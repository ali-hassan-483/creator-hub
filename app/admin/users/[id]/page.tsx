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
      vps: true,
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

  // Fetch available VPS nodes for assignment
  const allNodes = await prisma.ipAddress.findMany({
    select: {
      id: true,
      ipAddress: true,
      label: true,
      maxUsers: true,
      isMainVps: true,
      users: { select: { id: true } },
    },
    orderBy: [{ isMainVps: 'desc' }, { createdAt: 'desc' }],
  })

  const availableIps = allNodes
    .filter((node) => node.users.some((u) => u.id === id) || node.users.length < (node.maxUsers || 2))
    .map((node) => ({
      id: node.id,
      ipAddress: node.ipAddress,
      label: `${node.label || 'VPS'} (${node.users.length}/${node.maxUsers || 2}${node.isMainVps ? ' - Main' : ''})`,
    }))

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
    assignedIp: user.vps
      ? {
          id: user.vps.id,
          ipAddress: user.vps.ipAddress,
          port: user.vps.port,
          username: user.vps.username,
          password: user.vps.passwordEnc
            ? decryptIfPresent(user.vps.passwordEnc)
            : null,
          label: user.vps.label,
          notes: user.vps.notes,
          isMainVps: user.vps.isMainVps,
          status: user.vps.status,
          assignedAt: user.vps.createdAt.toISOString(),
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
