import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import * as fs from 'fs'
import * as path from 'path'

export const dynamic = 'force-dynamic'

/**
 * GET /api/user/whop-screenshot/[jobId]
 * Serves the debug screenshot captured when a Whop submission failed.
 */
export async function GET(
  req: NextRequest,
  props: { params: Promise<{ jobId: string }> | { jobId: string } }
) {
  try {
    await requireAuth()
    const resolvedParams = await Promise.resolve(props.params)
    const { jobId } = resolvedParams

    if (!jobId) {
      return NextResponse.json({ error: 'jobId is required' }, { status: 400 })
    }

    const safeJobId = jobId.replace(/[^a-zA-Z0-9_-]/g, '')
    const filePath = path.join(process.cwd(), 'storage', 'whop-debug', `fail_${safeJobId}.png`)

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'Screenshot not found' }, { status: 404 })
    }

    const imageBuffer = fs.readFileSync(filePath)
    return new NextResponse(imageBuffer, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Unauthorized' }, { status: 401 })
  }
}
