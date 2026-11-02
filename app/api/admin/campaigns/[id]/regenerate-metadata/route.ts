import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/db'
import { getClipsDir } from '@/tools/campaign-processor'
import { generateBatchMetadataFromGuidelines } from '@/tools/ai-clipper'
import * as fs from 'fs'
import * as path from 'path'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * POST /api/admin/campaigns/[id]/regenerate-metadata
 * Regenerates title, description, onScreenText for all clip meta.json files
 * in the campaign using the campaign's AI guidelines.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireAdmin()

    const campaignId = params.id

    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } })
    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    const cfg = (campaign.config as Record<string, any>) || {}

    const clipsDir = getClipsDir(campaignId)
    if (!fs.existsSync(clipsDir)) {
      return NextResponse.json({ error: 'No clips directory found for this campaign' }, { status: 404 })
    }

    // Find all meta.json files
    const allFiles = fs.readdirSync(clipsDir)
    const metaFiles = allFiles.filter((f) => f.endsWith('.meta.json'))

    if (metaFiles.length === 0) {
      return NextResponse.json({ error: 'No .meta.json files found in clips directory' }, { status: 404 })
    }

    const metaConfig = {
      titlesGuide: cfg.titlesGuide || '',
      descriptionsGuide: cfg.descriptionsGuide || '',
      onScreenGuide: cfg.onScreenAiGuide || cfg.onScreenGuide || '',
      ftcDisclosure: cfg.ftcDisclosure || '',
      predefinedDescription: cfg.predefinedDescription || '',
      useOnlyPredefinedDescription: cfg.useOnlyPredefinedDescription || false,
      linksInDescription: cfg.linksInDescription || '',
      maxTitleChars: cfg.maxTitleCharacters ? parseInt(cfg.maxTitleCharacters) : 100,
      onScreenMaxChars: cfg.onScreenMaxChars ? parseInt(cfg.onScreenMaxChars) : 80,
      niche: cfg.niche || '',
      campaignName: campaign.name,
    }

    // Generate metadata in batches of 20
    const totalClips = metaFiles.length
    let updated = 0
    let failed = 0

    let metadataPool: any[] = []
    let poolIndex = 0

    const refillPool = async () => {
      const needed = Math.min(20, totalClips - updated)
      if (needed <= 0) return
      try {
        const batch = await generateBatchMetadataFromGuidelines(needed, metaConfig)
        metadataPool = batch
        poolIndex = 0
      } catch (err: any) {
        console.error(`[RegenerateMeta] Batch generation failed: ${err.message}`)
        metadataPool = []
        poolIndex = 0
      }
    }

    await refillPool()

    for (const metaFile of metaFiles) {
      const metaPath = path.join(clipsDir, metaFile)
      try {
        const existing = JSON.parse(fs.readFileSync(metaPath, 'utf8'))

        // Refill pool if needed
        if (poolIndex >= metadataPool.length) {
          await refillPool()
        }

        const meta = metadataPool[poolIndex] || null
        poolIndex++

        if (!meta) {
          failed++
          continue
        }

        // Build proper description
        let desc = meta.description || ''
        if (metaConfig.useOnlyPredefinedDescription && metaConfig.predefinedDescription) {
          desc = metaConfig.predefinedDescription
        } else if (metaConfig.predefinedDescription && !desc.includes(metaConfig.predefinedDescription)) {
          desc = `${metaConfig.predefinedDescription}\n\n${desc}`
        }
        if (metaConfig.linksInDescription && !desc.includes(metaConfig.linksInDescription)) {
          desc = `${desc}\n\n${metaConfig.linksInDescription}`
        }

        const updatedMeta = {
          ...existing,
          title: meta.title || existing.title,
          description: desc || existing.description,
          onScreenText: meta.onScreenText || existing.onScreenText,
          hashtags: Array.isArray(meta.hashtags) ? meta.hashtags : existing.hashtags,
          metaRegeneratedAt: new Date().toISOString(),
        }

        fs.writeFileSync(metaPath, JSON.stringify(updatedMeta, null, 2), 'utf8')
        updated++
      } catch (err: any) {
        console.warn(`[RegenerateMeta] Failed to update ${metaFile}: ${err.message}`)
        failed++
      }
    }

    return NextResponse.json({
      success: true,
      message: `Metadata regenerated! ${updated} clips updated, ${failed} failed.`,
      total: totalClips,
      updated,
      failed,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to regenerate metadata' }, { status: 500 })
  }
}
