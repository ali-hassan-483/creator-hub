/**
 * Story Re-Cut Engine (Whop Shorts Style)
 * 
 * Implements the brand-safe story re-cut editing philosophy:
 * 1. Cold-Open Reorder: Payoff/hook first (3-4s punch zoom), then setup, then payoff in context
 * 2. Cross-Cut: Combines moments from different timestamps of the source footage
 * 3. Dynamic Punch Zoom: 1.0x normal, 1.15-1.25x on emphasis/hook
 * 4. Silence Tightening: Auto-trims dead silence at cut boundaries
 * 5. Clean Keyword Captions: Re-timed ASS subtitles from transcript SRT, with highlighted keywords
 * 6. Brand-safe: Uses only the brand's own source footage (no templates, no mirror blur)
 * 7. Different Angle Per Channel: Unique hook per clip, zero duplicates
 */

import * as fs from 'fs'
import * as path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import { TranscriptSegment } from './subtitle-generator'
import { getVideoInfo } from './video-editor'

const execAsync = promisify(exec)

export interface StoryRecutSegment {
  start: number | string
  end: number | string
  role: 'hook' | 'setup' | 'payoff' | 'crosscut_proof' | 'story'
  zoom: number
}

export interface StoryRecutClipDef {
  id: string
  keywords: string[]
  segments: StoryRecutSegment[]
}

export interface StoryRecutMap {
  _how_it_works: string
  captions_srt?: string
  clips: StoryRecutClipDef[]
}

export interface StoryRecutManifestItem {
  id: string
  file: string
  duration_sec: number
  playback_order_source_ranges: [number, number][]
  roles: string[]
}

// Common stopwords to exclude from auto keyword highlights
const STOPWORDS = new Set([
  'about', 'above', 'after', 'again', 'against', 'all', 'also', 'and', 'another', 'any', 'are', 'around', 'because', 'been',
  'before', 'being', 'below', 'between', 'both', 'but', 'came', 'come', 'could', 'did', 'does', 'doing', 'down', 'during',
  'each', 'even', 'every', 'few', 'for', 'from', 'further', 'get', 'gets', 'getting', 'give', 'going', 'good', 'had', 'has',
  'have', 'having', 'her', 'here', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'into', 'its', 'itself', 'just', 'know',
  'like', 'look', 'make', 'many', 'more', 'most', 'much', 'myself', 'never', 'now', 'off', 'once', 'only', 'other', 'our',
  'ours', 'ourselves', 'out', 'over', 'own', 'same', 'should', 'some', 'such', 'than', 'that', 'the', 'their', 'theirs',
  'them', 'themselves', 'then', 'there', 'these', 'they', 'thing', 'think', 'this', 'those', 'through', 'too', 'under',
  'until', 'very', 'was', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'will', 'with', 'would',
  'you', 'your', 'yours', 'yourself', 'yourselves', 'yeah', 'okay', 'gonna', 'wanna', 'right', 'really', 'well'
])

/**
 * Extract 3-5 punchy keywords from spoken text to highlight in captions.
 */
export function extractKeywords(text: string, count: number = 4): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4 && !STOPWORDS.has(w))

  const freq: Record<string, number> = {}
  for (const w of words) {
    freq[w] = (freq[w] || 0) + 1
  }

  // Sort by frequency and length
  return Object.keys(freq)
    .sort((a, b) => freq[b] - freq[a] || b.length - a.length)
    .slice(0, count)
}

/**
 * Build a Story Re-Cut cutmap for a source video.
 * Each clip has:
 * - Segment 1: Cold-Open Hook (payoff line, 3-4s, zoom 1.20)
 * - Segment 2: Setup / Story (context, 18-30s, zoom 1.00)
 * - Segment 3: Payoff in Context / Climax (10-18s, zoom 1.12)
 */
export function buildStoryRecutMap(
  videoDuration: number,
  transcript: TranscriptSegment[],
  srtPath: string | null,
  options: {
    clipCount: number
    startIndex: number
    targetDuration?: number
    hookDuration?: number
    campaignName?: string
  }
): StoryRecutMap {
  const {
    clipCount,
    startIndex,
    targetDuration = 45,
    hookDuration = 3.5,
  } = options

  const clips: StoryRecutClipDef[] = []
  const dur = Math.max(60, videoDuration)

  // Calculate safe window size for each story block
  const storyBlockDur = Math.min(targetDuration * 1.5, Math.max(40, dur / (clipCount + 2)))
  const maxStart = Math.max(0, dur - storyBlockDur - 10)

  for (let i = 0; i < clipCount; i++) {
    const clipNum = startIndex + i
    const clipId = `final_${String(clipNum).padStart(4, '0')}_${Date.now()}`

    // Distribute clips evenly across the video timeline to get different angles
    const blockStart = (maxStart * ((clipNum * 0.61803398875) % 1)) // golden ratio distribution
    const blockEnd = Math.min(dur - 2, blockStart + storyBlockDur)

    // Segment boundaries
    // Payoff is near the end of the block
    const payoffStart = Math.max(blockStart + 10, blockEnd - 12)
    const payoffEnd = blockEnd

    // Hook is the most punchy part of the payoff (last 3-4s)
    const hookStart = Math.max(blockStart, payoffEnd - hookDuration)
    const hookEnd = payoffEnd

    // Setup is the beginning of the block up to the payoff
    const setupStart = blockStart
    const setupEnd = payoffStart

    // Extract spoken words in this range to get smart keywords
    let spokenKeywords: string[] = []
    if (transcript && transcript.length > 0) {
      const clipWords = transcript
        .filter(s => s.start >= blockStart && s.end <= blockEnd)
        .map(s => s.text)
        .join(' ')
      spokenKeywords = extractKeywords(clipWords, 4)
    }

    if (spokenKeywords.length === 0) {
      spokenKeywords = ['viral', 'secret', 'money', 'truth']
    }

    clips.push({
      id: clipId,
      keywords: spokenKeywords,
      segments: [
        // 1. COLD-OPEN PAYOFF HOOK (Payoff first!)
        {
          start: Math.round(hookStart * 10) / 10,
          end: Math.round(hookEnd * 10) / 10,
          role: 'hook',
          zoom: 1.2,
        },
        // 2. SETUP (Context leading to the moment)
        {
          start: Math.round(setupStart * 10) / 10,
          end: Math.round(setupEnd * 10) / 10,
          role: 'setup',
          zoom: 1.0,
        },
        // 3. PAYOFF IN CONTEXT
        {
          start: Math.round(payoffStart * 10) / 10,
          end: Math.round(payoffEnd * 10) / 10,
          role: 'payoff',
          zoom: 1.12,
        },
      ],
    })
  }

  const result: StoryRecutMap = {
    _how_it_works:
      'segments are played in the ORDER LISTED, not source order. List the hook (payoff) first, then the setup, then the payoff in context. Brand-safe full 9:16 vertical crop with punch zooms and clean keyword captions.',
    clips,
  }

  if (srtPath && fs.existsSync(srtPath)) {
    result.captions_srt = srtPath
  }

  return result
}

/**
 * Execute story_recut_editor.py to render a batch of clips.
 */
export async function renderStoryRecutBatch(
  sourceVideoPath: string,
  cutmap: StoryRecutMap,
  outputDir: string,
  options?: {
    tighten?: boolean
    onLog?: (msg: string) => void
  }
): Promise<StoryRecutManifestItem[]> {
  fs.mkdirSync(outputDir, { recursive: true })

  // Write cutmap to temporary JSON
  const cutmapPath = path.join(outputDir, `cutmap_batch_${Date.now()}.json`)
  fs.writeFileSync(cutmapPath, JSON.stringify(cutmap, null, 2), 'utf8')

  const scriptPath = path.join(__dirname, 'story_recut_editor.py')
  const pythonBin = process.platform === 'win32' ? 'python' : 'python3'

  const cmdParts = [
    pythonBin,
    `"${scriptPath}"`,
    `"${sourceVideoPath}"`,
    `--cutmap "${cutmapPath}"`,
    `--out "${outputDir}"`,
  ]

  if (options?.tighten) {
    cmdParts.push('--tighten')
  }

  const cmd = cmdParts.join(' ')
  options?.onLog?.(`[StoryReCut] Executing: ${cmd}`)

  try {
    const { stdout, stderr } = await execAsync(cmd, {
      maxBuffer: 30 * 1024 * 1024,
      timeout: 10 * 60 * 1000, // 10 minutes max for a batch
      env: {
        ...process.env,
        FFMPEG_PRESET: process.env.FFMPEG_PRESET || 'ultrafast',
        FFMPEG_CRF: process.env.FFMPEG_CRF || '22',
      },
    })

    if (stdout) {
      options?.onLog?.(`[StoryReCut] Output:\n${stdout.slice(-1500)}`)
    }
  } catch (err: any) {
    const errOut = err?.stderr?.slice(-1000) || err?.message || 'Script execution failed'
    options?.onLog?.(`[StoryReCut] ⚠️ Error during batch render: ${errOut}`)
    throw new Error(`Story Re-Cut renderer failed: ${errOut}`)
  } finally {
    // Cleanup temporary cutmap
    if (fs.existsSync(cutmapPath)) {
      try { fs.unlinkSync(cutmapPath) } catch {}
    }
  }

  // Read manifest.json
  const manifestPath = path.join(outputDir, 'manifest.json')
  if (!fs.existsSync(manifestPath)) {
    throw new Error('manifest.json not found after Story Re-Cut render')
  }

  try {
    const manifestContent = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as StoryRecutManifestItem[]
    return manifestContent
  } catch (err: any) {
    throw new Error(`Failed to parse manifest.json: ${err.message}`)
  }
}
