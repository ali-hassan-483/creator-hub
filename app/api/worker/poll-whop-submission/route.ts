import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { validateVpsApiKey } from '@/lib/vps-service'
import { decryptIfPresent } from '@/lib/encryption'

export const dynamic = 'force-dynamic'

/**
 * GET /api/worker/poll-whop-submission?apiKey=xxx
 * Polls for the next pending Whop submission job for users assigned to this VPS node.
 * 
 * Rules:
 * 1. Only processes jobs for the users assigned to this specific VPS (e.g. up to 2 users).
 * 2. Picks the OLDEST pending submission across these users (FIFO / oldest first).
 * 3. Returns campaign details, Whop channel submission link, YouTube Short link, and cookies if saved.
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

    let assignedUserIds = vps.users.map((u) => u.id)
    if (assignedUserIds.length === 0) {
      if (vps.isMainVps) {
        // Main VPS serves as default fallback for users without an explicit dedicated VPS
        const fallbackUsers = await prisma.user.findMany({
          where: {
            OR: [
              { vpsId: null },
              { vpsId: vps.id },
            ],
          },
          select: { id: true },
        })
        assignedUserIds = fallbackUsers.map((u) => u.id)
      }

      if (assignedUserIds.length === 0) {
        return NextResponse.json({
          success: true,
          hasJob: false,
          message: 'No users currently assigned to this VPS node.',
        })
      }
    }

    // ── 1. Find all Automations belonging to assigned users that have pending Whop submissions ──
    const automations = await prisma.automation.findMany({
      where: {
        userId: { in: assignedUserIds },
      },
      include: {
        campaign: true,
        channels: {
          include: { channel: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    })

    interface CandidateJob {
      id: string
      automationId: string
      userId: string
      campaignId: string
      campaignName: string
      channelLink: string
      videoTitle: string
      videoLink: string
      whopEmail: string
      queuedAt: string
      queuedTimestamp: number
    }

    const candidates: CandidateJob[] = []

    for (const auto of automations) {
      const opts = (auto.options as Record<string, any>) || {}
      const whopList: any[] = opts.mockWhopSubmissions || []

      // Determine campaign for this automation
      const campaign = auto.campaign
      const campaignCfg = (campaign?.config as Record<string, any>) || {}
      const channelLink = campaignCfg.submissionLink || campaignCfg.whopChannelLink || ''
      const campaignName = campaign?.name || campaignCfg.whopChannelName || 'Campaign'

      for (const item of whopList) {
        if (!item.youtubeLink) continue

        // Check if pending (or in_progress for > 15 minutes that timed out)
        const isPending = item.status === 'pending'
        const isStuck = item.status === 'in_progress' && (Date.now() - new Date(item.inProgressAt || item.queuedAt).getTime() > 15 * 60 * 1000)

        if (isPending || isStuck) {
          // Identify whopEmail: item.whopEmail -> channel.whopEmail -> user email
          let whopEmail = item.whopEmail
          if (!whopEmail) {
            const ch = auto.channels.find(c => c.channel?.whopEmail)?.channel
            whopEmail = ch?.whopEmail || auto.channels[0]?.channel?.channelEmail || ''
          }

          const queuedTime = new Date(item.queuedAt || auto.createdAt).getTime()

          candidates.push({
            id: item.id,
            automationId: auto.id,
            userId: auto.userId,
            campaignId: campaign?.id || item.campaignId || '',
            campaignName,
            channelLink,
            videoTitle: item.videoTitle || 'Uploaded Short',
            videoLink: item.youtubeLink,
            whopEmail: whopEmail.trim().toLowerCase(),
            queuedAt: item.queuedAt || auto.createdAt.toISOString(),
            queuedTimestamp: queuedTime,
          })
        }
      }
    }

    if (candidates.length === 0) {
      return NextResponse.json({
        success: true,
        hasJob: false,
        message: 'No pending Whop submissions found for assigned users.',
      })
    }

    // ── 2. Sort by OLDEST first (ASC) ───────────────────────────────────────
    candidates.sort((a, b) => a.queuedTimestamp - b.queuedTimestamp)
    const selectedJob = candidates[0]

    // ── 3. Fetch Whop cookies for this user / whopEmail if present ──────────
    let decryptedCookies: string | null = null
    try {
      const cred = await prisma.credential.findFirst({
        where: {
          userId: selectedJob.userId,
          credentialType: 'whop',
          OR: [
            { email: { equals: selectedJob.whopEmail, mode: 'insensitive' } },
            { email: null },
          ],
        },
        orderBy: { updatedAt: 'desc' },
      })

      if (cred && cred.cookiesEnc) {
        decryptedCookies = decryptIfPresent(cred.cookiesEnc)
      }
    } catch (e: any) {
      console.warn(`[PollWhopSubmission] Warning reading cookies: ${e.message}`)
    }

    // ── 4. Mark item as in_progress to prevent duplicate processing ─────────
    try {
      const targetAuto = await prisma.automation.findUnique({
        where: { id: selectedJob.automationId },
      })
      if (targetAuto) {
        const opts = (targetAuto.options as Record<string, any>) || {}
        const whopList: any[] = opts.mockWhopSubmissions || []
        const updatedWhopList = whopList.map((item) => {
          if (item.id === selectedJob.id) {
            return {
              ...item,
              status: 'in_progress',
              inProgressAt: new Date().toISOString(),
              workerVps: vps.label,
            }
          }
          return item
        })

        await prisma.automation.update({
          where: { id: selectedJob.automationId },
          data: {
            options: {
              ...opts,
              mockWhopSubmissions: updatedWhopList,
            },
          },
        })
      }
    } catch (e: any) {
      console.warn(`[PollWhopSubmission] Failed to mark in_progress: ${e.message}`)
    }

    return NextResponse.json({
      success: true,
      hasJob: true,
      job: {
        jobId: selectedJob.id,
        automationId: selectedJob.automationId,
        userId: selectedJob.userId,
        whopEmail: selectedJob.whopEmail,
        campaignId: selectedJob.campaignId,
        campaignName: selectedJob.campaignName,
        channelLink: selectedJob.channelLink,
        videoTitle: selectedJob.videoTitle,
        videoLink: selectedJob.videoLink,
        queuedAt: selectedJob.queuedAt,
        cookies: decryptedCookies,
      },
    })
  } catch (err: any) {
    console.error('[Worker Poll Whop Submission] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
