import { NextRequest, NextResponse } from 'next/server'
import { getClipsDir } from '@/tools/campaign-processor'
import * as fs from 'fs'
import * as path from 'path'

export const dynamic = 'force-dynamic'

/**
 * GET /api/n8n/video-stream?campaignId=xxx&file=xxx.mp4
 * Serves the video file directly as binary stream to n8n HTTP Request node.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const campaignId = searchParams.get('campaignId')
    const fileName = searchParams.get('file')

    if (!campaignId || !fileName) {
      return NextResponse.json({ error: 'campaignId and file are required' }, { status: 400 })
    }

    const safeName = path.basename(fileName)
    const clipsDir = getClipsDir(campaignId)
    const filePath = path.join(clipsDir, safeName)

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'Video file not found' }, { status: 404 })
    }

    const stat = fs.statSync(filePath)
    const fileStream = fs.createReadStream(filePath)

    return new Response(fileStream as any, {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': stat.size.toString(),
        'Content-Disposition': `attachment; filename="${safeName}"`,
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Stream error' }, { status: 500 })
  }
}
