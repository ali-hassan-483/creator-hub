/**
 * Continuous Editing Engine (300 Clips Target Worker)
 * 
 * Target: Har campaign ke paas har waqt 300 active/ready edited clips available hone chahiye.
 * - Checks current clips count: countEditedClips(campaignId)
 * - Agar clips < 300 hain:
 *     - Automatically picks slices (Multi-cut / Continuous / Smart AI)
 *     - Reads pre-generated transcript for exact timestamps -> Accurate Title, Desc, On-Screen Hook
 *     - FFMPEG renders clip (9:16 vertical, background styling, banners, corner styles, logo)
 *     - Generates ASS karaoke subtitles & burns them
 *     - Saves to storage/campaigns/{campaignId}/clips/final_{index}_{timestamp}.mp4
 * - Runs continuously in background loop.
 */

import * as fs from 'fs'
import * as path from 'path'
import {
  getCampaignDir,
  getSourcesDir,
  getAssetsDir,
  getClipsDir,
  loadTranscript,
  getClipTranscriptText,
  countEditedClips,
  isSetupComplete,
  runCampaignSetup,
  getExistingSourceVideos,
} from './campaign-processor'
import {
  editVideoClip,
  getVideoInfo,
  generateMultiCutSlices,
  generateContinuousSlices,
  SliceJob,
} from './video-editor'
import { addSubtitlesToVideo } from './subtitle-generator'
import {
  findViralClips,
  generateFullMetadata,
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
 * Ensures target 300 clips exist for a campaign.
 * Can be run in VPS background worker or locally on laptop.
 */
export async function maintainCampaignClipPool(
  campaignId: string,
  cfg: Record<string, any>,
  onStatusUpdate?: (progress: EditEngineProgress) => void
): Promise<number> {
  const log = (msg: string) => {
    console.log(`[ClipPool:${campaignId}] ${msg}`)
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
  const assetsDir = getAssetsDir(campaignId)
  const hooksDir = path.join(getCampaignDir(campaignId), 'hooks')
  const ctasDir = path.join(getCampaignDir(campaignId), 'ctas')

  const logoFiles = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir).map(f => path.join(assetsDir, f)) : []
  const logoPath = logoFiles.length > 0 ? logoFiles[0] : undefined

  const hookFiles = fs.existsSync(hooksDir) ? fs.readdirSync(hooksDir).map(f => path.join(hooksDir, f)) : []
  const ctaFiles = fs.existsSync(ctasDir) ? fs.readdirSync(ctasDir).map(f => path.join(ctasDir, f)) : []

  // Extract config
  const clippingStrategies: string[] = cfg.clippingStrategies || ['multi_cut']
  const shortDuration = parseFloat(cfg.shortDuration || '45')
  const startOffset = parseFloat(cfg.startOffset || '0')
  const volumeMultiplier = parseFloat(cfg.volumeMultiplier || '1.0')
  const backgroundStyles: string[] = cfg.backgroundStyles || ['split_mirror_blur']
  const cornerStyles: string[] = cfg.foregroundCornerStyles || ['sharp']

  const banners = (cfg.banners || []).slice(0, 5).map((b: any) => ({
    text: b.text || '',
    font: b.font || 'Arial',
    textColor: b.textColor || 'white',
    positionHeight: parseFloat(b.positionHeight || '85'),
    fontSize: parseInt(b.fontSize || '54', 10),
    background: b.background || 'black@0.7',
    styledWordCount: parseInt(b.styledWordCount || '0', 10),
    styledWordsColor: b.styledWordsColor || 'yellow',
    showOnlyInLastSeconds: b.showOnlyInLastSeconds === true,
    lastSecondsDuration: parseFloat(b.lastSecondsDuration || '0'),
  })).filter((b: any) => b.text.trim() !== '')

  const subtitleEnabled = cfg.enableSubtitles !== 'Disabled'
  const subtitleConfig = {
    font: cfg.subtitleFonts || 'Arial',
    textColor: cfg.subtitleColors || 'white',
    outlineColor: cfg.outlineColors || 'black',
    fontSize: parseInt(cfg.subtitleWordSize || '60', 10),
    placementHeight: parseFloat(cfg.subtitlePlacementHeight || '80'),
    maxWordsPerScreen: parseInt(cfg.maxWordsPerScreen || '5', 10),
    speakingWordHighlight: cfg.speakingWordHighlight || 'yellow',
    textCase: cfg.subtitleTextCases || ['UPPERCASE'],
  }

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

  const isSmartAi = clippingStrategies.includes('smart_ai')

  // 🎯 BATCH METADATA POOL: For Multi-cut & Continuous, we do NOT send the transcript/script to Gemini!
  // Instead, we fetch 50 metadata items in ONE single API call directly using guidelines.
  let batchMetadataPool: ShortMetadata[] = []
  let batchMetadataIndex = 0

  const refreshBatchMetadata = async () => {
    log('🤖 Fetching batch of 50 metadata sets from Gemini (using Title/Desc/OnScreen guidelines only, NO script)...')
    try {
      batchMetadataPool = await generateBatchMetadataFromGuidelines(50, metaConfig)
      batchMetadataIndex = 0
      log(`✅ Batch of ${batchMetadataPool.length} metadata sets received from Gemini in ONE API call.`)
    } catch (err: any) {
      log(`⚠️ Failed to generate batch metadata: ${err.message}`)
    }
  }

  if (!isSmartAi) {
    await refreshBatchMetadata()
  }

  log(`🚀 Starting Continuous Edit Loop: need ${TARGET_EDITED_CLIPS - currentCount} more clips`)

  // Loop until 300 clips reached
  while (currentCount < TARGET_EDITED_CLIPS) {
    onStatusUpdate?.({
      campaignId,
      currentClips: currentCount,
      targetClips: TARGET_EDITED_CLIPS,
      status: 'editing',
      lastMessage: `Rendering clip #${currentCount + 1}...`,
    })

    // Pick a source video (round-robin / randomized)
    const sourceVideo = sourceVideos[currentCount % sourceVideos.length]
    const videoInfo = await getVideoInfo(sourceVideo)
    const transcript = loadTranscript(sourceVideo, campaignId)

    let slice: SliceJob | null = null

    if (isSmartAi && transcript.length > 0) {
      const suggestions = await findViralClips(transcript, {
        minDuration: shortDuration * 0.8,
        maxDuration: shortDuration * 1.2,
        clipCount: 1,
        niche: cfg.niche,
        audioNotes: cfg.audioNotes,
      })
      if (suggestions.length > 0) {
        slice = {
          index: currentCount + 1,
          startTime: suggestions[0].startTime,
          endTime: suggestions[0].endTime,
        }
      }
    }

    if (!slice) {
      if (clippingStrategies.includes('continuous')) {
        const continuous = generateContinuousSlices({
          videoDuration: videoInfo.duration,
          clipCount: 1,
          minDuration: shortDuration * 0.8,
          maxDuration: shortDuration * 1.2,
          startOffset: (startOffset + (currentCount * (shortDuration * 0.9))) % (videoInfo.duration - shortDuration),
        })
        slice = continuous[0] || null
      } else {
        // Multi-cut default
        const multi = generateMultiCutSlices({
          videoDuration: videoInfo.duration,
          clipCount: 1,
          minDuration: shortDuration * 0.8,
          maxDuration: shortDuration * 1.2,
          startOffset,
        })
        slice = multi[0] || null
      }
    }

    // Fallback if slicing calculated no slice
    if (!slice) {
      const start = Math.max(0, Math.min(videoInfo.duration - shortDuration - 5, Math.random() * (videoInfo.duration - shortDuration)))
      slice = {
        index: currentCount + 1,
        startTime: start,
        endTime: start + shortDuration,
      }
    }

    // 🎯 METADATA RESOLUTION:
    let metadata: ShortMetadata

    if (isSmartAi) {
      // Smart AI uses transcript excerpt for viral hook
      const clipWords = getClipTranscriptText(transcript, slice.startTime, slice.endTime)
      const metadataPromptContext = clipWords.length > 10
        ? `Spoken words in this clip: "${clipWords}"`
        : `Video clip from campaign "${cfg.campaignName || ''}" in niche "${cfg.niche || ''}"`
      metadata = await generateFullMetadata(metadataPromptContext, metaConfig)
    } else {
      // Multi-cut & Continuous: Use pre-fetched 50-batch metadata (NO script sent to Gemini!)
      if (batchMetadataIndex >= batchMetadataPool.length) {
        await refreshBatchMetadata()
      }
      metadata = batchMetadataPool[batchMetadataIndex] || {
        title: `${cfg.campaignName || 'Video'} #${currentCount + 1}`,
        description: cfg.predefinedDescription || '',
        onScreenText: 'Watch this!',
        hashtags: ['shorts', 'viral'],
      }
      batchMetadataIndex++
    }

    // Save metadata alongside clip
    const clipId = `final_${String(currentCount + 1).padStart(4, '0')}_${Date.now()}`
    const rawClipPath = path.join(clipsDir, `${clipId}_raw.mp4`)
    const finalClipPath = path.join(clipsDir, `${clipId}.mp4`)
    const metaJsonPath = path.join(clipsDir, `${clipId}.meta.json`)

    const hookPath = hookFiles.length > 0 ? hookFiles[currentCount % hookFiles.length] : undefined
    const ctaPath = ctaFiles.length > 0 ? ctaFiles[currentCount % ctaFiles.length] : undefined

    // Render Video via FFMPEG
    const editRes = await editVideoClip({
      inputPath: sourceVideo,
      outputPath: rawClipPath,
      startTime: slice.startTime,
      endTime: slice.endTime,
      hookPath,
      ctaPath,
      backgroundStyle: backgroundStyles,
      cornerStyles,
      volumeMultiplier,
      logoPath,
      overlayPosition: cfg.overlayPosition || 'top_right',
      overlayWidth: parseFloat(cfg.overlayWidth || '15'),
      banners,
    })

    if (!editRes.success) {
      log(`⚠️ Render failed for slice: ${editRes.error}`)
      continue
    }

    // Burn Subtitles if enabled
    if (subtitleEnabled) {
      const subWorkDir = path.join(clipsDir, 'tmp_sub', clipId)
      const subOk = await addSubtitlesToVideo(rawClipPath, finalClipPath, subtitleConfig, subWorkDir)
      if (!subOk) {
        fs.renameSync(rawClipPath, finalClipPath)
      } else if (fs.existsSync(rawClipPath)) {
        try { fs.unlinkSync(rawClipPath) } catch {}
      }
    } else {
      fs.renameSync(rawClipPath, finalClipPath)
    }

    // Write metadata file
    fs.writeFileSync(
      metaJsonPath,
      JSON.stringify({
        clipId,
        videoPath: finalClipPath,
        title: metadata.title,
        description: metadata.description,
        onScreenText: metadata.onScreenText,
        hashtags: metadata.hashtags,
        spokenWords: isSmartAi ? getClipTranscriptText(transcript, slice.startTime, slice.endTime) : '',
        startTime: slice.startTime,
        endTime: slice.endTime,
        createdAt: new Date().toISOString(),
      }, null, 2),
      'utf8'
    )

    currentCount++
    log(`✅ Generated clip #${currentCount}/${TARGET_EDITED_CLIPS} -> ${path.basename(finalClipPath)}`)

    onStatusUpdate?.({
      campaignId,
      currentClips: currentCount,
      targetClips: TARGET_EDITED_CLIPS,
      status: 'editing',
      lastMessage: `Clip #${currentCount} rendered successfully: ${metadata.title}`,
    })
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
