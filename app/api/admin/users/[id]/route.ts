import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/db'
import { decryptIfPresent } from '@/lib/encryption'
import bcrypt from 'bcryptjs'
import { z } from 'zod'

const updateUserSchema = z.object({
  name: z.string().optional().nullable(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional().nullable(),
  isActive: z.boolean().optional(),
  role: z.enum(['user', 'admin']).optional(),
  assignedIpId: z.string().optional().nullable(), // pass null to unassign, or ipAddress id
})

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireAdmin()
    const { id } = params

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        assignedIp: true,
        channels: {
          orderBy: { addedAt: 'desc' },
        },
        automations: {
          orderBy: { createdAt: 'desc' },
          take: 15,
          include: {
            campaign: { select: { name: true } },
          },
        },
        earnings: {
          orderBy: { createdAt: 'desc' },
          include: {
            campaign: { select: { name: true } },
          },
        },
        activityLogs: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 })
    }

    const activeChannels = user.channels.filter((c) => c.removedAt === null)
    const addedToday = user.channels.filter(
      (c) => c.addedAt >= todayStart && c.removedAt === null
    ).length
    const removedToday = user.channels.filter(
      (c) => c.removedAt && c.removedAt >= todayStart
    ).length

    const confirmedEarnings = user.earnings
      .filter((e) => e.status === 'confirmed')
      .reduce((acc, curr) => acc + Number(curr.amount || 0), 0)

    const pendingEarnings = user.earnings
      .filter((e) => e.status === 'pending')
      .reduce((acc, curr) => acc + Number(curr.amount || 0), 0)

    return NextResponse.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      stats: {
        totalChannels: activeChannels.length,
        channelsAddedToday: addedToday,
        channelsRemovedToday: removedToday,
        confirmedEarnings,
        pendingEarnings,
        totalAutomations: user.automations.length,
      },
      assignedIp: user.assignedIp
        ? {
            id: user.assignedIp.id,
            ipAddress: user.assignedIp.ipAddress,
            port: user.assignedIp.port,
            username: user.assignedIp.username,
            password: user.assignedIp.passwordEnc
              ? decryptIfPresent(user.assignedIp.passwordEnc)
              : null,
            label: user.assignedIp.label,
            notes: user.assignedIp.notes,
            assignedAt: user.assignedIp.assignedAt,
          }
        : null,
      channels: user.channels,
      automations: user.automations,
      earnings: user.earnings,
      activityLogs: user.activityLogs,
    })
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
    const data = updateUserSchema.parse(body)

    const updatePayload: any = {}
    if (data.name !== undefined) updatePayload.name = data.name?.trim() || null
    if (data.email !== undefined) updatePayload.email = data.email.toLowerCase().trim()
    if (data.isActive !== undefined) updatePayload.isActive = data.isActive
    if (data.role !== undefined) updatePayload.role = data.role
    if (data.password) {
      updatePayload.passwordHash = await bcrypt.hash(data.password, 12)
    }

    // IP assignment/unassignment logic
    if (data.assignedIpId !== undefined) {
      if (data.assignedIpId === null) {
        // Unassign current IP
        await prisma.ipAddress.updateMany({
          where: { assignedTo: id },
          data: { assignedTo: null, assignedAt: null, isAvailable: true },
        })
      } else {
        // Unassign user's previous IP if different
        await prisma.ipAddress.updateMany({
          where: { assignedTo: id, id: { not: data.assignedIpId } },
          data: { assignedTo: null, assignedAt: null, isAvailable: true },
        })

        // Assign the new IP to this user
        await prisma.ipAddress.update({
          where: { id: data.assignedIpId },
          data: {
            assignedTo: id,
            assignedAt: new Date(),
            isAvailable: false,
          },
        })
      }
    }

    const updated = await prisma.user.update({
      where: { id },
      data: updatePayload,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
      },
    })

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

    // Use a transaction to clean up all related records before deleting user
    await prisma.$transaction(async (tx) => {
      // 1. Free up any assigned IP
      await tx.ipAddress.updateMany({
        where: { assignedTo: id },
        data: { assignedTo: null, assignedAt: null, isAvailable: true },
      })

      // 2. Delete task status histories for tasks of this user
      const userTasks = await tx.pendingTask.findMany({
        where: { userId: id },
        select: { id: true },
      })
      const taskIds = userTasks.map((t) => t.id)
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

      // 3. Delete automation relations
      const automations = await tx.automation.findMany({
        where: { userId: id },
        select: { id: true },
      })
      const autoIds = automations.map((a) => a.id)
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

      // 4. Delete channels and related video analytics
      const channels = await tx.channel.findMany({
        where: { userId: id },
        select: { id: true },
      })
      const channelIds = channels.map((c) => c.id)
      if (channelIds.length > 0) {
        await tx.videoAnalytic.deleteMany({
          where: { channelId: { in: channelIds } },
        })
        await tx.analyticsSnapshot.deleteMany({
          where: { channelId: { in: channelIds } },
        })
        await tx.channel.deleteMany({
          where: { id: { in: channelIds } },
        })
      }

      // 5. Delete other configs & credentials
      await tx.geminiConfig.deleteMany({ where: { userId: id } })
      await tx.discordConfig.deleteMany({ where: { userId: id } })
      await tx.credential.deleteMany({ where: { userId: id } })
      await tx.campaignUserAccess.deleteMany({ where: { userId: id } })
      await tx.earning.deleteMany({ where: { userId: id } })
      await tx.activityLog.deleteMany({ where: { userId: id } })

      // 6. Finally delete the user
      await tx.user.delete({
        where: { id },
      })
    })

    return NextResponse.json({ success: true, message: 'User deleted successfully.' })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error.' }, { status: 500 })
  }
}
