import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { validateVpsApiKey } from '@/lib/vps-service'

export const dynamic = 'force-dynamic'

/**
 * POST /api/worker/upload-failed
 * Worker VPS reports an upload failure (e.g. YouTube quota or daily limit exceeded).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { apiKey, channelId, campaignId, reason, errorMessage, clipFilename } = body

    if (!apiKey) {
      return NextResponse.json({ error: 'Missing apiKey' }, { status: 401 })
    }

    const vps = await validateVpsApiKey(apiKey)
    if (!vps) {
      return NextResponse.json({ error: 'Invalid VPS API Key' }, { status: 403 })
    }

    if (!channelId) {
      return NextResponse.json({ error: 'channelId is required' }, { status: 400 })
    }

    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
    })

    if (!channel) {
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
    }

    const extra = (channel.extraData as Record<string, any>) || {}
    const now = new Date()

    // If YouTube upload limit exceeded, put channel on a 24-hour cooldown
    if (reason === 'uploadLimitExceeded' || errorMessage?.includes('uploadLimitExceeded')) {
      const cooldownUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000)
      await prisma.channel.update({
        where: { id: channelId },
        data: {
          extraData: {
            ...extra,
            uploadCooldownUntil: cooldownUntil.toISOString(),
            lastUploadError: 'YouTube daily upload limit reached (24-hour cooldown active)',
            lastUploadAttempt: now.toISOString(),
          },
        },
      })

      // Update recent automation run status to inform user
      const recentAutomation = await prisma.automation.findFirst({
        where: {
          userId: channel.userId,
          ...(campaignId ? { campaignId } : {}),
        },
        orderBy: { createdAt: 'desc' },
      })

      if (recentAutomation) {
        const opts = (recentAutomation.options as any) || {}
        await prisma.automation.update({
          where: { id: recentAutomation.id },
          data: {
            options: {
              ...opts,
              runStatus: 'partial',
              cancelReason: `YouTube daily upload limit reached for channel @${channel.channelHandle || channel.channelName}. Resumes after 24h.`,
            },
          },
        })
      }

      return NextResponse.json({
        success: true,
        message: 'Channel placed on 24h cooldown due to YouTube upload limit.',
        cooldownUntil: cooldownUntil.toISOString(),
      })
    }

    // Generic failure tracking
    await prisma.channel.update({
      where: { id: channelId },
      data: {
        extraData: {
          ...extra,
          lastUploadError: errorMessage || 'Upload failed',
          lastUploadAttempt: now.toISOString(),
        },
      },
    })

    return NextResponse.json({
      success: true,
      message: 'Upload failure recorded.',
    })
  } catch (err: any) {
    console.error('[Worker Upload Failed] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
