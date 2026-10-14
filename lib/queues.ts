import { Queue } from 'bullmq'
import { redis } from './redis'

export const analyticsQueue = new Queue('analytics', { connection: redis })
export const automationQueue = new Queue('automation', { connection: redis })
export const schedulerQueue = new Queue('scheduler', { connection: redis })
export const discordQueue = new Queue('discord-notify', { connection: redis })
