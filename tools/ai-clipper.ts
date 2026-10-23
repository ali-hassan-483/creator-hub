/**
 * Tool 5: Gemini Smart AI Clipper & Metadata Generator
 * 
 * Functions:
 * 1. Extract viral/engaging clip timestamps from video transcript
 * 2. Generate short titles (with FTC disclosure)
 * 3. Generate descriptions (predefined + AI)
 * 4. Generate on-screen text hooks (AI-based, follows AI guide)
 * 5. Parse campaign brief docs to auto-fill campaign form fields
 */

const GEMINI_MODEL = 'gemini-2.5-flash'
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ClipSuggestion {
  startTime: number
  endTime: number
  score: number           // 0–10 viral potential
  reason: string
  hookText: string        // suggested on-screen hook text
}

export interface ShortMetadata {
  title: string
  description: string
  onScreenText: string
  hashtags: string[]
}

export interface AiMetadataConfig {
  titlesGuide?: string
  descriptionsGuide?: string
  onScreenGuide?: string
  ftcDisclosure?: string
  predefinedDescription?: string
  useOnlyPredefinedDescription?: boolean
  linksInDescription?: string
  maxTitleChars?: number
  onScreenMaxChars?: number
  audioNotes?: string
  niche?: string
  campaignName?: string
}

import { callUnifiedAi } from '../lib/ai-provider'

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function callGemini(prompt: string, systemInstruction?: string): Promise<string> {
  const result = await callUnifiedAi(prompt, systemInstruction)
  return result.text
}

function extractJSON<T>(text: string, fallback: T): T {
  try {
    const match = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\[[\s\S]*\]|\{[\s\S]*\})/)
    if (match) return JSON.parse(match[1] || match[0])
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

// ─── 1. Smart AI Clip Extractor ───────────────────────────────────────────────

/**
 * Analyze transcript and find most engaging/viral clip timestamps.
 * Returns top N clip suggestions with start/end times and hook text.
 */
export async function findViralClips(
  transcript: Array<{ text: string; start: number; end: number }>,
  options: {
    minDuration: number
    maxDuration: number
    clipCount: number
    niche?: string
    audioNotes?: string
  }
): Promise<ClipSuggestion[]> {
  const { minDuration, maxDuration, clipCount, niche, audioNotes } = options

  // Build transcript text with timestamps
  const transcriptText = transcript
    .map(s => `[${s.start.toFixed(1)}s–${s.end.toFixed(1)}s] ${s.text}`)
    .join('\n')

  const prompt = `You are a viral short-form content expert specializing in ${niche || 'general'} content.

TRANSCRIPT WITH TIMESTAMPS:
${transcriptText}

TASK: Find the ${clipCount} most engaging and viral clip moments from this transcript.

Requirements:
- Each clip must be between ${minDuration}s and ${maxDuration}s long
- Focus on: hooks, punchlines, emotional peaks, surprising facts, actionable tips
- Avoid: slow intros, outros, sponsor segments, pauses
${audioNotes ? `- Special notes: ${audioNotes}` : ''}

Return ONLY valid JSON array:
[
  {
    "startTime": 12.5,
    "endTime": 47.3,
    "score": 9.2,
    "reason": "Strong hook with surprising fact",
    "hookText": "I can't believe this actually works..."
  }
]

Return ${clipCount} clips, sorted by score descending. Pure JSON only.`

  try {
    const response = await callGemini(prompt)
    const clips = extractJSON<ClipSuggestion[]>(response, [])
    console.log(`[AI-Clipper] ✅ Found ${clips.length} viral clips`)
    return clips.slice(0, clipCount)
  } catch (error: any) {
    console.error(`[AI-Clipper] ❌ ${error.message}`)
    return []
  }
}

// ─── 2. Title Generator ───────────────────────────────────────────────────────

/**
 * Generate YouTube Shorts title(s) for a clip.
 */
export async function generateTitle(
  clipText: string,
  config: AiMetadataConfig
): Promise<string> {
  const maxChars = config.maxTitleChars || 100
  const ftc = config.ftcDisclosure || ''
  const guide = config.titlesGuide || ''

  const prompt = `Generate 1 viral YouTube Shorts title for this clip content:
"${clipText}"

Guidelines: ${guide || 'Make it curiosity-driven, punchy, and relevant to the content.'}
Niche: ${config.niche || 'general'}
Campaign: ${config.campaignName || ''}

Rules:
- Maximum ${maxChars} characters
- Include FTC disclosure if required: "${ftc}"
- No clickbait that misrepresents content
- No emojis unless instructed

Return ONLY the title text, nothing else.`

  try {
    const title = await callGemini(prompt)
    return title.slice(0, maxChars)
  } catch (error: any) {
    console.error(`[AI-Title] ❌ ${error.message}`)
    return `${config.campaignName || 'Video'} - ${new Date().toLocaleDateString()}`
  }
}

// ─── 3. Description Generator ─────────────────────────────────────────────────

/**
 * Generate video description combining predefined + AI generated content.
 */
export async function generateDescription(
  clipText: string,
  config: AiMetadataConfig
): Promise<string> {
  const { predefinedDescription, useOnlyPredefinedDescription, linksInDescription, descriptionsGuide } = config

  if (useOnlyPredefinedDescription && predefinedDescription) {
    let desc = predefinedDescription
    if (linksInDescription) desc += '\n\n' + linksInDescription
    return desc
  }

  const prompt = `Write a YouTube Shorts description for this clip:
"${clipText}"

Guidelines: ${descriptionsGuide || 'Keep it short, engaging, and include a call to action.'}
Niche: ${config.niche || 'general'}

Rules:
- 2-4 sentences max
- Include relevant hashtags at end
- Don't repeat the title

Return ONLY the description text.`

  try {
    let desc = await callGemini(prompt)
    if (predefinedDescription) desc = predefinedDescription + '\n\n' + desc
    if (linksInDescription) desc += '\n\n' + linksInDescription
    return desc
  } catch (error: any) {
    console.error(`[AI-Description] ❌ ${error.message}`)
    return predefinedDescription || ''
  }
}

// ─── 4. On-Screen Text Generator ─────────────────────────────────────────────

/**
 * Generate on-screen text hook for a clip.
 */
export async function generateOnScreenText(
  clipText: string,
  config: AiMetadataConfig
): Promise<string> {
  const maxChars = config.onScreenMaxChars || 80
  const guide = config.onScreenGuide || ''

  const prompt = `Generate a short on-screen text hook for this video clip:
"${clipText}"

Guidelines: ${guide || 'Make it a curiosity hook that makes viewers keep watching. Use impact words.'}
Max characters: ${maxChars}

Return ONLY the on-screen text. No quotes, no explanation.`

  try {
    const text = await callGemini(prompt)
    return text.slice(0, maxChars)
  } catch (error: any) {
    console.error(`[AI-OnScreen] ❌ ${error.message}`)
    return ''
  }
}

// ─── 5. Full Metadata Generator ───────────────────────────────────────────────

/**
 * Generate complete metadata for a clip (title + description + on-screen text).
 */
export async function generateFullMetadata(
  clipTranscript: string,
  config: AiMetadataConfig
): Promise<ShortMetadata> {
  const [title, description, onScreenText] = await Promise.all([
    generateTitle(clipTranscript, config),
    generateDescription(clipTranscript, config),
    generateOnScreenText(clipTranscript, config),
  ])

  // Extract hashtags from description
  const hashtags = (description.match(/#\w+/g) || []).map(h => h.slice(1))

  return { title, description, onScreenText, hashtags }
}

// ─── 5b. Batch Metadata Generator from Guidelines (Multi-Cut / Continuous) ─────

/**
 * Generates a batch of N (default 50) clip metadata sets directly from campaign guidelines.
 * NO script/transcript is sent to Gemini! Only title guidelines, description guidelines,
 * on-screen guide, FTC disclosure, and niche/campaign context are sent in ONE API call.
 */
export async function generateBatchMetadataFromGuidelines(
  count: number = 50,
  config: AiMetadataConfig
): Promise<ShortMetadata[]> {
  const maxTitleChars = config.maxTitleChars || 100
  const onScreenMaxChars = config.onScreenMaxChars || 80
  const ftc = config.ftcDisclosure ? ` (Must include FTC disclosure: "${config.ftcDisclosure}")` : ''
  const links = config.linksInDescription ? `\nLinks to include in description: ${config.linksInDescription}` : ''
  const predefined = config.predefinedDescription || ''

  const prompt = `You are a social media viral growth strategist.
Generate exactly ${count} UNIQUE and DIVERSE sets of metadata for short-form videos (YouTube Shorts / TikTok / Reels) based ONLY on the campaign guidelines below.

CAMPAIGN DETAILS:
- Campaign Name: ${config.campaignName || 'Campaign'}
- Niche: ${config.niche || 'General'}
${config.audioNotes ? `- Notes/Theme: ${config.audioNotes}` : ''}

GUIDELINES:
1. Title Guidelines: ${config.titlesGuide || 'Punchy, curiosity-driven viral titles'}${ftc}
   - Max length: ${maxTitleChars} characters per title
2. On-Screen Text Guidelines: ${config.onScreenGuide || 'Engaging 3-5 word curiosity hook for viewers' }
   - Max length: ${onScreenMaxChars} characters
3. Description Guidelines: ${config.descriptionsGuide || 'Engaging 2-3 sentence description with call-to-action and relevant hashtags' }
   ${config.useOnlyPredefinedDescription ? '- Use ONLY the predefined description provided below.' : ''}

${predefined ? `PREDEFINED BASE DESCRIPTION: "${predefined}"` : ''}
${links}

REQUIREMENTS:
- Return an array of exactly ${count} items.
- Every item MUST have:
  - "title": String (<= ${maxTitleChars} chars)
  - "onScreenText": String (<= ${onScreenMaxChars} chars)
  - "description": String
  - "hashtags": Array of strings (e.g. ["shorts", "viral", ...])
- DO NOT repeat titles or hooks. Make them varied and high-converting.

Return ONLY a valid JSON array of ${count} objects matching this exact schema:
[
  {
    "title": "Viral Title Here",
    "onScreenText": "Wait till the end...",
    "description": "Short video description here...",
    "hashtags": ["shorts", "trending"]
  }
]
No explanation, no markdown backticks, pure JSON only.`

  try {
    const rawResponse = await callGemini(prompt, 'You are an expert social media viral copywriter. Always output valid JSON array.')
    let batch = extractJSON<ShortMetadata[]>(rawResponse, [])

    if (!Array.isArray(batch) || batch.length === 0) {
      throw new Error('Invalid array returned by Gemini')
    }

    // Sanitize lengths and format
    return batch.slice(0, count).map((item, idx) => {
      let desc = item.description || predefined || ''
      if (config.useOnlyPredefinedDescription && predefined) {
        desc = predefined
      } else if (predefined && !desc.includes(predefined)) {
        desc = `${predefined}\n\n${desc}`
      }
      if (config.linksInDescription && !desc.includes(config.linksInDescription)) {
        desc = `${desc}\n\n${config.linksInDescription}`
      }

      return {
        title: (item.title || `${config.campaignName || 'Video'} #${idx + 1}`).slice(0, maxTitleChars),
        onScreenText: (item.onScreenText || 'Watch this!').slice(0, onScreenMaxChars),
        description: desc,
        hashtags: Array.isArray(item.hashtags) ? item.hashtags : ['shorts', 'viral'],
      }
    })
  } catch (error: any) {
    console.error(`[Batch-Metadata] ❌ Error generating batch metadata: ${error.message}`)
    // Fallback generation if API fails
    const fallbackList: ShortMetadata[] = []
    for (let i = 1; i <= count; i++) {
      fallbackList.push({
        title: `${config.campaignName || 'Video'} #${i} ${config.ftcDisclosure ? `| ${config.ftcDisclosure}` : ''}`.slice(0, maxTitleChars),
        onScreenText: `Watch till the end! #${i}`.slice(0, onScreenMaxChars),
        description: predefined ? `${predefined}${links}` : `Check this out! #shorts #viral${links}`,
        hashtags: ['shorts', 'viral'],
      })
    }
    return fallbackList
  }
}

// ─── 6. Campaign Brief Parser ─────────────────────────────────────────────────

/**
 * Parse a campaign brief document and extract all campaign fields.
 * Used in the "Auto-Fill Settings from Brief" Gemini AI feature in admin.
 */
export async function parseCampaignBrief(briefText: string): Promise<Record<string, any>> {
  const prompt = `You are a campaign settings extractor. Parse this campaign brief and extract relevant fields.

BRIEF:
${briefText}

Extract and return JSON with these fields (use null if not mentioned):
{
  "campaignName": "string or null",
  "niche": "string or null",
  "whopChannelName": "string or null",
  "channelSubmissionLink": "string or null",
  "minViews": "number or null",
  "minEngagementRatio": "number or null",
  "dailyPostLimit": "number or null",
  "shortDuration": "number or null",
  "startOffset": "number or null",
  "titlesGuide": "string or null",
  "descriptionsGuide": "string or null",
  "onScreenGuide": "string or null",
  "audioNotes": "string or null",
  "fixYoutubeMentions": "boolean or null",
  "enablePendingTasks": "boolean or null",
  "ftcDisclosure": "string or null"
}

Return ONLY valid JSON. No explanation.`

  try {
    const response = await callGemini(prompt, 'You extract structured campaign settings from text briefs.')
    return extractJSON<Record<string, any>>(response, {})
  } catch (error: any) {
    console.error(`[AI-Brief] ❌ ${error.message}`)
    return {}
  }
}
