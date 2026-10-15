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
 * External or local Worker VPS polls this endpoint to check for upload jobs
 * strictly isolated to the users assigned to that VPS.
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

    // Find active channels for assigned users with YouTube credentials
    const channels = await prisma.channel.findMany({
      where: {
        userId: { in: assignedUserIds },
        status: 'active',
        removedAt: null,
        clientId: { not: null },
        refreshTokenEnc: { not: null },
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    })

    if (channels.length === 0) {
      return NextResponse.json({
        success: true,
        hasJob: false,
        message: 'No active channels with YouTube credentials found for assigned users.',
      })
    }

    // Find active campaigns
    const campaigns = await prisma.campaign.findMany({
      where: { status: 'active' },
    })

    // Determine host origin for downloadUrl
    const hostHeader = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000'
    const protocol = req.headers.get('x-forwarded-proto') || 'https'
    const baseUrl = `${protocol}://${hostHeader}`

    for (const channel of channels) {
      const clientId = channel.clientId || ''
      const clientSecret = decryptIfPresent(channel.clientSecretEnc) || ''
      const refreshToken = decryptIfPresent(channel.refreshTokenEnc) || ''

      if (!refreshToken || !clientId || !clientSecret) continue

      for (const campaign of campaigns) {
        const clipsDir = getClipsDir(campaign.id)
        if (!fs.existsSync(clipsDir)) continue

        const postedDir = path.join(clipsDir, 'posted')
        const postedFiles = new Set(
          fs.existsSync(postedDir) ? fs.readdirSync(postedDir) : []
        )

        const allClips = fs
          .readdirSync(clipsDir)
          .filter((f) => f.endsWith('.mp4') && !postedFiles.has(f))

        if (allClips.length === 0) continue

        // Pick the first available unposted clip
        const clipFileName = allClips[0]
        const clipFullPath = path.join(clipsDir, clipFileName)
        const cfg = (campaign.config as any) || {}

        // Check for .meta.json file
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
      message: 'No pending ready clips available at this moment.',
    })
  } catch (err: any) {
    console.error('[Worker Poll Upload] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
