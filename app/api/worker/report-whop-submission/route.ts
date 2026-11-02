import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { validateVpsApiKey } from '@/lib/vps-service'
import * as fs from 'fs'
import * as path from 'path'

export const dynamic = 'force-dynamic'

/**
 * POST /api/worker/report-whop-submission
 * Worker VPS reports the outcome (submitted or failed) of a Whop submission.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { jobId, automationId, status, errorMessage, timeTaken, screenshotBase64 } = body
    const apiKey = body.apiKey || req.headers.get('x-vps-key')

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

    // Save failure screenshot to disk if provided
    let screenshotUrl: string | null = null
    if (screenshotBase64) {
      try {
        const debugDir = path.join(process.cwd(), 'storage', 'whop-debug')
        if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true })
        const safeJobId = jobId.replace(/[^a-zA-Z0-9_-]/g, '')
        const filePath = path.join(debugDir, `fail_${safeJobId}.png`)
        const buffer = Buffer.from(screenshotBase64, 'base64')
        fs.writeFileSync(filePath, buffer)
        screenshotUrl = `/api/user/whop-screenshot/${safeJobId}`
      } catch (err: any) {
        console.warn(`[ReportWhopSubmission] Failed to save screenshot: ${err.message}`)
      }
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
    let matched = false
    let updatedWhopList = whopList.map((item) => {
      if (item.id === jobId) {
        matched = true
        targetItem = item
        const queuedMs = new Date(item.queuedAt || automation.createdAt).getTime()
        const calculatedTimeTaken = timeTaken || Math.max(1, Math.round((Date.now() - queuedMs) / 60000))
        return {
          ...item,
          status: status === 'submitted' ? 'submitted' : 'failed',
          errorMessage: errorMessage || null,
          screenshotUrl: screenshotUrl || item.screenshotUrl || null,
          timeTaken: calculatedTimeTaken,
          submittedAt: status === 'submitted' ? new Date().toISOString() : null,
          processedByVps: vps.label,
          completedAt: new Date().toISOString(),
        }
      }
      return item
    })

    // Fallback: If not matched by exact id but there is only 1 pending/matching item in the run
    if (!matched && whopList.length > 0) {
      const pendingIdx = whopList.findIndex((w) => w.status === 'pending' || w.status === 'in_progress')
      const targetIdx = pendingIdx >= 0 ? pendingIdx : 0
      targetItem = whopList[targetIdx]
      const queuedMs = new Date(targetItem.queuedAt || automation.createdAt).getTime()
      const calculatedTimeTaken = timeTaken || Math.max(1, Math.round((Date.now() - queuedMs) / 60000))
      updatedWhopList = whopList.map((item, idx) => {
        if (idx === targetIdx) {
          return {
            ...item,
            status: status === 'submitted' ? 'submitted' : 'failed',
            errorMessage: errorMessage || null,
            screenshotUrl: screenshotUrl || item.screenshotUrl || null,
            timeTaken: calculatedTimeTaken,
            submittedAt: status === 'submitted' ? new Date().toISOString() : null,
            processedByVps: vps.label,
            completedAt: new Date().toISOString(),
          }
        }
        return item
      })
    }

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
