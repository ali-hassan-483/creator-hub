import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/db'
import { encryptIfPresent, decryptIfPresent } from '@/lib/encryption'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const session = await requireAdmin()
    const userId = session.user.id

    const config = await prisma.discordConfig.findUnique({
      where: { userId },
    })

    return NextResponse.json({
      config: config
        ? {
            label: config.label,
            webhookUrl: decryptIfPresent(config.webhookUrlEnc) || '',
            isActive: config.isActive,
          }
        : null,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to fetch config' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAdmin()
    const userId = session.user.id
    const { webhookUrl, label, isActive } = await req.json()

    const webhookUrlEnc = encryptIfPresent(webhookUrl ? webhookUrl.trim() : null)

    const updated = await prisma.discordConfig.upsert({
      where: { userId },
      update: {
        label: label || 'Admin Alerts',
        webhookUrlEnc,
        isActive: isActive ?? true,
      },
      create: {
        userId,
        label: label || 'Admin Alerts',
        webhookUrlEnc,
        isActive: isActive ?? true,
      },
    })

    return NextResponse.json({
      success: true,
      config: {
        label: updated.label,
        isActive: updated.isActive,
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to save config' }, { status: 500 })
  }
}
