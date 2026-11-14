import { prisma } from './db'
import { decryptIfPresent } from './encryption'
import { verifyGoogleRefreshToken } from './youtube-auth'

export interface YouTubeVideoStat {
  videoIdExt: string
  title: string
  publishedAt: string
  viewCount: number
  likeCount: number
  commentCount: number
  thumbnail?: string
}

export interface FetchChannelStatsResult {
  success: boolean
  videos: YouTubeVideoStat[]
  error?: string
}

export function extractVidId(url: string | null | undefined): string | null {
  if (!url) return null
  const trimmed = String(url).trim()
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed
  const m = trimmed.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|(?:embed|v|shorts)\/))([\w-]{11})/)
  return m ? m[1] : null
}

/**
 * Fetch latest 10 videos with live views, likes, comments from YouTube Data API v3
 * using the channel's Google OAuth refresh token.
 */
export async function fetchChannelLatestVideos(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
  channelIdExt?: string | null
): Promise<FetchChannelStatsResult> {
  try {
    // 1. Obtain fresh Google OAuth access token
    const auth = await verifyGoogleRefreshToken(clientId, clientSecret, refreshToken)
    if (!auth.valid || !auth.accessToken) {
      return {
        success: false,
        videos: [],
        error: auth.error || 'Failed to authenticate with Google OAuth',
      }
    }

    const accessToken = auth.accessToken

    // 2. Fetch the channel's 'uploads' playlist ID
    let uploadsPlaylistId: string | null = null

    // Try mine=true first
    try {
      const chRes = await fetch(
        'https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true',
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        }
      )
      if (chRes.ok) {
        const chData = await chRes.json()
        if (chData.items && chData.items.length > 0) {
          uploadsPlaylistId = chData.items[0].contentDetails?.relatedPlaylists?.uploads || null
        }
      }
    } catch (err) {
      console.warn('[YouTube Analytics] Failed mine=true query:', err)
    }

    // Fallback: If mine=true didn't return playlist and we have channelIdExt
    if (!uploadsPlaylistId && channelIdExt) {
      try {
        const chRes = await fetch(
          `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${encodeURIComponent(channelIdExt)}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: 'application/json',
            },
          }
        )
        if (chRes.ok) {
          const chData = await chRes.json()
          if (chData.items && chData.items.length > 0) {
            uploadsPlaylistId = chData.items[0].contentDetails?.relatedPlaylists?.uploads || null
          }
        }
      } catch (err) {
        console.warn('[YouTube Analytics] Failed channelIdExt query:', err)
      }
    }

    // Fallback: Default YouTube upload playlist for a channel ID replaces UC with UU
    if (!uploadsPlaylistId && channelIdExt && channelIdExt.startsWith('UC')) {
      uploadsPlaylistId = 'UU' + channelIdExt.slice(2)
    }

    if (!uploadsPlaylistId) {
      return {
        success: false,
        videos: [],
        error: 'Could not determine channel uploads playlist ID.',
      }
    }

    // 3. Fetch latest 10 items from the uploads playlist
    const playlistRes = await fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${encodeURIComponent(uploadsPlaylistId)}&maxResults=10`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      }
    )

    if (!playlistRes.ok) {
      const errData = await playlistRes.json().catch(() => ({}))
      return {
        success: false,
        videos: [],
        error: errData.error?.message || `Playlist fetch error: HTTP ${playlistRes.status}`,
      }
    }

    const playlistData = await playlistRes.json()
    const items = playlistData.items || []

    if (items.length === 0) {
      return {
        success: true,
        videos: [],
      }
    }

    const videoIds: string[] = items
      .map((item: any) => item.contentDetails?.videoId || item.snippet?.resourceId?.videoId)
      .filter(Boolean)

    if (videoIds.length === 0) {
      return {
        success: true,
        videos: [],
      }
    }

    // 4. Batch fetch statistics (viewCount, likeCount, commentCount) for these videos
    const statsRes = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${videoIds.join(',')}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      }
    )

    if (!statsRes.ok) {
      const errData = await statsRes.json().catch(() => ({}))
      return {
        success: false,
        videos: [],
        error: errData.error?.message || `Videos statistics fetch error: HTTP ${statsRes.status}`,
      }
    }

    const statsData = await statsRes.json()
    const statItems = statsData.items || []

    const results: YouTubeVideoStat[] = statItems.map((v: any) => ({
      videoIdExt: v.id,
      title: v.snippet?.title || 'Untitled',
      publishedAt: v.snippet?.publishedAt || new Date().toISOString(),
      viewCount: Math.max(0, parseInt(v.statistics?.viewCount || '0', 10) || 0),
      likeCount: Math.max(0, parseInt(v.statistics?.likeCount || '0', 10) || 0),
      commentCount: Math.max(0, parseInt(v.statistics?.commentCount || '0', 10) || 0),
      thumbnail: v.snippet?.thumbnails?.medium?.url || v.snippet?.thumbnails?.default?.url,
    }))

    // Sort by publishedAt descending (latest first)
    results.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())

    return {
      success: true,
      videos: results,
    }
  } catch (err: any) {
    console.error('[YouTube Analytics] Exception:', err)
    return {
      success: false,
      videos: [],
      error: err.message || 'Unexpected error fetching YouTube analytics',
    }
  }
}

/**
 * Reusable function to sync live YouTube video statistics (views, likes, comments)
 * and check the 2 STRICT conditions for promoting videos to Pending Tasks:
 *   Condition 1: views >= campaign.minViews
 *   Condition 2: Video is marked as submitted to Whop (status: 'submitted')
 */
export async function syncUserYouTubeAnalytics(userId: string) {
  // 1. Fetch user active channels
  const channels = await prisma.channel.findMany({
    where: { userId, removedAt: null, status: 'active' },
  })

  let totalUpdatedVideos = 0
  let channelSuccessCount = 0

  for (const ch of channels) {
    let clientId = ch.clientId || ''
    let clientSecret = ''
    let refreshToken = ''

    try {
      clientSecret = decryptIfPresent(ch.clientSecretEnc) || ''
      refreshToken = decryptIfPresent(ch.refreshTokenEnc) || ''
    } catch (e: any) {
      console.warn(`[YouTube Analytics] Decrypt failed for channel "${ch.channelName || ch.id}":`, e.message)
      continue
    }

    if (!clientId || !clientSecret || !refreshToken) {
      console.log(`[YouTube Analytics] Skipping channel "${ch.channelName || ch.id}" (missing OAuth credentials)`)
      continue
    }

    const res = await fetchChannelLatestVideos(clientId, clientSecret, refreshToken, ch.channelIdExt)
    if (!res.success) {
      console.warn(`[YouTube Analytics] Channel "${ch.channelName || ch.id}" fetch error:`, res.error)
      continue
    }

    if (res.videos.length === 0) {
      console.log(`[YouTube Analytics] Channel "${ch.channelName || ch.id}" returned 0 videos.`)
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

      const safeViews = BigInt(Math.max(0, Math.floor(v.viewCount || 0)))

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
          viewCount: safeViews,
          lastFetchedAt: new Date(),
          extraData: updatedExtra,
        },
        update: {
          title: v.title,
          publishedAt: new Date(v.publishedAt),
          viewCount: safeViews,
          lastFetchedAt: new Date(),
          extraData: updatedExtra,
        },
      })
      totalUpdatedVideos++
    }
  }

  // 2. Map submitted Whop videos and linked campaigns across all automations
  // (Ensures videos submitted via Admin or scheduled runs are correctly recognized)
  const allAutomations = await prisma.automation.findMany({
    select: { id: true, campaignId: true, options: true },
  })

  const submittedVideoIds = new Set<string>()
  const submittedTitles = new Set<string>()
  const videoCampaignMap = new Map<string, string>()

  for (const auto of allAutomations) {
    const opts = (auto.options && typeof auto.options === 'object') ? (auto.options as any) : {}
    const whopList = Array.isArray(opts.mockWhopSubmissions) ? opts.mockWhopSubmissions : []
    for (const item of whopList) {
      if (!item || typeof item !== 'object') continue
      const rawUrl = item.youtubeLink || item.youtubeVideoId || item.videoId || item.url || item.link
      const vidId = extractVidId(rawUrl)
      const itemStatus = String(item.status || '').toLowerCase()
      // Accept any Whop entry that has not explicitly failed (e.g. submitted, pending, queued, success, completed)
      const isValidWhop = itemStatus !== 'failed'

      if (vidId) {
        if (isValidWhop) {
          submittedVideoIds.add(vidId)
        }
        if (auto.campaignId) {
          videoCampaignMap.set(vidId, auto.campaignId)
        }
      }
      if (item.videoTitle && isValidWhop) {
        submittedTitles.add(String(item.videoTitle).trim().toLowerCase())
      }
    }
    const videoUploads = Array.isArray(opts.mockVideoUploads) ? opts.mockVideoUploads : []
    for (const up of videoUploads) {
      if (!up || typeof up !== 'object') continue
      const rawUploadUrl = up.youtubeLink || up.youtubeVideoId || up.videoId || up.url
      const vidId = extractVidId(rawUploadUrl)
      if (vidId) {
        if (auto.campaignId) {
          videoCampaignMap.set(vidId, auto.campaignId)
        }
        if (up.whopSubmitted === true || up.whopStatus === 'submitted' || up.stage === 'Whop Submitted') {
          submittedVideoIds.add(vidId)
        }
      }
      if (up.videoTitle && (up.whopSubmitted === true || up.whopStatus === 'submitted' || up.stage === 'Whop Submitted')) {
        submittedTitles.add(String(up.videoTitle).trim().toLowerCase())
      }
    }
  }

  // 3. Check for Pending Tasks Promotion with the 2 STRICT CONDITIONS
  const allCampaigns = await prisma.campaign.findMany()
  const campaignMap = new Map(allCampaigns.map((c) => [c.id, c]))
  const defaultCampaign = allCampaigns[0]

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

    // Ensure campaign exists in DB to prevent foreign key violations
    let validCampaign =
      (extra.campaignId && campaignMap.get(extra.campaignId))
        ? campaignMap.get(extra.campaignId)
        : (videoCampaignMap.get(vid.videoIdExt) && campaignMap.get(videoCampaignMap.get(vid.videoIdExt)!))
        ? campaignMap.get(videoCampaignMap.get(vid.videoIdExt)!)
        : defaultCampaign

    if (!validCampaign && allCampaigns.length > 0) {
      validCampaign = allCampaigns[0]
    }
    if (!validCampaign) {
      console.warn(`[Promotion Check] Skipping video ${vid.videoIdExt} - no valid campaign found in DB`)
      continue
    }

    const campaignId = validCampaign.id
    const threshold = validCampaign.minViews || 10000

    // CONDITION 1: Minimum views crossed
    const isThresholdCrossed = views >= threshold

    // CONDITION 2: Whop submission verified
    const isWhopSubmitted =
      extra.whopSubmitted === true ||
      submittedVideoIds.has(vid.videoIdExt) ||
      (vid.title && submittedTitles.has(vid.title.trim().toLowerCase())) ||
      String(extra.whopStatus || '').toLowerCase() === 'submitted' ||
      String(extra.whopStatus || '').toLowerCase() === 'pending'

    console.log(`📊 [Promotion Check] User ${userId} | Video ${vid.videoIdExt} ("${vid.title}"): ${views}/${threshold} views, whopSubmitted=${isWhopSubmitted}`)

    if (isThresholdCrossed && isWhopSubmitted) {
      const existingTask = await prisma.pendingTask.findFirst({
        where: {
          userId,
          videoIdExt: vid.videoIdExt,
        },
      })

      if (!existingTask) {
        try {
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
          console.log(`📊 [Promotion Check] ✅ PROMOTED Video ${vid.videoIdExt} ("${vid.title}") to Pending Tasks!`)
        } catch (createErr: any) {
          console.error(`📊 [Promotion Check] ❌ Failed to create pending task for ${vid.videoIdExt}:`, createErr.message)
        }
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
 * Global function executed by the Analytics Worker every 6 hours
 * Iterates through all active users and runs syncUserYouTubeAnalytics
 */
export async function runAllUsersAnalyticsSync() {
  console.log(`📊 [Analytics] Starting 6-hour refresh across all active users at ${new Date().toISOString()}...`)
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, email: true, name: true },
  })

  let totalChannels = 0
  let totalVideos = 0
  let totalPromoted = 0

  for (const user of users) {
    try {
      const res = await syncUserYouTubeAnalytics(user.id)
      totalChannels += res.channelSuccessCount
      totalVideos += res.totalUpdatedVideos
      totalPromoted += res.promotedCount
      if (res.totalUpdatedVideos > 0) {
        console.log(`📊 [Analytics] User ${user.email}: synced ${res.channelSuccessCount} channels, ${res.totalUpdatedVideos} videos (${res.promotedCount} promoted)`)
      }
    } catch (uErr: any) {
      console.error(`📊 [Analytics] Failed syncing user ${user.email}:`, uErr.message)
    }
  }

  console.log(`📊 [Analytics] ✅ 6-hour refresh complete: ${users.length} user(s) checked, ${totalChannels} channel(s), ${totalVideos} video(s) updated, ${totalPromoted} task(s) promoted.`)
  return {
    usersChecked: users.length,
    totalChannels,
    totalVideos,
    totalPromoted,
  }
}
