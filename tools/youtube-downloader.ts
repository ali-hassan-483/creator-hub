/**
 * Tool 1: YouTube Downloader Engine
 * yt-dlp wrapper for downloading full videos or specific timestamp ranges.
 * Downloads to VPS local storage and returns the file path.
 */

import { exec, execFile } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as path from 'path'

const execAsync = promisify(exec)

export interface YouTubeDownloadOptions {
  url: string
  outputDir: string
  format?: string           // e.g. 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/mp4'
  startTime?: number        // seconds
  endTime?: number          // seconds
  filename?: string         // custom output filename (without extension)
  maxFileSize?: string      // e.g. '500M'
  quality?: 'best' | '1080p' | '720p' | '480p' | '360p'
}

export interface DownloadResult {
  success: boolean
  filePath?: string
  filename?: string
  duration?: number
  error?: string
}

/**
 * Resolves yt-dlp binary path. Supports Windows (yt-dlp.exe) and Linux (yt-dlp).
 */
export function getYtDlpPath(): string {
  const isWindows = process.platform === 'win32'
  const candidates = isWindows
    ? ['yt-dlp.exe', 'C:\\yt-dlp\\yt-dlp.exe', 'D:\\yt-dlp\\yt-dlp.exe']
    : ['yt-dlp', '/usr/local/bin/yt-dlp', '/usr/bin/yt-dlp']
  
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate
    } catch {}
  }
  // Fallback: rely on PATH
  return isWindows ? 'yt-dlp.exe' : 'yt-dlp'
}

/**
 * Build quality format string for yt-dlp.
 */
function buildFormatString(quality: string): string {
  switch (quality) {
    case '1080p': return 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]'
    case '720p':  return 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720]'
    case '480p':  return 'bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480]'
    case '360p':  return 'bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/best[height<=360]'
    default:      return 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'
  }
}

/**
 * Download a YouTube video using yt-dlp.
 */
export async function downloadYouTubeVideo(options: YouTubeDownloadOptions): Promise<DownloadResult> {
  const { url, outputDir, startTime, endTime, filename, quality = 'best' } = options

  // Ensure output directory exists
  fs.mkdirSync(outputDir, { recursive: true })

  const ytDlp = getYtDlpPath()
  const format = options.format || buildFormatString(quality)
  
  // Build safe output filename
  const safeFilename = filename 
    ? filename.replace(/[^a-zA-Z0-9_\-]/g, '_')
    : '%(id)s_%(title).50s'
  
  const outputTemplate = path.join(outputDir, `${safeFilename}.%(ext)s`)

  const args: string[] = [
    url,
    '-f', format,
    '-o', outputTemplate,
    '--no-playlist',
    '--merge-output-format', 'mp4',
    '--retries', '5',
    '--fragment-retries', '5',
    '--extractor-args', 'youtube:player_client=ios,android,mweb',
    '--newline',
    '--progress',
  ]

  // Time range clipping (yt-dlp native)
  if (startTime !== undefined && endTime !== undefined) {
    args.push('--download-sections', `*${startTime}-${endTime}`)
    args.push('--force-keyframes-at-cuts')
  }

  if (options.maxFileSize) {
    args.push('--max-filesize', options.maxFileSize)
  }

  // Write info JSON for metadata
  args.push('--write-info-json')

  try {
    console.log(`[YT-Downloader] Downloading: ${url}`)
    const command = `"${ytDlp}" ${args.map(a => `"${a}"`).join(' ')}`
    const { stdout, stderr } = await execAsync(command, { maxBuffer: 50 * 1024 * 1024 })

    // Find the downloaded file
    const files = fs.readdirSync(outputDir)
      .filter(f => f.endsWith('.mp4') && (filename ? f.startsWith(safeFilename) : true))
      .map(f => ({ name: f, time: fs.statSync(path.join(outputDir, f)).mtime.getTime() }))
      .sort((a, b) => b.time - a.time)

    if (files.length === 0) {
      throw new Error('Downloaded file not found in output directory')
    }

    const downloadedFile = path.join(outputDir, files[0].name)

    // Read duration from info JSON if available
    let duration: number | undefined
    const infoFiles = fs.readdirSync(outputDir).filter(f => f.endsWith('.info.json'))
    if (infoFiles.length > 0) {
      try {
        const info = JSON.parse(fs.readFileSync(path.join(outputDir, infoFiles[0]), 'utf8'))
        duration = info.duration
        // Cleanup info file
        fs.unlinkSync(path.join(outputDir, infoFiles[0]))
      } catch {}
    }

    console.log(`[YT-Downloader] ✅ Downloaded: ${downloadedFile}`)
    return { success: true, filePath: downloadedFile, filename: files[0].name, duration }

  } catch (error: any) {
    const errMsg = error?.stderr || error?.message || 'Unknown yt-dlp error'
    console.error(`[YT-Downloader] ❌ Failed: ${errMsg}`)
    return { success: false, error: errMsg }
  }
}

/**
 * Get video metadata without downloading.
 */
export async function getYouTubeVideoInfo(url: string): Promise<Record<string, any> | null> {
  const ytDlp = getYtDlpPath()
  try {
    const command = `"${ytDlp}" "${url}" --dump-json --no-playlist --extractor-args "youtube:player_client=ios,android,mweb"`
    const { stdout } = await execAsync(command, { maxBuffer: 5 * 1024 * 1024 })
    return JSON.parse(stdout.trim())
  } catch (error: any) {
    console.error(`[YT-Downloader] Info fetch failed: ${error.message}`)
    return null
  }
}

/**
 * Download multiple URLs (Drive/YouTube separated by commas).
 * Returns array of local file paths for downloaded videos.
 */
export async function downloadVideoURLs(
  urlsString: string,
  outputDir: string,
  quality: 'best' | '1080p' | '720p' | '480p' | '360p' = 'best'
): Promise<DownloadResult[]> {
  const urls = urlsString
    .split(/[\r\n,;]+/)
    .map(u => u.trim())
    .filter(u => u.length > 0 && (u.includes('youtube.com') || u.includes('youtu.be')))

  const results: DownloadResult[] = []
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i]
    console.log(`[YT-Downloader] Downloading ${i + 1}/${urls.length}: ${url}`)
    const result = await downloadYouTubeVideo({ url, outputDir, quality, filename: `video_${i + 1}` })
    results.push(result)
  }
  return results
}
