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
    // 1. Fetch campaigns accessible to the user
    const campaigns = await prisma.campaign.findMany({
      where: {
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

    // 2. Build where filter for tasks
    const whereClause: any = { userId }
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

    const formattedTasks = tasks.map((t) => {
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
