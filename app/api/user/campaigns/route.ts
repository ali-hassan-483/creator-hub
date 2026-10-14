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

    return NextResponse.json(campaigns)
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
