/**
 * Campaign Processor — One-Time Setup
 *
 * Called ONCE when a campaign is activated or first run.
 * Does the heavy lifting so the editing loop can run lightweight forever:
 *   1. Download all source videos (YouTube + Drive)
 *   2. Download logos / overlay assets
 *   3. Download hook and CTA clips
 *   4. Transcribe all source videos and save transcript JSON to disk
 *
 * Results saved at:
 *   {CAMPAIGN_STORAGE}/{campaignId}/sources/   ← video files
 *   {CAMPAIGN_STORAGE}/{campaignId}/assets/    ← logos, overlays
 *   {CAMPAIGN_STORAGE}/{campaignId}/hooks/     ← hook clips
 *   {CAMPAIGN_STORAGE}/{campaignId}/ctas/      ← CTA clips
 *   {CAMPAIGN_STORAGE}/{campaignId}/transcripts/{videoName}.json  ← transcript
 */

import * as fs from 'fs'
import * as path from 'path'
import { downloadVideoURLs } from './youtube-downloader'
import { downloadDriveUrls, downloadLogoOverlay } from './drive-downloader'
import { transcribeVideo, TranscriptSegment } from './subtitle-generator'

// Root storage dir — on VPS this should be a large disk mount
export const CAMPAIGN_STORAGE = process.env.CAMPAIGN_STORAGE_DIR
  || path.join(process.cwd(), 'storage', 'campaigns')

export interface CampaignSetupResult {
  campaignId: string
  sourceVideoPaths: string[]
  logoPaths: string[]
  hookPaths: string[]
  ctaPaths: string[]
  transcriptPaths: Record<string, string>  // videoPath → transcriptJsonPath
  alreadySetup: boolean
}

/** Path helpers */
export function getCampaignDir(campaignId: string) {
  return path.join(CAMPAIGN_STORAGE, campaignId)
}
export function getSourcesDir(campaignId: string) {
  return path.join(getCampaignDir(campaignId), 'sources')
}
export function getAssetsDir(campaignId: string) {
  return path.join(getCampaignDir(campaignId), 'assets')
}
export function getTranscriptsDir(campaignId: string) {
  return path.join(getCampaignDir(campaignId), 'transcripts')
}
export function getClipsDir(campaignId: string) {
  return path.join(getCampaignDir(campaignId), 'clips')
}
export function getSetupFlagPath(campaignId: string) {
  return path.join(getCampaignDir(campaignId), '.setup_complete')
}

/** Load transcript from disk for a source video */
export function loadTranscript(videoPath: string, campaignId: string): TranscriptSegment[] {
  const transcriptsDir = getTranscriptsDir(campaignId)
  const baseName = path.basename(videoPath, path.extname(videoPath))
  const transcriptPath = path.join(transcriptsDir, `${baseName}.json`)
  if (!fs.existsSync(transcriptPath)) return []
  try {
    return JSON.parse(fs.readFileSync(transcriptPath, 'utf8'))
  } catch {
    return []
  }
}

/**
 * Get transcript text for a specific time range (for metadata generation).
 * Returns the words spoken between startTime and endTime.
 */
export function getClipTranscriptText(
  transcript: TranscriptSegment[],
  startTime: number,
  endTime: number
): string {
  return transcript
    .filter(seg => seg.start >= startTime - 2 && seg.end <= endTime + 2)
    .map(seg => seg.text.trim())
    .join(' ')
    .trim()
}

const VALID_VIDEO_EXTS = new Set([
  '.mp4', '.mov', '.webm', '.mkv', '.m4v', '.avi', '.flv', '.wmv', '.ts', '.mts', '.3gp'
])

/** Get all existing source video files for a campaign */
export function getExistingSourceVideos(campaignId: string): string[] {
  const sourcesDir = getSourcesDir(campaignId)
  if (!fs.existsSync(sourcesDir)) return []
  return fs.readdirSync(sourcesDir)
    .filter(f => {
      if (f.startsWith('.') || f.endsWith('.part') || f.endsWith('.json') || f.endsWith('.txt')) {
        return false
      }
      const ext = path.extname(f).toLowerCase()
      if (VALID_VIDEO_EXTS.has(ext)) return true
      // Accept any file that is not a known non-video file
      return !['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.json', '.srt', '.vtt', '.ass', '.txt', '.log'].includes(ext)
    })
    .map(f => path.join(sourcesDir, f))
    .filter(fullPath => {
      try {
        const stat = fs.statSync(fullPath)
        return stat.isFile() && stat.size > 1024
      } catch {
        return false
      }
    })
}

/** Count how many edited clips exist for a campaign */
export function countEditedClips(campaignId: string): number {
  const clipsDir = getClipsDir(campaignId)
  if (!fs.existsSync(clipsDir)) return 0
  return fs.readdirSync(clipsDir)
    .filter(f => f.endsWith('.mp4') && f.startsWith('final_'))
    .length
}

/** Check if campaign setup was already completed (flag exists AND source files exist) */
export function isSetupComplete(campaignId: string): boolean {
  const flagPath = getSetupFlagPath(campaignId)
  if (!fs.existsSync(flagPath)) return false

  const sources = getExistingSourceVideos(campaignId)
  if (sources.length === 0) {
    // Stale or empty setup flag — clean up so setup can be retriggered
    try { fs.unlinkSync(flagPath) } catch {}
    return false
  }

  return true
}

/**
 * ONE-TIME SETUP: Download everything and generate all transcripts.
 * Safe to call multiple times — skips if already done (checks .setup_complete flag).
 */
export async function runCampaignSetup(
  campaignId: string,
  cfg: Record<string, any>,
  onProgress?: (msg: string) => void
): Promise<CampaignSetupResult> {
  const log = (msg: string) => {
    console.log(`[Setup:${campaignId}] ${msg}`)
    onProgress?.(msg)
  }

  // Create directories
  const sourcesDir = getSourcesDir(campaignId)
  const assetsDir = getAssetsDir(campaignId)
  const transcriptsDir = getTranscriptsDir(campaignId)
  const hooksDir = path.join(getCampaignDir(campaignId), 'hooks')
  const ctasDir = path.join(getCampaignDir(campaignId), 'ctas')
  const clipsDir = getClipsDir(campaignId)

  for (const dir of [sourcesDir, assetsDir, transcriptsDir, hooksDir, ctasDir, clipsDir]) {
    fs.mkdirSync(dir, { recursive: true })
  }

  // Return early if already setup with actual files
  if (isSetupComplete(campaignId)) {
    log('✅ Already setup — loading existing files')
    return {
      campaignId,
      sourceVideoPaths: getExistingSourceVideos(campaignId),
      logoPaths: fs.readdirSync(assetsDir).map(f => path.join(assetsDir, f)),
      hookPaths: fs.existsSync(hooksDir)
        ? fs.readdirSync(hooksDir).map(f => path.join(hooksDir, f)) : [],
      ctaPaths: fs.existsSync(ctasDir)
        ? fs.readdirSync(ctasDir).map(f => path.join(ctasDir, f)) : [],
      transcriptPaths: {},
      alreadySetup: true,
    }
  }

  // ── Step 1: Download source videos ────────────────────────────────────────
  log('📥 Step 1/4: Downloading source videos...')
  const sourceUrls: string = cfg.sourceVideoUrls || cfg.driveYoutubeUrls || ''
  let sourceVideoPaths: string[] = []

  if (sourceUrls) {
    // YouTube URLs
    const ytResults = await downloadVideoURLs(sourceUrls, sourcesDir)
    ytResults.filter(r => r.success && r.filePath).forEach(r => sourceVideoPaths.push(r.filePath!))

    // Drive URLs
    const driveResults = await downloadDriveUrls(sourceUrls, sourcesDir, 'source')
    driveResults.filter(r => r.success && r.filePath).forEach(r => sourceVideoPaths.push(r.filePath!))
  }

  log(`📹 Downloaded ${sourceVideoPaths.length} source video(s)`)

  if (sourceUrls.trim() && sourceVideoPaths.length === 0) {
    throw new Error('No source videos could be downloaded from the provided Drive/YouTube URL(s). Make sure Google Drive link is public ("Anyone with the link can view").')
  }

  // ── Step 2: Download logos + hooks + CTAs ─────────────────────────────────
  log('📥 Step 2/4: Downloading assets (logo, hooks, CTAs)...')

  const logoPaths: string[] = []
  const logoPath = await downloadLogoOverlay(cfg.logoOverlayUrl || '', assetsDir)
  if (logoPath) logoPaths.push(logoPath)

  let hookPaths: string[] = []
  const hookUrls = cfg.hookVideoUrls || cfg.hookUrls || ''
  if (hookUrls) {
    const hookResults = await downloadDriveUrls(hookUrls, hooksDir, 'hook')
    hookPaths = hookResults.filter(r => r.success && r.filePath).map(r => r.filePath!)
  }

  let ctaPaths: string[] = []
  const ctaUrls = cfg.ctaVideoUrls || cfg.ctaUrls || ''
  if (ctaUrls) {
    const ctaResults = await downloadDriveUrls(ctaUrls, ctasDir, 'cta')
    ctaPaths = ctaResults.filter(r => r.success && r.filePath).map(r => r.filePath!)
  }

  log(`🖼️ Assets: ${logoPaths.length} logos, ${hookPaths.length} hooks, ${ctaPaths.length} CTAs`)

  // ── Step 3: Transcribe all source videos ──────────────────────────────────
  log('📝 Step 3/4: Generating transcripts for all source videos...')
  const transcriptPaths: Record<string, string> = {}

  for (const videoPath of sourceVideoPaths) {
    const baseName = path.basename(videoPath, path.extname(videoPath))
    const transcriptPath = path.join(transcriptsDir, `${baseName}.json`)

    if (fs.existsSync(transcriptPath)) {
      log(`⏭️ Transcript already exists: ${baseName}`)
      transcriptPaths[videoPath] = transcriptPath
      continue
    }

    log(`🎙️ Transcribing: ${baseName}...`)
    const workDir = path.join(transcriptsDir, 'tmp', baseName)
    const segments = await transcribeVideo(videoPath, workDir)

    if (segments.length > 0) {
      fs.writeFileSync(transcriptPath, JSON.stringify(segments, null, 2), 'utf8')
      transcriptPaths[videoPath] = transcriptPath
      log(`✅ Transcript saved: ${baseName}.json (${segments.length} segments)`)
    } else {
      log(`⚠️ No transcript generated for: ${baseName}`)
    }
  }

  // ── Step 4: Mark setup complete ───────────────────────────────────────────
  log('✅ Step 4/4: Setup complete!')
  fs.writeFileSync(getSetupFlagPath(campaignId), new Date().toISOString(), 'utf8')

  return {
    campaignId,
    sourceVideoPaths,
    logoPaths,
    hookPaths,
    ctaPaths,
    transcriptPaths,
    alreadySetup: false,
  }
}
