import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import * as fs from 'fs'
import * as path from 'path'
import {
  getClipsDir,
  getCampaignDir,
  getAssetsDir,
  loadTranscript,
  loadTranscriptSrt,
  runCampaignSetup,
  isSetupComplete,
  getExistingSourceVideos,
} from '@/tools/campaign-processor'
import { downloadLogoOverlay } from '@/tools/drive-downloader'
import { getVideoInfo } from '@/tools/video-editor'
import {
  buildStoryRecutMap,
  renderStoryRecutBatch,
} from '@/tools/story-recut-engine'
import {
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

    // Check if source videos exist; if not, run one-time setup
    let sourceVideos = getExistingSourceVideos(campaignId)
    if (sourceVideos.length === 0) {
      update('rendering', 'Setting up source video files...')
      await runCampaignSetup(campaignId, {
        ...cfg,
        campaignName: campaign.name,
        niche: cfg.niche || 'general',
      })
      sourceVideos = getExistingSourceVideos(campaignId)
    }

    if (sourceVideos.length === 0) {
      throw new Error('No source video files found for this campaign. Please ensure source URLs are valid or video clips are uploaded.')
    }

    const sourceVideo = sourceVideos[0]
    update('rendering', 'Inspecting video dimensions & duration...')
    let videoDuration = 1800
    try {
      const vInfo = await getVideoInfo(sourceVideo)
      videoDuration = vInfo.duration
    } catch {}

    let transcript = loadTranscript(sourceVideo, campaignId)
    let srtPath = loadTranscriptSrt(sourceVideo, campaignId)

    // If subtitles are enabled and transcript/SRT is missing, generate on demand
    const subsEnabled = cfg.enableSubtitles !== 'Disabled (Fallback to AI Captions)' && cfg.enableSubtitles !== false && cfg.enableSubtitles !== 'disabled'
    if (subsEnabled && (!srtPath || transcript.length === 0)) {
      update('rendering', 'Generating speech-to-text transcript for subtitles...')
      try {
        const { transcribeVideo } = await import('@/tools/subtitle-generator')
        const { segmentsToSrt, getTranscriptsDir } = await import('@/tools/campaign-processor')
        const transcriptsDir = getTranscriptsDir(campaignId)
        const baseName = path.basename(sourceVideo, path.extname(sourceVideo))
        const workDir = path.join(transcriptsDir, 'tmp', baseName)
        const segments = await transcribeVideo(sourceVideo, workDir)
        if (segments && segments.length > 0) {
          const jsonPath = path.join(transcriptsDir, `${baseName}.json`)
          const generatedSrt = path.join(transcriptsDir, `${baseName}.srt`)
          fs.writeFileSync(jsonPath, JSON.stringify(segments, null, 2), 'utf8')
          fs.writeFileSync(generatedSrt, segmentsToSrt(segments), 'utf8')
          srtPath = generatedSrt
          transcript = segments
          console.log(`[SandboxRender] ✅ Generated on-demand transcript: ${segments.length} segments`)
        }
      } catch (err: any) {
        console.warn('[SandboxRender] On-demand transcription failed:', err.message)
      }
    }

    const shortDuration = parseFloat(cfg.shortDuration || '45')
    const hookDuration = parseFloat(cfg.hookDuration || '3.5')

    // Generate metadata for the test clip first so on-screen text hook is available
    update('rendering', 'Generating title & descriptions with AI...')
    const metaConfig: AiMetadataConfig = {
      // DB stores fields as titlesAiGuide / descriptionsAiGuide / onScreenTextAiGuide
      titlesGuide: cfg.titlesAiGuide || cfg.titlesGuide || '',
      descriptionsGuide: cfg.descriptionsAiGuide || cfg.descriptionsGuide || '',
      onScreenGuide: cfg.onScreenTextAiGuide || cfg.onScreenAiGuide || '',
      ftcDisclosure: cfg.ftcDisclosure,
      predefinedDescription: cfg.predefinedDescription,
      useOnlyPredefinedDescription: cfg.useOnlyPredefinedDescription || cfg.useOnlyPredefinedDesc,
      linksInDescription: cfg.linksInDescription,
      maxTitleChars: cfg.maxTitleCharacters ? parseInt(cfg.maxTitleCharacters) : 100,
      onScreenMaxChars: cfg.onScreenMaxCharacters ? parseInt(cfg.onScreenMaxCharacters) : (cfg.onScreenMaxChars ? parseInt(cfg.onScreenMaxChars) : 80),
      audioNotes: cfg.audioNotes,
      niche: cfg.niche || 'general',
      campaignName: campaign.name,
    }

    let metadata: ShortMetadata
    try {
      const batch = await generateBatchMetadataFromGuidelines(1, metaConfig)
      metadata = batch[0] || {
        title: `${campaign.name} - Story Re-Cut Sample`,
        description: cfg.predefinedDescription || '#shorts #viral',
        onScreenText: '',
        hashtags: ['shorts', 'viral'],
      }
    } catch {
      metadata = {
        title: `${campaign.name} - Story Re-Cut Sample`,
        description: cfg.predefinedDescription || '#shorts #viral',
        onScreenText: '',
        hashtags: ['shorts', 'viral'],
      }
    }

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

    const onScreenTextVal = metadata.onScreenText || (cfg.onScreenTextPool ? cfg.onScreenTextPool.split('\n')[0] : '')

      const resolvedSubFont = (cfg.useSameFontForBannersAndSubs ? cfg.onScreenFontName : cfg.subtitleFonts) || 'Arial'
      const resolvedSubHighlight = (cfg.useSameForSpeakingWordHighlight ? cfg.onScreenStyledWordsColor : cfg.speakingWordHighlight) || 'yellow'

      update('rendering', 'Building Story Re-Cut plan (Aspect Ratio, Hook & Captions)...')
      const cutmap = buildStoryRecutMap(videoDuration, transcript, srtPath, {
        clipCount: 1,
        startIndex: 1,
        targetDuration: shortDuration,
        hookDuration: hookDuration,
        campaignName: campaign.name,
        videoAspectRatio: cfg.videoAspectRatio || '9:16',
        frameBackgroundColor: cfg.frameBackgroundColor || '#000000',
        logo: logoPath ? {
          path: logoPath,
          position: cfg.overlayPosition || 'Bottom Center',
          width_percent: Number(cfg.overlayWidthPercent) || 40,
          height_percent: cfg.overlayHeightPercent !== undefined && cfg.overlayHeightPercent !== '' ? Number(cfg.overlayHeightPercent) : undefined,
        } : undefined,
        onScreenConfig: {
          text: onScreenTextVal,
          font: cfg.onScreenFontName || 'Arial',
          text_color: cfg.onScreenTextColor || 'white',
          position_height_percent: cfg.onScreenPositionHeightPercent !== undefined && cfg.onScreenPositionHeightPercent !== '' ? Number(cfg.onScreenPositionHeightPercent) : 27,
          size_px: Number(cfg.onScreenSizePx) || 52,
          background: cfg.onScreenBackground || 'black@0.5',
          styled_word_count: Number(cfg.onScreenStyledWordCount) || 0,
          styled_words_color: cfg.onScreenStyledWordsColor || 'yellow',
        },
        subtitlesConfig: {
          enable: cfg.enableSubtitles !== 'Disabled (Fallback to AI Captions)' && cfg.enableSubtitles !== false && cfg.enableSubtitles !== 'disabled',
          font: resolvedSubFont,
          color: cfg.subtitleColors || 'white',
          outline_color: cfg.outlineColors || 'black',
          font_size: Number(cfg.subtitleWordSize) || 54,
          placement_height_percent: cfg.subtitlesPlacementHeightPercent !== undefined && cfg.subtitlesPlacementHeightPercent !== '' ? Number(cfg.subtitlesPlacementHeightPercent) : 80,
          max_words_per_screen: Number(cfg.maxWordsPerScreen) || 5,
          speaking_word_highlight: resolvedSubHighlight,
          text_cases: Array.isArray(cfg.subtitleTextCases) ? cfg.subtitleTextCases : ['Normal Text'],
        },
        onScreenTextList: onScreenTextVal ? [onScreenTextVal] : [],
      })

    update('rendering', 'Rendering 9:16 vertical video with FFMPEG (ultrafast)...')
    const manifest = await renderStoryRecutBatch(sourceVideo, cutmap, clipsDir, {
      tighten: false, // fast preview for sandbox
      onLog: (msg) => console.log(`[SandboxRender:${jobId}] ${msg}`),
    })

    if (!manifest || manifest.length === 0) {
      throw new Error('Story Re-Cut renderer produced no output')
    }

    const rendered = manifest[0]
    const clipId = rendered.id

    // Write meta JSON
    const metaJsonPath = path.join(clipsDir, `${clipId}.meta.json`)
    fs.writeFileSync(
      metaJsonPath,
      JSON.stringify({
        clipId,
        videoPath: rendered.file,
        title: metadata.title,
        description: metadata.description,
        onScreenText: metadata.onScreenText,
        hashtags: metadata.hashtags,
        duration: rendered.duration_sec,
        playbackRanges: rendered.playback_order_source_ranges,
        roles: rendered.roles,
        createdAt: new Date().toISOString(),
      }, null, 2),
      'utf8'
    )

    const finalResult = {
      clipId,
      campaignId,
      title: metadata.title,
      description: metadata.description,
      onScreenText: metadata.onScreenText,
      hashtags: metadata.hashtags,
      videoUrl: `/api/user/sandbox-render?clipId=${clipId}&campaignId=${campaignId}`,
      duration: rendered.duration_sec,
      playbackRanges: rendered.playback_order_source_ranges,
    }

    update('completed', '✅ Sandbox Story Re-Cut clip rendered successfully!', undefined, finalResult)
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
      progress: '🚀 Initializing Story Re-Cut render job...',
      startedAt: Date.now(),
    })

    // Execute in background without blocking HTTP request
    executeSandboxRender(jobId, campaignId)

    // Respond immediately in < 50ms so Nginx NEVER times out
    return NextResponse.json({
      success: true,
      jobId,
      status: 'rendering',
      progress: '🚀 Initializing Story Re-Cut render job...',
    })

  } catch (error: any) {
    console.error('[Sandbox Render Error]:', error)
    return NextResponse.json({ error: error.message || 'Sandbox rendering failed' }, { status: 500 })
  }
}
