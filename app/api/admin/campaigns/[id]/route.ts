import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/db'
import * as fs from 'fs'
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
      // 1. Delete earnings under this campaign or its tasks
      await tx.earning.deleteMany({
        where: {
          OR: [
            { campaignId: id },
            { task: { campaignId: id } },
          ],
        },
      })

      // 2. Delete task status history for tasks under this campaign
      await tx.taskStatusHistory.deleteMany({
        where: { task: { campaignId: id } },
      })

      // 3. Delete pending tasks under this campaign
      await tx.pendingTask.deleteMany({
        where: { campaignId: id },
      })

      // 4. Delete automations and their child channels & credentials
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

      // 5. Delete scheduled automations and their child channels (CASCADE)
      const scheduledAutos = await tx.scheduledAutomation.findMany({
        where: { campaignId: id },
        select: { id: true },
      })
      const scheduledIds = scheduledAutos.map((s) => s.id)
      if (scheduledIds.length > 0) {
        await tx.scheduledAutomationChannel.deleteMany({
          where: { scheduledAutomationId: { in: scheduledIds } },
        })
        await tx.scheduledAutomation.deleteMany({
          where: { id: { in: scheduledIds } },
        })
      }

      // 6. Delete user access
      await tx.campaignUserAccess.deleteMany({ where: { campaignId: id } })

      // 7. Delete the campaign
      await tx.campaign.delete({
        where: { id },
      })
    })

    // 8. Clean up disk files safely
    try {
      const { getCampaignDir } = await import('@/tools/campaign-processor')
      const dir = getCampaignDir(id)
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    } catch (diskErr) {
      console.warn(`[Campaign DELETE] Could not remove storage dir for ${id}:`, diskErr)
    }

    return NextResponse.json({ success: true, message: 'Campaign deleted successfully.' })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error.' }, { status: 500 })
  }
}
