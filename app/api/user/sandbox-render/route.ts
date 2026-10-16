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
import { downloadLogoOverlay } from '@/tools/drive-downloader'
import { addSubtitlesToVideo } from '@/tools/subtitle-generator'
import {
  findViralClips,
  generateFullMetadata,
  generateBatchMetadataFromGuidelines,
  ShortMetadata,
  AiMetadataConfig,
} from '@/tools/ai-clipper'

export const dynamic = 'force-dynamic'

interface SandboxJob {
  id: string
  campaignId: string
  status: 'queued' | 'rendering' | 'completed' | 'error'
  progress: string
  result?: any
  error?: string
  startedAt: number
}

// Global in-memory job tracker for sandbox renders
const activeSandboxJobs = new Map<string, SandboxJob>()

async function executeSandboxRender(jobId: string, campaignId: string) {
  const update = (status: SandboxJob['status'], progress: string, error?: string, result?: any) => {
    const job = activeSandboxJobs.get(jobId)
    if (job) {
      job.status = status
      job.progress = progress
      if (error) job.error = error
      if (result) job.result = result
    }
  }

  try {
    update('rendering', 'Loading campaign configuration...')
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
    })
    if (!campaign) throw new Error('Campaign not found')

    const cfg = (campaign.config || {}) as Record<string, any>
    const clipsDir = getClipsDir(campaignId)
    fs.mkdirSync(clipsDir, { recursive: true })

    // 1. One-time setup if needed
    if (!isSetupComplete(campaignId)) {
      update('rendering', 'Setting up source videos and transcripts...')
      await runCampaignSetup(campaignId, {
        ...cfg,
        campaignName: campaign.name,
        niche: cfg.niche || 'general',
      })
    }

    const sourceVideos = getExistingSourceVideos(campaignId)
    if (sourceVideos.length === 0) {
      throw new Error('No source video files found for this campaign. Please ensure source URLs are downloaded or clips are uploaded.')
    }

    const sourceVideo = sourceVideos[0]
    update('rendering', 'Inspecting video dimensions & duration...')
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
    const logoFiles = fs.existsSync(assetsDir)
      ? fs.readdirSync(assetsDir).filter(f => !f.startsWith('.') && !f.endsWith('.part')).map(f => path.join(assetsDir, f))
      : []
    let logoPath = logoFiles.length > 0 ? logoFiles[0] : undefined

    // On-demand download if logo is configured but not yet in assets folder
    if (!logoPath && cfg.logoOverlayUrl) {
      update('rendering', 'Downloading campaign logo overlay...')
      try {
        const dl = await downloadLogoOverlay(cfg.logoOverlayUrl, assetsDir)
        if (dl) logoPath = dl
      } catch (err: any) {
        console.warn('[SandboxRender] Failed to download logo on demand:', err?.message || err)
      }
    }

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

    // Determine slice range
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
      update('rendering', 'Finding viral timestamp with AI...')
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

    // Generate Metadata
    update('rendering', 'Generating viral title & on-screen text with AI...')
    let metadata: ShortMetadata
    try {
      if (clippingStrategies.includes('smart_ai')) {
        const clipWords = getClipTranscriptText(transcript, startTime, endTime)
        metadata = await generateFullMetadata(clipWords, metaConfig)
      } else {
        const batch = await generateBatchMetadataFromGuidelines(1, metaConfig)
        metadata = batch[0] || {
          title: `${campaign.name} - Viral Clip`,
          description: cfg.predefinedDescription || 'Check this out! #shorts #viral',
          onScreenText: 'Watch till the end!',
          hashtags: ['shorts', 'viral'],
        }
      }
    } catch {
      metadata = {
        title: `${campaign.name} - Sample Clip`,
        description: cfg.predefinedDescription || '#shorts #viral',
        onScreenText: 'Watch this!',
        hashtags: ['shorts', 'viral'],
      }
    }

    // Render Video
    const clipId = `sandbox_${Date.now()}`
    const rawClipPath = path.join(clipsDir, `${clipId}_raw.mp4`)
    const finalClipPath = path.join(clipsDir, `${clipId}.mp4`)

    // Include On-Screen Text Hook banner on video (matching the campaign preview mockup)
    const renderBanners = [...banners]
    const hookText = metadata.onScreenText || (cfg.onScreenTextPool ? cfg.onScreenTextPool.split('\n')[0] : '')
    if (hookText && hookText.trim()) {
      renderBanners.unshift({
        text: hookText.trim(),
        font: cfg.onScreenFontName || 'Arial',
        textColor: cfg.onScreenTextColor || 'white',
        positionHeight: parseFloat(cfg.onScreenPositionHeightPercent ?? '27'),
        fontSize: parseInt(cfg.onScreenSizePx ?? '64', 10),
        background: cfg.onScreenBackground || 'black@0.5',
        styledWordCount: parseInt(cfg.onScreenStyledWordCount ?? '0', 10),
        styledWordsColor: cfg.onScreenStyledWordsColor || 'yellow',
        showOnlyInLastSeconds: false,
        lastSecondsDuration: 0,
      })
    }

    update('rendering', 'Rendering 9:16 vertical video with FFMPEG (background, banners, logo)...')
    const editRes = await editVideoClip({
      inputPath: sourceVideo,
      outputPath: rawClipPath,
      startTime,
      endTime,
      preset: 'ultrafast', // High-speed preview render for Sandbox!
      backgroundStyle: backgroundStyles,
      cornerStyles,
      volumeMultiplier,
      logoPath,
      overlayPosition: cfg.overlayPosition || 'Bottom Center',
      overlayWidth: parseFloat(cfg.overlayWidthPercent ?? cfg.overlayWidth ?? '60'),
      overlayHeightPercent: cfg.overlayHeightPercent !== undefined ? parseFloat(cfg.overlayHeightPercent) : undefined,
      banners: renderBanners,
    })

    if (!editRes.success) {
      throw new Error(`Video rendering failed: ${editRes.error}`)
    }

    if (subtitleEnabled) {
      update('rendering', 'Generating and burning karaoke subtitles...')
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

    const finalResult = {
      clipId,
      campaignId,
      title: metadata.title,
      description: metadata.description,
      onScreenText: metadata.onScreenText,
      hashtags: metadata.hashtags,
      videoUrl: `/api/user/sandbox-render?clipId=${clipId}&campaignId=${campaignId}`,
      duration: Math.round(endTime - startTime),
    }

    update('completed', '✅ Sandbox clip rendered successfully!', undefined, finalResult)
  } catch (err: any) {
    console.error(`[Sandbox Render Job ${jobId} Error]:`, err)
    update('error', '❌ Render failed', err.message || 'Render failed')
  }
}

/**
 * GET /api/user/sandbox-render
 * 1. Stream or download rendered video: ?clipId=xxx&campaignId=yyy
 * 2. Check job status: ?jobId=xxx
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const jobId = searchParams.get('jobId')

    // 1. Check Job Status
    if (jobId) {
      const job = activeSandboxJobs.get(jobId)
      if (!job) {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 })
      }
      return NextResponse.json({
        jobId: job.id,
        status: job.status,
        progress: job.progress,
        result: job.result || null,
        error: job.error || null,
        elapsedSeconds: Math.round((Date.now() - job.startedAt) / 1000),
      })
    }

    // 2. Stream/Download Video File
    const clipId = searchParams.get('clipId')
    const campaignId = searchParams.get('campaignId')

    if (!clipId || !campaignId) {
      return NextResponse.json({ error: 'clipId and campaignId (or jobId) required' }, { status: 400 })
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
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Request failed' }, { status: 500 })
  }
}

/**
 * POST /api/user/sandbox-render
 * Starts an asynchronous sandbox render job and returns immediately with jobId.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized. Please log in to test sandbox clips.' }, { status: 401 })
    }

    const { campaignId } = await req.json()
    if (!campaignId) {
      return NextResponse.json({ error: 'Please select a campaign' }, { status: 400 })
    }

    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, name: true },
    })

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    // Generate unique job ID
    const jobId = `sandbox_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`

    // Register job
    activeSandboxJobs.set(jobId, {
      id: jobId,
      campaignId,
      status: 'rendering',
      progress: '🚀 Initializing render job...',
      startedAt: Date.now(),
    })

    // Execute in background without blocking HTTP request
    executeSandboxRender(jobId, campaignId)

    // Respond immediately in < 50ms so Nginx NEVER times out
    return NextResponse.json({
      success: true,
      jobId,
      status: 'rendering',
      progress: '🚀 Initializing render job...',
    })

  } catch (error: any) {
    console.error('[Sandbox Render Error]:', error)
    return NextResponse.json({ error: error.message || 'Sandbox rendering failed' }, { status: 500 })
  }
}
