import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/db'
import * as fs from 'fs'
import * as path from 'path'
import { getSourcesDir, getClipsDir, countEditedClips } from '@/tools/campaign-processor'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/campaigns/upload-clips
 * Form-data:
 *   - campaignId: string
 *   - targetType: 'sources' | 'clips' (default 'sources')
 *   - files: multiple video files
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin()

    const formData = await req.formData()
    const campaignId = formData.get('campaignId') as string
    const targetType = (formData.get('targetType') as string) || 'sources'

    if (!campaignId) {
      return NextResponse.json({ error: 'campaignId is required' }, { status: 400 })
    }

    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
    })

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    const destinationDir = targetType === 'clips'
      ? getClipsDir(campaignId)
      : getSourcesDir(campaignId)

    fs.mkdirSync(destinationDir, { recursive: true })

    const files = formData.getAll('files') as File[]
    if (!files || files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 })
    }

    const uploadedFiles: string[] = []

    for (const file of files) {
      if (typeof file === 'string') continue
      const bytes = await file.arrayBuffer()
      const buffer = Buffer.from(bytes)

      // Sanitize file name
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const targetPath = path.join(destinationDir, safeName)

      fs.writeFileSync(targetPath, buffer)
      uploadedFiles.push(safeName)
    }

    const currentClips = countEditedClips(campaignId)

    return NextResponse.json({
      success: true,
      message: `Uploaded ${uploadedFiles.length} file(s) to ${targetType}`,
      uploadedFiles,
      currentClips,
    })
  } catch (error: any) {
    console.error('[Upload Clips API] Error:', error)
    return NextResponse.json({ error: error.message || 'Upload failed' }, { status: 500 })
  }
}

/**
 * GET /api/admin/campaigns/upload-clips?campaignId=xxx
 * Returns clip pool status (how many ready, list of source & clip files)
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin()

    const { searchParams } = new URL(req.url)
  const campaignId = searchParams.get('campaignId')

  if (!campaignId) {
    return NextResponse.json({ error: 'campaignId is required' }, { status: 400 })
  }

  const sourcesDir = getSourcesDir(campaignId)
  const clipsDir = getClipsDir(campaignId)

  const sourceFiles = fs.existsSync(sourcesDir)
    ? fs.readdirSync(sourcesDir).filter(f => !f.startsWith('.'))
    : []

  const clipFiles = fs.existsSync(clipsDir)
    ? fs.readdirSync(clipsDir).filter(f => f.endsWith('.mp4') && f.startsWith('final_'))
    : []

    return NextResponse.json({
      campaignId,
      sourceFilesCount: sourceFiles.length,
      editedClipsCount: clipFiles.length,
      targetClips: 300,
      sourceFiles: sourceFiles.slice(0, 50),
      clipFiles: clipFiles.slice(0, 50),
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to fetch clips status' }, { status: 500 })
  }
}
