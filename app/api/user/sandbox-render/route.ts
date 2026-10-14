import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import * as fs from 'fs'
import * as path from 'path'
import {
  getCampaignDir,
  getSourcesDir,
  getAssetsDir,
  getClipsDir,
  loadTranscript,
  getClipTranscriptText,
  runCampaignSetup,
  isSetupComplete,
  getExistingSourceVideos,
} from '@/tools/campaign-processor'
import {
  editVideoClip,
  getVideoInfo,
  generateMultiCutSlices,
  generateContinuousSlices,
} from '@/tools/video-editor'
import { addSubtitlesToVideo } from '@/tools/subtitle-generator'
import {
  findViralClips,
  generateFullMetadata,
  generateBatchMetadataFromGuidelines,
  ShortMetadata,
  AiMetadataConfig,
} from '@/tools/ai-clipper'

export const dynamic = 'force-dynamic'

/**
 * GET /api/user/sandbox-render
 * Stream or download rendered sandbox video clip
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const clipId = searchParams.get('clipId')
  const campaignId = searchParams.get('campaignId')

  if (!clipId || !campaignId) {
    return NextResponse.json({ error: 'clipId and campaignId required' }, { status: 400 })
  }

  const clipsDir = getClipsDir(campaignId)
  const filePath = path.join(clipsDir, `${clipId}.mp4`)

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: 'Video file not found' }, { status: 404 })
  }

  const stat = fs.statSync(filePath)
  const fileStream = fs.createReadStream(filePath)

  return new NextResponse(fileStream as any, {
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': stat.size.toString(),
      'Content-Disposition': `attachment; filename="${clipId}.mp4"`,
    },
  })
}

/**
 * POST /api/user/sandbox-render
 * Generates ONE test compiled clip for a selected campaign locally/VPS
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized. Please log in to test sandbox clips.' }, { status: 401 })
    }
    const userId = session.user.id
    const { campaignId } = await req.json()
    if (!campaignId) {
      return NextResponse.json({ error: 'Please select a campaign' }, { status: 400 })
    }

    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
    })

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    const cfg = (campaign.config || {}) as Record<string, any>
    const clipsDir = getClipsDir(campaignId)
    fs.mkdirSync(clipsDir, { recursive: true })

    // 1. One-time setup if not completed
    if (!isSetupComplete(campaignId)) {
      await runCampaignSetup(campaignId, {
        ...cfg,
        campaignName: campaign.name,
        niche: cfg.niche || 'general',
      })
    }

    const sourceVideos = getExistingSourceVideos(campaignId)
    if (sourceVideos.length === 0) {
      return NextResponse.json({
        error: 'No source video files found for this campaign. Please ensure Drive/YouTube source URLs are provided or upload clips in Admin.',
      }, { status: 400 })
    }

    const sourceVideo = sourceVideos[0]
    const videoInfo = await getVideoInfo(sourceVideo)
    const transcript = loadTranscript(sourceVideo, campaignId)

    // Slicing config
    const clippingStrategies: string[] = cfg.clippingStrategies || ['multi_cut']
    const shortDuration = parseFloat(cfg.shortDuration || '45')
    const startOffset = parseFloat(cfg.startOffset || '0')
    const volumeMultiplier = parseFloat(cfg.volumeMultiplier || '1.0')
    const backgroundStyles: string[] = cfg.backgroundStyles || ['split_mirror_blur']
    const cornerStyles: string[] = cfg.foregroundCornerStyles || ['sharp']

    const assetsDir = getAssetsDir(campaignId)
    const logoFiles = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir).map(f => path.join(assetsDir, f)) : []
    const logoPath = logoFiles.length > 0 ? logoFiles[0] : undefined

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
      niche: cfg.niche || 'general',
      campaignName: campaign.name,
    }

    // Determine Slice
    let startTime = startOffset
    let endTime = Math.min(videoInfo.duration, startOffset + shortDuration)

    if (clippingStrategies.includes('continuous')) {
      const continuous = generateContinuousSlices({
        videoDuration: videoInfo.duration,
        clipCount: 1,
        minDuration: shortDuration * 0.8,
        maxDuration: shortDuration * 1.2,
        startOffset,
      })
      if (continuous[0]) {
        startTime = continuous[0].startTime
        endTime = continuous[0].endTime
      }
    } else if (clippingStrategies.includes('smart_ai') && transcript.length > 0) {
      const suggestions = await findViralClips(transcript, {
        minDuration: shortDuration * 0.8,
        maxDuration: shortDuration * 1.2,
        clipCount: 1,
        niche: cfg.niche,
        audioNotes: cfg.audioNotes,
      })
      if (suggestions[0]) {
        startTime = suggestions[0].startTime
        endTime = suggestions[0].endTime
      }
    }

    // Generate Metadata (AI or Guidelines)
    let metadata: ShortMetadata
    if (clippingStrategies.includes('smart_ai')) {
      const clipWords = getClipTranscriptText(transcript, startTime, endTime)
      metadata = await generateFullMetadata(clipWords, metaConfig)
    } else {
      // 50-batch guidelines call
      const batch = await generateBatchMetadataFromGuidelines(1, metaConfig)
      metadata = batch[0] || {
        title: `${campaign.name} - Viral Clip`,
        description: cfg.predefinedDescription || 'Check this out! #shorts #viral',
        onScreenText: 'Watch till the end!',
        hashtags: ['shorts', 'viral'],
      }
    }

    // Render Video
    const clipId = `sandbox_${Date.now()}`
    const rawClipPath = path.join(clipsDir, `${clipId}_raw.mp4`)
    const finalClipPath = path.join(clipsDir, `${clipId}.mp4`)

    const editRes = await editVideoClip({
      inputPath: sourceVideo,
      outputPath: rawClipPath,
      startTime,
      endTime,
      backgroundStyle: backgroundStyles,
      cornerStyles,
      volumeMultiplier,
      logoPath,
      overlayPosition: cfg.overlayPosition || 'top_right',
      overlayWidth: parseFloat(cfg.overlayWidth || '15'),
      banners,
    })

    if (!editRes.success) {
      throw new Error(`Video rendering failed: ${editRes.error}`)
    }

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

    return NextResponse.json({
      success: true,
      clipId,
      campaignId,
      title: metadata.title,
      description: metadata.description,
      onScreenText: metadata.onScreenText,
      hashtags: metadata.hashtags,
      videoUrl: `/api/user/sandbox-render?clipId=${clipId}&campaignId=${campaignId}`,
      duration: Math.round(endTime - startTime),
    })

  } catch (error: any) {
    console.error('[Sandbox Render Error]:', error)
    return NextResponse.json({ error: error.message || 'Sandbox rendering failed' }, { status: 500 })
  }
}
