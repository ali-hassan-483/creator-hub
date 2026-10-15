import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { prisma } from '@/lib/db'
import { decryptIfPresent } from '@/lib/encryption'
import { fetchChannelLatestVideos } from '@/lib/youtube-analytics'

export const dynamic = 'force-dynamic'

function extractVidId(url: string | null | undefined): string | null {
  if (!url) return null
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|(?:embed|v|shorts)\/))([\w-]{11})/)
  return m ? m[1] : null
}

/**
 * Reusable function to sync live YouTube video statistics (views, likes, comments)
 * and check the 2 STRICT conditions for promoting videos to Pending Tasks:
 *   Condition 1: views >= campaign.minViews
 *   Condition 2: Video is marked as submitted to Whop (status: 'submitted')
 */
async function syncUserYouTubeAnalytics(userId: string) {
  // 1. Fetch user active channels
  const channels = await prisma.channel.findMany({
    where: { userId, removedAt: null, status: 'active' },
  })

  let totalUpdatedVideos = 0
  let channelSuccessCount = 0

  for (const ch of channels) {
    const clientId = ch.clientId || ''
    const clientSecret = decryptIfPresent(ch.clientSecretEnc) || ''
    const refreshToken = decryptIfPresent(ch.refreshTokenEnc) || ''

    if (!clientId || !clientSecret || !refreshToken) {
      continue
    }

    const res = await fetchChannelLatestVideos(clientId, clientSecret, refreshToken, ch.channelIdExt)
    if (!res.success || res.videos.length === 0) {
      continue
    }

    channelSuccessCount++

    for (const v of res.videos) {
      const existing = await prisma.videoAnalytic.findUnique({
        where: {
          channelId_videoIdExt: {
            channelId: ch.id,
            videoIdExt: v.videoIdExt,
          },
        },
      })

      const existingExtra = (existing?.extraData as Record<string, any>) || {}
      const updatedExtra = {
        ...existingExtra,
        likes: v.likeCount,
        comments: v.commentCount,
        thumbnail: v.thumbnail,
      }

      await prisma.videoAnalytic.upsert({
        where: {
          channelId_videoIdExt: {
            channelId: ch.id,
            videoIdExt: v.videoIdExt,
          },
        },
        create: {
          channelId: ch.id,
          videoIdExt: v.videoIdExt,
          title: v.title,
          publishedAt: new Date(v.publishedAt),
          viewCount: BigInt(v.viewCount),
          lastFetchedAt: new Date(),
          extraData: updatedExtra,
        },
        update: {
          title: v.title,
          publishedAt: new Date(v.publishedAt),
          viewCount: BigInt(v.viewCount),
          lastFetchedAt: new Date(),
          extraData: updatedExtra,
        },
      })
      totalUpdatedVideos++
    }
  }

  // 2. Map submitted Whop videos and linked campaigns across user automations
  const userAutomations = await prisma.automation.findMany({
    where: { userId },
    select: { id: true, campaignId: true, options: true },
  })

  const submittedVideoIds = new Set<string>()
  const videoCampaignMap = new Map<string, string>()

  for (const auto of userAutomations) {
    const opts = (auto.options as any) || {}
    const whopList = (opts.mockWhopSubmissions || []) as any[]
    for (const item of whopList) {
      const vidId = extractVidId(item.youtubeLink)
      if (vidId) {
        if (item.status === 'submitted') {
          submittedVideoIds.add(vidId)
        }
        if (auto.campaignId) {
          videoCampaignMap.set(vidId, auto.campaignId)
        }
      }
    }
    const videoUploads = (opts.mockVideoUploads || []) as any[]
    for (const up of videoUploads) {
      const vidId = extractVidId(up.youtubeLink)
      if (vidId && auto.campaignId) {
        videoCampaignMap.set(vidId, auto.campaignId)
      }
    }
  }

  // 3. Check for Pending Tasks Promotion with the 2 STRICT CONDITIONS
  const campaigns = await prisma.campaign.findMany({
    where: {
      OR: [
        { userAccess: { some: { userId } } },
        { automations: { some: { userId } } },
      ],
    },
  })
  const campaignMap = new Map(campaigns.map((c) => [c.id, c]))
  const defaultCampaign = campaigns[0]

  const allUserVideos = await prisma.videoAnalytic.findMany({
    where: {
      channel: { userId, removedAt: null },
    },
    include: { channel: true },
  })

  let promotedCount = 0

  for (const vid of allUserVideos) {
    const views = Number(vid.viewCount || 0)
    const extra = (vid.extraData as any) || {}

    const campaignId = extra.campaignId || videoCampaignMap.get(vid.videoIdExt) || defaultCampaign?.id
    if (!campaignId) continue

    const campaign = campaignMap.get(campaignId) || defaultCampaign
    const threshold = campaign?.minViews || 10000

    // CONDITION 1: Minimum views crossed
    const isThresholdCrossed = views >= threshold

    // CONDITION 2: Whop submission verified
    const isWhopSubmitted = extra.whopSubmitted === true || submittedVideoIds.has(vid.videoIdExt)

    if (isThresholdCrossed && isWhopSubmitted) {
      const existingTask = await prisma.pendingTask.findFirst({
        where: {
          userId,
          channelId: vid.channelId,
          videoIdExt: vid.videoIdExt,
        },
      })

      if (!existingTask) {
        await prisma.pendingTask.create({
          data: {
            userId,
            campaignId,
            channelId: vid.channelId,
            videoId: vid.id,
            videoIdExt: vid.videoIdExt,
            viewCountAtTrigger: vid.viewCount,
            status: 'pending',
            notes: `Auto-promoted by Analytics: ${views.toLocaleString()} views crossed ${threshold.toLocaleString()} min views & Whop submission verified.`,
            requirementsData: {
              thresholdMet: threshold,
              actualViews: views,
              actualLikes: Number(extra.likes || 0),
              whopSubmitted: true,
              promotedAt: new Date().toISOString(),
            },
          },
        })
        promotedCount++
      }
    }
  }

  return {
    channelSuccessCount,
    totalUpdatedVideos,
    promotedCount,
  }
}

/**
 * GET /api/user/analytics
 * Returns YouTube channel analytics with top 10 videos per channel, views, likes, and refresh status
 */
export async function GET(req: NextRequest) {
  const session = await requireAuth()
  const userId = session.user.id

  const { searchParams } = new URL(req.url)
  const niche = searchParams.get('niche') || 'all'
  const search = (searchParams.get('search') || '').trim().toLowerCase()
  const minViews = parseInt(searchParams.get('minViews') || '0', 10)

  try {
    const whereChannel: any = { userId, removedAt: null }
    if (niche !== 'all') {
      whereChannel.niche = niche
    }

    let channels = await prisma.channel.findMany({
      where: whereChannel,
      orderBy: { addedAt: 'desc' },
      include: {
        videoAnalytics: {
          orderBy: { publishedAt: 'desc' },
          take: 10,
        },
      },
    })

    // If channels exist but no videoAnalytics recorded yet, auto-sync initial batch
    const totalExistingVideos = channels.reduce((acc, c) => acc + c.videoAnalytics.length, 0)
    if (channels.length > 0 && totalExistingVideos === 0) {
      await syncUserYouTubeAnalytics(userId)
      channels = await prisma.channel.findMany({
        where: whereChannel,
        orderBy: { addedAt: 'desc' },
        include: {
          videoAnalytics: {
            orderBy: { publishedAt: 'desc' },
            take: 10,
          },
        },
      })
    }

    // Get active user campaigns with minViews thresholds
    const campaigns = await prisma.campaign.findMany({
      where: {
        OR: [
          { userAccess: { some: { userId } } },
          { automations: { some: { userId } } },
        ],
      },
      select: { id: true, name: true, minViews: true },
    })
    const defaultThreshold = campaigns[0]?.minViews || 10000

    const channelRows = channels
      .map((ch) => {
        const videos = ch.videoAnalytics.map((v) => {
          const views = Number(v.viewCount || 0)
          const extra = (v.extraData as any) || {}
          const likes = Number(extra.likes ?? Math.round(views * 0.05))

          return {
            id: v.id,
            videoIdExt: v.videoIdExt,
            title: v.title || 'Untitled',
            views,
            likes,
            publishedAt: v.publishedAt,
            hasCrossedThreshold: views >= defaultThreshold,
            thumbnail: extra.thumbnail || null,
          }
        })

        // Pad up to 10 video slots for the table columns (Video #1 ... Video #10)
        const paddedVideos = Array.from({ length: 10 }, (_, i) => {
          return videos[i] || null
        })

        const totalViews = videos.reduce((acc, curr) => acc + curr.views, 0)
        const totalLikes = videos.reduce((acc, curr) => acc + curr.likes, 0)

        return {
          id: ch.id,
          channelName: ch.channelName || ch.channelHandle || 'Channel',
          channelHandle: ch.channelHandle || '',
          niche: ch.niche || 'General',
          videos: paddedVideos,
          totalViews,
          totalLikes,
          status: ch.status,
          updatedAt: ch.updatedAt,
        }
      })
      .filter((row) => {
        if (search && !row.channelName.toLowerCase().includes(search) && !row.channelHandle.toLowerCase().includes(search)) {
          return false
        }
        if (minViews > 0 && row.totalViews < minViews) {
          return false
        }
        return true
      })

    // Extract unique niches for filter
    const allNiches = Array.from(new Set(channels.map((c) => c.niche).filter(Boolean))) as string[]

    return NextResponse.json({
      rows: channelRows,
      niches: allNiches,
      defaultThreshold,
      totalChannels: channelRows.length,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to fetch analytics' }, { status: 500 })
  }
}

/**
 * POST /api/user/analytics
 * Refresh video analytics (calls YouTube Data API directly for live views & likes)
 * Automatically triggers videos that crossed minimum views AND are submitted to Whop into Pending Tasks
 */
export async function POST(req: NextRequest) {
  const session = await requireAuth()
  const userId = session.user.id

  try {
    const body = await req.json()
    const { action, channelId } = body

    if (action === 'delete_channel') {
      if (!channelId) return NextResponse.json({ error: 'channelId required' }, { status: 400 })

      await prisma.channel.update({
        where: { id: channelId, userId },
        data: { removedAt: new Date() },
      })
      return NextResponse.json({ success: true, message: 'Channel removed from analytics' })
    }

    if (action === 'refresh_all' || action === 'cron_6h') {
      const result = await syncUserYouTubeAnalytics(userId)

      return NextResponse.json({
        success: true,
        message: `Synced ${result.channelSuccessCount} channel(s) and ${result.totalUpdatedVideos} video(s) from YouTube. ${result.promotedCount} qualifying video(s) promoted to Pending Tasks!`,
        ...result,
      })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Analytics action failed' }, { status: 500 })
  }
}
