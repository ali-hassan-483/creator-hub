import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { decryptIfPresent } from '@/lib/encryption'
import { getClipsDir } from '@/tools/campaign-processor'
import * as fs from 'fs'
import * as path from 'path'

export const dynamic = 'force-dynamic'

/**
 * GET /api/n8n/pending-uploads
 * Query params (optional):
 *   - channelId: string (to fetch clips for a specific channel)
 *   - apiKey: string (or header x-n8n-key for security)
 *
 * Returns a list of pending upload jobs containing:
 *   - channel: { id, channelName, channelHandle, clientId, clientSecret, refreshToken }
 *   - campaign: { id, name, niche }
 *   - clip: { filename, localPath, streamUrl, title, description, tags }
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const specificChannelId = searchParams.get('channelId')

    // Find active channels with YouTube credentials
    const channels = await prisma.channel.findMany({
      where: {
        status: 'active',
        removedAt: null,
        clientId: { not: null },
        refreshTokenEnc: { not: null },
        ...(specificChannelId ? { id: specificChannelId } : {}),
      },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
    })

    if (channels.length === 0) {
      return NextResponse.json({
        success: true,
        count: 0,
        message: 'No active channels ready for upload',
        jobs: [],
      })
    }

    // Find active campaigns that have available ready clips
    const campaigns = await prisma.campaign.findMany({
      where: {
        status: 'active',
      },
    })

    const jobs: any[] = []

    for (const channel of channels) {
      // Decrypt credentials
      const clientId = channel.clientId || ''
      const clientSecret = decryptIfPresent(channel.clientSecretEnc) || ''
      const refreshToken = decryptIfPresent(channel.refreshTokenEnc) || ''

      if (!refreshToken) continue

      // Look for available clips across campaigns
      for (const campaign of campaigns) {
        const clipsDir = getClipsDir(campaign.id)
        if (!fs.existsSync(clipsDir)) continue

        const allClips = fs.readdirSync(clipsDir).filter(f => f.endsWith('.mp4'))
        if (allClips.length === 0) continue

        // Pick the first available clip
        const clipFileName = allClips[0]
        const clipFullPath = path.join(clipsDir, clipFileName)
        const cfg = (campaign.config as any) || {}

        // Look for corresponding .meta.json file
        const metaFileName = clipFileName.replace(/\.mp4$/, '.meta.json')
        const metaFullPath = path.join(clipsDir, metaFileName)

        let title = cfg.onScreenTextPool
          ? cfg.onScreenTextPool.split('\n')[0].slice(0, 60)
          : `${campaign.name} Short`
        let description = `${cfg.predefinedDescription || ''}\n\n${cfg.linksInDescription || ''}`.trim()
        let tags = ['shorts', 'viral', (cfg.niche || 'trending').toLowerCase()]

        if (fs.existsSync(metaFullPath)) {
          try {
            const meta = JSON.parse(fs.readFileSync(metaFullPath, 'utf8'))
            if (meta.title) title = meta.title
            if (meta.description) description = meta.description
            if (meta.hashtags && Array.isArray(meta.hashtags)) tags = meta.hashtags
          } catch {}
        }

        jobs.push({
          channel: {
            id: channel.id,
            channelName: channel.channelName || channel.channelHandle || 'YouTube Channel',
            channelHandle: channel.channelHandle,
            channelIdExt: channel.channelIdExt,
            clientId,
            clientSecret,
            refreshToken,
          },
          campaign: {
            id: campaign.id,
            name: campaign.name,
            niche: cfg.niche || 'General',
            minViews: campaign.minViews || 5000,
          },
          clip: {
            filename: clipFileName,
            localPath: clipFullPath,
            streamUrl: `/api/n8n/video-stream?campaignId=${campaign.id}&file=${encodeURIComponent(clipFileName)}`,
            title,
            description,
            tags: ['shorts', 'viral', (cfg.niche || 'trending').toLowerCase()],
          },
        })

        // Limit 1 clip per channel per poll
        break
      }
    }

    return NextResponse.json({
      success: true,
      count: jobs.length,
      jobs,
    })
  } catch (err: any) {
    console.error('[N8N Pending Uploads] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
