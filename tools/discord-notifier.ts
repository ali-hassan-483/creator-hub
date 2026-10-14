/**
 * Tool 6: Discord Mention & Threshold Monitor
 * 
 * Monitors video view counts on YouTube.
 * When a video crosses the minimum views threshold AND fixYoutubeMentions is enabled,
 * sends a Discord alert message listing channels to mention in the video title.
 * 
 * Also sends general notifications for:
 * - Automation completed
 * - Automation failed
 * - Pending tasks (videos needing attention)
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DiscordNotifyOptions {
  webhookUrl: string
  message?: string
  embeds?: DiscordEmbed[]
  username?: string
  avatarUrl?: string
}

export interface DiscordEmbed {
  title?: string
  description?: string
  color?: number      // decimal color (e.g. 0x5865F2)
  fields?: Array<{ name: string; value: string; inline?: boolean }>
  footer?: { text: string }
  timestamp?: string  // ISO 8601
  thumbnail?: { url: string }
}

export interface ViewCheckResult {
  videoId: string
  currentViews: number
  minViews: number
  crossed: boolean
}

// ─── Discord Sender ───────────────────────────────────────────────────────────

/**
 * Send a message to a Discord webhook.
 */
export async function sendDiscordNotification(options: DiscordNotifyOptions): Promise<boolean> {
  const { webhookUrl, message, embeds, username, avatarUrl } = options

  if (!webhookUrl || !webhookUrl.startsWith('https://discord.com/api/webhooks/')) {
    console.error('[Discord] Invalid webhook URL')
    return false
  }

  const payload: Record<string, any> = {}
  if (message) payload.content = message
  if (embeds && embeds.length > 0) payload.embeds = embeds
  if (username) payload.username = username
  if (avatarUrl) payload.avatar_url = avatarUrl

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error(`[Discord] ❌ Webhook failed ${response.status}: ${errText}`)
      return false
    }

    console.log(`[Discord] ✅ Notification sent`)
    return true

  } catch (error: any) {
    console.error(`[Discord] ❌ ${error.message}`)
    return false
  }
}

// ─── View Count Checker ───────────────────────────────────────────────────────

/**
 * Get current view count for a YouTube video using YouTube Data API v3.
 */
export async function getYouTubeViewCount(videoId: string): Promise<number | null> {
  const apiKey = process.env.YOUTUBE_API_KEY || process.env.GOOGLE_API_KEY
  if (!apiKey) {
    console.error('[ViewCheck] No YOUTUBE_API_KEY or GOOGLE_API_KEY set')
    return null
  }

  try {
    const url = `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${videoId}&key=${apiKey}`
    const response = await fetch(url)
    const data = await response.json() as any
    const views = data.items?.[0]?.statistics?.viewCount
    return views ? parseInt(views, 10) : null
  } catch (error: any) {
    console.error(`[ViewCheck] ❌ ${error.message}`)
    return null
  }
}

/**
 * Extract YouTube video ID from URL or ID string.
 */
export function extractYouTubeVideoId(urlOrId: string): string | null {
  if (/^[a-zA-Z0-9_-]{11}$/.test(urlOrId)) return urlOrId
  const match = urlOrId.match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/)
  return match ? match[1] : null
}

// ─── Threshold Monitor ────────────────────────────────────────────────────────

export interface MonitorJobConfig {
  videoId: string
  minViews: number
  webhookUrl: string
  channelsToMention: string[]   // e.g. ['@Channel1', '@Channel2']
  campaignName: string
  shortTitle: string
  fixMentions: boolean
  alreadyNotified?: boolean     // prevent duplicate alerts
}

/**
 * Check if a video has crossed the min views threshold.
 * If yes and fixMentions is enabled, send Discord alert.
 * Returns true if notification was sent.
 */
export async function checkViewThresholdAndNotify(config: MonitorJobConfig): Promise<ViewCheckResult> {
  const {
    videoId,
    minViews,
    webhookUrl,
    channelsToMention,
    campaignName,
    shortTitle,
    fixMentions,
    alreadyNotified,
  } = config

  const currentViews = await getYouTubeViewCount(videoId)
  
  if (currentViews === null) {
    return { videoId, currentViews: 0, minViews, crossed: false }
  }

  const crossed = currentViews >= minViews

  if (crossed && fixMentions && !alreadyNotified && webhookUrl) {
    const mentionList = channelsToMention.length > 0
      ? channelsToMention.map(c => `• ${c}`).join('\n')
      : 'No channels specified'

    const embed: DiscordEmbed = {
      title: '🎯 Min Views Crossed — Update Title Required!',
      description: `Video **"${shortTitle}"** has crossed the minimum view threshold.`,
      color: 0xF59E0B,  // amber
      fields: [
        { name: '📊 Current Views', value: currentViews.toLocaleString(), inline: true },
        { name: '🎯 Min Views', value: minViews.toLocaleString(), inline: true },
        { name: '📋 Campaign', value: campaignName, inline: false },
        { name: '🔗 YouTube Video', value: `https://youtu.be/${videoId}`, inline: false },
        { name: '📢 Channels to Mention in Title', value: mentionList, inline: false },
      ],
      footer: { text: 'Creator Hub — Automation Monitor' },
      timestamp: new Date().toISOString(),
    }

    await sendDiscordNotification({
      webhookUrl,
      message: `⚡ **Action Required:** Video crossed ${minViews.toLocaleString()} views!`,
      embeds: [embed],
      username: 'Creator Hub Bot',
    })
  }

  return { videoId, currentViews, minViews, crossed }
}

// ─── Automation Event Notifications ──────────────────────────────────────────

export async function notifyAutomationStarted(webhookUrl: string, campaignName: string, jobId: string): Promise<void> {
  if (!webhookUrl) return
  await sendDiscordNotification({
    webhookUrl,
    embeds: [{
      title: '🚀 Automation Started',
      description: `Campaign: **${campaignName}**`,
      color: 0x3B82F6,
      fields: [{ name: 'Job ID', value: jobId, inline: true }],
      timestamp: new Date().toISOString(),
    }],
    username: 'Creator Hub Bot',
  })
}

export async function notifyAutomationCompleted(
  webhookUrl: string,
  campaignName: string,
  jobId: string,
  clipsProduced: number
): Promise<void> {
  if (!webhookUrl) return
  await sendDiscordNotification({
    webhookUrl,
    embeds: [{
      title: '✅ Automation Completed',
      description: `Campaign: **${campaignName}**`,
      color: 0x22C55E,
      fields: [
        { name: 'Job ID', value: jobId, inline: true },
        { name: 'Clips Produced', value: String(clipsProduced), inline: true },
      ],
      timestamp: new Date().toISOString(),
    }],
    username: 'Creator Hub Bot',
  })
}

export async function notifyAutomationFailed(
  webhookUrl: string,
  campaignName: string,
  jobId: string,
  errorMessage: string
): Promise<void> {
  if (!webhookUrl) return
  await sendDiscordNotification({
    webhookUrl,
    embeds: [{
      title: '❌ Automation Failed',
      description: `Campaign: **${campaignName}**`,
      color: 0xEF4444,
      fields: [
        { name: 'Job ID', value: jobId, inline: true },
        { name: 'Error', value: errorMessage.slice(0, 1000), inline: false },
      ],
      timestamp: new Date().toISOString(),
    }],
    username: 'Creator Hub Bot',
  })
}
