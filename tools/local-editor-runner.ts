/**
 * Local Standalone Video Editing Agent (Laptop Runner)
 * 
 * Yeh script aap apne local laptop par run kar sakte hain.
 * Yeh aapke local FFMPEG aur CPU/GPU ko use karke video edit karega.
 * 
 * Features:
 * - Local folders se source video uthata hai
 * - 300 clips ki pool banata hai
 * - Multi-cut / Continuous / Smart AI cuts
 * - Banners, background styling, logos, karaoke subtitles
 * - Generated clips ko VPS par direct upload karne ka command bhi deta hai
 * 
 * Usage:
 *   npx ts-node tools/local-editor-runner.ts --campaign="Campaign Name"
 *   ya
 *   npm run local-edit
 */

import * as fs from 'fs'
import * as path from 'path'
import * as readline from 'readline'
import { maintainCampaignClipPool } from './continuous-edit-engine'
import { countEditedClips, getCampaignDir, getClipsDir } from './campaign-processor'

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
})

const question = (query: string): Promise<string> =>
  new Promise((resolve) => rl.question(query, resolve))

async function runLocalEditor() {
  console.log('====================================================')
  console.log('🎬 CREATOR HUB — LOCALSTANDALONE VIDEO EDITING AGENT')
  console.log('====================================================')
  console.log('Yeh script aapke laptop ke FFMPEG se 300 clips render karegi.')
  console.log('')

  const campaignId = (await question('Enter Campaign ID ya Folder Name (default: local_campaign_1): ')).trim() || 'local_campaign_1'
  const sourceVideoDir = (await question('Apne laptop par source videos ka folder path daalein (leave blank agar already storage mein hai): ')).trim()
  const customNiche = (await question('Niche name (e.g. finance / motivation / gaming): ')).trim() || 'general'
  const customSubtitles = (await question('Subtitles enable karein? (y/n, default: y): ')).trim().toLowerCase() !== 'n'

  console.log('\n⚙️ Initializing local workspace...')

  const campaignDir = getCampaignDir(campaignId)
  const sourcesDir = path.join(campaignDir, 'sources')
  fs.mkdirSync(sourcesDir, { recursive: true })

  // Agar user ne local path diya to files copy karo
  if (sourceVideoDir && fs.existsSync(sourceVideoDir)) {
    const files = fs.readdirSync(sourceVideoDir).filter(f => f.endsWith('.mp4') || f.endsWith('.mov'))
    console.log(`📁 Found ${files.length} videos in ${sourceVideoDir}. Copying to local workspace...`)
    for (const f of files) {
      const src = path.join(sourceVideoDir, f)
      const dest = path.join(sourcesDir, f)
      if (!fs.existsSync(dest)) {
        fs.copyFileSync(src, dest)
        console.log(`  -> Copied: ${f}`)
      }
    }
  }

  const existingClips = countEditedClips(campaignId)
  console.log(`📊 Existing clips ready in pool: ${existingClips}/300`)

  // Default configuration for local rendering
  const localConfig: Record<string, any> = {
    campaignName: campaignId,
    niche: customNiche,
    shortDuration: '45',
    startOffset: '5',
    volumeMultiplier: '1.0',
    clippingStrategies: ['multi_cut'],
    backgroundStyles: ['split_mirror_blur'],
    foregroundCornerStyles: ['sharp'],
    enableSubtitles: customSubtitles ? 'Enabled (Auto-generated)' : 'Disabled',
    subtitleFonts: 'Arial',
    subtitleColors: 'white',
    outlineColors: 'black',
    subtitleWordSize: '60',
    subtitlePlacementHeight: '80',
    maxWordsPerScreen: '4',
    speakingWordHighlight: 'yellow',
    subtitleTextCases: ['UPPERCASE'],
    banners: [
      {
        text: 'Link In Bio!',
        font: 'Arial',
        textColor: 'white',
        positionHeight: '85',
        fontSize: '54',
        background: 'red@0.85',
        styledWordCount: 1,
        styledWordsColor: 'yellow',
        showOnlyInLastSeconds: true,
        lastSecondsDuration: '8',
      },
    ],
  }

  console.log('\n🚀 Starting Continuous Editing Engine locally...')
  console.log('Clips render ho rahi hain: storage/campaigns/' + campaignId + '/clips/\n')

  await maintainCampaignClipPool(campaignId, localConfig, (progress) => {
    console.log(`[${progress.currentClips}/${progress.targetClips}] ${progress.lastMessage}`)
  })

  const finalCount = countEditedClips(campaignId)
  const clipsDir = getClipsDir(campaignId)

  console.log('\n====================================================')
  console.log(`🎉 Finished! Total ${finalCount} clips generated in:`)
  console.log(`📁 ${clipsDir}`)
  console.log('====================================================')
  console.log('\nIn clips ko VPS par upload karne ke liye:')
  console.log('1. Admin Dashboard me Campaign ke "Upload Clips" button se direct drag & drop karein, ya')
  console.log(`2. Dashboard API endpoint par post karein.`)

  rl.close()
}

if (require.main === module) {
  runLocalEditor().catch((err) => {
    console.error('Fatal Local Editor Error:', err)
    process.exit(1)
  })
}
