import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { validateVpsApiKey } from '@/lib/vps-service'

export const dynamic = 'force-dynamic'

/**
 * POST /api/worker/report-whop-submission
 * Worker VPS reports the outcome (submitted or failed) of a Whop submission.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { apiKey, jobId, automationId, status, errorMessage, timeTaken } = body

    if (!apiKey) {
      return NextResponse.json({ error: 'Missing apiKey' }, { status: 401 })
    }

    const vps = await validateVpsApiKey(apiKey)
    if (!vps) {
      return NextResponse.json({ error: 'Invalid or unregistered VPS API Key' }, { status: 403 })
    }

    if (!jobId || !automationId) {
      return NextResponse.json({ error: 'jobId and automationId are required' }, { status: 400 })
    }

    const automation = await prisma.automation.findUnique({
      where: { id: automationId },
      include: { campaign: true },
    })

    if (!automation) {
      return NextResponse.json({ error: 'Automation run not found' }, { status: 404 })
    }

    const opts = (automation.options as Record<string, any>) || {}
    const whopList: any[] = opts.mockWhopSubmissions || []

    let targetItem: any = null
    const updatedWhopList = whopList.map((item) => {
      if (item.id === jobId) {
        targetItem = item
        const queuedMs = new Date(item.queuedAt || automation.createdAt).getTime()
        const calculatedTimeTaken = timeTaken || Math.max(1, Math.round((Date.now() - queuedMs) / 60000))
        return {
          ...item,
          status: status === 'submitted' ? 'submitted' : 'failed',
          errorMessage: errorMessage || null,
          timeTaken: calculatedTimeTaken,
          submittedAt: status === 'submitted' ? new Date().toISOString() : null,
          processedByVps: vps.label,
          completedAt: new Date().toISOString(),
        }
      }
      return item
    })

    await prisma.automation.update({
      where: { id: automationId },
      data: {
        options: {
          ...opts,
          mockWhopSubmissions: updatedWhopList,
        },
      },
    })

    // If successfully submitted, mark on VideoAnalytic record as whopSubmitted
    if (status === 'submitted' && targetItem?.youtubeLink) {
      const vidMatch = targetItem.youtubeLink.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|(?:embed|v|shorts)\/))([\w-]{11})/)
      const targetVideoIdExt = vidMatch ? vidMatch[1] : null

      if (targetVideoIdExt) {
        try {
          const videoRecord = await prisma.videoAnalytic.findFirst({
            where: { videoIdExt: targetVideoIdExt },
          })

          if (videoRecord) {
            const currentExtra = (videoRecord.extraData as Record<string, any>) || {}
            await prisma.videoAnalytic.update({
              where: { id: videoRecord.id },
              data: {
                extraData: {
                  ...currentExtra,
                  whopSubmitted: true,
                  whopSubmittedAt: new Date().toISOString(),
                  whopVps: vps.label,
                },
              },
            })

            // Check if threshold already crossed to auto-promote to PendingTask
            if (automation.campaignId) {
              const camp = automation.campaign
              const threshold = camp?.minViews || 10000
              const currentViews = Number(videoRecord.viewCount || 0)

              if (currentViews >= threshold) {
                const existingTask = await prisma.pendingTask.findFirst({
                  where: {
                    userId: automation.userId,
                    channelId: videoRecord.channelId,
                    videoIdExt: targetVideoIdExt,
                  },
                })

                if (!existingTask) {
                  await prisma.pendingTask.create({
                    data: {
                      userId: automation.userId,
                      campaignId: automation.campaignId,
                      channelId: videoRecord.channelId,
                      videoId: videoRecord.id,
                      videoIdExt: targetVideoIdExt,
                      viewCountAtTrigger: videoRecord.viewCount,
                      status: 'pending',
                      notes: `Auto-promoted on Whop submission by ${vps.label}: ${currentViews.toLocaleString()} views crossed threshold (${threshold.toLocaleString()}).`,
                      requirementsData: {
                        thresholdMet: threshold,
                        actualViews: currentViews,
                        whopSubmitted: true,
                        promotedAt: new Date().toISOString(),
                      },
                    },
                  })
                }
              }
            }
          }
        } catch (e: any) {
          console.warn(`[ReportWhopSubmission] Warning updating video analytic: ${e.message}`)
        }
      }
    }

    console.log(`[ReportWhopSubmission] ✅ Job ${jobId} reported as "${status}" by ${vps.label}`)

    return NextResponse.json({
      success: true,
      message: `Whop submission recorded as ${status}`,
    })
  } catch (err: any) {
    console.error('[Worker Report Whop Submission] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
