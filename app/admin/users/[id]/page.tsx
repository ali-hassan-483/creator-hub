import { requireAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/db'
import { decryptIfPresent } from '@/lib/encryption'
import { notFound } from 'next/navigation'
import { UserDetailClient } from '@/components/admin/user-detail-client'

export const dynamic = 'force-dynamic'

export default async function AdminUserDetailPage({
  params,
}: {
  params: { id: string }
}) {
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
    },
  })

  if (!user) {
    notFound()
  }

  // Fetch available IPs for assignment
  const availableIps = await prisma.ipAddress.findMany({
    where: {
      OR: [{ assignedTo: null }, { assignedTo: id }],
    },
    select: {
      id: true,
      ipAddress: true,
      label: true,
    },
  })

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

  const formattedUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt.toISOString(),
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
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
          assignedAt: user.assignedIp.assignedAt
            ? user.assignedIp.assignedAt.toISOString()
            : null,
        }
      : null,
    channels: user.channels.map((c) => ({
      ...c,
      addedAt: c.addedAt.toISOString(),
      removedAt: c.removedAt ? c.removedAt.toISOString() : null,
    })),
    automations: user.automations.map((a) => ({
      ...a,
      startedAt: a.startedAt ? a.startedAt.toISOString() : null,
      completedAt: a.completedAt ? a.completedAt.toISOString() : null,
      createdAt: a.createdAt.toISOString(),
    })),
    earnings: user.earnings.map((e) => ({
      ...e,
      amount: Number(e.amount),
      earnedAt: e.earnedAt ? e.earnedAt.toISOString() : null,
    })),
  }

  return <UserDetailClient initialUser={formattedUser} availableIps={availableIps} />
}
