/**
 * Continuous Editing Engine (100 Clips Target Worker)
 * Powered by Continuous Random Clip Editor (Whop Shorts Style)
 * 
 * Target: Har campaign ke paas har waqt 100 active/ready edited clips available hone chahiye.
 * - Brand-safe 9:16 vertical video from source footage only (no templates, no mirror blur)
 * - Cold-Open Reorder (Payoff/Hook first at 1.2x zoom, then Setup, then Payoff in context)
 * - Cross-cut pacing & per-segment loudness normalization
 * - Silence tightening (--tighten)
 * - Clean keyword captions with warm yellow highlights
 * - Automatic duplicate prevention across channels
 */

import * as fs from 'fs'
import * as path from 'path'
import {
  getCampaignDir,
  getAssetsDir,
  getClipsDir,
  loadTranscript,
  loadTranscriptSrt,
  getClipTranscriptText,
  countEditedClips,
  isSetupComplete,
  runCampaignSetup,
  getExistingSourceVideos,
} from './campaign-processor'
import { downloadLogoOverlay } from './drive-downloader'
import { getVideoInfo } from './video-editor'
import {
  buildStoryRecutMap,
  renderStoryRecutBatch,
} from './story-recut-engine'
import {
  generateBatchMetadataFromGuidelines,
  ShortMetadata,
  AiMetadataConfig,
} from './ai-clipper'

export const TARGET_EDITED_CLIPS = 100

export interface EditEngineProgress {
  campaignId: string
  currentClips: number
  targetClips: number
  status: 'idle' | 'setting_up' | 'editing' | 'completed' | 'error'
  lastMessage?: string
}

/**
 * Ensures target 100 clips exist for a campaign using the Continuous Clip Editor.
 */
export async function maintainCampaignClipPool(
  campaignId: string,
  cfg: Record<string, any>,
  onStatusUpdate?: (progress: EditEngineProgress) => void
): Promise<number> {
  const log = (msg: string) => {
    console.log(`[StoryReCut:${campaignId}] ${msg}`)
  }

  // 1. Check if one-time setup (download + transcript) is completed
  if (!isSetupComplete(campaignId)) {
    onStatusUpdate?.({
      campaignId,
      currentClips: countEditedClips(campaignId),
      targetClips: TARGET_EDITED_CLIPS,
      status: 'setting_up',
      lastMessage: 'Running one-time setup (Downloading videos & generating transcripts)...',
    })
    log('Setting up campaign files & transcripts for the first time...')
    await runCampaignSetup(campaignId, cfg, (progressMsg) => {
      onStatusUpdate?.({
        campaignId,
        currentClips: countEditedClips(campaignId),
        targetClips: TARGET_EDITED_CLIPS,
        status: 'setting_up',
        lastMessage: progressMsg,
      })
    })
  }

  const maxTarget = Number(cfg.targetClipsPool || cfg.maxClipsPool || TARGET_EDITED_CLIPS) || 100
  let currentCount = countEditedClips(campaignId)
  log(`Current pool count: ${currentCount}/${maxTarget}`)

  if (currentCount >= maxTarget) {
    onStatusUpdate?.({
      campaignId,
      currentClips: currentCount,
      targetClips: maxTarget,
      status: 'completed',
      lastMessage: `Target reached (${currentCount}/${maxTarget} clips ready).`,
    })
    return currentCount
  }

  // File-based lock to prevent duplicate parallel editing processes across containers
  const lockPath = path.join(getCampaignDir(campaignId), '.editing.lock')
  if (fs.existsSync(lockPath)) {
    try {
      const stat = fs.statSync(lockPath)
      const ageMs = Date.now() - stat.mtimeMs
      if (ageMs < 10 * 60 * 1000) {
        log(`⚠️ Another editing process is already active for this campaign (lock active). Skipping to prevent duplicate clips.`)
        return currentCount
      }
    } catch {}
  }

  // Acquire lock
  try {
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, time: new Date().toISOString() }))
  } catch {}

  try {
    const sourceVideos = getExistingSourceVideos(campaignId)
    if (sourceVideos.length === 0) {
      const errorMsg = 'No source videos found in storage. Please add source URLs or upload clips.'
      log(`❌ ${errorMsg}`)
      onStatusUpdate?.({
        campaignId,
        currentClips: currentCount,
        targetClips: maxTarget,
        status: 'error',
        lastMessage: errorMsg,
      })
      return currentCount
    }

    const clipsDir = getClipsDir(campaignId)
    const shortDuration = parseFloat(cfg.shortDuration || '45')
    const hookDuration = parseFloat(cfg.hookDuration || '3.5')
    const tightenSilence = cfg.tightenSilence === true // disabled by default for 3x render speed

    const metaConfig: AiMetadataConfig = {
      // DB stores fields as titlesAiGuide / descriptionsAiGuide / onScreenTextAiGuide
      // AiMetadataConfig interface uses titlesGuide / descriptionsGuide / onScreenGuide
      titlesGuide: cfg.titlesAiGuide || cfg.titlesGuide || '',
      descriptionsGuide: cfg.descriptionsAiGuide || cfg.descriptionsGuide || '',
      onScreenGuide: cfg.onScreenTextAiGuide || cfg.onScreenAiGuide || cfg.onScreenGuide || '',
      ftcDisclosure: cfg.ftcDisclosure,
      predefinedDescription: cfg.predefinedDescription,
      useOnlyPredefinedDescription: cfg.useOnlyPredefinedDescription || cfg.useOnlyPredefinedDesc,
      linksInDescription: cfg.linksInDescription,
      maxTitleChars: cfg.maxTitleCharacters ? parseInt(cfg.maxTitleCharacters) : 100,
      onScreenMaxChars: cfg.onScreenMaxCharacters ? parseInt(cfg.onScreenMaxCharacters) : (cfg.onScreenMaxChars ? parseInt(cfg.onScreenMaxChars) : 80),
      audioNotes: cfg.audioNotes,
      niche: cfg.niche,
      campaignName: cfg.campaignName,
    }

    // Pre-fetch batch metadata from guidelines
    let batchMetadataPool: ShortMetadata[] = []
    let batchMetadataIndex = 0
    let metadataFailed = false

    const refreshBatchMetadata = async () => {
      log('🤖 Fetching batch of 20 metadata sets from AI (Title/Desc guidelines)...')
      try {
        batchMetadataPool = await generateBatchMetadataFromGuidelines(20, metaConfig)
        batchMetadataIndex = 0
        metadataFailed = false
        log(`✅ Batch of ${batchMetadataPool.length} metadata sets received.`)
      } catch (err: any) {
        metadataFailed = true
        log(`❌ AI metadata generation failed: ${err.message}`)
        log(`🛑 Editing stopped — cannot generate clips without proper AI-generated titles/descriptions.`)
        log(`🔑 Please check your Gemini / OpenRouter API keys in Admin > API Settings.`)
        throw new Error(`Metadata generation failed — editing stopped: ${err.message}`)
      }
    }

    try {
      await refreshBatchMetadata()
    } catch {
      onStatusUpdate?.({
        campaignId,
        currentClips: currentCount,
        targetClips: maxTarget,
        status: 'error',
        lastMessage: 'Editing halted: AI metadata generation failed. Check Gemini/OpenRouter API keys.',
      })
      return currentCount
    }

    log(`🚀 Starting Story Re-Cut Loop: need ${maxTarget - currentCount} more clips (Target: ${maxTarget})`)

    // Loop until maxTarget clips reached, checking disk on EVERY iteration
    while (true) {
      // Re-read exact count from disk to guarantee we NEVER exceed target!
      currentCount = countEditedClips(campaignId)
      if (currentCount >= maxTarget) {
        log(`🎯 Target reached on disk (${currentCount}/${maxTarget} clips). Stopping editing loop.`)
        break
      }

      // Check if admin paused editing or deactivated campaign mid-run
      try {
        const { prisma } = await import('../lib/db')
        const cCheck = await prisma.campaign.findUnique({
          where: { id: campaignId },
          select: { status: true, config: true },
        })
        const cCfg = (cCheck?.config || {}) as Record<string, any>
        if (cCheck?.status !== 'active' || cCfg.editingApproved === false) {
          log(`⏸️ Auto-editing paused by admin for campaign ${campaignId}. Stopping editing loop immediately.`)
          break
        }
      } catch {}

      const clipsNeeded = maxTarget - currentCount
      if (clipsNeeded <= 0) break
      const batchSize = Math.min(3, clipsNeeded)

      onStatusUpdate?.({
        campaignId,
        currentClips: currentCount,
        targetClips: maxTarget,
        status: 'editing',
        lastMessage: `Rendering clip batch (${currentCount + 1} to ${currentCount + batchSize})...`,
      })

    // Pick a random source video from available sources
    const sourceVideo = sourceVideos[Math.floor(Math.random() * sourceVideos.length)]
    let videoDuration = 1800 // default 30m
    try {
      const vInfo = await getVideoInfo(sourceVideo)
      videoDuration = vInfo.duration
    } catch {}

    const transcript = loadTranscript(sourceVideo, campaignId)
    const srtPath = loadTranscriptSrt(sourceVideo, campaignId)

    // Check for logo
    const assetsDir = getAssetsDir(campaignId)
    let logoPath: string | undefined = undefined
    if (cfg.logoOverlayUrl) {
      try {
        const dl = await downloadLogoOverlay(cfg.logoOverlayUrl, assetsDir)
        if (dl) logoPath = dl
      } catch {}
    }
    if (!logoPath && fs.existsSync(assetsDir)) {
      const existing = fs.readdirSync(assetsDir).filter(f => !f.startsWith('.') && !f.endsWith('.part'))
      if (existing.length > 0) logoPath = path.join(assetsDir, existing[0])
    }

    // Extract on-screen texts from pre-fetched pool for this batch
    const onScreenList = batchMetadataPool.slice(batchMetadataIndex, batchMetadataIndex + batchSize).map(m => m.onScreenText).filter(Boolean)

    const resolvedSubFont = (cfg.useSameFontForBannersAndSubs ? cfg.onScreenFontName : cfg.subtitleFonts) || 'DejaVu Sans'
    const resolvedSubHighlight = (cfg.useSameForSpeakingWordHighlight ? cfg.onScreenStyledWordsColor : cfg.speakingWordHighlight) || 'yellow'

    // Build cutmap for this batch
    const cutmap = buildStoryRecutMap(videoDuration, transcript, srtPath, {
      clipCount: batchSize,
      startIndex: currentCount + 1,
      targetDuration: shortDuration,
      hookDuration: hookDuration,
      campaignName: cfg.campaignName,
      videoAspectRatio: cfg.videoAspectRatio || '9:16',
      frameBackgroundColor: cfg.frameBackgroundColor || '#000000',
      logo: logoPath ? {
        path: logoPath,
        position: cfg.overlayPosition || 'Bottom Center',
        width_percent: Number(cfg.overlayWidthPercent) || 40,
        height_percent: cfg.overlayHeightPercent !== undefined && cfg.overlayHeightPercent !== '' ? Number(cfg.overlayHeightPercent) : undefined,
      } : undefined,
      onScreenConfig: {
        font: cfg.onScreenFontName || 'Arial',
        text_color: cfg.onScreenTextColor || 'white',
        position_height_percent: cfg.onScreenPositionHeightPercent !== undefined && cfg.onScreenPositionHeightPercent !== '' ? Number(cfg.onScreenPositionHeightPercent) : 25,
        size_px: Number(cfg.onScreenSizePx) || 54,
        background: cfg.onScreenBackground || 'black@0.5',
        styled_word_count: Number(cfg.onScreenStyledWordCount) || 0,
        styled_words_color: cfg.onScreenStyledWordsColor || 'yellow',
      },
      subtitlesConfig: {
        enable: cfg.enableSubtitles !== 'Disabled (Fallback to AI Captions)' && cfg.enableSubtitles !== false && cfg.enableSubtitles !== 'disabled',
        font: resolvedSubFont,
        color: cfg.subtitleColors || 'white',
        outline_color: cfg.outlineColors || 'black',
        font_size: Number(cfg.subtitleWordSize) || 64,
        placement_height_percent: cfg.subtitlesPlacementHeightPercent !== undefined && cfg.subtitlesPlacementHeightPercent !== '' ? Number(cfg.subtitlesPlacementHeightPercent) : 78,
        max_words_per_screen: Number(cfg.maxWordsPerScreen) || 4,
        speaking_word_highlight: resolvedSubHighlight,
        text_cases: Array.isArray(cfg.subtitleTextCases) ? cfg.subtitleTextCases : ['Normal Text'],
      },
      onScreenTextList: onScreenList,
    })

    log(`🎬 Rendering clip batch of ${batchSize} clips from ${path.basename(sourceVideo)}...`)

    try {
      const manifest = await renderStoryRecutBatch(sourceVideo, cutmap, clipsDir, {
        tighten: tightenSilence,
        onLog: log,
      })

      // For each rendered clip, save metadata
      for (const item of manifest) {
        if (batchMetadataIndex >= batchMetadataPool.length) {
          try {
            await refreshBatchMetadata()
          } catch {
            metadataFailed = true
            break
          }
        }

        // If pool is still empty after refresh, AI failed — stop editing
        if (batchMetadataPool.length === 0 || metadataFailed) {
          log(`🛑 Metadata pool empty after refresh attempt — stopping editing loop to prevent generic fallback clips.`)
          metadataFailed = true
          break
        }

        const meta = batchMetadataPool[batchMetadataIndex] ?? batchMetadataPool[batchMetadataPool.length - 1]
        batchMetadataIndex++

        const finalTitle = (meta?.title || '').trim() || `${cfg.campaignName || 'Video'} - Special Feature`
        const finalDesc = (meta?.description || '').trim() || `Watch ${cfg.campaignName || 'this video'}! Subscribe for more daily content. #shorts #viral`

        const metaJsonPath = path.join(clipsDir, `${item.id}.meta.json`)
        fs.writeFileSync(
          metaJsonPath,
          JSON.stringify({
            clipId: item.id,
            videoPath: item.file,
            title: finalTitle,
            description: finalDesc,
            onScreenText: meta?.onScreenText || '',
            hashtags: meta?.hashtags || ['shorts', 'viral'],
            duration: item.duration_sec,
            playbackRanges: item.playback_order_source_ranges,
            roles: item.roles,
            createdAt: new Date().toISOString(),
          }, null, 2),
          'utf8'
        )

        currentCount = countEditedClips(campaignId)
        log(`✅ [${currentCount}/${maxTarget}] Generated: ${path.basename(item.file)} (${item.duration_sec}s)`)

        onStatusUpdate?.({
          campaignId,
          currentClips: currentCount,
          targetClips: maxTarget,
          status: 'editing',
          lastMessage: `Clip #${currentCount} rendered: ${meta.title}`,
        })
      }

      if (metadataFailed) {
        onStatusUpdate?.({
          campaignId,
          currentClips: currentCount,
          targetClips: maxTarget,
          status: 'error',
          lastMessage: 'Editing halted: AI metadata generation failed. Check API keys.',
        })
        break
      }
    } catch (batchErr: any) {
      if (metadataFailed) break
      log(`❌ Batch render error: ${batchErr.message}`)
      // Brief pause before retry
      await new Promise((r) => setTimeout(r, 5000))
    }
  }

  const finalOnDisk = countEditedClips(campaignId)
  if (finalOnDisk >= maxTarget) {
    log(`🎉 Campaign ${campaignId} reached full pool of ${maxTarget} clips!`)
    onStatusUpdate?.({
      campaignId,
      currentClips: finalOnDisk,
      targetClips: maxTarget,
      status: 'completed',
      lastMessage: `All ${maxTarget} clips ready in pool.`,
    })
  }

  return finalOnDisk
  } finally {
    try {
      if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath)
    } catch {}
  }
}
