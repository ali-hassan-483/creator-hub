import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import * as fs from 'fs'
import * as path from 'path'
import {
  getClipsDir,
  loadTranscript,
  loadTranscriptSrt,
  runCampaignSetup,
  isSetupComplete,
  getExistingSourceVideos,
} from '@/tools/campaign-processor'
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

    const transcript = loadTranscript(sourceVideo, campaignId)
    const srtPath = loadTranscriptSrt(sourceVideo, campaignId)

    const shortDuration = parseFloat(cfg.shortDuration || '45')
    const hookDuration = parseFloat(cfg.hookDuration || '3.5')

    update('rendering', 'Building Story Re-Cut plan (Cold-Open Hook + Punch Zoom)...')
    const cutmap = buildStoryRecutMap(videoDuration, transcript, srtPath, {
      clipCount: 1,
      startIndex: 1,
      targetDuration: shortDuration,
      hookDuration: hookDuration,
      campaignName: campaign.name,
    })

    // Generate metadata for the test clip
    update('rendering', 'Generating title & descriptions with AI...')
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
