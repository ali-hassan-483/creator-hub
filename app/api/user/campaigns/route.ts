import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth-helpers'
import { prisma } from '@/lib/db'

export async function GET() {
  try {
    const session = await requireUser()
    const userId = session.user.id

    // Fetch campaigns that are granted to this user
    const campaigns = await prisma.campaign.findMany({
      where: {
        status: { in: ['active', 'paused'] },
        userAccess: {
          some: { userId },
        },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        minViews: true,
        config: true,
        createdAt: true,
      },
    })

    // Add available clips count for each campaign
    const { countEditedClips, getSourcesDir } = await import('@/tools/campaign-processor')
    const fs = await import('fs')

    const enriched = campaigns.map((c) => {
      let editedClipsCount = 0
      let sourceFilesCount = 0
      try {
        editedClipsCount = countEditedClips(c.id)
        const sourcesDir = getSourcesDir(c.id)
        if (fs.existsSync(sourcesDir)) {
          sourceFilesCount = fs.readdirSync(sourcesDir).filter((f) => !f.startsWith('.')).length
        }
      } catch {}

      return {
        ...c,
        availableClips: editedClipsCount,
        sourceFilesCount,
      }
    })

    return NextResponse.json(enriched)
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
