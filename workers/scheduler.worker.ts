/**
 * Scheduler Worker
 * Periodically triggers scheduled automation tasks based on cron or one-time schedules.
 */
import { Worker } from 'bullmq'
import { redis } from '../lib/redis'

console.log('⏰ [Scheduler Worker] Started — processing scheduled jobs...')

const worker = new Worker(
  'scheduler',
  async (job) => {
    console.log(`⏰ [Scheduler Worker] Triggering scheduled task: ${job.id}`, job.data)
    // Phase 8: Dispatch to automation queue
  },
  { connection: redis }
)

worker.on('failed', (job, err) => {
  console.error(`⏰ [Scheduler Worker] Job ${job?.id} failed:`, err.message)
})
