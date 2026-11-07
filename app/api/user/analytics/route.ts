import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { prisma } from '@/lib/db'
import { syncUserYouTubeAnalytics } from '@/lib/youtube-analytics'

export const dynamic = 'force-dynamic'

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
