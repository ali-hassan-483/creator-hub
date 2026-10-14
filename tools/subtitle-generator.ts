/**
 * Tool 4: Subtitles & Transcription Engine
 * 
 * Generates ASS (Advanced SubStation Alpha) subtitle files with:
 * - Word-by-word karaoke highlight (speaking word highlight)
 * - Custom fonts, colors, outline
 * - Placement height (% from top)
 * - Max words per screen
 * - Text case transformation (UPPERCASE / lowercase / Title Case)
 * 
 * Transcription via:
 *   1. Whisper (local, via openai-whisper CLI or whisper.cpp)
 *   2. Gemini API (transcribe audio with timestamps)
 *   3. xAI Grok (API fallback)
 */

import * as fs from 'fs'
import * as path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WordTimestamp {
  word: string
  start: number   // seconds
  end: number     // seconds
}

export interface TranscriptSegment {
  text: string
  start: number
  end: number
  words?: WordTimestamp[]
}

export interface SubtitleConfig {
  font: string
  textColor: string
  outlineColor: string
  fontSize: number
  placementHeight: number     // % from top border (e.g. 80)
  maxWordsPerScreen: number   // max words visible at once
  speakingWordHighlight: string  // color for karaoke active word
  textCase: string[]          // 'UPPERCASE' | 'lowercase' | 'Normal'
  canvasWidth?: number
  canvasHeight?: number
}

// ─── Transcription ─────────────────────────────────────────────────────────

/**
 * Transcribe audio using Whisper CLI (must be installed on VPS).
 * Returns word-level timestamps.
 */
export async function transcribeWithWhisper(videoPath: string, outputDir: string): Promise<TranscriptSegment[]> {
  const whisperBin = process.env.WHISPER_BIN || 'whisper'
  const jsonOut = path.join(outputDir, 'whisper_out')
  
  try {
    // Extract audio first
    const audioPath = path.join(outputDir, 'audio_temp.wav')
    await execAsync(`ffmpeg -i "${videoPath}" -vn -ar 16000 -ac 1 -y "${audioPath}"`, {
      maxBuffer: 5 * 1024 * 1024,
    })

    // Run Whisper with word timestamps
    const cmd = `${whisperBin} "${audioPath}" --output_dir "${outputDir}" --output_format json --word_timestamps True --model base`
    await execAsync(cmd, { maxBuffer: 20 * 1024 * 1024 })

    // Read output JSON
    const jsonFiles = fs.readdirSync(outputDir).filter(f => f.endsWith('.json') && f.includes('audio_temp'))
    if (jsonFiles.length === 0) throw new Error('Whisper output JSON not found')

    const whisperOut = JSON.parse(fs.readFileSync(path.join(outputDir, jsonFiles[0]), 'utf8'))
    
    // Cleanup
    if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath)

    // Parse segments
    const segments: TranscriptSegment[] = (whisperOut.segments || []).map((seg: any) => ({
      text: seg.text.trim(),
      start: seg.start,
      end: seg.end,
      words: (seg.words || []).map((w: any) => ({
        word: w.word.trim(),
        start: w.start,
        end: w.end,
      })),
    }))

    console.log(`[Whisper] ✅ Transcribed ${segments.length} segments`)
    return segments

  } catch (error: any) {
    console.error(`[Whisper] ❌ ${error.message}`)
    return []
  }
}

import { executeGeminiWithFailover } from '../lib/gemini-pool'

/**
 * Transcribe using Gemini API (gemini-2.0-flash with audio inline data).
 * Fallback when Whisper is not available.
 * Uses Multi-Key Failover pool across all user keys.
 */
export async function transcribeWithGemini(videoPath: string): Promise<TranscriptSegment[]> {
  try {
    // Extract audio as base64
    const audioPath = videoPath + '_audio.mp3'
    await execAsync(`ffmpeg -i "${videoPath}" -vn -b:a 64k -y "${audioPath}"`, {
      maxBuffer: 5 * 1024 * 1024,
    })
    const audioData = fs.readFileSync(audioPath).toString('base64')
    if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath)

    const prompt = `Transcribe this audio with word-level timestamps in JSON format.
Return ONLY a JSON array of segments like:
[{"text":"...", "start":0.0, "end":2.5, "words":[{"word":"Hello","start":0.0,"end":0.4},...]},...]
No markdown, no explanation. Pure JSON only.`

    return await executeGeminiWithFailover(async (apiKey) => {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inlineData: { mimeType: 'audio/mpeg', data: audioData } },
              { text: prompt },
            ],
          }],
          generationConfig: { temperature: 0.1 },
        }),
      })

      if (!response.ok) {
        const err = await response.text()
        throw new Error(`Gemini Transcribe API error ${response.status}: ${err}`)
      }

      const data = await response.json() as any
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''

      const jsonMatch = text.match(/\[[\s\S]*\]/)
      if (!jsonMatch) throw new Error('No JSON found in Gemini response')

      const segments: TranscriptSegment[] = JSON.parse(jsonMatch[0])
      console.log(`[Gemini-Transcribe] ✅ ${segments.length} segments`)
      return segments
    })

  } catch (error: any) {
    console.error(`[Gemini-Transcribe] ❌ ${error.message}`)
    return []
  }
}

/**
 * Auto-select transcription method.
 * Tries Whisper first, then falls back to Gemini.
 */
export async function transcribeVideo(videoPath: string, outputDir: string): Promise<TranscriptSegment[]> {
  fs.mkdirSync(outputDir, { recursive: true })

  // Check if Whisper is available
  try {
    const whisperBin = process.env.WHISPER_BIN || 'whisper'
    await execAsync(`${whisperBin} --help`, { timeout: 5000 })
    console.log('[Transcribe] Using Whisper')
    const result = await transcribeWithWhisper(videoPath, outputDir)
    if (result.length > 0) return result
  } catch {
    console.log('[Transcribe] Whisper not available, trying Gemini...')
  }

  return transcribeWithGemini(videoPath)
}

// ─── Text Case Transform ──────────────────────────────────────────────────────

function applyTextCase(text: string, textCases: string[]): string {
  if (textCases.includes('UPPERCASE')) return text.toUpperCase()
  if (textCases.includes('lowercase')) return text.toLowerCase()
  if (textCases.includes('Normal')) {
    // Title case for important words
    return text.replace(/\b\w+/g, (w) =>
      w.length > 3 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()
    )
  }
  return text
}

// ─── ASS Subtitle Generator ───────────────────────────────────────────────────

function secondsToAssTime(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const centiseconds = Math.round((sec % 1) * 100)
  const whole = Math.floor(sec)
  return `${h}:${String(m).padStart(2, '0')}:${String(whole).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`
}

function hexToAssColor(hexColor: string, alpha = 0): string {
  // ASS uses &HAABBGGRR format
  const hex = hexColor.replace('#', '')
  let r = '00', g = '00', b = '00'
  if (hex.length === 6) {
    r = hex.slice(0, 2)
    g = hex.slice(2, 4)
    b = hex.slice(4, 6)
  } else if (hex.length === 3) {
    r = hex[0] + hex[0]
    g = hex[1] + hex[1]
    b = hex[2] + hex[2]
  }
  const aa = String(Math.round(alpha * 255)).padStart(2, '0').toUpperCase()
  // Named colors
  const namedColors: Record<string, string> = {
    'white': '&H00FFFFFF', 'black': '&H00000000', 'yellow': '&H0000FFFF',
    'red': '&H000000FF', 'blue': '&H00FF0000', 'green': '&H0000FF00',
    'orange': '&H000080FF', 'purple': '&H00800080', 'cyan': '&H00FFFF00',
  }
  if (namedColors[hexColor.toLowerCase()]) return namedColors[hexColor.toLowerCase()]
  return `&H00${b}${g}${r}`
}

/**
 * Generate an ASS subtitle file with karaoke word highlighting.
 */
export function generateAssSubtitles(
  segments: TranscriptSegment[],
  outputPath: string,
  config: SubtitleConfig
): void {
  const {
    font,
    textColor,
    outlineColor,
    fontSize,
    placementHeight,
    maxWordsPerScreen,
    speakingWordHighlight,
    textCase,
    canvasWidth = 1080,
    canvasHeight = 1920,
  } = config

  const marginV = Math.round(canvasHeight * (placementHeight / 100))
  const assColor = hexToAssColor(textColor)
  const assOutline = hexToAssColor(outlineColor)
  const assHighlight = hexToAssColor(speakingWordHighlight)

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${canvasWidth}
PlayResY: ${canvasHeight}
Collisions: Normal
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${font || 'Arial'},${fontSize},${assColor},${assHighlight},${assOutline},&H80000000,-1,0,0,0,100,100,0,0,1,3,2,2,20,20,${marginV},1
Style: Highlight,${font || 'Arial'},${fontSize},${assHighlight},${assColor},${assOutline},&H80000000,-1,0,0,0,100,100,0,0,1,3,2,2,20,20,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`

  const events: string[] = []

  for (const segment of segments) {
    if (!segment.words || segment.words.length === 0) {
      // No word-level timestamps — emit whole segment
      const text = applyTextCase(segment.text, textCase)
      events.push(
        `Dialogue: 0,${secondsToAssTime(segment.start)},${secondsToAssTime(segment.end)},Default,,0,0,0,,${text}`
      )
      continue
    }

    // Group words into chunks of maxWordsPerScreen
    const words = segment.words
    for (let i = 0; i < words.length; i += maxWordsPerScreen) {
      const chunk = words.slice(i, i + maxWordsPerScreen)
      const chunkStart = chunk[0].start
      const chunkEnd = chunk[chunk.length - 1].end

      // Build karaoke line: normal words + highlight current speaking word
      for (let j = 0; j < chunk.length; j++) {
        const word = chunk[j]
        const lineWords = chunk.map((w, idx) => {
          const wordText = applyTextCase(w.word, textCase)
          if (idx === j) {
            return `{\\c${assHighlight}}${wordText}{\\c${assColor}}`
          }
          return wordText
        })

        events.push(
          `Dialogue: 0,${secondsToAssTime(word.start)},${secondsToAssTime(word.end)},Default,,0,0,0,,${lineWords.join(' ')}`
        )
      }
    }
  }

  const assContent = header + events.join('\n') + '\n'
  fs.writeFileSync(outputPath, assContent, 'utf8')
  console.log(`[Subtitles] ✅ ASS file written: ${outputPath}`)
}

/**
 * Burn ASS subtitles into video using FFMPEG.
 */
export async function burnSubtitlesIntoVideo(
  inputVideo: string,
  assPath: string,
  outputVideo: string
): Promise<boolean> {
  // FFMPEG ass filter — path needs forward slashes on Windows
  const safeAssPath = assPath.replace(/\\/g, '/').replace(/:/g, '\\:')
  
  const cmd = [
    process.env.FFMPEG_PATH || 'ffmpeg',
    `-i "${inputVideo}"`,
    `-vf "ass='${safeAssPath}'"`,
    `-c:v libx264 -preset fast -crf 23`,
    `-c:a copy`,
    `-y "${outputVideo}"`,
  ].join(' ')

  try {
    await execAsync(cmd, { maxBuffer: 10 * 1024 * 1024 })
    console.log(`[Subtitles] ✅ Burned subtitles into: ${outputVideo}`)
    return true
  } catch (error: any) {
    console.error(`[Subtitles] ❌ Burn failed: ${error.stderr?.slice(-300) || error.message}`)
    return false
  }
}

/**
 * Full pipeline: transcribe → generate ASS → burn into video.
 */
export async function addSubtitlesToVideo(
  videoPath: string,
  outputPath: string,
  config: SubtitleConfig,
  workDir: string
): Promise<boolean> {
  fs.mkdirSync(workDir, { recursive: true })

  // 1. Transcribe
  const segments = await transcribeVideo(videoPath, workDir)
  if (segments.length === 0) {
    console.warn('[Subtitles] No transcription data — skipping subtitles')
    return false
  }

  // 2. Generate ASS
  const assPath = path.join(workDir, 'subtitles.ass')
  generateAssSubtitles(segments, assPath, config)

  // 3. Burn into video
  return burnSubtitlesIntoVideo(videoPath, assPath, outputPath)
}
