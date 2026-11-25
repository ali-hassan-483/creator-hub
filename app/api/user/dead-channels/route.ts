import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth-helpers'
import { prisma } from '@/lib/db'
import { decryptIfPresent } from '@/lib/encryption'
import { fetchChannelLatestVideos } from '@/lib/youtube-analytics'

export const dynamic = 'force-dynamic'

/**
 * Helper to evaluate and sync dead channels for a user.
 * Condition:
 * Channel has at least 10 recorded videos, AND the sum of views across its latest 10 videos
 * is fewer than 100 (< 100).
 * Dead channels remain 'active' so uploading is NOT blocked; this is strictly informational.
 */
async function scanAndFlagDeadChannels(userId: string, forceFetchYouTube = false) {
  const channels = await prisma.channel.findMany({
    where: { userId, removedAt: null },
    include: {
      videoAnalytics: {
        orderBy: { publishedAt: 'desc' },
        take: 10,
      },
    },
  })

  const results: any[] = []
  const now = new Date()

  for (const channel of channels) {
    const extra = (channel.extraData as Record<string, any>) || {}
    let videos = channel.videoAnalytics

    // If channel has no videos or user requested fresh sync, or > 24h since last sync
    const lastSync = extra.lastDeadScanAt ? new Date(extra.lastDeadScanAt).getTime() : 0
    const hoursSinceLastSync = (now.getTime() - lastSync) / (1000 * 60 * 60)
    const shouldFetch = forceFetchYouTube || videos.length === 0 || hoursSinceLastSync >= 24

    if (shouldFetch) {
      const clientId = channel.clientId || ''
      const clientSecret = decryptIfPresent(channel.clientSecretEnc) || ''
      const refreshToken = decryptIfPresent(channel.refreshTokenEnc) || ''

      if (clientId && clientSecret && refreshToken) {
        try {
          const ytRes = await fetchChannelLatestVideos(clientId, clientSecret, refreshToken, channel.channelIdExt)
          if (ytRes.success && ytRes.videos.length > 0) {
            // Upsert into VideoAnalytic
            for (const v of ytRes.videos) {
              const existingExtra = {}
              await prisma.videoAnalytic.upsert({
                where: {
                  channelId_videoIdExt: {
                    channelId: channel.id,
                    videoIdExt: v.videoIdExt,
                  },
                },
                create: {
                  channelId: channel.id,
                  videoIdExt: v.videoIdExt,
                  title: v.title,
                  publishedAt: new Date(v.publishedAt),
                  viewCount: BigInt(v.viewCount),
                  lastFetchedAt: now,
                  extraData: {
                    likes: v.likeCount,
                    comments: v.commentCount,
                    thumbnail: v.thumbnail,
                  },
                },
                update: {
                  title: v.title,
                  publishedAt: new Date(v.publishedAt),
                  viewCount: BigInt(v.viewCount),
                  lastFetchedAt: now,
                  extraData: {
                    likes: v.likeCount,
                    comments: v.commentCount,
                    thumbnail: v.thumbnail,
                  },
                },
              })
            }

            // Re-query fresh videos for this channel
            videos = await prisma.videoAnalytic.findMany({
              where: { channelId: channel.id },
              orderBy: { publishedAt: 'desc' },
              take: 10,
            })
          }
        } catch (err) {
          console.warn(`[Dead Channels] Could not fetch YouTube videos for ${channel.channelHandle}:`, err)
        }
      }
    }

    // Evaluate Dead Status:
    // Channel must have at least 10 videos, AND sum of views across latest 10 videos is under 100 (< 100)
    const hasEnoughVideos = videos.length >= 10
    const viewCounts = videos.map((v) => Number(v.viewCount))
    const totalViews = hasEnoughVideos ? viewCounts.reduce((a, b) => a + b, 0) : 0
    const maxViews = videos.length > 0 ? Math.max(...viewCounts) : 0
    const avgViews = videos.length > 0 ? Math.round(viewCounts.reduce((a, b) => a + b, 0) / viewCounts.length) : 0
    const isDead = hasEnoughVideos && totalViews < 100

    // If channel is dead, flag it in extraData for user reference, but keep status 'active' so uploads are NOT blocked
    if (isDead) {
      const shouldRestoreActive = channel.status === 'inactive' && extra.isDead
      await prisma.channel.update({
        where: { id: channel.id },
        data: {
          ...(shouldRestoreActive ? { status: 'active' } : {}),
          extraData: {
            ...extra,
            isDead: true,
            deadReason: `Latest ${videos.length} videos total views (${totalViews}) is under 100 (requires ≥ 10 videos)`,
            deadDetectedAt: extra.deadDetectedAt || now.toISOString(),
            lastDeadScanAt: now.toISOString(),
          },
        },
      })

      results.push({
        id: channel.id,
        channelName: channel.channelName || 'YouTube Channel',
        channelHandle: channel.channelHandle || '@channel',
        channelIdExt: channel.channelIdExt,
        channelEmail: channel.channelEmail || '',
        whopEmail: channel.whopEmail || '',
        niche: channel.niche || 'General',
        status: shouldRestoreActive ? 'active' : channel.status,
        isDead: true,
        deadDetectedAt: extra.deadDetectedAt || now.toISOString(),
        videoCount: videos.length,
        maxViews,
        avgViews,
        videos: videos.map((v) => {
          const vExtra = (v.extraData as Record<string, any>) || {}
          return {
            videoIdExt: v.videoIdExt,
            title: v.title || 'Untitled Video',
            viewCount: Number(v.viewCount),
            likes: vExtra.likes || 0,
            thumbnail: vExtra.thumbnail || `https://i.ytimg.com/vi/${v.videoIdExt}/mqdefault.jpg`,
            publishedAt: v.publishedAt ? v.publishedAt.toISOString() : new Date().toISOString(),
          }
        }),
      })
    } else {
      // If channel is not dead (sum of views >= 100 or no videos yet)
      if (extra.isDead === true) {
        // Channel was previously flagged dead but now has crossed 100 views -> restore active!
        await prisma.channel.update({
          where: { id: channel.id },
          data: {
            status: 'active',
            extraData: {
              ...extra,
              isDead: false,
              deadReason: null,
              lastDeadScanAt: now.toISOString(),
            },
          },
        })
      } else if (shouldFetch) {
        await prisma.channel.update({
          where: { id: channel.id },
          data: {
            extraData: {
              ...extra,
              isDead: false,
              lastDeadScanAt: now.toISOString(),
            },
          },
        })
      }
    }
  }

  return results
}

/**
 * GET /api/user/dead-channels
 * Fetches all dead channels for the authenticated user.
 * Optional query parameter: ?sync=true to force fresh YouTube scan.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireUser()
    const userId = session.user.id

    const { searchParams } = new URL(req.url)
    const forceSync = searchParams.get('sync') === 'true'

    const deadChannels = await scanAndFlagDeadChannels(userId, forceSync)

    return NextResponse.json({
      success: true,
      channels: deadChannels,
      stats: {
        totalDead: deadChannels.length,
        scanInterval: '24 Hours',
        lastScannedAt: new Date().toISOString(),
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/user/dead-channels
 * Actions:
 * 1. 'reactivate': User restores dead channel to active state.
 * 2. 'scan': Force refresh YouTube stats and re-scan.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireUser()
    const userId = session.user.id
    const body = await req.json()
    const { action, channelId } = body

    // 1. Reactivate Channel
    if (action === 'reactivate') {
      if (!channelId) {
        return NextResponse.json({ error: 'channelId is required' }, { status: 400 })
      }

      const existing = await prisma.channel.findFirst({
        where: { id: channelId, userId, removedAt: null },
      })

      if (!existing) {
        return NextResponse.json({ error: 'Channel not found.' }, { status: 404 })
      }

      const extra = (existing.extraData as Record<string, any>) || {}
      const { isDead, deadReason, deadDetectedAt, uploadCooldownUntil, lastUploadError, ...rest } = extra

      await prisma.channel.update({
        where: { id: channelId },
        data: {
          status: 'active', // Reactivate channel
          extraData: {
            ...rest,
            isDead: false,
            reactivatedAt: new Date().toISOString(),
          },
        },
      })

      return NextResponse.json({
        success: true,
        message: `Channel @${existing.channelHandle || existing.channelName} reactivated successfully! It is now active and ready for automations.`,
      })
    }

    // 2. Scan All Channels Now
    if (action === 'scan') {
      const deadChannels = await scanAndFlagDeadChannels(userId, true)
      return NextResponse.json({
        success: true,
        channels: deadChannels,
        message: `Scan complete. Found ${deadChannels.length} dead channels with < 100 views across latest 10 videos.`,
      })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
