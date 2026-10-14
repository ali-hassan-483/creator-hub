import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/db'
import * as fs from 'fs'
import * as path from 'path'
import {
  getCampaignDir,
  getSourcesDir,
  getAssetsDir,
  getClipsDir,
  isSetupComplete,
  runCampaignSetup,
  countEditedClips,
} from '@/tools/campaign-processor'
import { maintainCampaignClipPool } from '@/tools/continuous-edit-engine'

export const dynamic = 'force-dynamic'

// In-memory progress tracker for active setups
const activeSetups = new Map<string, {
  status: 'downloading' | 'completed' | 'error'
  progress: string
  startedAt: number
  error?: string
}>()

// In-memory progress tracker for active clip generation
const activeClipGenerations = new Map<string, {
  status: 'generating' | 'completed' | 'error'
  progress: string
  startedAt: number
  error?: string
}>()

export function getSetupTracker() {
  return activeSetups
}

export function getClipGenTracker() {
  return activeClipGenerations
}

/**
 * Trigger background clip generation using maintainCampaignClipPool
 */
export function triggerClipGeneration(campaignId: string, cfg: Record<string, any>) {
  const existing = activeClipGenerations.get(campaignId)
  if (existing && existing.status === 'generating') {
    return false
  }

  activeClipGenerations.set(campaignId, {
    status: 'generating',
    progress: '⚙️ Starting clip generation engine...',
    startedAt: Date.now(),
  })

  maintainCampaignClipPool(campaignId, cfg, (progress) => {
    const entry = activeClipGenerations.get(campaignId)
    if (entry) {
      entry.progress = progress.lastMessage || `⚙️ Rendering clips (${progress.currentClips}/${progress.targetClips})...`
      if (progress.status === 'completed') {
        entry.status = 'completed'
      } else if (progress.status === 'error') {
        entry.status = 'error'
        entry.error = progress.lastMessage
      }
    }
  })
    .then((count) => {
      activeClipGenerations.set(campaignId, {
        status: 'completed',
        progress: `✅ ${count} clips ready in pool!`,
        startedAt: activeClipGenerations.get(campaignId)?.startedAt || Date.now(),
      })
      console.log(`[ClipGen] ✅ Campaign ${campaignId} generated ${count} clips`)
    })
    .catch((err) => {
      activeClipGenerations.set(campaignId, {
        status: 'error',
        progress: `❌ Clip generation error: ${err.message}`,
        startedAt: activeClipGenerations.get(campaignId)?.startedAt || Date.now(),
        error: err.message,
      })
      console.error(`[ClipGen] ❌ Campaign ${campaignId} clip gen failed:`, err.message)
    })

  return true
}

/**
 * Derive clip generation status from active generator or DB automations for a campaign.
 */
async function getClipStatus(campaignId: string, clipCount: number) {
  // Check active in-memory clip generation first
  const activeGen = activeClipGenerations.get(campaignId)
  if (activeGen && activeGen.status === 'generating') {
    return {
      clipStatus: 'generating' as const,
      clipProgress: activeGen.progress || `⚙️ Generating clips... (${clipCount} ready so far)`,
      clipError: null,
    }
  }

  if (activeGen && activeGen.status === 'error' && clipCount === 0) {
    return {
      clipStatus: 'error' as const,
      clipProgress: null,
      clipError: activeGen.error || 'Clip generation failed',
    }
  }

  // Check if any DB automation is currently running/queued for this campaign
  const activeAutomation = await prisma.automation.findFirst({
    where: {
      campaignId,
      status: { in: ['running', 'queued'] },
    },
    select: { status: true, startedAt: true, name: true },
    orderBy: { createdAt: 'desc' },
  })

  if (activeAutomation) {
    return {
      clipStatus: activeAutomation.status === 'running' ? 'generating' : 'queued',
      clipProgress: activeAutomation.status === 'running'
        ? `⚙️ Generating clips... (${clipCount} ready so far)`
        : `⏳ Queued for clip generation`,
      clipError: null,
    }
  }

  // Check most recent automation for errors
  const lastAutomation = await prisma.automation.findFirst({
    where: { campaignId },
    select: { status: true, errorMessage: true, completedAt: true },
    orderBy: { createdAt: 'desc' },
  })

  if (lastAutomation?.status === 'failed' && clipCount === 0) {
    return {
      clipStatus: 'error',
      clipProgress: null,
      clipError: lastAutomation.errorMessage || 'Clip generation failed',
    }
  }

  if (clipCount > 0) {
    return {
      clipStatus: 'ready',
      clipProgress: `✅ ${clipCount} clip(s) ready`,
      clipError: null,
    }
  }

  if (lastAutomation?.status === 'completed') {
    return {
      clipStatus: 'ready',
      clipProgress: '✅ Last run completed (0 new clips)',
      clipError: null,
    }
  }

  return {
    clipStatus: 'pending',
    clipProgress: null,
    clipError: null,
  }
}

/**
 * GET /api/admin/campaigns/setup-status?campaignId=xxx
 * Returns the real-time setup/download AND clip generation status for campaigns.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin()

    const { searchParams } = new URL(req.url)
    const campaignId = searchParams.get('campaignId')

    // If no campaignId, return all campaign statuses
    if (!campaignId) {
      const campaigns = await prisma.campaign.findMany({
        select: { id: true, name: true, config: true },
        orderBy: { createdAt: 'desc' },
      })

      const statuses = await Promise.all(campaigns.map(async (c) => {
        const cfg = (c.config || {}) as Record<string, any>
        const sourceUrls = cfg.sourceVideoUrls || cfg.driveYoutubeUrls || ''
        const hasSourceUrls = !!sourceUrls.trim()
        const setupDone = isSetupComplete(c.id)
        const active = activeSetups.get(c.id)
        const sourcesDir = getSourcesDir(c.id)
        const sourceCount = fs.existsSync(sourcesDir)
          ? fs.readdirSync(sourcesDir).filter(f => !f.startsWith('.')).length
          : 0
        const clipCount = countEditedClips(c.id)

        let sourceStatus: string
        if (active && active.status === 'downloading') {
          sourceStatus = 'downloading'
        } else if (active && active.status === 'error') {
          sourceStatus = 'error'
        } else if (sourceCount > 0) {
          sourceStatus = 'ready'
        } else if (!hasSourceUrls) {
          sourceStatus = 'no_sources'
        } else {
          sourceStatus = 'pending'
        }

        const clipInfo = await getClipStatus(c.id, clipCount)

        return {
          campaignId: c.id,
          name: c.name,
          sourceStatus,
          sourceCount,
          clipCount,
          setupComplete: setupDone,
          progress: active?.progress || null,
          error: active?.error || null,
          startedAt: active?.startedAt || null,
          ...clipInfo,
        }
      }))

      return NextResponse.json({ statuses })
    }

    // Single campaign status
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, name: true, config: true },
    })

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    const cfg = (campaign.config || {}) as Record<string, any>
    const sourceUrls = cfg.sourceVideoUrls || cfg.driveYoutubeUrls || ''
    const hasSourceUrls = !!sourceUrls.trim()
    const setupDone = isSetupComplete(campaignId)
    const active = activeSetups.get(campaignId)

    const sourcesDir = getSourcesDir(campaignId)
    const clipsDir = getClipsDir(campaignId)

    const sourceFiles = fs.existsSync(sourcesDir)
      ? fs.readdirSync(sourcesDir).filter(f => !f.startsWith('.'))
      : []
    const clipCount = countEditedClips(campaignId)

    let sourceStatus: string
    if (active && active.status === 'downloading') {
      sourceStatus = 'downloading'
    } else if (active && active.status === 'error') {
      sourceStatus = 'error'
    } else if (sourceFiles.length > 0) {
      sourceStatus = 'ready'
    } else if (!hasSourceUrls) {
      sourceStatus = 'no_sources'
    } else {
      sourceStatus = 'pending'
    }

    const clipInfo = await getClipStatus(campaignId, clipCount)

    return NextResponse.json({
      campaignId,
      name: campaign.name,
      sourceStatus,
      setupComplete: setupDone,
      sourceFiles: sourceFiles.slice(0, 50),
      sourceCount: sourceFiles.length,
      clipCount,
      progress: active?.progress || null,
      error: active?.error || null,
      startedAt: active?.startedAt || null,
      elapsedMs: active?.startedAt ? Date.now() - active.startedAt : null,
      ...clipInfo,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to get setup status' }, { status: 500 })
  }
}

/**
 * POST /api/admin/campaigns/setup-status
 * Trigger campaign setup (download sources, logos, hooks, transcripts) in background.
 * Body: { campaignId: string }
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin()

    const { campaignId, force, action } = await req.json()
    if (!campaignId) {
      return NextResponse.json({ error: 'campaignId is required' }, { status: 400 })
    }

    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
    })

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    const cfg = (campaign.config || {}) as Record<string, any>

    // ── ACTION: Generate Clips Directly ──────────────────────────────────────
    if (action === 'generate_clips') {
      const sourcesDir = getSourcesDir(campaignId)
      const sourceCount = fs.existsSync(sourcesDir)
        ? fs.readdirSync(sourcesDir).filter(f => !f.startsWith('.')).length
        : 0

      if (sourceCount === 0) {
        return NextResponse.json({
          error: 'No source videos found. Please download source videos first.',
        }, { status: 400 })
      }

      triggerClipGeneration(campaignId, {
        ...cfg,
        campaignName: campaign.name,
        niche: cfg.niche || 'general',
      })

      return NextResponse.json({
        message: 'Clip generation started in background!',
        status: 'generating',
        campaignId,
      })
    }

    // ── ACTION: Reset / Delete Generated Clips ──────────────────────────────
    if (action === 'reset_clips') {
      const clipsDir = getClipsDir(campaignId)
      if (fs.existsSync(clipsDir)) {
        const files = fs.readdirSync(clipsDir)
        for (const file of files) {
          try {
            fs.rmSync(path.join(clipsDir, file), { recursive: true, force: true })
          } catch {}
        }
      }
      activeClipGenerations.delete(campaignId)
      return NextResponse.json({
        message: 'All generated clips deleted successfully!',
        campaignId,
        clipCount: 0,
      })
    }

    // ── ACTION: Setup / Source Download ──────────────────────────────────────
    // Check if already running
    const existing = activeSetups.get(campaignId)
    if (existing && existing.status === 'downloading' && !force) {
      return NextResponse.json({
        message: 'Setup already in progress',
        status: 'downloading',
        progress: existing.progress,
      })
    }

    // Check if already done (unless force re-trigger)
    if (!force && isSetupComplete(campaignId)) {
      return NextResponse.json({
        message: 'Setup already completed',
        status: 'ready',
      })
    }

    // If force retrigger, clear any setup flag
    const flagPath = path.join(process.env.CAMPAIGN_STORAGE_DIR || path.join(process.cwd(), 'storage', 'campaigns'), campaignId, '.setup_complete')
    if (fs.existsSync(flagPath)) {
      try { fs.unlinkSync(flagPath) } catch {}
    }

    // Mark as downloading
    activeSetups.set(campaignId, {
      status: 'downloading',
      progress: '📥 Starting campaign setup...',
      startedAt: Date.now(),
    })

    // Run setup in background (don't await)
    runCampaignSetup(campaignId, {
      ...cfg,
      campaignName: campaign.name,
      niche: cfg.niche || 'general',
    }, (progressMsg) => {
      const entry = activeSetups.get(campaignId)
      if (entry) {
        entry.progress = progressMsg
      }
    })
      .then((result) => {
        activeSetups.set(campaignId, {
          status: 'completed',
          progress: `✅ Setup complete! ${result.sourceVideoPaths.length} sources, ${result.logoPaths.length} logos, ${result.hookPaths.length} hooks downloaded.`,
          startedAt: activeSetups.get(campaignId)?.startedAt || Date.now(),
        })
        console.log(`[CampaignSetup] ✅ ${campaign.name} (${campaignId}) setup complete`)

        // 🚀 Auto-trigger clip generation once sources & transcripts are ready!
        triggerClipGeneration(campaignId, {
          ...cfg,
          campaignName: campaign.name,
          niche: cfg.niche || 'general',
        })
      })
      .catch((err) => {
        activeSetups.set(campaignId, {
          status: 'error',
          progress: `❌ Setup failed: ${err.message}`,
          startedAt: activeSetups.get(campaignId)?.startedAt || Date.now(),
          error: err.message,
        })
        console.error(`[CampaignSetup] ❌ ${campaign.name} (${campaignId}) setup failed:`, err.message)
      })

    return NextResponse.json({
      message: 'Campaign setup started in background!',
      status: 'downloading',
      campaignId,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to start setup' }, { status: 500 })
  }
}
