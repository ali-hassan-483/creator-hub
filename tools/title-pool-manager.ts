/**
 * Title & Metadata Pool Manager
 * 
 * Ensures campaigns (especially "Ready to Post" campaigns) always maintain
 * an active pool of at least 100 unique, AI-generated titles & descriptions.
 * Prevents duplicate titles across channels and automations.
 */

import * as fs from 'fs'
import * as path from 'path'
import { getCampaignDir, getSourcesDir, getClipsDir } from './campaign-processor'
import { generateBatchMetadataFromGuidelines, AiMetadataConfig } from './ai-clipper'

export interface PooledTitle {
  id: string
  title: string
  description: string
  onScreenText?: string
  hashtags?: string[]
  used: boolean
  usedAt?: string | null
  usedByChannel?: string | null
}

const POOL_TARGET_SIZE = 100

function getPoolFilePath(campaignId: string): string {
  return path.join(getCampaignDir(campaignId), 'titles_pool.json')
}

export function loadTitlePool(campaignId: string): PooledTitle[] {
  const file = getPoolFilePath(campaignId)
  if (!fs.existsSync(file)) return []
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    return Array.isArray(data) ? data : []
  } catch (e) {
    console.error(`[TitlePool] Failed to parse pool for ${campaignId}:`, e)
    return []
  }
}

export function saveTitlePool(campaignId: string, pool: PooledTitle[]): void {
  const file = getPoolFilePath(campaignId)
  const dir = path.dirname(file)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(file, JSON.stringify(pool, null, 2), 'utf8')
}

export function getTitlePoolStats(campaignId: string): { total: number; unused: number; used: number } {
  const pool = loadTitlePool(campaignId)
  const unused = pool.filter((t) => !t.used).length
  return {
    total: pool.length,
    unused,
    used: pool.length - unused,
  }
}

/**
 * Ensures at least `targetCount` (default: 100) unused titles exist in the pool.
 * If below target, generates new batches with Gemini AI using campaign guidelines.
 */
export async function ensureTitlesPool(
  campaignId: string,
  cfg: Record<string, any>,
  targetCount: number = POOL_TARGET_SIZE
): Promise<PooledTitle[]> {
  const pool = loadTitlePool(campaignId)
  const unused = pool.filter((t) => !t.used)

  if (unused.length >= targetCount) {
    return pool
  }

  const needed = targetCount - unused.length
  console.log(`[TitlePool:${campaignId}] Unused titles (${unused.length}/${targetCount}) below target. Generating ${needed} fresh titles with AI...`)

  const metaConfig: AiMetadataConfig = {
    titlesGuide: cfg.titlesAiGuide || cfg.titlesGuide || '',
    descriptionsGuide: cfg.descriptionsAiGuide || cfg.descriptionsGuide || '',
    onScreenGuide: cfg.onScreenTextAiGuide || cfg.onScreenAiGuide || cfg.onScreenGuide || '',
    ftcDisclosure: cfg.ftcDisclosure || '',
    predefinedDescription: cfg.predefinedDescription || '',
    useOnlyPredefinedDescription: cfg.useOnlyPredefinedDescription || cfg.useOnlyPredefinedDesc || false,
    linksInDescription: cfg.linksInDescription || '',
    maxTitleChars: cfg.maxTitleCharacters ? parseInt(cfg.maxTitleCharacters) : 100,
    onScreenMaxChars: cfg.onScreenMaxCharacters ? parseInt(cfg.onScreenMaxCharacters) : 80,
    niche: cfg.niche || 'General',
    campaignName: cfg.campaignName || cfg.name || 'Campaign',
  }

  // Collect all existing titles to avoid generating duplicates
  const existingTitles = pool.map((t) => t.title)

  try {
    const newItems = await generateBatchMetadataFromGuidelines(needed, metaConfig, existingTitles)

    for (const item of newItems) {
      if (!item.title) continue
      pool.push({
        id: `title_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        title: item.title,
        description: item.description || '',
        onScreenText: item.onScreenText || '',
        hashtags: item.hashtags && item.hashtags.length > 0 ? item.hashtags : ['shorts', 'viral'],
        used: false,
        usedAt: null,
        usedByChannel: null,
      })
    }

    saveTitlePool(campaignId, pool)
    const newUnusedCount = pool.filter((t) => !t.used).length
    console.log(`[TitlePool:${campaignId}] ✅ Generated titles successfully. Total pool: ${pool.length}, Unused: ${newUnusedCount}`)
  } catch (err: any) {
    console.error(`[TitlePool:${campaignId}] ❌ Error generating batch titles:`, err.message)
  }

  return pool
}

/**
 * Gets the next unused title from the pool and marks it as used.
 */
export function getNextTitleFromPool(campaignId: string, channelIdentifier?: string): PooledTitle | null {
  const pool = loadTitlePool(campaignId)
  const nextItem = pool.find((t) => !t.used)
  if (!nextItem) return null

  nextItem.used = true
  nextItem.usedAt = new Date().toISOString()
  if (channelIdentifier) nextItem.usedByChannel = channelIdentifier

  saveTitlePool(campaignId, pool)
  return nextItem
}

/**
 * Synchronizes a "Ready to Post" campaign:
 * 1. Copies any source videos from sourcesDir directly to clipsDir (no editing/transcoding needed!).
 * 2. Ensures the pool of 100 AI titles is maintained.
 * 3. Pre-attaches .meta.json to any clips currently missing metadata.
 */
export async function syncReadyToPostCampaign(
  campaignId: string,
  cfg: Record<string, any>
): Promise<{ clipsReady: number; titlesUnused: number }> {
  const sourcesDir = getSourcesDir(campaignId)
  const clipsDir = getClipsDir(campaignId)

  if (!fs.existsSync(clipsDir)) {
    fs.mkdirSync(clipsDir, { recursive: true })
  }

  // 1. Mirror any videos from sourcesDir to clipsDir
  if (fs.existsSync(sourcesDir)) {
    const sourceVideos = fs
      .readdirSync(sourcesDir)
      .filter((f) => /\.(mp4|mov|mkv|webm)$/i.test(f) && !f.startsWith('.'))

    for (const file of sourceVideos) {
      const srcPath = path.join(sourcesDir, file)
      const destPath = path.join(clipsDir, file)
      if (!fs.existsSync(destPath)) {
        try {
          fs.copyFileSync(srcPath, destPath)
          console.log(`[ReadyToPost:${campaignId}] Copied ready clip to pool: ${file}`)
        } catch (e) {
          console.warn(`[ReadyToPost:${campaignId}] Could not copy ${file}:`, e)
        }
      }
    }
  }

  // 2. Ensure 100 titles in pool
  await ensureTitlesPool(campaignId, cfg, POOL_TARGET_SIZE)

  // 3. For any clip in clipsDir that doesn't have .meta.json, attach one from pool
  const allClips = fs
    .readdirSync(clipsDir)
    .filter((f) => /\.(mp4|mov|mkv|webm)$/i.test(f) && !f.startsWith('.'))

  for (const clipFile of allClips) {
    const metaFile = clipFile.replace(/\.[^.]+$/, '.meta.json')
    const metaPath = path.join(clipsDir, metaFile)

    if (!fs.existsSync(metaPath)) {
      const pooled = getNextTitleFromPool(campaignId, 'auto_sync')
      if (pooled) {
        fs.writeFileSync(
          metaPath,
          JSON.stringify({
            clipId: clipFile.replace(/\.[^.]+$/, ''),
            videoPath: path.join(clipsDir, clipFile),
            title: pooled.title,
            description: pooled.description,
            onScreenText: pooled.onScreenText || '',
            hashtags: pooled.hashtags || ['shorts', 'viral'],
            createdAt: new Date().toISOString(),
            readyToPost: true,
          }, null, 2),
          'utf8'
        )
      }
    }
  }

  const stats = getTitlePoolStats(campaignId)
  return {
    clipsReady: allClips.length,
    titlesUnused: stats.unused,
  }
}
