import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * GET /api/user/pending-tasks
 * Returns user accessible campaigns, stages, and tasks matching selected campaign and stage filters
 */
export async function GET(req: NextRequest) {
  const session = await requireAuth()
  const userId = session.user.id

  const { searchParams } = new URL(req.url)
  const campaignId = searchParams.get('campaignId') || 'all'
  const stage = searchParams.get('stage') || 'all'

  try {
    // Reconcile/clean up Alliance campaign and any tasks erroneously mapped to PopDarts
    try {
      const allianceCampaign = await prisma.campaign.findFirst({
        where: { name: { contains: 'Alliance', mode: 'insensitive' } },
      })
      if (allianceCampaign) {
        if (allianceCampaign.status !== 'ended') {
          await prisma.campaign.update({
            where: { id: allianceCampaign.id },
            data: { status: 'ended' },
          })
        }
        // If any AI / Cybersecurity videos were assigned to PopDarts, reassign to Alliance
        await prisma.pendingTask.updateMany({
          where: {
            OR: [
              { video: { title: { contains: 'AI', mode: 'insensitive' } } },
              { video: { title: { contains: 'Cybersecurity', mode: 'insensitive' } } },
              { video: { title: { contains: 'Outsmart', mode: 'insensitive' } } },
            ],
            campaign: { name: { contains: 'PopDarts', mode: 'insensitive' } },
          },
          data: {
            campaignId: allianceCampaign.id,
          },
        })
      }
    } catch (e: any) {
      console.warn('[PendingTasks] Alliance reconciliation warning:', e.message)
    }

    // 1. Fetch campaigns accessible to the user (excluding ended campaigns)
    const campaigns = await prisma.campaign.findMany({
      where: {
        status: { not: 'ended' },
        OR: [
          { userAccess: { some: { userId } } },
          { automations: { some: { userId } } },
        ],
      },
      select: {
        id: true,
        name: true,
        minViews: true,
      },
    })

    // 2. Build where filter for tasks - NEVER SHOW ENDED CAMPAIGNS
    const whereClause: any = {
      userId,
      campaign: {
        status: { not: 'ended' },
      },
    }
    if (campaignId !== 'all') {
      whereClause.campaignId = campaignId
    }

    if (stage !== 'all') {
      // Mapping frontend stages to database TaskStatus or notes
      if (stage === 'eligible_for_review') {
        whereClause.status = 'pending'
      } else if (stage === 'analytics_required') {
        whereClause.status = 'requirements_completed'
      } else if (stage === 'analytics_submitted') {
        whereClause.status = 'ready_for_review'
      } else if (stage === 'approved') {
        whereClause.status = 'approved'
      } else if (stage === 'rejected') {
        whereClause.status = 'rejected'
      }
    }

    const tasks = await prisma.pendingTask.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      include: {
        campaign: {
          select: {
            id: true,
            name: true,
            config: true,
          },
        },
        channel: {
          select: {
            id: true,
            channelName: true,
            channelHandle: true,
            channelEmail: true,
            whopEmail: true,
          },
        },
        video: {
          select: {
            id: true,
            title: true,
            videoIdExt: true,
            viewCount: true,
            publishedAt: true,
          },
        },
      },
    })

    const formattedTasks = tasks
      .filter((t) => {
        // Guard: Never show ended campaign tasks or AI/Alliance videos under PopDarts
        const campName = t.campaign?.name?.toLowerCase() || ''
        const vidTitle = t.video?.title?.toLowerCase() || ''
        if (campName.includes('popdarts') && (vidTitle.includes('ai') || vidTitle.includes('cyber') || vidTitle.includes('superintelligence') || vidTitle.includes('outsmart') || vidTitle.includes('rogue'))) {
          return false
        }
        return true
      })
      .map((t) => {
      // Map TaskStatus to Stage Label
      let stageLabel = 'Eligible for Review'
      if (t.status === 'pending') {
        stageLabel = 'Eligible for Review'
      } else if (t.status === 'requirements_completed') {
        stageLabel = 'Analytics Required'
      } else if (t.status === 'ready_for_review') {
        stageLabel = 'Analytics Submitted'
      } else if (t.status === 'approved') {
        stageLabel = 'Approved'
      } else if (t.status === 'rejected') {
        stageLabel = 'Rejected'
      }

      const reqData = (t.requirementsData as Record<string, any>) || {}

      return {
        id: t.id,
        campaignId: t.campaignId,
        campaignName: t.campaign?.name || 'Campaign',
        channelId: t.channelId,
        channelName: t.channel?.channelName || t.channel?.channelHandle || 'Channel',
        channelEmail: t.channel?.channelEmail || '',
        whopEmail: t.channel?.whopEmail || '',
        videoId: t.videoIdExt || t.video?.videoIdExt || '',
        videoTitle: t.video?.title || 'YouTube Short / Video',
        viewCount: t.viewCountAtTrigger ? Number(t.viewCountAtTrigger) : Number(t.video?.viewCount || 0),
        status: t.status,
        stageLabel,
        requirementsData: t.requirementsData,
        earningAmount: typeof reqData.earningAmount === 'number' ? reqData.earningAmount : null,
        publishedAt: t.video?.publishedAt ? t.video.publishedAt.toISOString() : null,
        notes: t.notes,
        createdAt: t.createdAt,
        reviewedAt: t.reviewedAt,
      }
    })

    return NextResponse.json({
      campaigns,
      tasks: formattedTasks,
      total: formattedTasks.length,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to load pending tasks' }, { status: 500 })
  }
}

/**
 * POST /api/user/pending-tasks
 * Submit requirements proof or update task state
 */
export async function POST(req: NextRequest) {
  const session = await requireAuth()
  const userId = session.user.id

  try {
    const body = await req.json()
    const { action } = body

    if (action === 'submit_proof') {
      const { taskId, proofLink, notes } = body
      if (!taskId) return NextResponse.json({ error: 'taskId is required' }, { status: 400 })

      const updated = await prisma.pendingTask.update({
        where: { id: taskId, userId },
        data: {
          status: 'ready_for_review',
          notes: notes || undefined,
          requirementsData: { proofLink, submittedAt: new Date().toISOString() },
        },
      })

      return NextResponse.json({
        success: true,
        task: {
          id: updated.id,
          status: updated.status,
          viewCountAtTrigger: updated.viewCountAtTrigger ? Number(updated.viewCountAtTrigger) : null,
        },
      })
    }

    if (action === 'toggle_yt_mention') {
      const { taskId, ytMentioned } = body
      if (!taskId) return NextResponse.json({ error: 'taskId required' }, { status: 400 })

      const existing = await prisma.pendingTask.findFirst({
        where: { id: taskId, userId },
      })
      if (!existing) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

      const currentReq = (existing.requirementsData as any) || {}
      const updated = await prisma.pendingTask.update({
        where: { id: taskId },
        data: {
          requirementsData: {
            ...currentReq,
            ytMentioned: Boolean(ytMentioned),
            ytMentionedUpdatedAt: new Date().toISOString(),
          },
        },
      })

      return NextResponse.json({
        success: true,
        task: {
          id: updated.id,
          status: updated.status,
          viewCountAtTrigger: updated.viewCountAtTrigger ? Number(updated.viewCountAtTrigger) : null,
        },
      })
    }

    if (action === 'approve_task') {
      const { taskId, earningAmount, notes } = body
      if (!taskId) return NextResponse.json({ error: 'taskId is required' }, { status: 400 })
      const amountNum = parseFloat(String(earningAmount ?? '0'))
      if (isNaN(amountNum) || amountNum < 0) {
        return NextResponse.json({ error: 'Please enter a valid positive earning amount ($)' }, { status: 400 })
      }

      const task = await prisma.pendingTask.findFirst({
        where: { id: taskId, userId },
        include: { video: true, campaign: true },
      })
      if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

      const currentReq = (task.requirementsData as Record<string, any>) || {}

      // 1. Update task to approved with recorded earning
      const updatedTask = await prisma.pendingTask.update({
        where: { id: taskId },
        data: {
          status: 'approved',
          reviewedAt: new Date(),
          notes: notes || task.notes,
          requirementsData: {
            ...currentReq,
            earningAmount: amountNum,
            approvedAt: new Date().toISOString(),
          },
        },
      })

      // 2. Create or update Earning record with status 'confirmed'
      // This immediately credits user balance and reflects on User Dashboard and Admin Dashboard
      const existingEarning = await prisma.earning.findFirst({
        where: { taskId: task.id },
      })

      let earningRecord
      if (existingEarning) {
        earningRecord = await prisma.earning.update({
          where: { id: existingEarning.id },
          data: {
            amount: amountNum,
            status: 'confirmed',
            notes: notes || `Approved clip: ${task.video?.title || task.videoIdExt || 'Video'}`,
            earnedAt: new Date(),
          },
        })
      } else {
        earningRecord = await prisma.earning.create({
          data: {
            userId,
            campaignId: task.campaignId,
            taskId: task.id,
            amount: amountNum,
            currency: 'USD',
            status: 'confirmed',
            notes: notes || `Approved clip: ${task.video?.title || task.videoIdExt || 'Video'}`,
            earnedAt: new Date(),
          },
        })
      }

      return NextResponse.json({
        success: true,
        message: `Video approved! $${amountNum.toFixed(2)} added to your balance.`,
        task: {
          id: updatedTask.id,
          status: updatedTask.status,
          earningAmount: amountNum,
          viewCountAtTrigger: updatedTask.viewCountAtTrigger ? Number(updatedTask.viewCountAtTrigger) : null,
        },
        earning: earningRecord,
      })
    }

    if (action === 'reject_task') {
      const { taskId, reason } = body
      if (!taskId) return NextResponse.json({ error: 'taskId is required' }, { status: 400 })

      const task = await prisma.pendingTask.findFirst({
        where: { id: taskId, userId },
      })
      if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

      const currentReq = (task.requirementsData as Record<string, any>) || {}

      const updatedTask = await prisma.pendingTask.update({
        where: { id: taskId },
        data: {
          status: 'rejected',
          reviewedAt: new Date(),
          notes: reason || task.notes || 'Clip rejected',
          requirementsData: {
            ...currentReq,
            rejectedAt: new Date().toISOString(),
            rejectReason: reason || null,
          },
        },
      })

      // If an earning was previously attached, cancel/delete it
      await prisma.earning.deleteMany({
        where: { taskId: task.id },
      })

      return NextResponse.json({
        success: true,
        message: 'Task marked as rejected.',
        task: {
          id: updatedTask.id,
          status: updatedTask.status,
          viewCountAtTrigger: updatedTask.viewCountAtTrigger ? Number(updatedTask.viewCountAtTrigger) : null,
        },
      })
    }

    if (action === 'mark_stage') {
      const { taskId, targetStatus } = body
      if (!taskId || !targetStatus) {
        return NextResponse.json({ error: 'taskId and targetStatus required' }, { status: 400 })
      }

      const updated = await prisma.pendingTask.update({
        where: { id: taskId, userId },
        data: { status: targetStatus },
      })

      return NextResponse.json({
        success: true,
        task: {
          id: updated.id,
          status: updated.status,
          viewCountAtTrigger: updated.viewCountAtTrigger ? Number(updated.viewCountAtTrigger) : null,
        },
      })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Action failed' }, { status: 500 })
  }
}
