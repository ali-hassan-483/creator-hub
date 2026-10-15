import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { validateVpsApiKey } from '@/lib/vps-service'
import { decryptIfPresent } from '@/lib/encryption'
import { getClipsDir } from '@/tools/campaign-processor'
import * as fs from 'fs'
import * as path from 'path'

export const dynamic = 'force-dynamic'

/**
 * GET /api/worker/poll-upload?apiKey=xxx
 * External or local Worker VPS polls this endpoint.
 *
 * STRICT RULE:
 * 1 Automation Trigger = Exactly 1 Video Clip Per Selected Channel!
 * If there is no queued/running automation for the assigned users, worker stays idle.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const apiKey = searchParams.get('apiKey') || req.headers.get('x-vps-key')

    if (!apiKey) {
      return NextResponse.json({ error: 'apiKey query parameter is required' }, { status: 401 })
    }

    const vps = await validateVpsApiKey(apiKey)
    if (!vps) {
      return NextResponse.json({ error: 'Invalid or unregistered VPS API Key' }, { status: 403 })
    }

    const assignedUserIds = vps.users.map((u) => u.id)
    if (assignedUserIds.length === 0) {
      return NextResponse.json({
        success: true,
        hasJob: false,
        message: 'No users currently assigned to this VPS node.',
      })
    }

    // ── 1. Find Pending (queued or running) Automation Runs for Assigned Users ────
    const pendingAutomations = await prisma.automation.findMany({
      where: {
        userId: { in: assignedUserIds },
        status: { in: ['queued', 'running'] },
      },
      include: {
        channels: {
          include: {
            channel: true,
          },
        },
        campaign: true,
      },
      orderBy: { createdAt: 'asc' },
    })

    if (pendingAutomations.length === 0) {
      return NextResponse.json({
        success: true,
        hasJob: false,
        message: 'No queued automation runs. Worker is idle.',
      })
    }

    // Determine host origin for downloadUrl
    const hostHeader = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000'
    const protocol = req.headers.get('x-forwarded-proto') || 'https'
    const baseUrl = `${protocol}://${hostHeader}`

    for (const automation of pendingAutomations) {
      const campaign = automation.campaign
      if (!campaign || campaign.status !== 'active') {
        // If campaign is inactive or deleted, mark automation cancelled
        await prisma.automation.update({
          where: { id: automation.id },
          data: { status: 'cancelled' },
        })
        continue
      }

      const opts = (automation.options as Record<string, any>) || {}
      const mockVideoUploads: any[] = opts.mockVideoUploads || []

      // Find channels in this automation that have NOT yet been attempted (succeeded or failed)
      const channelsNeedingUpload = automation.channels.filter((ac) => {
        const ch = ac.channel
        if (!ch || ch.status !== 'active' || ch.removedAt) return false

        // Check if this channel was already processed (either succeeded or failed) in this automation run
        const alreadyAttempted = mockVideoUploads.some(
          (u) => u.channelId === ch.id
        )
        return !alreadyAttempted
      })

      // If all channels in this automation run have been processed, mark finished!
      if (channelsNeedingUpload.length === 0) {
        const hasSuccess = mockVideoUploads.some((u) => !!u.youtubeLink)
        const hasFailed = mockVideoUploads.some((u) => !u.youtubeLink)
        const finalStatus = (hasSuccess && hasFailed) ? 'completed' : hasFailed ? 'failed' : 'completed'
        const finalRunStatus = (hasSuccess && hasFailed) ? 'partial' : hasFailed ? 'failed' : 'success'

        await prisma.automation.update({
          where: { id: automation.id },
          data: {
            status: finalStatus,
            completedAt: new Date(),
            options: {
              ...opts,
              runStatus: finalRunStatus,
            },
          },
        })
        continue
      }

      // Mark automation as running if it was queued
      if (automation.status === 'queued') {
        await prisma.automation.update({
          where: { id: automation.id },
          data: { status: 'running', startedAt: new Date() },
        })
      }

      // Pick the first channel in this automation that needs a video
      for (const ac of channelsNeedingUpload) {
        const channel = ac.channel
        const extra = (channel.extraData as Record<string, any>) || {}

        // Check YouTube 24h upload cooldown
        if (extra.uploadCooldownUntil && new Date(extra.uploadCooldownUntil) > new Date()) {
          console.log(`[Worker Poll] Channel @${channel.channelHandle} is on cooldown until ${extra.uploadCooldownUntil}`)
          const failureItem = {
            id: `fail_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            channelId: channel.id,
            channelName: channel.channelName || channel.channelHandle || 'YouTube Channel',
            campaign: campaign.name,
            stage: 'Upload Failed',
            videoTitle: 'Daily limit cooldown active',
            youtubeLink: null,
            error: `YouTube 24h cooldown active until ${new Date(extra.uploadCooldownUntil).toLocaleTimeString()}`,
            uploadedAt: new Date().toISOString(),
            vpsNode: vps.label,
          }
          const updatedUploads = [failureItem, ...mockVideoUploads]
          const isAllDone = updatedUploads.length >= automation.channels.length
          const hasAnySuccess = updatedUploads.some((u: any) => !!u.youtubeLink)

          await prisma.automation.update({
            where: { id: automation.id },
            data: {
              status: isAllDone ? (hasAnySuccess ? 'completed' : 'failed') : 'running',
              completedAt: isAllDone ? new Date() : null,
              options: {
                ...opts,
                mockVideoUploads: updatedUploads,
                runStatus: isAllDone ? (hasAnySuccess ? 'partial' : 'failed') : 'running',
              },
            },
          })
          continue
        }

        const clientId = channel.clientId || ''
        const clientSecret = decryptIfPresent(channel.clientSecretEnc) || ''
        const refreshToken = decryptIfPresent(channel.refreshTokenEnc) || ''

        if (!refreshToken || !clientId || !clientSecret) {
          console.warn(`[Worker Poll] Channel @${channel.channelHandle} is missing Google credentials.`)
          const failureItem = {
            id: `fail_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            channelId: channel.id,
            channelName: channel.channelName || channel.channelHandle || 'YouTube Channel',
            campaign: campaign.name,
            stage: 'Upload Failed',
            videoTitle: 'Credentials Missing',
            youtubeLink: null,
            error: 'Missing Google OAuth credentials',
            uploadedAt: new Date().toISOString(),
            vpsNode: vps.label,
          }
          const updatedUploads = [failureItem, ...mockVideoUploads]
          const isAllDone = updatedUploads.length >= automation.channels.length
          const hasAnySuccess = updatedUploads.some((u: any) => !!u.youtubeLink)

          await prisma.automation.update({
            where: { id: automation.id },
            data: {
              status: isAllDone ? (hasAnySuccess ? 'completed' : 'failed') : 'running',
              completedAt: isAllDone ? new Date() : null,
              options: {
                ...opts,
                mockVideoUploads: updatedUploads,
                runStatus: isAllDone ? (hasAnySuccess ? 'partial' : 'failed') : 'running',
              },
            },
          })
          continue
        }

        // Find available unposted clips in campaign directory
        const clipsDir = getClipsDir(campaign.id)
        if (!fs.existsSync(clipsDir)) continue

        const postedDir = path.join(clipsDir, 'posted')
        const postedFiles = new Set(
          fs.existsSync(postedDir) ? fs.readdirSync(postedDir) : []
        )

        const allClips = fs
          .readdirSync(clipsDir)
          .filter((f) => f.endsWith('.mp4') && !postedFiles.has(f))

        if (allClips.length === 0) {
          console.warn(`[Worker Poll] No unposted clips left in campaign ${campaign.name}`)
          continue
        }

        // Pick exactly 1 available clip
        const clipFileName = allClips[0]
        const cfg = (campaign.config as Record<string, any>) || {}

        // Look for corresponding .meta.json file
        const metaFileName = clipFileName.replace(/\.mp4$/, '.meta.json')
        const metaFullPath = path.join(clipsDir, metaFileName)

        let title = cfg.onScreenTextPool
          ? cfg.onScreenTextPool.split('\n')[0].slice(0, 60)
          : `${campaign.name} Short`
        let description = `${cfg.predefinedDescription || ''}\n\n${cfg.linksInDescription || ''}`.trim()
        let tags = ['shorts', 'viral', (cfg.niche || 'trending').toLowerCase()]

        if (fs.existsSync(metaFullPath)) {
          try {
            const meta = JSON.parse(fs.readFileSync(metaFullPath, 'utf8'))
            if (meta.title) title = meta.title
            if (meta.description) description = meta.description
            if (meta.hashtags && Array.isArray(meta.hashtags)) tags = meta.hashtags
          } catch {}
        }

        const downloadUrl = `${baseUrl}/api/n8n/video-stream?campaignId=${campaign.id}&file=${encodeURIComponent(clipFileName)}`

        return NextResponse.json({
          success: true,
          hasJob: true,
          job: {
            jobId: `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            automationId: automation.id,
            channel: {
              id: channel.id,
              channelName: channel.channelName || channel.channelHandle || 'YouTube Channel',
              channelHandle: channel.channelHandle,
              channelEmail: channel.channelEmail,
              clientId,
              clientSecret,
              refreshToken,
            },
            campaign: {
              id: campaign.id,
              name: campaign.name,
              niche: cfg.niche || 'General',
            },
            clip: {
              filename: clipFileName,
              downloadUrl,
              title,
              description,
              tags,
            },
          },
        })
      }
    }

    return NextResponse.json({
      success: true,
      hasJob: false,
      message: 'All queued automations are processed or channels are on cooldown.',
    })
  } catch (err: any) {
    console.error('[Worker Poll Upload] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
