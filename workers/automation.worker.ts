/**
 * Automation Worker — Full Pipeline
 * 
 * Consumes BullMQ jobs from 'automation' queue.
 * Routes each job through the 7 automation tools based on campaign config.
 * 
 * Job Flow:
 *   1. Load automation + campaign + channel from DB
 *   2. Download videos (YouTube or Drive)
 *   3. Slice clips (Multi-Cut / Continuous / Smart AI)
 *   4. Edit each clip (FFMPEG: background, banners, logo, volume)
 *   5. Generate subtitles (Whisper/Gemini)
 *   6. Generate metadata (Gemini: title, description, on-screen text)
 *   7. Submit to Whop
 *   8. Discord notifications throughout
 */

import { Worker, Job } from 'bullmq'
import { redis } from '../lib/redis'
import { prisma } from '../lib/db'
import * as path from 'path'
import * as fs from 'fs'

// ─── Tool Imports ──────────────────────────────────────────────────────────────
import { downloadYouTubeVideo, downloadVideoURLs } from '../tools/youtube-downloader'
import { downloadDriveUrls, downloadLogoOverlay } from '../tools/drive-downloader'
import {
  editVideoClip,
  getVideoDuration,
  getVideoInfo,
  generateMultiCutSlices,
  generateContinuousSlices,
  concatVideos,
  SliceJob,
} from '../tools/video-editor'
import {
  addSubtitlesToVideo,
  transcribeVideo,
} from '../tools/subtitle-generator'
import {
  findViralClips,
  generateFullMetadata,
  generateBatchMetadataFromGuidelines,
  ShortMetadata,
  AiMetadataConfig,
} from '../tools/ai-clipper'
import {
  submitToWhop,
  batchSubmitToWhop,
  BatchSubmitJob,
} from '../tools/whop-submitter'
import {
  notifyAutomationStarted,
  notifyAutomationCompleted,
  notifyAutomationFailed,
  checkViewThresholdAndNotify,
} from '../tools/discord-notifier'

// ─── Constants ────────────────────────────────────────────────────────────────

const WORK_BASE_DIR = process.env.WORK_DIR || path.join(process.cwd(), 'tmp', 'automation')

console.log('🤖 [Automation Worker] Started — waiting for automation tasks...')

// ─── Main Worker ──────────────────────────────────────────────────────────────

const worker = new Worker(
  'automation',
  async (job: Job) => {
    const { automationId } = job.data
    const workDir = path.join(WORK_BASE_DIR, automationId)
    fs.mkdirSync(workDir, { recursive: true })

    console.log(`🤖 [Worker] Starting automation: ${automationId}`)

    // ── 1. Load automation record ───────────────────────────────────────────
    const automation = await prisma.automation.update({
      where: { id: automationId },
      data: { status: 'running', startedAt: new Date() },
      include: {
        campaign: true,
        channels: true,
      },
    })

    // Load campaign from the relation or campaignId
    const campaign = automation.campaign
      ?? (automation.campaignId
          ? await prisma.campaign.findUnique({ where: { id: automation.campaignId } })
          : null)

    if (!campaign) throw new Error('Campaign not found for automation')

    const cfg = (campaign.config || {}) as Record<string, any>
    const discordWebhook = process.env.DISCORD_WEBHOOK_URL || cfg.discordWebhookUrl || ''
    const campaignName = campaign.name || 'Unknown Campaign'

    // Discord: job started
    await notifyAutomationStarted(discordWebhook, campaignName, automationId)

    try {
      // ── 1b. Verify Required YouTube Cookies & Whop Credentials ─────────────
      // Agar kisi channel email ki YouTube ya Whop credential missing ho to uploading start nahi hogi!
      const automationChannels = await prisma.automationChannel.findMany({
        where: { automationId },
        include: { channel: true },
      })

      const targetChannels = automationChannels.map(ac => ac.channel).filter(Boolean)

      if (targetChannels.length > 0) {
        const userCreds = await prisma.credential.findMany({
          where: { userId: automation.userId, status: 'active' },
          select: { credentialType: true, email: true },
        })

        const missingYt: string[] = []
        const missingWhop: string[] = []

        for (const ch of targetChannels) {
          if (ch.channelEmail) {
            const hasYt = userCreds.some(
              c => c.credentialType === 'youtube_cookies' && c.email?.toLowerCase() === ch.channelEmail!.toLowerCase()
            )
            if (!hasYt && !missingYt.includes(ch.channelEmail)) missingYt.push(ch.channelEmail)
          }

          if (ch.whopEmail) {
            const hasWhop = userCreds.some(
              c => c.credentialType === 'whop' && c.email?.toLowerCase() === ch.whopEmail!.toLowerCase()
            )
            if (!hasWhop && !missingWhop.includes(ch.whopEmail)) missingWhop.push(ch.whopEmail)
          }
        }

        if (missingYt.length > 0 || missingWhop.length > 0) {
          const errMsg = `Uploading Blocked: Missing credentials for required accounts! Missing YouTube Cookies: [${missingYt.join(', ') || 'None'}], Missing Whop Credentials: [${missingWhop.join(', ') || 'None'}]. Please configure them in Credentials tab.`
          console.error(`[Worker] ❌ ${errMsg}`)
          throw new Error(errMsg)
        }
      }
      // ── 2. Resolve metadata config ────────────────────────────────────────
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
        niche: cfg.niche ?? campaign.name,
        campaignName,
      }

      // ── 3. Download source videos ─────────────────────────────────────────
      const downloadDir = path.join(workDir, 'downloads')
      fs.mkdirSync(downloadDir, { recursive: true })

      const sourceUrls: string = cfg.driveYoutubeUrls || ''
      let downloadedVideoPaths: string[] = []

      if (sourceUrls) {
        // YouTube URLs
        const ytResults = await downloadVideoURLs(sourceUrls, downloadDir)
        ytResults.filter(r => r.success && r.filePath).forEach(r => downloadedVideoPaths.push(r.filePath!))

        // Drive URLs
        const driveResults = await downloadDriveUrls(sourceUrls, downloadDir, 'source')
        driveResults.filter(r => r.success && r.filePath).forEach(r => downloadedVideoPaths.push(r.filePath!))
      }

      if (downloadedVideoPaths.length === 0) {
        throw new Error('No source videos downloaded. Check Drive/YouTube URLs in campaign config.')
      }

      console.log(`[Worker] Downloaded ${downloadedVideoPaths.length} source video(s)`)

      // ── 4. Download logo overlay ──────────────────────────────────────────
      const logoDir = path.join(workDir, 'assets')
      fs.mkdirSync(logoDir, { recursive: true })
      const logoPath = await downloadLogoOverlay(cfg.logoOverlayUrl || '', logoDir)

      // ── 5. Download hooks and CTAs ────────────────────────────────────────
      let hookPaths: string[] = []
      let ctaPaths: string[] = []

      if (cfg.hookUrls) {
        const hookResults = await downloadDriveUrls(cfg.hookUrls, path.join(workDir, 'hooks'), 'hook')
        hookPaths = hookResults.filter(r => r.success && r.filePath).map(r => r.filePath!)
      }
      if (cfg.ctaUrls) {
        const ctaResults = await downloadDriveUrls(cfg.ctaUrls, path.join(workDir, 'ctas'), 'cta')
        ctaPaths = ctaResults.filter(r => r.success && r.filePath).map(r => r.filePath!)
      }

      // ── 6. Parse campaign clip settings ───────────────────────────────────
      const clippingStrategies: string[] = cfg.clippingStrategies || ['multi_cut']
      const shortDuration = parseFloat(cfg.shortDuration || '45')
      const startOffset = parseFloat(cfg.startOffset || '0')
      const volumeMultiplier = parseFloat(cfg.volumeMultiplier || '1.0')
      const dailyPostLimit = parseInt(cfg.dailyPostLimit || '5', 10)
      const minViews = parseInt(cfg.minViews || '1000', 10)

      const backgroundStyles: string[] = cfg.backgroundStyles || ['split_mirror_blur']
      const cornerStyles: string[] = cfg.foregroundCornerStyles || ['sharp']

      // Parse banners
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

      // Parse subtitle config
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

      // ── 7. Generate clips ─────────────────────────────────────────────────
      const allClipJobs: BatchSubmitJob[] = []
      const clipsDir = path.join(workDir, 'clips')
      fs.mkdirSync(clipsDir, { recursive: true })

      const isSmartAi = clippingStrategies.includes('smart_ai')
      let workerBatchPool: ShortMetadata[] = []
      let workerBatchIdx = 0

      // Pre-fetch 50 metadata batch directly from guidelines if Multi-cut or Continuous
      if (!isSmartAi) {
        console.log(`[Worker] Pre-fetching 50 metadata batch from guidelines (no script sent to Gemini)...`)
        try {
          workerBatchPool = await generateBatchMetadataFromGuidelines(50, metaConfig)
        } catch (e: any) {
          console.warn(`[Worker] Batch metadata fallback: ${e.message}`)
        }
      }

      for (const sourceVideo of downloadedVideoPaths) {
        const videoInfo = await getVideoInfo(sourceVideo)
        const videoDuration = videoInfo.duration

        let slices: SliceJob[] = []

        if (clippingStrategies.includes('smart_ai')) {
          // Smart AI: transcribe → Gemini clip extraction
          const transcribeDir = path.join(workDir, 'transcripts', path.basename(sourceVideo))
          const transcript = await transcribeVideo(sourceVideo, transcribeDir)

          if (transcript.length > 0) {
            const aiClips = await findViralClips(transcript, {
              minDuration: shortDuration * 0.8,
              maxDuration: shortDuration * 1.2,
              clipCount: dailyPostLimit,
              niche: cfg.niche,
              audioNotes: cfg.audioNotes,
            })
            slices = aiClips.map((c, i) => ({
              index: i,
              startTime: c.startTime,
              endTime: c.endTime,
            }))
          } else {
            // Fallback to multi-cut if no transcript
            slices = generateMultiCutSlices({
              videoDuration,
              clipCount: dailyPostLimit,
              minDuration: shortDuration * 0.8,
              maxDuration: shortDuration * 1.2,
              startOffset,
            })
          }

        } else if (clippingStrategies.includes('continuous')) {
          slices = generateContinuousSlices({
            videoDuration,
            clipCount: dailyPostLimit,
            minDuration: shortDuration * 0.8,
            maxDuration: shortDuration * 1.2,
            startOffset,
          })
        } else {
          // Default: multi-cut
          slices = generateMultiCutSlices({
            videoDuration,
            clipCount: dailyPostLimit,
            minDuration: shortDuration * 0.8,
            maxDuration: shortDuration * 1.2,
            startOffset,
          })
        }

        console.log(`[Worker] Generated ${slices.length} slices for ${path.basename(sourceVideo)}`)

        // ── 8. Edit each clip ───────────────────────────────────────────────
        for (const slice of slices) {
          const clipOutputPath = path.join(clipsDir, `clip_${slice.index}_raw.mp4`)
          
          const hookPath = hookPaths.length > 0 ? hookPaths[slice.index % hookPaths.length] : undefined
          const ctaPath = ctaPaths.length > 0 ? ctaPaths[slice.index % ctaPaths.length] : undefined

          await job.updateProgress(Math.round((slice.index / slices.length) * 60))

          const editResult = await editVideoClip({
            inputPath: sourceVideo,
            outputPath: clipOutputPath,
            startTime: slice.startTime,
            endTime: slice.endTime,
            hookPath,
            ctaPath,
            backgroundStyle: backgroundStyles,
            cornerStyles,
            volumeMultiplier,
            logoPath: logoPath || undefined,
            overlayPosition: cfg.overlayPosition || 'top_right',
            overlayWidth: parseFloat(cfg.overlayWidth || '15'),
            banners,
          })

          if (!editResult.success) {
            console.error(`[Worker] Clip ${slice.index} edit failed: ${editResult.error}`)
            continue
          }

          // ── 9. Add subtitles ──────────────────────────────────────────────
          let finalClipPath = clipOutputPath
          if (subtitleEnabled) {
            const subtitledPath = path.join(clipsDir, `clip_${slice.index}_final.mp4`)
            const subWorkDir = path.join(workDir, 'subs', `clip_${slice.index}`)
            const subSuccess = await addSubtitlesToVideo(
              clipOutputPath,
              subtitledPath,
              subtitleConfig,
              subWorkDir
            )
            if (subSuccess) finalClipPath = subtitledPath
          }

          // ── 10. Generate metadata (AI) ────────────────────────────────────
          let metadata: ShortMetadata
          if (isSmartAi) {
            const clipTranscriptText = `Video clip from campaign "${campaignName}" in ${cfg.niche || 'general'} niche`
            metadata = await generateFullMetadata(clipTranscriptText, metaConfig)
          } else {
            metadata = workerBatchPool[workerBatchIdx] || {
              title: `${campaignName} #${slice.index + 1}`,
              description: cfg.predefinedDescription || '',
              onScreenText: 'Watch this!',
              hashtags: ['shorts', 'viral'],
            }
            workerBatchIdx = (workerBatchIdx + 1) % (workerBatchPool.length || 1)
          }

          console.log(`[Worker] Clip ${slice.index} metadata: "${metadata.title}"`)

          allClipJobs.push({
            clipPath: finalClipPath,
            title: metadata.title,
            description: metadata.description,
          })
        }
      }

      await job.updateProgress(80)

      // ── 11. Submit to Whop ──────────────────────────────────────────────────
      const submissionUrl = cfg.channelSubmissionLink || ''
      let submittedCount = 0

      if (submissionUrl && allClipJobs.length > 0) {
        const whopSessionCookies = process.env.WHOP_SESSION_COOKIES
        
        const submitResults = await batchSubmitToWhop(
          allClipJobs,
          submissionUrl,
          dailyPostLimit,
          whopSessionCookies,
          path.join(workDir, 'whop-screenshots')
        )

        submittedCount = submitResults.filter(r => r.success).length
        console.log(`[Worker] Submitted ${submittedCount}/${allClipJobs.length} clips to Whop`)
      } else {
        console.log(`[Worker] No submission URL or no clips — skipping Whop submission`)
        submittedCount = allClipJobs.length  // treat as done for now
      }

      await job.updateProgress(100)

      // ── 12. Mark complete ───────────────────────────────────────────────────
      await prisma.automation.update({
        where: { id: automationId },
        data: {
          status: 'completed',
          completedAt: new Date(),
          options: {
            clipsProduced: allClipJobs.length,
            submitted: submittedCount,
            completedAt: new Date().toISOString(),
          },
        },
      })

      await notifyAutomationCompleted(discordWebhook, campaignName, automationId, submittedCount)
      console.log(`🤖 [Worker] ✅ Automation ${automationId} complete — ${submittedCount} clips submitted`)

    } catch (error: any) {
      const errMsg = error?.message || 'Unknown error'
      console.error(`🤖 [Worker] ❌ Automation ${automationId} failed: ${errMsg}`)

      await prisma.automation.update({
        where: { id: automationId },
        data: { status: 'failed', errorMessage: errMsg },
      }).catch(() => {})

      await notifyAutomationFailed(discordWebhook, campaignName, automationId, errMsg)
      throw error
    } finally {
      // Cleanup temp work dir (optional — can be disabled for debugging)
      if (process.env.CLEANUP_WORK_DIR === 'true') {
        fs.rmSync(workDir, { recursive: true, force: true })
      }
    }
  },
  { connection: redis, concurrency: 2 }
)

// ─── Worker Events ────────────────────────────────────────────────────────────

worker.on('progress', (job, progress) => {
  console.log(`🤖 [Worker] Job ${job.id} progress: ${progress}%`)
})

worker.on('failed', async (job, err) => {
  console.error(`🤖 [Worker] Job ${job?.id} failed:`, err.message)
  if (job?.data?.automationId) {
    await prisma.automation.update({
      where: { id: job.data.automationId },
      data: { status: 'failed', errorMessage: err.message },
    }).catch(() => {})
  }
})

worker.on('completed', (job) => {
  console.log(`🤖 [Worker] Job ${job.id} completed ✅`)
})
