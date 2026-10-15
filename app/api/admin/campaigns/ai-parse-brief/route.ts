import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth-helpers'
import { callUnifiedAi } from '@/lib/ai-provider'

export async function POST(req: NextRequest) {
  try {
    await requireAdmin()

    const body = await req.json()
    const { briefText, geminiApiKey } = body

    if (!briefText || typeof briefText !== 'string' || !briefText.trim()) {
      return NextResponse.json({ error: 'Please paste a campaign brief to scan.' }, { status: 400 })
    }

    const prompt = `You are an AI assistant that extracts content campaign brief settings into a structured JSON.
Parse the following campaign brief text and extract these fields:
- campaignName: string
- niche: string
- readyToPost: "yes" or "no"
- subcampaignGid: string
- submissionLink: string (Whop or other form URL)
- whopChannelName: string (e.g. #clipping-submissions)
- fixYoutubeMentions: "yes" or "no"
- youtubeMentionChannel: string (e.g. "@ChannelName" if mentioned in the brief, otherwise empty string)
- enablePendingTasks: "enabled" or "disabled"
- dailyPostLimit: number
- sourceVideoUrls: string (comma separated URLs for YouTube or Drive)
- minViews: number
- minEngagementRate: number
- audioNotes: string
- clippingStrategies: array of strings from ["multi_cut", "continuous", "smart_ai"]
- shortDuration: number (seconds)
- startOffset: number (seconds)
- volumeMultiplier: number
- hookVideoUrls: string
- ctaVideoUrls: string
- onScreenTextPool: string (newlines between overlays)
- singleOnScreenTextOnly: "yes" or "no"
- ftcDisclosure: string
- onScreenTextAiGuide: string
- onScreenMaxCharacters: number (max character limit for on-screen text, default 50)
- titlesAiGuide: string (guidelines for generating video titles)
- descriptionsAiGuide: string (guidelines for generating video descriptions)
- maxTitleCharacters: number (max character limit for title, default 60)
- predefinedDescription: string (static description to use across videos)

Brief Text:
"""
${briefText}
"""

Return ONLY a valid JSON object matching this schema without markdown code blocks.`

    try {
      const { text, provider } = await callUnifiedAi(
        prompt,
        'You extract structured campaign settings from text briefs. Always output valid JSON only.'
      )

      if (text) {
        let jsonStr = text.trim()
        const match = jsonStr.match(/```json\s*([\s\S]*?)```/) || jsonStr.match(/\{[\s\S]*\}/)
        if (match) jsonStr = match[1] || match[0]

        const parsed = JSON.parse(jsonStr)
        return NextResponse.json({
          parsed,
          source: provider,
          message: `Successfully extracted settings using ${provider === 'openrouter' ? 'OpenRouter Fallback AI' : 'Google Gemini AI'}`,
        })
      }
    } catch (aiErr: any) {
      console.error('Unified AI parse error:', aiErr?.message || aiErr)
    }

    // Heuristic Fallback parser if both Gemini and OpenRouter fail
    const text = briefText
    const parsed: Record<string, any> = {}

    // Name extraction heuristic
    const nameMatch = text.match(/(?:campaign|name|title)[:\s-]*([^\n]+)/i)
    if (nameMatch) parsed.campaignName = nameMatch[1].trim()

    // Niche extraction heuristic
    const nicheMatch = text.match(/(?:niche|category)[:\s-]*([^\n]+)/i)
    if (nicheMatch) parsed.niche = nicheMatch[1].trim()

    // Whop submission link heuristic
    const whopMatch = text.match(/(https?:\/\/[^\s]+whop[^\s]+)/i)
    if (whopMatch) parsed.submissionLink = whopMatch[1]

    // Drive / YouTube URLs heuristic
    const urls = text.match(/https?:\/\/(?:drive\.google\.com|youtu\.be|www\.youtube\.com)[^\s,]+/gi)
    if (urls && urls.length > 0) {
      parsed.sourceVideoUrls = urls.join(', ')
    }

    // Min views heuristic
    const viewsMatch = text.match(/(?:min(?:imum)?[\s_]*views?|views?)[:\s-]*(\d+[\d,]*)/i)
    if (viewsMatch) parsed.minViews = parseInt(viewsMatch[1].replace(/,/g, ''), 10)

    // Discord / Whop channel
    const channelMatch = text.match(/(?:channel)[:\s-]*([#\w-]+)/i)
    if (channelMatch) parsed.whopChannelName = channelMatch[1].trim()

    // Audio notes
    const audioMatch = text.match(/(?:audio|music|sound)[:\s-]*([^\n]+)/i)
    if (audioMatch) parsed.audioNotes = audioMatch[1].trim()

    return NextResponse.json({
      parsed,
      source: 'heuristic',
      notice: 'Parsed using rule heuristics.',
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Brief scan failed.' }, { status: 500 })
  }
}
