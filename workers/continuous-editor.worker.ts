/**
 * Continuous Editor Background Worker
 * 
 * Yeh worker VPS backend par har waqt continuous check karta hai:
 * - Saari active campaigns ko query karta hai
 * - Har campaign ke paas check karta hai ke kya 300 clips pool me available hain?
 * - Agar kisi campaign me < 300 clips hon (e.g. users ne upload kar di ya naya campaign bana):
 *     -> Automatically continuous-edit-engine trigger ho jata hai aur 300 tak clips banata hai
 * - Har 5 minute baad sleep & recheck loop.
 */

import { prisma } from '../lib/db'
import { maintainCampaignClipPool, TARGET_EDITED_CLIPS } from '../tools/continuous-edit-engine'
import { countEditedClips } from '../tools/campaign-processor'

const CHECK_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

async function runContinuousEditorLoop() {
  console.log('🤖 [Continuous Editor Worker] Started — monitoring campaign clip pools...')

  while (true) {
    try {
      // Find all active campaigns
      const activeCampaigns = await prisma.campaign.findMany({
        where: { status: 'active' },
      })

      console.log(`[Continuous Editor] Found ${activeCampaigns.length} active campaigns.`)

      for (const campaign of activeCampaigns) {
        const count = countEditedClips(campaign.id)
        const cfg = (campaign.config || {}) as Record<string, any>

        console.log(`[Continuous Editor] Campaign "${campaign.name}" (${campaign.id}): ${count}/${TARGET_EDITED_CLIPS} clips ready.`)

        if (count < TARGET_EDITED_CLIPS) {
          console.log(`⚡ Pool is below target (${count} < ${TARGET_EDITED_CLIPS}). Generating clips for "${campaign.name}"...`)
          try {
            await maintainCampaignClipPool(campaign.id, {
              ...cfg,
              campaignName: campaign.name,
              niche: cfg.niche || 'general',
            })
          } catch (err: any) {
            console.error(`❌ Error rendering clips for campaign ${campaign.id}:`, err.message)
          }
        }
      }
    } catch (loopError: any) {
      console.error('[Continuous Editor] Loop error:', loopError.message)
    }

    // Wait before next check round
    await new Promise((resolve) => setTimeout(resolve, CHECK_INTERVAL_MS))
  }
}

if (require.main === module) {
  runContinuousEditorLoop().catch((err) => {
    console.error('Fatal Continuous Editor Worker Error:', err)
    process.exit(1)
  })
}
