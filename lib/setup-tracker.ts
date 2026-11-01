import { maintainCampaignClipPool } from '@/tools/continuous-edit-engine'

// In-memory progress tracker for active setups
export const activeSetups = new Map<string, {
  status: 'downloading' | 'completed' | 'error'
  progress: string
  startedAt: number
  error?: string
}>()

// In-memory progress tracker for active clip generation
export const activeClipGenerations = new Map<string, {
  status: 'generating' | 'completed' | 'error'
  progress: string
  startedAt: number
  error?: string
}>()

export function getSetupTracker() {
  return activeSetups
}

export function getClipGenTracker() {
  return activeClipGenerations
}

/**
 * Trigger background clip generation using maintainCampaignClipPool
 */
export function triggerClipGeneration(campaignId: string, cfg: Record<string, any>) {
  const existing = activeClipGenerations.get(campaignId)
  if (existing && existing.status === 'generating') {
    return false
  }

  activeClipGenerations.set(campaignId, {
    status: 'generating',
    progress: '⚙️ Starting clip generation engine...',
    startedAt: Date.now(),
  })

  maintainCampaignClipPool(campaignId, cfg, (progress) => {
    const entry = activeClipGenerations.get(campaignId)
    if (entry) {
      entry.progress = progress.lastMessage || `⚙️ Rendering clips (${progress.currentClips}/${progress.targetClips})...`
      if (progress.status === 'completed') {
        entry.status = 'completed'
      } else if (progress.status === 'error') {
        entry.status = 'error'
        entry.error = progress.lastMessage
      }
    }
  })
    .then((count) => {
      activeClipGenerations.set(campaignId, {
        status: 'completed',
        progress: `✅ ${count} clips ready in pool!`,
        startedAt: activeClipGenerations.get(campaignId)?.startedAt || Date.now(),
      })
      console.log(`[ClipGen] ✅ Campaign ${campaignId} generated ${count} clips`)
    })
    .catch((err) => {
      activeClipGenerations.set(campaignId, {
        status: 'error',
        progress: `❌ Clip generation error: ${err.message}`,
        startedAt: activeClipGenerations.get(campaignId)?.startedAt || Date.now(),
        error: err.message,
      })
      console.error(`[ClipGen] ❌ Campaign ${campaignId} clip gen failed:`, err.message)
    })

  return true
}
