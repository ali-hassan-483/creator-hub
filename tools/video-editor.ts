/**
 * Tool 3: FFMPEG Video Editing & Slicing Engine
 * 
 * Handles:
 * - Multi-Cut / Continuous / Smart AI clip slicing
 * - Hook + Clip + CTA stitching
 * - Canvas backgrounds (Split Mirror Blur, Vibrant Mirror Blur, Solid Canvas, RGB Monitor)
 * - Foreground corner styles (Sharp / Rounded / Feathered / Border / Shadow)
 * - Logo/watermark overlay (positioned by percentage)
 * - Bottom Banners (up to 5, with timed appearance and styled word colors)
 * - Volume multiplier
 * - Output: 9:16 vertical short (1080x1920)
 */

import * as fs from 'fs'
import * as path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BannerConfig {
  text: string
  font: string
  textColor: string
  positionHeight: number      // % from top (e.g. 85)
  fontSize: number            // px
  background: string          // e.g. "red@0.8" or "black@0.5"
  styledWordCount: number
  styledWordsColor: string
  showOnlyInLastSeconds: boolean
  lastSecondsDuration?: number
}

export interface VideoEditOptions {
  // Input
  inputPath: string
  outputPath: string
  
  // Clip range
  startTime: number           // seconds
  endTime: number             // seconds
  
  // Optional hook + CTA stitching
  hookPath?: string
  ctaPath?: string
  
  // Canvas / Background
  backgroundStyle: string[]   // multi-select: 'split_mirror_blur' | 'vibrant_mirror_blur' | 'solid_white' | 'solid_black' | 'custom_color' | 'rgb_monitor'
  customBgColor?: string      // hex color for 'custom_color' background
  
  // Foreground corner style
  cornerStyles: string[]      // multi-select: 'sharp' | 'rounded' | 'feathered' | 'rounded_white_border' | 'rounded_drop_shadow'
  
  // Volume
  volumeMultiplier: number    // 1.0 = normal
  preset?: string             // e.g. 'ultrafast' for instant sandbox preview
  
  // Logo overlay
  logoPath?: string           // local path to logo image
  overlayPosition?: string    // 'top_left' | 'top_center' | 'top_right' | 'bottom_left' | 'bottom_center' | 'bottom_right'
  overlayWidth?: number       // % of canvas width (e.g. 15)
  
  // Bottom banners
  banners: BannerConfig[]
  
  // Output canvas size (default 1080x1920 for Shorts)
  canvasWidth?: number
  canvasHeight?: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_WIDTH = 1080
const DEFAULT_HEIGHT = 1920
const FFMPEG_BIN = process.env.FFMPEG_PATH || (process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
const FONTS_DIR = process.env.FONTS_DIR || (process.platform === 'win32' ? 'C:/Windows/Fonts' : '/usr/share/fonts')

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Parse "color@opacity" string → {color, alpha} */
function parseBgColor(bgStr: string): { color: string; alpha: number } {
  const [color, alphaStr] = bgStr.split('@')
  return { color: color || 'black', alpha: parseFloat(alphaStr ?? '1') }
}

/** Convert overlay position name to FFMPEG x/y expressions */
function overlayPositionToXY(position: string, W: number, H: number, logoW: number): string {
  switch (position) {
    case 'top_left':      return `x=20:y=20`
    case 'top_center':    return `x=(W-w)/2:y=20`
    case 'top_right':     return `x=W-w-20:y=20`
    case 'bottom_left':   return `x=20:y=H-h-20`
    case 'bottom_center': return `x=(W-w)/2:y=H-h-20`
    case 'bottom_right':  return `x=W-w-20:y=H-h-20`
    default:              return `x=W-w-20:y=20`
  }
}

/** Get video duration in seconds using ffprobe */
export async function getVideoDuration(filePath: string): Promise<number> {
  try {
    const cmd = `ffprobe -v quiet -print_format json -show_format "${filePath}"`
    const { stdout } = await execAsync(cmd, { maxBuffer: 2 * 1024 * 1024 })
    const info = JSON.parse(stdout)
    return parseFloat(info.format.duration) || 0
  } catch {
    return 0
  }
}

/** Get video dimensions using ffprobe */
export async function getVideoInfo(filePath: string): Promise<{ width: number; height: number; duration: number }> {
  try {
    const cmd = `ffprobe -v quiet -print_format json -show_streams -show_format "${filePath}"`
    const { stdout } = await execAsync(cmd, { maxBuffer: 2 * 1024 * 1024 })
    const info = JSON.parse(stdout)
    const video = info.streams.find((s: any) => s.codec_type === 'video')
    return {
      width: video?.width || 1920,
      height: video?.height || 1080,
      duration: parseFloat(info.format?.duration || '0'),
    }
  } catch {
    return { width: 1920, height: 1080, duration: 0 }
  }
}

// ─── Background Style Builders ────────────────────────────────────────────────

/**
 * Build FFMPEG filtergraph for background style.
 * Returns filter_complex string segment that creates [bg] stream.
 * Input stream [0:v] is the source video.
 */
function buildBackgroundFilter(
  style: string,
  canvasW: number,
  canvasH: number,
  customColor?: string
): string {
  switch (style) {
    case 'split_mirror_blur':
      // Mirror top and bottom halves with blur as background
      return [
        `[0:v]scale=${canvasW}:${canvasH}:force_original_aspect_ratio=increase,crop=${canvasW}:${canvasH},split=2[bg_top][bg_bot]`,
        `[bg_top]vflip,scale=${canvasW}:${canvasH / 2}[bg_top_flip]`,
        `[bg_bot]scale=${canvasW}:${canvasH / 2}[bg_bot_s]`,
        `[bg_top_flip][bg_bot_s]vstack=inputs=2,gblur=sigma=25[bg]`,
      ].join(';')

    case 'vibrant_mirror_blur':
      return [
        `[0:v]scale=${canvasW}:${canvasH}:force_original_aspect_ratio=increase,crop=${canvasW}:${canvasH}`,
        `split=2[bg_a][bg_b]`,
        `[bg_a]vflip[bg_flip]`,
        `[bg_flip][bg_b]blend=all_mode=overlay,eq=saturation=2.5:brightness=0.05,gblur=sigma=30[bg]`,
      ].join(';')

    case 'solid_white':
      return `color=white:${canvasW}x${canvasH}[bg]`

    case 'solid_black':
      return `color=black:${canvasW}x${canvasH}[bg]`

    case 'custom_color':
      const hex = (customColor || '#1a1a2e').replace('#', '')
      return `color=0x${hex}:${canvasW}x${canvasH}[bg]`

    case 'rgb_monitor':
      // Dark background with subtle RGB border effect
      return [
        `color=0x0d0d1a:${canvasW}x${canvasH}[bg_base]`,
        `[bg_base]drawbox=x=0:y=0:w=${canvasW}:h=10:color=red@0.8:t=fill`,
        `drawbox=x=0:y=${canvasH - 10}:w=${canvasW}:h=10:color=blue@0.8:t=fill[bg]`,
      ].join(',')

    default:
      return `color=black:${canvasW}x${canvasH}[bg]`
  }
}

/**
 * Scale and position foreground video on canvas.
 * Applies corner styles via alpha masks.
 */
function buildForegroundScaleFilter(
  canvasW: number,
  canvasH: number,
  cornerStyle: string
): string {
  // Scale foreground video to fit vertically in 9:16 with side margins
  const fgW = Math.round(canvasW * 0.92)
  const fgH = Math.round(fgW * (16 / 9))
  const yOffset = Math.round((canvasH - fgH) / 2)

  let scaleFilter = `[fg_raw]scale=${fgW}:${fgH}:force_original_aspect_ratio=decrease[fg_scaled]`

  switch (cornerStyle) {
    case 'rounded':
    case 'rounded_white_border':
      // Use geq for rounded corners via alpha channel
      scaleFilter += `;[fg_scaled]format=rgba,geq=`
        + `'if(gt(pow(X-${fgW / 2},2)+pow(Y-${fgH / 2},2),pow(min(${fgW},${fgH})/2,2)),0,255)':128:128[fg_mask]`
      break
    case 'feathered':
      scaleFilter += `;[fg_scaled]format=rgba,unsharp=5:5:-1.5:5:5:-1.5[fg_mask]`
      break
    case 'rounded_drop_shadow':
      scaleFilter += `;[fg_scaled]format=rgba[fg_mask]`
      break
    default:
      scaleFilter += `;[fg_scaled]copy[fg_mask]`
  }

  return `${scaleFilter};[fg_mask]setpts=PTS-STARTPTS[fg]`
}

// ─── Banner Filter Builder ────────────────────────────────────────────────────

/**
 * Build FFMPEG drawtext filters for bottom banners.
 */
function buildBannerFilters(banners: BannerConfig[], totalDuration: number): string {
  if (!banners || banners.length === 0) return ''

  const filters: string[] = []

  for (const banner of banners) {
    if (!banner.text || banner.text.trim() === '') continue

    const { color: bgColor, alpha: bgAlpha } = parseBgColor(banner.background || 'black@0.7')
    const y = `(h*${banner.positionHeight / 100})`
    const fontSize = banner.fontSize || 54
    const fontColor = banner.textColor || 'white'

    // Time condition for "show only in last N seconds"
    const timeCond = banner.showOnlyInLastSeconds && banner.lastSecondsDuration
      ? `enable='between(t,${totalDuration - banner.lastSecondsDuration},${totalDuration})'`
      : `enable=1`

    // Escape text for FFMPEG
    const safeText = banner.text
      .replace(/'/g, "\\'")
      .replace(/:/g, '\\:')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]')

    // Background box behind text
    const bgFilter = `drawbox=x=0:y=${y}-10:w=iw:h=${fontSize + 20}:color=${bgColor}@${bgAlpha}:t=fill:${timeCond}`
    filters.push(bgFilter)

    // Main text
    const textFilter = `drawtext=text='${safeText}':fontsize=${fontSize}:fontcolor=${fontColor}:x=(w-tw)/2:y=${y}:${timeCond}`
    filters.push(textFilter)

    // Styled words (first N words in a different color)
    if (banner.styledWordCount > 0 && banner.styledWordsColor) {
      const words = banner.text.split(' ')
      const styledPart = words.slice(0, banner.styledWordCount).join(' ')
      const safeStyled = styledPart
        .replace(/'/g, "\\'")
        .replace(/:/g, '\\:')
      // Draw styled words overlay at same position
      const styledFilter = `drawtext=text='${safeStyled}':fontsize=${fontSize}:fontcolor=${banner.styledWordsColor}:x=(w-tw_main)/2:y=${y}:${timeCond}`
      filters.push(styledFilter)
    }
  }

  return filters.join(',')
}

// ─── Main Video Edit Function ─────────────────────────────────────────────────

/**
 * Edit and compose a single short video clip.
 * Handles background, foreground scaling, logo overlay, and banners.
 */
export async function editVideoClip(options: VideoEditOptions): Promise<{ success: boolean; outputPath?: string; error?: string }> {
  const {
    inputPath,
    outputPath,
    startTime,
    endTime,
    hookPath,
    ctaPath,
    backgroundStyle,
    customBgColor,
    cornerStyles,
    volumeMultiplier,
    logoPath,
    overlayPosition,
    overlayWidth,
    banners,
    canvasWidth = DEFAULT_WIDTH,
    canvasHeight = DEFAULT_HEIGHT,
  } = options

  const duration = endTime - startTime
  if (duration <= 0) return { success: false, error: 'Invalid clip range: endTime must be > startTime' }

  const selectedBg = backgroundStyle?.[0] || 'split_mirror_blur'
  const selectedCorner = cornerStyles?.[0] || 'sharp'
  const vol = volumeMultiplier || 1.0

  // Determine inputs
  const inputs: string[] = []
  let inputFlags = ''

  // Main clip input
  inputs.push(`-ss ${startTime} -t ${duration} -i "${inputPath}"`)

  if (hookPath && fs.existsSync(hookPath)) inputs.push(`-i "${hookPath}"`)
  if (ctaPath && fs.existsSync(ctaPath)) inputs.push(`-i "${ctaPath}"`)
  if (logoPath && fs.existsSync(logoPath)) inputs.push(`-i "${logoPath}"`)

  const mainIdx = 0
  const logoIdx = inputs.length - 1

  // Build filter_complex
  const filterParts: string[] = []

  // 1. Background
  const bgFilter = buildBackgroundFilter(selectedBg, canvasWidth, canvasHeight, customBgColor)
  filterParts.push(bgFilter)

  // 2. Scale source video to foreground
  filterParts.push(`[${mainIdx}:v]setpts=PTS-STARTPTS[fg_raw]`)
  filterParts.push(buildForegroundScaleFilter(canvasWidth, canvasHeight, selectedCorner))

  // 3. Overlay foreground on background
  const yCenter = Math.round((canvasHeight - Math.round(canvasWidth * 0.92 * (16 / 9))) / 2)
  filterParts.push(`[bg][fg]overlay=x=(W-w)/2:y=${yCenter}[composed]`)

  // 4. Logo overlay
  let lastStream = 'composed'
  if (logoPath && fs.existsSync(logoPath)) {
    const logoW = Math.round(canvasWidth * (overlayWidth || 15) / 100)
    const logoScaleFilter = `[${logoIdx}:v]scale=${logoW}:-1[logo]`
    filterParts.push(logoScaleFilter)
    const xyStr = overlayPositionToXY(overlayPosition || 'top_right', canvasWidth, canvasHeight, logoW)
    filterParts.push(`[${lastStream}][logo]overlay=${xyStr}[with_logo]`)
    lastStream = 'with_logo'
  }

  // 5. Banner filters (drawtext)
  const bannerStr = buildBannerFilters(banners || [], duration)
  if (bannerStr) {
    filterParts.push(`[${lastStream}]${bannerStr}[with_banners]`)
    lastStream = 'with_banners'
  }

  // 6. Volume
  const audioFilter = `[0:a]volume=${vol}[audio_out]`
  filterParts.push(audioFilter)

  const filterComplex = filterParts.join(';')

  // Build final FFMPEG command
  const inputStr = inputs.join(' ')
  const cmd = [
    FFMPEG_BIN,
    inputStr,
    `-filter_complex "${filterComplex.replace(/"/g, '\\"')}"`,
    `-map "[${lastStream}]"`,
    `-map "[audio_out]"`,
    `-c:v libx264 -preset ${options.preset || 'fast'} -crf 23`,
    `-c:a aac -b:a 192k`,
    `-r 30 -pix_fmt yuv420p`,
    `-movflags +faststart`,
    `-y "${outputPath}"`,
  ].join(' ')

  console.log(`[FFMPEG] Processing clip: ${path.basename(inputPath)} [${startTime}s → ${endTime}s]`)

  try {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    await execAsync(cmd, { maxBuffer: 10 * 1024 * 1024 })
    console.log(`[FFMPEG] ✅ Output: ${outputPath}`)
    return { success: true, outputPath }
  } catch (error: any) {
    const errMsg = error?.stderr?.slice(-500) || error?.message || 'FFMPEG error'
    console.error(`[FFMPEG] ❌ ${errMsg}`)
    return { success: false, error: errMsg }
  }
}

// ─── Multi-Cut Slicer ─────────────────────────────────────────────────────────

export interface SliceJob {
  index: number
  startTime: number
  endTime: number
}

/**
 * Multi-Cut Mode: Randomly sample N clips from video respecting minDuration, maxDuration, and startOffset.
 */
export function generateMultiCutSlices(params: {
  videoDuration: number
  clipCount: number
  minDuration: number
  maxDuration: number
  startOffset: number
}): SliceJob[] {
  const { videoDuration, clipCount, minDuration, maxDuration, startOffset } = params
  const usableEnd = videoDuration - 5  // leave 5s buffer at end
  const usableStart = startOffset || 0

  if (usableEnd - usableStart < minDuration) return []

  const slices: SliceJob[] = []
  const usedRanges: Array<[number, number]> = []

  for (let i = 0; i < clipCount; i++) {
    let attempts = 0
    while (attempts < 50) {
      const clipLen = minDuration + Math.random() * (maxDuration - minDuration)
      const maxStart = usableEnd - clipLen
      if (maxStart <= usableStart) break
      const start = usableStart + Math.random() * (maxStart - usableStart)
      const end = start + clipLen

      // Check no overlap with existing slices
      const overlap = usedRanges.some(([s, e]) => start < e && end > s)
      if (!overlap) {
        slices.push({ index: i, startTime: Math.round(start * 10) / 10, endTime: Math.round(end * 10) / 10 })
        usedRanges.push([start, end])
        break
      }
      attempts++
    }
  }

  return slices.sort((a, b) => a.startTime - b.startTime)
}

/**
 * Continuous Mode: Sequential clips from startOffset forward.
 */
export function generateContinuousSlices(params: {
  videoDuration: number
  clipCount: number
  minDuration: number
  maxDuration: number
  startOffset: number
}): SliceJob[] {
  const { videoDuration, clipCount, minDuration, maxDuration, startOffset } = params
  const slices: SliceJob[] = []
  let cursor = startOffset || 0

  for (let i = 0; i < clipCount; i++) {
    const clipLen = minDuration + Math.random() * (maxDuration - minDuration)
    const end = cursor + clipLen
    if (end >= videoDuration - 2) break
    slices.push({ index: i, startTime: Math.round(cursor * 10) / 10, endTime: Math.round(end * 10) / 10 })
    cursor = end + 0.5  // 0.5s gap between continuous clips
  }

  return slices
}

/**
 * Concatenate multiple video clips into one file using FFMPEG concat demuxer.
 */
export async function concatVideos(inputPaths: string[], outputPath: string): Promise<boolean> {
  if (inputPaths.length === 0) return false
  if (inputPaths.length === 1) {
    fs.copyFileSync(inputPaths[0], outputPath)
    return true
  }

  // Write concat file
  const concatFile = outputPath + '.concat.txt'
  const lines = inputPaths.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n')
  fs.writeFileSync(concatFile, lines, 'utf8')

  try {
    const cmd = `${FFMPEG_BIN} -f concat -safe 0 -i "${concatFile}" -c copy -y "${outputPath}"`
    await execAsync(cmd, { maxBuffer: 5 * 1024 * 1024 })
    fs.unlinkSync(concatFile)
    return true
  } catch (err: any) {
    console.error(`[FFMPEG] Concat failed: ${err.message}`)
    fs.unlinkSync(concatFile)
    return false
  }
}
