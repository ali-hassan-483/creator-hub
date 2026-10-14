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
  getExistingSourceVideos,
} from '@/tools/campaign-processor'

export const dynamic = 'force-dynamic'

// In-memory progress tracker for active setups
const activeSetups = new Map<string, {
  status: 'downloading' | 'completed' | 'error'
  progress: string
  startedAt: number
  error?: string
}>()

export function getSetupTracker() {
  return activeSetups
}

/**
 * GET /api/admin/campaigns/setup-status?campaignId=xxx
 * Returns the real-time setup/download status for a campaign.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin()

    const { searchParams } = new URL(req.url)
    const campaignId = searchParams.get('campaignId')

    // If no campaignId, return all active setups + all campaign statuses
    if (!campaignId) {
      const campaigns = await prisma.campaign.findMany({
        select: { id: true, name: true, config: true },
        orderBy: { createdAt: 'desc' },
      })

      const statuses = campaigns.map((c) => {
        const cfg = (c.config || {}) as Record<string, any>
        const sourceUrls = cfg.sourceVideoUrls || cfg.driveYoutubeUrls || ''
        const hasSourceUrls = !!sourceUrls.trim()
        const setupDone = isSetupComplete(c.id)
        const active = activeSetups.get(c.id)
        const sourcesDir = getSourcesDir(c.id)
        const sourceCount = fs.existsSync(sourcesDir)
          ? fs.readdirSync(sourcesDir).filter(f => !f.startsWith('.')).length
          : 0

        let status: string
        if (active && active.status === 'downloading') {
          status = 'downloading'
        } else if (active && active.status === 'error') {
          status = 'error'
        } else if (setupDone) {
          status = 'ready'
        } else if (!hasSourceUrls && sourceCount === 0) {
          status = 'no_sources'
        } else {
          status = 'pending'
        }

        return {
          campaignId: c.id,
          name: c.name,
          status,
          sourceCount,
          setupComplete: setupDone,
          progress: active?.progress || null,
          error: active?.error || null,
          startedAt: active?.startedAt || null,
        }
      })

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
    const assetsDir = getAssetsDir(campaignId)
    const clipsDir = getClipsDir(campaignId)

    const sourceFiles = fs.existsSync(sourcesDir)
      ? fs.readdirSync(sourcesDir).filter(f => !f.startsWith('.'))
      : []
    const assetFiles = fs.existsSync(assetsDir)
      ? fs.readdirSync(assetsDir).filter(f => !f.startsWith('.'))
      : []
    const clipFiles = fs.existsSync(clipsDir)
      ? fs.readdirSync(clipsDir).filter(f => f.endsWith('.mp4') && f.startsWith('final_'))
      : []

    let status: string
    if (active && active.status === 'downloading') {
      status = 'downloading'
    } else if (active && active.status === 'error') {
      status = 'error'
    } else if (setupDone) {
      status = 'ready'
    } else if (!hasSourceUrls && sourceFiles.length === 0) {
      status = 'no_sources'
    } else {
      status = 'pending'
    }

    return NextResponse.json({
      campaignId,
      name: campaign.name,
      status,
      setupComplete: setupDone,
      sourceFiles: sourceFiles.slice(0, 50),
      sourceCount: sourceFiles.length,
      assetCount: assetFiles.length,
      clipCount: clipFiles.length,
      progress: active?.progress || null,
      error: active?.error || null,
      startedAt: active?.startedAt || null,
      elapsedMs: active?.startedAt ? Date.now() - active.startedAt : null,
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

    const { campaignId } = await req.json()
    if (!campaignId) {
      return NextResponse.json({ error: 'campaignId is required' }, { status: 400 })
    }

    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
    })

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    // Check if already running
    const existing = activeSetups.get(campaignId)
    if (existing && existing.status === 'downloading') {
      return NextResponse.json({
        message: 'Setup already in progress',
        status: 'downloading',
        progress: existing.progress,
      })
    }

    // Check if already done
    if (isSetupComplete(campaignId)) {
      return NextResponse.json({
        message: 'Setup already completed',
        status: 'ready',
      })
    }

    const cfg = (campaign.config || {}) as Record<string, any>

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
