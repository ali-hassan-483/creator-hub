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
      viewCount: parseInt(v.statistics?.viewCount || '0', 10),
      likeCount: parseInt(v.statistics?.likeCount || '0', 10),
      commentCount: parseInt(v.statistics?.commentCount || '0', 10),
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
