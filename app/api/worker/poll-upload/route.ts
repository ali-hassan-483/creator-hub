import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { validateVpsApiKey } from '@/lib/vps-service'
import { decryptIfPresent } from '@/lib/encryption'
import { getClipsDir } from '@/tools/campaign-processor'
import { getPakistanTodayStart } from '@/lib/date-utils'
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

    let minWaitSeconds: number | null = null

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

      // Auto-complete zombie automations created > 24 hours ago
      const isStale = (Date.now() - new Date(automation.createdAt).getTime()) > 24 * 60 * 60 * 1000
      if (isStale) {
        console.log(`[Worker Poll] Auto-completing stale automation ${automation.id} (created >24h ago)`)
        await prisma.automation.update({
          where: { id: automation.id },
          data: { status: 'completed', completedAt: new Date() },
        })
        continue
      }

      const opts = (automation.options as Record<string, any>) || {}
      const mockVideoUploads: any[] = opts.mockVideoUploads || []

      // Find channels in this automation that have NOT yet been attempted (succeeded, failed, or currently in_progress)
      const channelsNeedingUpload = automation.channels.filter((ac) => {
        const ch = ac.channel
        if (!ch || ch.status !== 'active' || ch.removedAt) return false

        // Check if this channel was already processed or is currently being uploaded by a worker
        const alreadyAttempted = mockVideoUploads.some((u) => {
          if (u.channelId !== ch.id) return false
          if (u.status === 'in_progress') {
            // Allow retry if in_progress has been stuck for > 15 minutes (worker crashed/timed out)
            const elapsed = Date.now() - new Date(u.uploadedAt).getTime()
            return elapsed < 15 * 60 * 1000
          }
          return true
        })
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

      // ── Enforce 2-Minute (120s) Wait Between Channel Uploads in Same Automation ──
      if (mockVideoUploads.length > 0) {
        let latestUploadTime = 0
        for (const u of mockVideoUploads) {
          if (u.uploadedAt) {
            const t = new Date(u.uploadedAt).getTime()
            if (t > latestUploadTime) latestUploadTime = t
          }
        }

        if (latestUploadTime > 0) {
          const elapsedMs = Date.now() - latestUploadTime
          const waitRequiredMs = 120 * 1000 // 2 minutes (120 seconds) cooldown
          if (elapsedMs < waitRequiredMs) {
            const remainingSec = Math.ceil((waitRequiredMs - elapsedMs) / 1000)
            console.log(
              `[Worker Poll] Automation ${automation.id}: waiting ${remainingSec}s before uploading next channel (120s inter-channel cooldown).`
            )
            if (minWaitSeconds === null || remainingSec < minWaitSeconds) {
              minWaitSeconds = remainingSec
            }
            continue
          }
        }
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
          mockVideoUploads.unshift(failureItem)
          const isAllDone = mockVideoUploads.length >= automation.channels.length
          const hasAnySuccess = mockVideoUploads.some((u: any) => !!u.youtubeLink)

          await prisma.automation.update({
            where: { id: automation.id },
            data: {
              status: isAllDone ? (hasAnySuccess ? 'completed' : 'failed') : 'running',
              completedAt: isAllDone ? new Date() : null,
              options: {
                ...opts,
                mockVideoUploads,
                runStatus: isAllDone ? (hasAnySuccess ? 'partial' : 'failed') : 'running',
              },
            },
          })
          continue
        }

        // ── Check Channel Daily Upload Limit (STRICT RULE: Max 1 video per channel per day, resets 12 AM PKT) ──
        const todayStart = getPakistanTodayStart()

        // 1. Check VideoAnalytic for successful uploads today for this channel
        const uploadsTodayCount = await prisma.videoAnalytic.count({
          where: {
            channelId: channel.id,
            publishedAt: { gte: todayStart },
          },
        })

        // 2. Also check all automations today for successful uploads to this channel
        let hasUploadedToday = uploadsTodayCount >= 1
        if (!hasUploadedToday) {
          const todayAutos = await prisma.automation.findMany({
            where: {
              userId: automation.userId,
              createdAt: { gte: todayStart },
            },
            select: { options: true },
          })
          for (const auto of todayAutos) {
            const autoUploads = ((auto.options as any)?.mockVideoUploads || []) as any[]
            if (autoUploads.some((u: any) => u.channelId === channel.id && !!u.youtubeLink)) {
              hasUploadedToday = true
              break
            }
          }
        }

        if (hasUploadedToday) {
          console.log(
            `[Worker Poll] Channel @${channel.channelHandle} skipped: Channel already uploaded 1 video today (daily limit reached since 12:00 AM PKT).`
          )
          const skipItem = {
            id: `skip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            channelId: channel.id,
            channelName: channel.channelName || channel.channelHandle || 'YouTube Channel',
            campaign: campaign.name,
            stage: 'Daily Limit Reached',
            videoTitle: 'Channel already uploaded today',
            youtubeLink: null,
            error: 'Channel reached daily upload limit (1 video per channel/day). Next upload available after 12:00 AM PKT.',
            uploadedAt: new Date().toISOString(),
            vpsNode: vps.label,
          }
          mockVideoUploads.unshift(skipItem)
          const isAllDone = mockVideoUploads.length >= automation.channels.length
          const hasAnySuccess = mockVideoUploads.some((u: any) => !!u.youtubeLink)

          await prisma.automation.update({
            where: { id: automation.id },
            data: {
              status: isAllDone ? (hasAnySuccess ? 'completed' : 'failed') : 'running',
              completedAt: isAllDone ? new Date() : null,
              options: {
                ...opts,
                mockVideoUploads,
                runStatus: isAllDone ? (hasAnySuccess ? 'partial' : 'failed') : 'running',
              },
            },
          })
          continue
        }

        // ── Check Campaign Whop Daily Post Limit ──
        const campaignCfg = (campaign.config as Record<string, any>) || {}
        const dailyWhopLimit = Number(campaignCfg.dailyPostLimit) || 30
        const whopEmail = (channel.whopEmail || '').trim().toLowerCase()

        if (whopEmail && dailyWhopLimit > 0) {
          // Reset daily at 12:00 AM Pakistan Time (PKT, UTC+5)
          const todayStart = getPakistanTodayStart()

          const whopChannels = await prisma.channel.findMany({
            where: {
              userId: automation.userId,
              whopEmail: channel.whopEmail,
              removedAt: null,
            },
            select: { id: true },
          })
          const whopChannelIdSet = new Set(whopChannels.map((c) => c.id))

          const todayAutomations = await prisma.automation.findMany({
            where: {
              userId: automation.userId,
              campaignId: campaign.id,
              createdAt: { gte: todayStart },
            },
            select: { id: true, options: true },
          })

          let totalWhopUploadsToday = 0
          for (const auto of todayAutomations) {
            const autoUploads = ((auto.options as Record<string, any>)?.mockVideoUploads || []) as any[]
            for (const u of autoUploads) {
              if (u.youtubeLink && u.channelId && whopChannelIdSet.has(u.channelId)) {
                totalWhopUploadsToday++
              }
            }
          }

          if (totalWhopUploadsToday >= dailyWhopLimit) {
            console.log(
              `[Worker Poll] Channel @${channel.channelHandle} skipped: Whop email "${whopEmail}" reached daily limit (${totalWhopUploadsToday}/${dailyWhopLimit})`
            )
            const skipItem = {
              id: `skip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              channelId: channel.id,
              channelName: channel.channelName || channel.channelHandle || 'YouTube Channel',
              campaign: campaign.name,
              stage: 'Limit Exceeded',
              videoTitle: 'Whop daily limit reached',
              youtubeLink: null,
              error: `Whop account daily limit (${dailyWhopLimit}) reached for ${whopEmail}`,
              uploadedAt: new Date().toISOString(),
              vpsNode: vps.label,
            }
            mockVideoUploads.unshift(skipItem)
            const isAllDone = mockVideoUploads.length >= automation.channels.length
            const hasAnySuccess = mockVideoUploads.some((u: any) => !!u.youtubeLink)

            await prisma.automation.update({
              where: { id: automation.id },
              data: {
                status: isAllDone ? (hasAnySuccess ? 'completed' : 'failed') : 'running',
                completedAt: isAllDone ? new Date() : null,
                options: {
                  ...opts,
                  mockVideoUploads,
                  runStatus: isAllDone ? (hasAnySuccess ? 'partial' : 'failed') : 'running',
                },
              },
            })
            continue
          }
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
          mockVideoUploads.unshift(failureItem)
          const isAllDone = mockVideoUploads.length >= automation.channels.length
          const hasAnySuccess = mockVideoUploads.some((u: any) => !!u.youtubeLink)

          await prisma.automation.update({
            where: { id: automation.id },
            data: {
              status: isAllDone ? (hasAnySuccess ? 'completed' : 'failed') : 'running',
              completedAt: isAllDone ? new Date() : null,
              options: {
                ...opts,
                mockVideoUploads,
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

        // Find clips currently in-progress across any channel in this automation run
        // so multiple parallel channels NEVER pick the exact same clip!
        const inProgressClips = new Set(
          mockVideoUploads
            .filter((u: any) => u.status === 'in_progress' && u.clipFilename)
            .map((u: any) => u.clipFilename)
        )

        const allClips = fs
          .readdirSync(clipsDir)
          .filter((f) => f.endsWith('.mp4') && !postedFiles.has(f) && !inProgressClips.has(f))

        if (allClips.length === 0) {
          console.warn(`[Worker Poll] No available (unreserved) clips left in campaign ${campaign.name} (${inProgressClips.size} currently in-progress)`)
          continue
        }

        // Pick exactly 1 available unreserved clip
        const clipFileName = allClips[0]
        const cfg = (campaign.config as Record<string, any>) || {}

        // Look for corresponding .meta.json file — meta title/description takes PRIORITY
        const metaFileName = clipFileName.replace(/\.mp4$/, '.meta.json')
        const metaFullPath = path.join(clipsDir, metaFileName)

        let title = ''
        let description = ''
        let tags = ['shorts', 'viral', (cfg.niche || 'trending').toLowerCase()]

        // 1. Try meta.json first (AI-generated title/description per clip)
        if (fs.existsSync(metaFullPath)) {
          try {
            const meta = JSON.parse(fs.readFileSync(metaFullPath, 'utf8'))
            if (meta.title) title = meta.title
            if (meta.description) description = meta.description
            if (meta.hashtags && Array.isArray(meta.hashtags)) tags = meta.hashtags
            if (title) console.log(`[Worker Poll] ✅ Loaded meta.json for ${clipFileName}: "${title}"`)
            else console.warn(`[Worker Poll] ⚠️ meta.json exists but title is empty for ${clipFileName}`)
          } catch (e) {
            console.warn(`[Worker Poll] ⚠️ Failed to parse meta.json for ${clipFileName}: ${e}`)
          }
        } else {
          console.warn(`[Worker Poll] ⚠️ No meta.json found for ${clipFileName} at ${metaFullPath}`)
        }

        // 2. Check if this title was already used by another channel in this automation run
        const alreadyUsedTitles = new Set(
          mockVideoUploads
            .map((u: any) => (u.videoTitle || '').trim().toLowerCase())
            .filter(Boolean)
        )
        const isDuplicateTitle = !!(title && alreadyUsedTitles.has(title.trim().toLowerCase()))

        // 3. If meta had no title or description OR if title was already used for another clip in this run,
        // generate on-the-fly fresh unique AI metadata (NEVER upload duplicate titles!)
        if (!title || !description || isDuplicateTitle) {
          if (isDuplicateTitle) {
            console.log(`[Worker Poll] ⚠️ Title "${title}" was already used by another channel in this run. Generating a fresh unique AI title & description for ${clipFileName}...`)
          } else {
            console.log(`[Worker Poll] 🤖 Metadata missing/incomplete for ${clipFileName}. Generating AI title & description on the fly...`)
          }
          try {
            const { generateBatchMetadataFromGuidelines } = await import('@/tools/ai-clipper')
            const aiBatch = await generateBatchMetadataFromGuidelines(1, {
              // DB stores fields as titlesAiGuide / descriptionsAiGuide / onScreenTextAiGuide
              titlesGuide: cfg.titlesAiGuide || cfg.titlesGuide || '',
              descriptionsGuide: cfg.descriptionsAiGuide || cfg.descriptionsGuide || '',
              onScreenGuide: cfg.onScreenTextAiGuide || cfg.onScreenAiGuide || '',
              ftcDisclosure: cfg.ftcDisclosure,
              predefinedDescription: cfg.predefinedDescription,
              useOnlyPredefinedDescription: cfg.useOnlyPredefinedDescription || cfg.useOnlyPredefinedDesc,
              linksInDescription: cfg.linksInDescription,
              maxTitleChars: cfg.maxTitleCharacters ? parseInt(cfg.maxTitleCharacters) : 100,
              niche: cfg.niche,
              campaignName: campaign.name,
            })
            if (aiBatch && aiBatch[0]) {
              title = aiBatch[0].title
              description = aiBatch[0].description
              if (aiBatch[0].hashtags && aiBatch[0].hashtags.length > 0) tags = aiBatch[0].hashtags
              // Save meta.json file so it is permanently cached and never empty or duplicate again
              fs.writeFileSync(
                metaFullPath,
                JSON.stringify({
                  clipId: clipFileName.replace(/\.mp4$/, ''),
                  videoPath: path.join(clipsDir, clipFileName),
                  title,
                  description,
                  onScreenText: aiBatch[0].onScreenText,
                  hashtags: tags,
                  createdAt: new Date().toISOString(),
                }, null, 2),
                'utf8'
              )
              console.log(`[Worker Poll] ✅ AI generated & saved unique meta.json for ${clipFileName}: "${title}"`)
            }
          } catch (aiErr: any) {
            console.error(`[Worker Poll] ❌ AI metadata on-the-fly generation failed: ${aiErr.message}`)
          }
        }

        // Final safety check: if AI failed, derive an engaging title from campaign rather than a raw fallback
        if (!title) {
          title = cfg.onScreenTextPool
            ? cfg.onScreenTextPool.split('\n')[0].slice(0, 60)
            : `How To Win Big With ${campaign.name}`
        }
        if (!description) {
          description = `${cfg.predefinedDescription || ''}\n\n${cfg.linksInDescription || ''}`.trim()
          if (!description) {
            description = `Watch ${campaign.name}! Tap the link to learn more. #shorts #viral #${(cfg.niche || 'trending').toLowerCase().replace(/\s+/g, '')}`
          }
        }

        const downloadUrl = `${baseUrl}/api/n8n/video-stream?campaignId=${campaign.id}&file=${encodeURIComponent(clipFileName)}`
        const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`

        // 🚀 IN-FLIGHT JOB LOCK: Record this channel as in_progress immediately in the automation
        // so no concurrent worker or poll can pick this channel a second time!
        const inProgressItem = {
          id: jobId,
          channelId: channel.id,
          channelName: channel.channelName || channel.channelHandle || 'YouTube Channel',
          campaign: campaign.name,
          stage: 'Uploading to YouTube...',
          videoTitle: title,
          clipFilename: clipFileName,
          youtubeLink: null,
          uploadedAt: new Date().toISOString(),
          vpsNode: vps.label,
          status: 'in_progress',
        }
        mockVideoUploads.unshift(inProgressItem)
        await prisma.automation.update({
          where: { id: automation.id },
          data: {
            options: {
              ...opts,
              mockVideoUploads,
            },
          },
        })

        return NextResponse.json({
          success: true,
          hasJob: true,
          job: {
            jobId,
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

    if (minWaitSeconds !== null && minWaitSeconds > 0) {
      return NextResponse.json({
        success: true,
        hasJob: false,
        cooldownSeconds: minWaitSeconds,
        message: `Waiting 2 minutes between channel uploads (${minWaitSeconds}s remaining).`,
      })
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
