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
 * Create authenticated Google Drive client.
 * Uses GOOGLE_SERVICE_ACCOUNT_JSON env var (JSON string) or falls back to API key.
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
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(serviceAccountJson),
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    })
    return google.drive({ version: 'v3', auth })
  }

  // API key fallback (public files only)
  const apiKey = process.env.GOOGLE_API_KEY
  if (apiKey) {
    return google.drive({ version: 'v3', auth: apiKey })
  }

  throw new Error('No Google auth configured. Set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_API_KEY env var.')
}

/**
 * Download a file from Google Drive by file ID.
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

  try {
    const drive = getDriveClient(accessToken)

    // Get file metadata first
    const meta = await drive.files.get({
      fileId,
      fields: 'id,name,mimeType,size',
      supportsAllDrives: true,
    })

    const originalName = meta.data.name || `drive_file_${fileId}`
    const mimeType = meta.data.mimeType || 'application/octet-stream'
    
    // Determine output filename
    const ext = getExtFromMime(mimeType) || path.extname(originalName) || '.bin'
    const baseName = filename 
      ? filename.replace(/[^a-zA-Z0-9_\-]/g, '_')
      : originalName.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_\-]/g, '_')
    
    const outputPath = path.join(outputDir, `${baseName}${ext}`)

    console.log(`[Drive-Downloader] Downloading: ${originalName} → ${outputPath}`)

    // Stream download
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

    console.log(`[Drive-Downloader] ✅ Saved: ${outputPath}`)
    return { success: true, filePath: outputPath, filename: `${baseName}${ext}`, mimeType }

  } catch (error: any) {
    const errMsg = error?.message || 'Drive download failed'
    console.error(`[Drive-Downloader] ❌ ${errMsg}`)
    return { success: false, error: errMsg }
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
    .split(',')
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
