/**
 * Continuous Editing Engine (300 Clips Target Worker)
 * Powered by Story Re-Cut Editor (Whop Shorts Style)
 * 
 * Target: Har campaign ke paas har waqt 300 active/ready edited clips available hone chahiye.
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
  getClipsDir,
  loadTranscript,
  loadTranscriptSrt,
  getClipTranscriptText,
  countEditedClips,
  isSetupComplete,
  runCampaignSetup,
  getExistingSourceVideos,
} from './campaign-processor'
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

export const TARGET_EDITED_CLIPS = 300

export interface EditEngineProgress {
  campaignId: string
  currentClips: number
  targetClips: number
  status: 'idle' | 'setting_up' | 'editing' | 'completed' | 'error'
  lastMessage?: string
}

/**
 * Ensures target 300 clips exist for a campaign using the Story Re-Cut Editor.
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

  let currentCount = countEditedClips(campaignId)
  log(`Current pool count: ${currentCount}/${TARGET_EDITED_CLIPS}`)

  if (currentCount >= TARGET_EDITED_CLIPS) {
    onStatusUpdate?.({
      campaignId,
      currentClips: currentCount,
      targetClips: TARGET_EDITED_CLIPS,
      status: 'completed',
      lastMessage: `Target reached (${currentCount}/${TARGET_EDITED_CLIPS} clips ready).`,
    })
    return currentCount
  }

  const sourceVideos = getExistingSourceVideos(campaignId)
  if (sourceVideos.length === 0) {
    const errorMsg = 'No source videos found in storage. Please add source URLs or upload clips.'
    log(`❌ ${errorMsg}`)
    onStatusUpdate?.({
      campaignId,
      currentClips: currentCount,
      targetClips: TARGET_EDITED_CLIPS,
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
    titlesGuide: cfg.titlesGuide,
    descriptionsGuide: cfg.descriptionsGuide,
    onScreenGuide: cfg.onScreenAiGuide,
    ftcDisclosure: cfg.ftcDisclosure,
    predefinedDescription: cfg.predefinedDescription,
    useOnlyPredefinedDescription: cfg.useOnlyPredefinedDescription,
    linksInDescription: cfg.linksInDescription,
    maxTitleChars: cfg.maxTitleCharacters ? parseInt(cfg.maxTitleCharacters) : 100,
    onScreenMaxChars: cfg.onScreenMaxChars ? parseInt(cfg.onScreenMaxChars) : 80,
    audioNotes: cfg.audioNotes,
    niche: cfg.niche,
    campaignName: cfg.campaignName,
  }

  // Pre-fetch batch metadata from guidelines
  let batchMetadataPool: ShortMetadata[] = []
  let batchMetadataIndex = 0

  const refreshBatchMetadata = async () => {
    log('🤖 Fetching batch of 20 metadata sets from AI (Title/Desc guidelines)...')
    try {
      batchMetadataPool = await generateBatchMetadataFromGuidelines(20, metaConfig)
      batchMetadataIndex = 0
      log(`✅ Batch of ${batchMetadataPool.length} metadata sets received.`)
    } catch (err: any) {
      log(`⚠️ Failed to generate batch metadata: ${err.message}`)
    }
  }

  await refreshBatchMetadata()

  log(`🚀 Starting Story Re-Cut Loop: need ${TARGET_EDITED_CLIPS - currentCount} more clips`)

  // Loop until 300 clips reached, rendering in small batches of 3-5 clips
  while (currentCount < TARGET_EDITED_CLIPS) {
    const clipsNeeded = TARGET_EDITED_CLIPS - currentCount
    const batchSize = Math.min(3, clipsNeeded)

    onStatusUpdate?.({
      campaignId,
      currentClips: currentCount,
      targetClips: TARGET_EDITED_CLIPS,
      status: 'editing',
      lastMessage: `Rendering Story Re-Cut batch (${currentCount + 1} to ${currentCount + batchSize})...`,
    })

    // Pick a source video (round-robin)
    const sourceVideo = sourceVideos[currentCount % sourceVideos.length]
    let videoDuration = 1800 // default 30m
    try {
      const vInfo = await getVideoInfo(sourceVideo)
      videoDuration = vInfo.duration
    } catch {}

    const transcript = loadTranscript(sourceVideo, campaignId)
    const srtPath = loadTranscriptSrt(sourceVideo, campaignId)

    // Build cutmap for this batch
    const cutmap = buildStoryRecutMap(videoDuration, transcript, srtPath, {
      clipCount: batchSize,
      startIndex: currentCount + 1,
      targetDuration: shortDuration,
      hookDuration: hookDuration,
      campaignName: cfg.campaignName,
    })

    log(`🎬 Rendering Story Re-Cut batch of ${batchSize} clips from ${path.basename(sourceVideo)}...`)

    try {
      const manifest = await renderStoryRecutBatch(sourceVideo, cutmap, clipsDir, {
        tighten: tightenSilence,
        onLog: log,
      })

      // For each rendered clip, save metadata
      for (const item of manifest) {
        if (batchMetadataIndex >= batchMetadataPool.length) {
          await refreshBatchMetadata()
        }

        const meta = batchMetadataPool[batchMetadataIndex] || {
          title: `${cfg.campaignName || 'Short'} #${currentCount + 1}`,
          description: cfg.predefinedDescription || '',
          onScreenText: '',
          hashtags: ['shorts', 'viral'],
        }
        batchMetadataIndex++

        const metaJsonPath = path.join(clipsDir, `${item.id}.meta.json`)
        fs.writeFileSync(
          metaJsonPath,
          JSON.stringify({
            clipId: item.id,
            videoPath: item.file,
            title: meta.title,
            description: meta.description,
            onScreenText: meta.onScreenText,
            hashtags: meta.hashtags,
            duration: item.duration_sec,
            playbackRanges: item.playback_order_source_ranges,
            roles: item.roles,
            createdAt: new Date().toISOString(),
          }, null, 2),
          'utf8'
        )

        currentCount++
        log(`✅ [${currentCount}/${TARGET_EDITED_CLIPS}] Generated: ${path.basename(item.file)} (${item.duration_sec}s)`)

        onStatusUpdate?.({
          campaignId,
          currentClips: currentCount,
          targetClips: TARGET_EDITED_CLIPS,
          status: 'editing',
          lastMessage: `Clip #${currentCount} rendered: ${meta.title}`,
        })
      }
    } catch (batchErr: any) {
      log(`❌ Batch render error: ${batchErr.message}`)
      // Brief pause before retry
      await new Promise((r) => setTimeout(r, 5000))
    }
  }

  log(`🎉 Campaign ${campaignId} reached full pool of ${TARGET_EDITED_CLIPS} clips!`)
  onStatusUpdate?.({
    campaignId,
    currentClips: currentCount,
    targetClips: TARGET_EDITED_CLIPS,
    status: 'completed',
    lastMessage: `All ${TARGET_EDITED_CLIPS} clips ready in pool.`,
  })

  return currentCount
}
