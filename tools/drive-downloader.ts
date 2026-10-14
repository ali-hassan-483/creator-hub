/**
 * Tool 2: Google Drive Downloader
 * Authenticated Google Drive client using service account or OAuth2.
 * Downloads video assets, hook clips, CTA clips, and logo/overlay images.
 */

import { google } from 'googleapis'
import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'
import * as http from 'http'
import { exec } from 'child_process'
import { promisify } from 'util'
import { getYtDlpPath } from './youtube-downloader'

const execAsync = promisify(exec)

export interface DriveDownloadOptions {
  fileIdOrUrl: string       // Google Drive file ID or full URL
  outputDir: string
  filename?: string         // custom filename without extension
  accessToken?: string      // OAuth2 access token (if user-scoped)
}

export interface DriveDownloadResult {
  success: boolean
  filePath?: string
  filename?: string
  mimeType?: string
  error?: string
}

/**
 * Extract Google Drive file ID from various URL formats.
 * Supports:
 *  - https://drive.google.com/file/d/{id}/view
 *  - https://drive.google.com/open?id={id}
 *  - https://docs.google.com/uc?export=download&id={id}
 *  - Raw file ID (no URL)
 */
export function extractDriveFileId(fileIdOrUrl: string): string {
  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]+)/,
    /[?&]id=([a-zA-Z0-9_-]+)/,
    /\/d\/([a-zA-Z0-9_-]+)/,
  ]
  for (const pattern of patterns) {
    const match = fileIdOrUrl.match(pattern)
    if (match) return match[1]
  }
  // Treat as raw file ID if no URL pattern matched
  if (/^[a-zA-Z0-9_-]{25,}$/.test(fileIdOrUrl)) return fileIdOrUrl
  throw new Error(`Cannot extract Drive file ID from: ${fileIdOrUrl}`)
}

/**
 * Create authenticated Google Drive client (optional).
 * Returns null if no service account or API key is configured.
 */
function getDriveClient(accessToken?: string) {
  if (accessToken) {
    const auth = new google.auth.OAuth2()
    auth.setCredentials({ access_token: accessToken })
    return google.drive({ version: 'v3', auth })
  }

  // Service account (for admin-owned files)
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (serviceAccountJson) {
    try {
      const auth = new google.auth.GoogleAuth({
        credentials: JSON.parse(serviceAccountJson),
        scopes: ['https://www.googleapis.com/auth/drive.readonly'],
      })
      return google.drive({ version: 'v3', auth })
    } catch {}
  }

  // API key fallback (public files only)
  const apiKey = process.env.GOOGLE_API_KEY
  if (apiKey) {
    return google.drive({ version: 'v3', auth: apiKey })
  }

  return null
}

/**
 * Download HTTP/HTTPS URL following all redirects.
 */
function downloadHttpWithRedirects(url: string, destPath: string, maxRedirects = 10): Promise<void> {
  return new Promise((resolve, reject) => {
    function fetchUrl(currentUrl: string, redirectsRemaining: number) {
      if (redirectsRemaining <= 0) {
        return reject(new Error('Too many redirects'))
      }

      const client = currentUrl.startsWith('https') ? https : http
      const req = client.get(currentUrl, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const nextUrl = new URL(res.headers.location, currentUrl).href
          return fetchUrl(nextUrl, redirectsRemaining - 1)
        }

        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP status ${res.statusCode}`))
        }

        const file = fs.createWriteStream(destPath)
        res.pipe(file)
        file.on('finish', () => {
          file.close()
          resolve()
        })
        file.on('error', (err) => {
          fs.unlink(destPath, () => {})
          reject(err)
        })
      })

      req.on('error', (err) => {
        fs.unlink(destPath, () => {})
        reject(err)
      })
    }

    fetchUrl(url, maxRedirects)
  })
}

/**
 * Download a file from Google Drive by file ID or URL.
 * Automatically tries:
 *  1. yt-dlp (Native support for public/shared Google Drive videos — zero API credentials needed!)
 *  2. Google Drive API (if service account or API key configured)
 *  3. Direct HTTP export download
 */
export async function downloadDriveFile(options: DriveDownloadOptions): Promise<DriveDownloadResult> {
  const { fileIdOrUrl, outputDir, filename, accessToken } = options

  fs.mkdirSync(outputDir, { recursive: true })

  let fileId: string
  try {
    fileId = extractDriveFileId(fileIdOrUrl)
  } catch (e: any) {
    return { success: false, error: e.message }
  }

  const baseName = filename
    ? filename.replace(/[^a-zA-Z0-9_\-]/g, '_')
    : `drive_${fileId}`

  // ── Strategy 1: yt-dlp (Zero credentials, supports Google Drive video streams) ──
  try {
    const ytDlp = getYtDlpPath()
    const driveUrl = fileIdOrUrl.startsWith('http')
      ? fileIdOrUrl
      : `https://drive.google.com/file/d/${fileId}/view`

    const outTemplate = path.join(outputDir, `${baseName}.%(ext)s`)
    const cmd = `"${ytDlp}" "${driveUrl}" -o "${outTemplate}" --no-playlist`
    console.log(`[Drive-Downloader] Attempting yt-dlp download: ${cmd}`)

    await execAsync(cmd, { timeout: 600000, maxBuffer: 10 * 1024 * 1024 })

    const files = fs.readdirSync(outputDir).filter(f => f.startsWith(baseName) && !f.endsWith('.part'))
    if (files.length > 0) {
      const downloadedPath = path.join(outputDir, files[0])
      console.log(`[Drive-Downloader] ✅ Downloaded via yt-dlp: ${downloadedPath}`)
      return { success: true, filePath: downloadedPath, filename: files[0] }
    }
  } catch (ytErr: any) {
    console.warn(`[Drive-Downloader] yt-dlp download attempt note: ${ytErr?.message || ytErr}`)
  }

  // ── Strategy 2: Google Drive API (if credentials configured) ─────────────
  const drive = getDriveClient(accessToken)
  if (drive) {
    try {
      const meta = await drive.files.get({
        fileId,
        fields: 'id,name,mimeType,size',
        supportsAllDrives: true,
      })

      const originalName = meta.data.name || `drive_file_${fileId}`
      const mimeType = meta.data.mimeType || 'application/octet-stream'
      const ext = getExtFromMime(mimeType) || path.extname(originalName) || '.mp4'
      const name = filename
        ? `${filename.replace(/[^a-zA-Z0-9_\-]/g, '_')}${ext}`
        : originalName.replace(/[^a-zA-Z0-9_\-.]/g, '_')

      const outputPath = path.join(outputDir, name)
      console.log(`[Drive-Downloader] Downloading via Google API: ${originalName} → ${outputPath}`)

      const response = await drive.files.get(
        { fileId, alt: 'media', supportsAllDrives: true },
        { responseType: 'stream' }
      ) as any

      await new Promise<void>((resolve, reject) => {
        const dest = fs.createWriteStream(outputPath)
        response.data
          .on('error', reject)
          .pipe(dest)
          .on('error', reject)
          .on('finish', resolve)
      })

      console.log(`[Drive-Downloader] ✅ Saved via Google API: ${outputPath}`)
      return { success: true, filePath: outputPath, filename: name, mimeType }
    } catch (apiErr: any) {
      console.warn(`[Drive-Downloader] Google API download failed: ${apiErr.message}`)
    }
  }

  // ── Strategy 3: Direct HTTP export download ─────────────────────────────
  try {
    const directUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`
    const outputPath = path.join(outputDir, `${baseName}.mp4`)
    console.log(`[Drive-Downloader] Attempting direct HTTP download: ${directUrl}`)

    await downloadHttpWithRedirects(directUrl, outputPath)
    if (fs.existsSync(outputPath)) {
      const stats = fs.statSync(outputPath)
      if (stats.size > 10240) {
        console.log(`[Drive-Downloader] ✅ Saved via direct HTTP: ${outputPath} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`)
        return { success: true, filePath: outputPath, filename: `${baseName}.mp4` }
      } else {
        fs.unlinkSync(outputPath)
      }
    }
  } catch (httpErr: any) {
    console.warn(`[Drive-Downloader] Direct HTTP download failed: ${httpErr.message}`)
  }

  return {
    success: false,
    error: `Failed to download Drive file (${fileId}). Please verify the link is public ("Anyone with the link can view").`,
  }
}

/**
 * Download multiple Drive URLs (comma-separated).
 * Commonly used for Hook/CTA clips or logo assets.
 */
export async function downloadDriveUrls(
  urlsString: string,
  outputDir: string,
  prefix = 'clip',
  accessToken?: string
): Promise<DriveDownloadResult[]> {
  const urls = urlsString
    .split(/[\r\n,;]+/)
    .map(u => u.trim())
    .filter(u => u.length > 0 && (u.includes('drive.google.com') || u.includes('docs.google.com')))

  const results: DriveDownloadResult[] = []
  for (let i = 0; i < urls.length; i++) {
    console.log(`[Drive-Downloader] ${i + 1}/${urls.length}: ${urls[i]}`)
    const result = await downloadDriveFile({
      fileIdOrUrl: urls[i],
      outputDir,
      filename: `${prefix}_${i + 1}`,
      accessToken,
    })
    results.push(result)
  }
  return results
}

/**
 * Download logo/overlay image from Drive URL.
 * Returns local path to the image file.
 */
export async function downloadLogoOverlay(
  logoUrl: string,
  outputDir: string,
  accessToken?: string
): Promise<string | null> {
  if (!logoUrl || logoUrl.trim() === '') return null

  const isDriveUrl = logoUrl.includes('drive.google.com') || logoUrl.includes('docs.google.com')
  
  if (isDriveUrl) {
    const result = await downloadDriveFile({
      fileIdOrUrl: logoUrl,
      outputDir,
      filename: 'logo_overlay',
      accessToken,
    })
    return result.success ? result.filePath || null : null
  }

  // Direct URL download (non-Drive)
  const outputPath = path.join(outputDir, 'logo_overlay.png')
  return new Promise((resolve) => {
    const protocol = logoUrl.startsWith('https') ? https : http
    const file = fs.createWriteStream(outputPath)
    protocol.get(logoUrl, (res) => {
      res.pipe(file)
      file.on('finish', () => { file.close(); resolve(outputPath) })
    }).on('error', () => { fs.unlink(outputPath, () => {}); resolve(null) })
  })
}

function getExtFromMime(mimeType: string): string {
  const map: Record<string, string> = {
    'video/mp4': '.mp4',
    'video/quicktime': '.mov',
    'video/x-msvideo': '.avi',
    'video/webm': '.webm',
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'audio/mpeg': '.mp3',
    'audio/mp4': '.m4a',
  }
  return map[mimeType] || ''
}
