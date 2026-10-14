import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getClipsDir } from '@/tools/campaign-processor'
import * as fs from 'fs'
import * as path from 'path'

export const dynamic = 'force-dynamic'

/**
 * POST /api/n8n/upload-complete
 * Body:
 *   - channelId: string (Creator Hub channel ID)
 *   - campaignId: string
 *   - youtubeVideoId: string
 *   - youtubeLink: string
 *   - title: string
 *   - clipFilename?: string (to archive/delete from pending pool)
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { channelId, campaignId, youtubeVideoId, youtubeLink, title, clipFilename } = body

    if (!channelId || !youtubeVideoId) {
      return NextResponse.json({ error: 'channelId and youtubeVideoId are required' }, { status: 400 })
    }

    // Verify channel exists
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
    })

    if (!channel) {
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
    }

    // Register into VideoAnalytic table so Views Monitor tracks it
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
          uploadedVia: 'n8n',
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
          uploadedVia: 'n8n',
          uploadDate: new Date().toISOString(),
        },
      },
    })

    // If a clip filename was uploaded, remove or move it from pool
    if (campaignId && clipFilename) {
      try {
        const clipsDir = getClipsDir(campaignId)
        const filePath = path.join(clipsDir, path.basename(clipFilename))
        if (fs.existsSync(filePath)) {
          // Move to posted archive folder
          const archiveDir = path.join(clipsDir, 'posted')
          fs.mkdirSync(archiveDir, { recursive: true })
          fs.renameSync(filePath, path.join(archiveDir, path.basename(clipFilename)))
        }
      } catch (fileErr) {
        console.warn('[N8N Upload Complete] Could not archive clip file:', fileErr)
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Video registered successfully in Creator Hub',
      video: {
        id: video.id,
        videoIdExt: video.videoIdExt,
        title: video.title,
      },
    })
  } catch (err: any) {
    console.error('[N8N Upload Complete] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
