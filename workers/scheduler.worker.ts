/**
 * Scheduler Worker
 * Periodically triggers scheduled automation tasks based on user-configured daily cycles.
 * Checks active ScheduledAutomation records every 30 seconds and dispatches queued runs.
 */
import { Worker, Queue } from 'bullmq'
import { redis } from '../lib/redis'
import { prisma } from '../lib/db'

console.log('⏰ [Scheduler Worker] Started — monitoring scheduled automation cycles.')

process.on('unhandledRejection', (reason) => {
  console.error('⏰ [Scheduler Worker] Unhandled Rejection:', reason)
})

process.on('uncaughtException', (err) => {
  console.error('⏰ [Scheduler Worker] Uncaught Exception:', err)
})

let isSchedulerRunning = false

function parseTimeToMinutes(timeStr: string): number {
  const cleaned = timeStr.trim().toUpperCase()
  // Matches "09:00 AM", "9:00 AM", "09:00AM", "14:30"
  const ampmMatch = cleaned.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/)
  if (!ampmMatch) return -1

  let hours = parseInt(ampmMatch[1], 10)
  const minutes = parseInt(ampmMatch[2], 10)
  const modifier = ampmMatch[3]

  if (modifier === 'PM' && hours < 12) hours += 12
  if (modifier === 'AM' && hours === 12) hours = 0

  return hours * 60 + minutes
}

async function checkAndTriggerSchedules() {
  if (isSchedulerRunning) return
  isSchedulerRunning = true

  try {
    const now = new Date()

    // PKT Time (Asia/Karachi, UTC+5)
    const pktDateFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Karachi',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    const currentPktDate = pktDateFormatter.format(now) // e.g. "2026-11-18"

    const pktTimeFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Karachi',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    })
    const currentPktTimeParts = pktTimeFormatter.formatToParts(now)
    const curHour = parseInt(currentPktTimeParts.find((p) => p.type === 'hour')?.value || '0', 10)
    const curMinute = parseInt(currentPktTimeParts.find((p) => p.type === 'minute')?.value || '0', 10)
    const currentMinutesOfDay = curHour * 60 + curMinute

    const activeSchedules = await prisma.scheduledAutomation.findMany({
      where: { status: 'active' },
      include: {
        channels: { select: { channelId: true } },
        campaign: { select: { id: true, name: true, status: true } },
      },
    })

    for (const schedule of activeSchedules) {
      const opts = (schedule.options as Record<string, any>) || {}
      const repeatDays = Number(opts.repeatDays || 7)
      const scheduleTimes: string[] = Array.isArray(opts.scheduleTimes) ? opts.scheduleTimes : ['09:00 AM']
      const executedSlots: Record<string, string> = { ...(opts.executedSlots || {}) }

      // 1. Check if cycle duration has elapsed
      const createdMs = new Date(schedule.createdAt).getTime()
      const cycleDurationMs = repeatDays * 24 * 60 * 60 * 1000
      if (now.getTime() - createdMs >= cycleDurationMs) {
        console.log(`⏰ [Scheduler Worker] Cycle completed (${repeatDays} days) for schedule: "${schedule.name}" (${schedule.id})`)
        await prisma.scheduledAutomation.update({
          where: { id: schedule.id },
          data: { status: 'completed' },
        })
        continue
      }

      // 2. Check if campaign is ended
      if (schedule.campaign && schedule.campaign.status === 'ended') {
        console.log(`⏰ [Scheduler Worker] Campaign ended for schedule: "${schedule.name}". Pausing schedule.`)
        await prisma.scheduledAutomation.update({
          where: { id: schedule.id },
          data: { status: 'paused' },
        })
        continue
      }

      // 3. Ensure channels are configured
      if (!schedule.channels || schedule.channels.length === 0) {
        continue
      }

      // 4. Check each scheduled time slot
      for (const slotTime of scheduleTimes) {
        const slotMinutes = parseTimeToMinutes(slotTime)
        if (slotMinutes === -1) continue

        // Check if current minute matches slot (+- 2 minutes window)
        const diff = Math.abs(currentMinutesOfDay - slotMinutes)
        const isTimeMatch = diff <= 2

        const slotKey = `${currentPktDate}_${slotTime.trim()}`
        const alreadyRanToday = Boolean(executedSlots[slotKey])

        if (isTimeMatch && !alreadyRanToday) {
          console.log(`⏰ [Scheduler Worker] 🚀 TRIGGERING Scheduled Automation "${schedule.name}" (${schedule.id}) at PKT ${slotTime}!`)

          // Create queued Automation
          const newAutomation = await prisma.automation.create({
            data: {
              userId: schedule.userId,
              campaignId: schedule.campaignId,
              name: `Scheduled Run - ${schedule.campaign?.name || 'Campaign'} - ${slotTime} PKT`,
              runType: 'scheduled',
              status: 'queued',
              options: {
                ...opts,
                scheduledAutomationId: schedule.id,
                scheduledSlot: slotTime,
                scheduledDate: currentPktDate,
                triggeredAt: now.toISOString(),
              },
              channels: {
                create: schedule.channels.map((c) => ({ channelId: c.channelId })),
              },
            },
          })

          executedSlots[slotKey] = newAutomation.id

          await prisma.scheduledAutomation.update({
            where: { id: schedule.id },
            data: {
              lastRunAt: now,
              options: {
                ...opts,
                executedSlots,
              },
            },
          })

          console.log(`⏰ [Scheduler Worker] ✅ Automation ${newAutomation.id} queued successfully for ${schedule.channels.length} channel(s)!`)
        }
      }
    }
  } catch (err: any) {
    console.error('⏰ [Scheduler Worker] Error checking schedules:', err.message)
  } finally {
    isSchedulerRunning = false
  }
}

// 1. Initial check 5 seconds after startup
setTimeout(() => {
  console.log('⏰ [Scheduler Worker] Running initial schedule check...')
  checkAndTriggerSchedules()
}, 5000)

// 2. Continuous check every 30 seconds
setInterval(() => {
  checkAndTriggerSchedules()
}, 30000)

// 3. BullMQ queue listener for ad-hoc manual or programmatic scheduler jobs
const worker = new Worker(
  'scheduler',
  async (job) => {
    console.log(`⏰ [Scheduler Worker] Received BullMQ job ${job.id}:`, job.data)
    await checkAndTriggerSchedules()
  },
  { connection: redis }
)

worker.on('failed', (job, err) => {
  console.error(`⏰ [Scheduler Worker] Job ${job?.id} failed:`, err.message)
})
