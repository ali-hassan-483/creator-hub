import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { validateVpsApiKey } from '@/lib/vps-service'

export const dynamic = 'force-dynamic'

/**
 * POST /api/worker/upload-failed
 * Worker VPS reports an upload failure (e.g. YouTube quota or daily limit exceeded).
 * 
 * Rules:
 * 1. Channel status remains 'active' (NOT marked as error on Channels page).
 * 2. Failure is recorded for this channel in the Run Logs details.
 * 3. Automation moves on to the next channel in the batch.
 * 4. If all channels have been processed, the automation completes with 'partial' or 'failed'.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { apiKey, channelId, campaignId, reason, errorMessage, clipFilename, automationId } = body

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
    const isLimitExceeded = reason === 'uploadLimitExceeded' || errorMessage?.includes('uploadLimitExceeded')

    // Keep channel status 'active', but record 24h cooldown if YouTube daily limit was reached
    const cooldownUntil = isLimitExceeded
      ? new Date(now.getTime() + 24 * 60 * 60 * 1000)
      : null

    await prisma.channel.update({
      where: { id: channelId },
      data: {
        extraData: {
          ...extra,
          ...(cooldownUntil ? { uploadCooldownUntil: cooldownUntil.toISOString() } : {}),
          lastUploadError: errorMessage || (isLimitExceeded ? 'YouTube daily upload limit reached' : 'Upload failed'),
          lastUploadAttempt: now.toISOString(),
        },
      },
    })

    // Find the target automation run
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

      const failureItem = {
        id: `fail_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        channelId: channel.id,
        channelName: channel.channelName || channel.channelHandle || 'YouTube Channel',
        campaign: campaignId || 'Active Campaign',
        stage: 'Upload Failed',
        videoTitle: clipFilename || 'Upload Failed',
        youtubeLink: null,
        error: errorMessage || (isLimitExceeded ? 'YouTube daily upload limit reached' : 'Upload failed'),
        uploadedAt: now.toISOString(),
        vpsNode: vps.label,
      }

      // Check if this channel was already recorded in this run
      const filteredUploads = videoUploads.filter((u: any) => u.channelId !== channel.id)
      const updatedUploads = [failureItem, ...filteredUploads]

      const totalChannels = targetAutomation.channels?.length || 1
      const isAllDone = updatedUploads.length >= totalChannels
      const hasAnySuccess = updatedUploads.some((u: any) => !!u.youtubeLink)

      let newStatus: 'running' | 'completed' | 'failed' = 'running'
      let newRunStatus: 'running' | 'partial' | 'failed' = 'running'

      if (isAllDone) {
        newStatus = hasAnySuccess ? 'completed' : 'failed'
        newRunStatus = hasAnySuccess ? 'partial' : 'failed'
      }

      await prisma.automation.update({
        where: { id: targetAutomation.id },
        data: {
          status: newStatus,
          completedAt: isAllDone ? now : null,
          errorMessage: !hasAnySuccess && isAllDone ? failureItem.error : targetAutomation.errorMessage,
          options: {
            ...opts,
            mockVideoUploads: updatedUploads,
            runStatus: newRunStatus,
          },
        },
      })

      return NextResponse.json({
        success: true,
        message: isAllDone
          ? `All channels processed. Automation finished with status: ${newRunStatus}.`
          : 'Upload failure recorded for this channel. Continuing with next channel.',
        isAllDone,
        cooldownUntil: cooldownUntil?.toISOString() || null,
      })
    }

    return NextResponse.json({
      success: true,
      message: 'Upload failure recorded.',
    })
  } catch (err: any) {
    console.error('[Worker Upload Failed] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
