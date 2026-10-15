import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

// ─── Seed mock data for test user ─────────────────────────────────────────────
async function seedTestData(userId: string) {
  // Check if test data already exists
  const existing = await prisma.automation.findFirst({
    where: { userId, name: { contains: '[TEST]' } },
  })
  if (existing) return { message: 'Test data already seeded' }

  // Get user's first campaign and channels
  const campaigns = await prisma.campaign.findMany({
    where: { userAccess: { some: { userId } } },
    take: 3,
  })
  const channels = await prisma.channel.findMany({
    where: { userId, removedAt: null },
    take: 4,
  })

  if (campaigns.length === 0 || channels.length === 0) {
    return { message: 'No campaigns/channels found to seed data against' }
  }

  const now = new Date()
  const msAgo = (mins: number) => new Date(now.getTime() - mins * 60 * 1000)

  // Mock automation runs
  const runs = [
    {
      name: '[TEST] Morning Batch Run',
      campaignId: campaigns[0]?.id,
      runType: 'immediate' as const,
      status: 'completed' as const,
      startedAt: msAgo(180),
      completedAt: msAgo(150),
      channelSlots: [channels[0]?.id, channels[1]?.id].filter(Boolean),
      options: {
        mockVideoUploads: [
          {
            id: 'upl_001',
            channelId: channels[0]?.id,
            channelName: channels[0]?.channelName || '@TechChannel1',
            campaign: campaigns[0]?.name || 'Campaign Alpha',
            stage: 'Video Uploaded',
            videoTitle: 'How to 10x Your Productivity with AI Tools | Full Guide',
            youtubeLink: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
            uploadedAt: msAgo(160).toISOString(),
          },
          {
            id: 'upl_002',
            channelId: channels[1]?.id,
            channelName: channels[1]?.channelName || '@GrowthHacks',
            campaign: campaigns[0]?.name || 'Campaign Alpha',
            stage: 'Video Uploaded',
            videoTitle: 'Secret AI Workflow Nobody Talks About (2025)',
            youtubeLink: 'https://youtube.com/watch?v=abc123def',
            uploadedAt: msAgo(158).toISOString(),
          },
        ],
        mockWhopSubmissions: [
          {
            id: 'whop_001',
            videoTitle: 'How to 10x Your Productivity with AI Tools | Full Guide',
            youtubeLink: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
            queuedAt: msAgo(160).toISOString(),
            timeTaken: 12,
            status: 'submitted',
          },
          {
            id: 'whop_002',
            videoTitle: 'Secret AI Workflow Nobody Talks About (2025)',
            youtubeLink: 'https://youtube.com/watch?v=abc123def',
            queuedAt: msAgo(158).toISOString(),
            timeTaken: 8,
            status: 'submitted',
          },
        ],
      },
    },
    {
      name: '[TEST] Partial Run - Mixed Results',
      campaignId: campaigns[1]?.id || campaigns[0]?.id,
      runType: 'scheduled' as const,
      status: 'completed' as const,
      startedAt: msAgo(90),
      completedAt: msAgo(65),
      channelSlots: [channels[0]?.id, channels[2]?.id, channels[3]?.id].filter(Boolean),
      options: {
        mockVideoUploads: [
          {
            id: 'upl_003',
            channelId: channels[0]?.id,
            channelName: channels[0]?.channelName || '@TechChannel1',
            campaign: campaigns[1]?.name || 'Campaign Beta',
            stage: 'Video Uploaded',
            videoTitle: 'The Only YouTube Growth Strategy You Need in 2025',
            youtubeLink: 'https://youtube.com/watch?v=xyz987abc',
            uploadedAt: msAgo(80).toISOString(),
          },
          {
            id: 'upl_004',
            channelId: channels[2]?.id,
            channelName: channels[2]?.channelName || '@ViralClips',
            campaign: campaigns[1]?.name || 'Campaign Beta',
            stage: 'Upload Failed',
            videoTitle: 'Why Every Creator Needs a Content Calendar',
            youtubeLink: null,
            uploadedAt: msAgo(78).toISOString(),
          },
        ],
        mockWhopSubmissions: [
          {
            id: 'whop_003',
            videoTitle: 'The Only YouTube Growth Strategy You Need in 2025',
            youtubeLink: 'https://youtube.com/watch?v=xyz987abc',
            queuedAt: msAgo(80).toISOString(),
            timeTaken: 15,
            status: 'submitted',
          },
        ],
        runStatus: 'partial',
      },
    },
    {
      name: '[TEST] Cancelled - Credential Missing',
      campaignId: campaigns[0]?.id,
      runType: 'immediate' as const,
      status: 'cancelled' as const,
      startedAt: msAgo(40),
      completedAt: msAgo(39),
      channelSlots: [channels[0]?.id].filter(Boolean),
      options: {
        mockVideoUploads: [],
        mockWhopSubmissions: [],
        cancelReason: 'YouTube credentials not found for channel email',
        runStatus: 'cancelled',
      },
    },
    {
      name: '[TEST] Recent - Pending Whop Submission',
      campaignId: campaigns[0]?.id,
      runType: 'immediate' as const,
      status: 'completed' as const,
      startedAt: msAgo(22),
      completedAt: msAgo(18),
      channelSlots: [channels[0]?.id, channels[1]?.id].filter(Boolean),
      options: {
        mockVideoUploads: [
          {
            id: 'upl_005',
            channelId: channels[0]?.id,
            channelName: channels[0]?.channelName || '@TechChannel1',
            campaign: campaigns[0]?.name || 'Campaign Alpha',
            stage: 'Video Uploaded',
            videoTitle: 'I Used AI to Make 30 Videos in One Day - Here\'s What Happened',
            youtubeLink: 'https://youtube.com/watch?v=newvideo123',
            uploadedAt: msAgo(20).toISOString(),
          },
          {
            id: 'upl_006',
            channelId: channels[1]?.id,
            channelName: channels[1]?.channelName || '@GrowthHacks',
            campaign: campaigns[0]?.name || 'Campaign Alpha',
            stage: 'Video Uploaded',
            videoTitle: 'Making \$500/Day with Short-Form Content Automation',
            youtubeLink: 'https://youtube.com/watch?v=newvideo456',
            uploadedAt: msAgo(19).toISOString(),
          },
        ],
        mockWhopSubmissions: [
          {
            id: 'whop_005',
            videoTitle: 'I Used AI to Make 30 Videos in One Day - Here\'s What Happened',
            youtubeLink: 'https://youtube.com/watch?v=newvideo123',
            queuedAt: msAgo(20).toISOString(),
            timeTaken: null,
            status: 'pending',
          },
          {
            id: 'whop_006',
            videoTitle: 'Making \$500/Day with Short-Form Content Automation',
            youtubeLink: 'https://youtube.com/watch?v=newvideo456',
            queuedAt: msAgo(19).toISOString(),
            timeTaken: null,
            status: 'pending',
          },
        ],
        runStatus: 'success',
      },
    },
  ]

  for (const run of runs) {
    const { channelSlots, ...runData } = run
    await prisma.automation.create({
      data: {
        userId,
        campaignId: runData.campaignId,
        name: runData.name,
        runType: runData.runType,
        status: runData.status,
        startedAt: runData.startedAt,
        completedAt: runData.completedAt,
        options: runData.options,
        channels: {
          create: (channelSlots as string[]).map((cid) => ({ channelId: cid })),
        },
      },
    })
  }

  return { message: 'Test data seeded successfully', count: runs.length }
}

// ─── GET /api/user/run-logs ────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const session = await requireAuth()
  const userId = session.user.id

  const { searchParams } = new URL(req.url)
  const page = parseInt(searchParams.get('page') || '1', 10)
  const limit = parseInt(searchParams.get('limit') || '20', 10)
  const skip = (page - 1) * limit

  try {
    const [automations, total] = await Promise.all([
      prisma.automation.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          campaign: { select: { id: true, name: true } },
          channels: {
            include: {
              channel: {
                select: {
                  id: true,
                  channelName: true,
                  channelHandle: true,
                  channelEmail: true,
                  whopEmail: true,
                },
              },
            },
          },
        },
      }),
      prisma.automation.count({ where: { userId } }),
    ])

    const rows = automations.map((auto) => {
      const opts = (auto.options as any) || {}
      const mockUploads: any[] = opts.mockVideoUploads || []
      const mockWhop: any[] = opts.mockWhopSubmissions || []

      // Build channelId -> whopEmail map from the automation's linked channels
      const channelWhopMap: Record<string, string> = {}
      for (const ac of auto.channels) {
        channelWhopMap[ac.channel.id] = ac.channel.whopEmail || ''
      }

      // Build videoTitle / youtubeLink -> channelId lookup from mockUploads
      const uploadMap: Record<string, string> = {}
      for (const u of mockUploads) {
        const cWhop = u.channelId ? (channelWhopMap[u.channelId] || '') : ''
        if (u.videoTitle && cWhop) uploadMap[u.videoTitle] = cWhop
        if (u.youtubeLink && cWhop) uploadMap[u.youtubeLink] = cWhop
      }

      // Derive display status
      let displayStatus: 'success' | 'partial' | 'cancelled' | 'running' | 'queued' | 'failed' | 'paused' =
        'queued'
      if (auto.status === 'cancelled' || opts.runStatus === 'cancelled') {
        displayStatus = 'cancelled'
      } else if (auto.status === 'paused' || opts.runStatus === 'paused') {
        displayStatus = 'paused'
      } else if (auto.status === 'failed' || opts.runStatus === 'failed') {
        displayStatus = 'failed'
      } else if (auto.status === 'running' || opts.runStatus === 'running') {
        displayStatus = 'running'
      } else if (auto.status === 'completed') {
        const hasFailedUpload = mockUploads.some((u) => !u.youtubeLink)
        displayStatus = opts.runStatus === 'partial' || hasFailedUpload ? 'partial' : 'success'
      }

      // Inject whopEmail into each whop submission
      const enrichedWhopSubmissions = mockWhop.map((sub: any) => {
        let email = sub.whopEmail || ''
        if (!email && sub.channelId) {
          email = channelWhopMap[sub.channelId] || ''
        }
        if (!email && sub.videoTitle) {
          email = uploadMap[sub.videoTitle] || ''
        }
        if (!email && sub.youtubeLink) {
          email = uploadMap[sub.youtubeLink] || ''
        }
        if (!email && auto.channels.length > 0) {
          email = auto.channels[0]?.channel?.whopEmail || ''
        }
        return {
          ...sub,
          whopEmail: email,
        }
      })

      return {
        id: auto.id,
        triggeredAt: auto.createdAt,
        startedAt: auto.startedAt,
        completedAt: auto.completedAt,
        name: auto.name,
        runType: auto.runType,
        status: displayStatus,
        rawStatus: auto.status,
        campaign: auto.campaign ? { id: auto.campaign.id, name: auto.campaign.name } : null,
        channels: auto.channels.map((ac) => ({
          id: ac.channel.id,
          name: ac.channel.channelName || 'YouTube Channel',
          handle: ac.channel.channelHandle || '',
          email: ac.channel.channelEmail || '',
          whopEmail: ac.channel.whopEmail || '',
        })),
        activeSlots: auto.channels.length,
        videoUploads: mockUploads,
        whopSubmissions: enrichedWhopSubmissions,
        cancelReason: opts.cancelReason || null,
        errorMessage: auto.errorMessage,
      }
    })

    return NextResponse.json({ rows, total, page, limit, totalPages: Math.ceil(total / limit) })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to fetch run logs' }, { status: 500 })
  }
}

// ─── POST /api/user/run-logs ───────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const session = await requireAuth()
  const userId = session.user.id

  try {
    const body = await req.json()
    const { action } = body

    if (action === 'seed_test_data') {
      const result = await seedTestData(userId)
      return NextResponse.json({ success: true, ...result })
    }

    if (action === 'pause') {
      const { automationId } = body
      if (!automationId) {
        return NextResponse.json({ error: 'automationId required' }, { status: 400 })
      }
      const auto = await prisma.automation.findFirst({
        where: { id: automationId, userId },
      })
      if (!auto) {
        return NextResponse.json({ error: 'Automation not found' }, { status: 404 })
      }
      const opts = (auto.options as any) || {}
      await prisma.automation.update({
        where: { id: automationId },
        data: {
          status: 'paused',
          options: { ...opts, runStatus: 'paused' },
        },
      })
      return NextResponse.json({ success: true, message: 'Automation paused' })
    }

    if (action === 'resume') {
      const { automationId } = body
      if (!automationId) {
        return NextResponse.json({ error: 'automationId required' }, { status: 400 })
      }
      const auto = await prisma.automation.findFirst({
        where: { id: automationId, userId },
      })
      if (!auto) {
        return NextResponse.json({ error: 'Automation not found' }, { status: 404 })
      }
      const opts = (auto.options as any) || {}
      await prisma.automation.update({
        where: { id: automationId },
        data: {
          status: 'running',
          options: { ...opts, runStatus: 'running' },
        },
      })
      return NextResponse.json({ success: true, message: 'Automation resumed' })
    }

    if (action === 'cancel') {
      const { automationId } = body
      if (!automationId) {
        return NextResponse.json({ error: 'automationId required' }, { status: 400 })
      }
      const auto = await prisma.automation.findFirst({
        where: { id: automationId, userId },
      })
      if (!auto) {
        return NextResponse.json({ error: 'Automation not found' }, { status: 404 })
      }
      const opts = (auto.options as any) || {}
      await prisma.automation.update({
        where: { id: automationId },
        data: {
          status: 'cancelled',
          options: {
            ...opts,
            cancelReason: 'Stopped by user',
            runStatus: 'cancelled',
          },
        },
      })
      return NextResponse.json({ success: true, message: 'Automation cancelled' })
    }

    if (action === 'delete') {
      const { automationId } = body
      if (!automationId) {
        return NextResponse.json({ error: 'automationId required' }, { status: 400 })
      }
      const auto = await prisma.automation.findFirst({
        where: { id: automationId, userId },
      })
      if (!auto) {
        return NextResponse.json({ error: 'Automation not found' }, { status: 404 })
      }
      await prisma.automationChannel.deleteMany({ where: { automationId } })
      await prisma.automationCredential.deleteMany({ where: { automationId } })
      await prisma.automation.delete({ where: { id: automationId, userId } })
      return NextResponse.json({ success: true, message: 'Automation run deleted successfully' })
    }

    if (action === 'rerun') {
      const { automationId } = body
      if (!automationId) {
        return NextResponse.json({ error: 'automationId required' }, { status: 400 })
      }
      const original = await prisma.automation.findFirst({
        where: { id: automationId, userId },
        include: { channels: true },
      })
      if (!original) {
        return NextResponse.json({ error: 'Automation not found' }, { status: 404 })
      }

      // Filter only channels that did NOT have a successful upload
      const opts = (original.options as any) || {}
      const mockUploads: any[] = opts.mockVideoUploads || []
      const succeededChannelIds = new Set(
        mockUploads.filter((u: any) => !!u.youtubeLink).map((u: any) => u.channelId)
      )

      const failedChannels = original.channels.filter(
        (c) => !succeededChannelIds.has(c.channelId)
      )
      const rerunChannels = failedChannels.length > 0 ? failedChannels : original.channels

      const newRun = await prisma.automation.create({
        data: {
          userId,
          campaignId: original.campaignId,
          name: `[Rerun] ${original.name?.replace(/^\[Rerun\]\s*/, '') || 'Automation'}`,
          runType: 'immediate',
          status: 'queued',
          channels: {
            create: rerunChannels.map((c) => ({ channelId: c.channelId })),
          },
        },
      })

      return NextResponse.json({
        success: true,
        automationId: newRun.id,
        message: `Rerun queued for ${rerunChannels.length} channel(s)!`,
      })
    }

    if (action === 'mark_whop_submitted') {
      const { automationId, whopSubmissionId } = body
      if (!automationId || !whopSubmissionId) {
        return NextResponse.json({ error: 'automationId and whopSubmissionId required' }, { status: 400 })
      }

      const automation = await prisma.automation.findFirst({
        where: { id: automationId, userId },
      })
      if (!automation) {
        return NextResponse.json({ error: 'Automation run not found' }, { status: 404 })
      }

      const opts = (automation.options as any) || {}
      const whopList: any[] = opts.mockWhopSubmissions || []

      const updatedWhopList = whopList.map((item) => {
        if (item.id === whopSubmissionId) {
          const queuedMs = new Date(item.queuedAt).getTime()
          const diffMins = Math.max(1, Math.round((Date.now() - queuedMs) / 60000))
          return {
            ...item,
            status: 'submitted',
            timeTaken: diffMins,
            submittedAt: new Date().toISOString(),
          }
        }
        return item
      })

      const updated = await prisma.automation.update({
        where: { id: automationId },
        data: {
          options: {
            ...opts,
            mockWhopSubmissions: updatedWhopList,
          },
        },
      })

      return NextResponse.json({ success: true, message: 'Whop submission marked as submitted!', automation: updated })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Request failed' }, { status: 500 })
  }
}
