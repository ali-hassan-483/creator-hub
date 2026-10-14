import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth-helpers'
import { sendDiscordNotification } from '@/lib/discord'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    await requireAdmin()
    const { webhookUrl } = await req.json()

    if (!webhookUrl) {
      return NextResponse.json({ error: 'Webhook URL is required' }, { status: 400 })
    }

    const embed = {
      title: '✅ Discord Webhook Connected Successfully!',
      description: 'Your Creator Hub Admin alert system is now active. You will receive notifications for video uploads, errors, and Whop submission tracking here.',
      color: 0x5865f2,
      timestamp: new Date().toISOString(),
      footer: {
        text: 'Creator Hub Alert Bot',
      },
    }

    await sendDiscordNotification(webhookUrl, '🔔 **Creator Hub Test Notification**', [embed])

    return NextResponse.json({ success: true, message: 'Test notification sent!' })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to send test alert' }, { status: 500 })
  }
}
