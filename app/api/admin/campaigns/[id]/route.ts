import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/db'
import { z } from 'zod'

const updateCampaignSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  status: z.enum(['draft', 'active', 'paused', 'ended']).optional(),
  minViews: z.number().nullable().optional(),
  config: z.record(z.any()).nullable().optional(),
  assignedUserIds: z.array(z.string()).optional(),
  assignAllUsers: z.boolean().optional(),
})

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireAdmin()
    const { id } = params

    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: {
        userAccess: {
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
        },
        _count: {
          select: {
            pendingTasks: true,
            automations: true,
            earnings: true,
          },
        },
      },
    })

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    return NextResponse.json(campaign)
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error.' }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireAdmin()
    const { id } = params
    const body = await req.json()
    const data = updateCampaignSchema.parse(body)

    const updatePayload: any = {}
    if (data.name !== undefined) updatePayload.name = data.name.trim()
    if (data.description !== undefined) updatePayload.description = data.description ? data.description.trim() : null
    if (data.status !== undefined) updatePayload.status = data.status
    if (data.minViews !== undefined) updatePayload.minViews = data.minViews
    if (data.config !== undefined) updatePayload.config = data.config

    const updated = await prisma.campaign.update({
      where: { id },
      data: updatePayload,
    })

    // Update user access if provided
    if (data.assignAllUsers) {
      const allUsers = await prisma.user.findMany({
        where: { role: 'user', isActive: true },
        select: { id: true },
      })
      await prisma.campaignUserAccess.deleteMany({ where: { campaignId: id } })
      if (allUsers.length > 0) {
        await prisma.campaignUserAccess.createMany({
          data: allUsers.map((u) => ({ campaignId: id, userId: u.id })),
        })
      }
    } else if (data.assignedUserIds !== undefined) {
      await prisma.campaignUserAccess.deleteMany({ where: { campaignId: id } })
      if (data.assignedUserIds.length > 0) {
        await prisma.campaignUserAccess.createMany({
          data: data.assignedUserIds.map((userId) => ({ campaignId: id, userId })),
        })
      }
    }

    return NextResponse.json(updated)
  } catch (err: any) {
    if (err.name === 'ZodError') return NextResponse.json({ error: err.errors[0]?.message || 'Validation error' }, { status: 400 })
    return NextResponse.json({ error: err.message || 'Internal server error.' }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireAdmin()
    const { id } = params

    await prisma.$transaction(async (tx) => {
      // 1. Delete tasks under this campaign
      const tasks = await tx.pendingTask.findMany({
        where: { campaignId: id },
        select: { id: true },
      })
      const taskIds = tasks.map((t) => t.id)
      if (taskIds.length > 0) {
        await tx.taskStatusHistory.deleteMany({
          where: { taskId: { in: taskIds } },
        })
        await tx.earning.deleteMany({
          where: { taskId: { in: taskIds } },
        })
        await tx.pendingTask.deleteMany({
          where: { id: { in: taskIds } },
        })
      }

      // 2. Delete automations under this campaign
      const autos = await tx.automation.findMany({
        where: { campaignId: id },
        select: { id: true },
      })
      const autoIds = autos.map((a) => a.id)
      if (autoIds.length > 0) {
        await tx.automationChannel.deleteMany({
          where: { automationId: { in: autoIds } },
        })
        await tx.automationCredential.deleteMany({
          where: { automationId: { in: autoIds } },
        })
        await tx.automation.deleteMany({
          where: { id: { in: autoIds } },
        })
      }

      // 3. Delete scheduled automations
      await tx.scheduledAutomation.deleteMany({ where: { campaignId: id } })

      // 4. Delete user access
      await tx.campaignUserAccess.deleteMany({ where: { campaignId: id } })

      // 5. Delete campaign
      await tx.campaign.delete({
        where: { id },
      })
    })

    return NextResponse.json({ success: true, message: 'Campaign deleted successfully.' })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error.' }, { status: 500 })
  }
}
