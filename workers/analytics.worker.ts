/**
 * Analytics Worker — Auto-Refreshes Every 6 Hours
 *
 * Periodically fetches latest 10 videos per user channel from YouTube Data API v3.
 * Automatically updates live views, likes, and comments in the VideoAnalytic table.
 * Automatically promotes videos crossing minimum views with verified Whop submissions to Pending Tasks.
 */
import { Worker } from 'bullmq'
import { redis } from '../lib/redis'
import { runAllUsersAnalyticsSync, syncUserYouTubeAnalytics } from '../lib/youtube-analytics'

const SIX_HOURS_MS = 6 * 60 * 60 * 1000

console.log('📊 [Analytics Worker] Started — scheduled for automatic 6-hour refresh cycles.')

let isSyncRunning = false

async function triggerSyncSafely(source = 'timer') {
  if (isSyncRunning) {
    console.log(`📊 [Analytics Worker] Sync already in progress, skipping trigger from ${source}.`)
    return
  }
  isSyncRunning = true
  try {
    console.log(`📊 [Analytics Worker] [${new Date().toISOString()}] Triggered sync from: ${source}`)
    await runAllUsersAnalyticsSync()
  } catch (err: any) {
    console.error('📊 [Analytics Worker] Error during sync:', err)
  } finally {
    isSyncRunning = false
    const nextRun = new Date(Date.now() + SIX_HOURS_MS).toLocaleString()
    console.log(`📊 [Analytics Worker] Next auto-refresh scheduled in 6 hours (at ${nextRun}).`)
  }
}

// 1. Initial sync 15 seconds after worker boots up so DB & Redis connections settle
setTimeout(() => {
  console.log('📊 [Analytics Worker] Running initial analytics sync on worker startup...')
  triggerSyncSafely('worker-startup')
}, 15000)

// 2. Exact 6-hour recurring interval timer
setInterval(() => {
  console.log('📊 [Analytics Worker] 6-hour interval reached. Triggering automatic refresh...')
  triggerSyncSafely('6h-interval')
}, SIX_HOURS_MS)

// 3. Also consume on-demand jobs from BullMQ 'analytics' queue (manual triggers from UI)
const worker = new Worker(
  'analytics',
  async (job) => {
    console.log(`📊 [Analytics Worker] Received BullMQ job ${job.id}:`, job.data)
    if (job.data?.userId) {
      const res = await syncUserYouTubeAnalytics(job.data.userId)
      console.log(`📊 [Analytics Worker] Synced user ${job.data.userId}: ${res.totalUpdatedVideos} videos updated, ${res.promotedCount} promoted.`)
    } else {
      await triggerSyncSafely(`bullmq-job-${job.id}`)
    }
  },
  { connection: redis, concurrency: 1 }
)

worker.on('failed', (job, err) => {
  console.error(`📊 [Analytics Worker] Job ${job?.id} failed:`, err.message)
})

worker.on('completed', (job) => {
  console.log(`📊 [Analytics Worker] Job ${job.id} completed ✅`)
})
