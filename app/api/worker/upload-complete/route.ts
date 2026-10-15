import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { validateVpsApiKey } from '@/lib/vps-service'
import { getClipsDir } from '@/tools/campaign-processor'
import * as fs from 'fs'
import * as path from 'path'

export const dynamic = 'force-dynamic'

/**
 * POST /api/worker/upload-complete
 * Worker VPS reports a completed YouTube upload.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { apiKey, channelId, campaignId, youtubeVideoId, youtubeLink, title, clipFilename, automationId } = body

    if (!apiKey) {
      return NextResponse.json({ error: 'Missing apiKey' }, { status: 401 })
    }

    const vps = await validateVpsApiKey(apiKey)
    if (!vps) {
      return NextResponse.json({ error: 'Invalid or unregistered VPS API Key' }, { status: 403 })
    }

    if (!channelId || !youtubeVideoId) {
      return NextResponse.json({ error: 'channelId and youtubeVideoId are required' }, { status: 400 })
    }

    // Verify channel
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      include: { user: true },
    })

    if (!channel) {
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
    }

    const whopEmail = channel.whopEmail || channel.channelEmail || ''
    const now = new Date()

    // Find target automation run
    let targetAutomation = automationId
      ? await prisma.automation.findUnique({
          where: { id: automationId },
          include: { channels: true },
        })
      : null

    if (!targetAutomation) {
      targetAutomation = await prisma.automation.findFirst({
        where: {
          userId: channel.userId,
          status: { in: ['queued', 'running'] },
          ...(campaignId ? { campaignId } : {}),
        },
        include: { channels: true },
        orderBy: { createdAt: 'desc' },
      })
    }

    if (targetAutomation) {
      const opts = (targetAutomation.options as any) || {}
      const videoUploads = opts.mockVideoUploads || []
      const whopSubmissions = opts.mockWhopSubmissions || []

      const uploadItem = {
        id: `upl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        channelId: channel.id,
        channelName: channel.channelName || channel.channelHandle || 'YouTube Channel',
        campaign: campaignId || 'Active Campaign',
        stage: 'Video Uploaded',
        videoTitle: title || 'Uploaded Short',
        youtubeLink,
        uploadedAt: now.toISOString(),
        vpsNode: vps.label,
      }

      const whopItem = {
        id: `whop_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        videoTitle: title || 'Uploaded Short',
        youtubeLink,
        queuedAt: now.toISOString(),
        timeTaken: null,
        status: 'pending',
        whopEmail,
      }

      const updatedUploads = [uploadItem, ...videoUploads]
      const totalChannels = targetAutomation.channels?.length || 1
      const isAllDone = updatedUploads.length >= totalChannels

      await prisma.automation.update({
        where: { id: targetAutomation.id },
        data: {
          options: {
            ...opts,
            mockVideoUploads: updatedUploads,
            mockWhopSubmissions: [whopItem, ...whopSubmissions],
          },
          status: isAllDone ? 'completed' : 'running',
          completedAt: isAllDone ? now : null,
        },
      })
    }

    // Register into VideoAnalytic table for view tracking
    const video = await prisma.videoAnalytic.upsert({
      where: {
        channelId_videoIdExt: {
          channelId,
          videoIdExt: youtubeVideoId,
        },
      },
      update: {
        title: title || 'Uploaded Short',
        lastFetchedAt: new Date(),
        extraData: {
          youtubeLink,
          campaignId,
          uploadedViaVps: vps.label,
          vpsId: vps.id,
          uploadDate: new Date().toISOString(),
        },
      },
      create: {
        channelId,
        videoIdExt: youtubeVideoId,
        title: title || 'Uploaded Short',
        viewCount: BigInt(0),
        publishedAt: new Date(),
        extraData: {
          youtubeLink,
          campaignId,
          uploadedViaVps: vps.label,
          vpsId: vps.id,
          uploadDate: new Date().toISOString(),
        },
      },
    })

    // Archive the uploaded clip so it is not re-uploaded
    if (campaignId && clipFilename) {
      try {
        const clipsDir = getClipsDir(campaignId)
        const baseName = path.basename(clipFilename)
        const filePath = path.join(clipsDir, baseName)
        const metaPath = path.join(clipsDir, baseName.replace(/\.mp4$/, '.meta.json'))

        const archiveDir = path.join(clipsDir, 'posted')
        fs.mkdirSync(archiveDir, { recursive: true })

        if (fs.existsSync(filePath)) {
          fs.renameSync(filePath, path.join(archiveDir, baseName))
        }
        if (fs.existsSync(metaPath)) {
          fs.renameSync(metaPath, path.join(archiveDir, path.basename(metaPath)))
        }
      } catch (fileErr) {
        console.warn('[Worker Upload Complete] Could not archive clip:', fileErr)
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Video upload recorded successfully in Creator Hub',
      video: {
        id: video.id,
        videoIdExt: video.videoIdExt,
        title: video.title,
      },
    })
  } catch (err: any) {
    console.error('[Worker Upload Complete] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
