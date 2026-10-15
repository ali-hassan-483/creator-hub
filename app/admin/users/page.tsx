import { requireAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/db'
import { UsersTable } from '@/components/admin/users-table'
import { Users, UserCheck, ShieldAlert, Globe } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function AdminUsersPage() {
  await requireAdmin()

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  // Fetch users with related channel and earnings data
  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      createdAt: true,
      lastLoginAt: true,
      vps: {
        select: {
          id: true,
          ipAddress: true,
          port: true,
          label: true,
          isMainVps: true,
        },
      },
      channels: {
        select: {
          id: true,
          addedAt: true,
          removedAt: true,
          status: true,
        },
      },
      earnings: {
        where: { status: 'confirmed' },
        select: {
          amount: true,
        },
      },
      _count: {
        select: {
          automations: true,
        },
      },
    },
  })

  // Fetch available VPS nodes (those with < maxUsers assigned)
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
    .filter((node) => node.users.length < (node.maxUsers || 2))
    .map((node) => ({
      id: node.id,
      ipAddress: node.ipAddress,
      label: `${node.label || 'VPS'} (${node.users.length}/${node.maxUsers || 2})`,
    }))

  // Format users with daily counters
  const formattedUsers = users.map((u) => {
    const activeChannels = u.channels.filter((c) => c.removedAt === null)
    const addedToday = u.channels.filter(
      (c) => c.addedAt >= todayStart && c.removedAt === null
    ).length
    const removedToday = u.channels.filter(
      (c) => c.removedAt && c.removedAt >= todayStart
    ).length

    const totalEarnings = u.earnings.reduce(
      (acc, curr) => acc + Number(curr.amount || 0),
      0
    )

    return {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      isActive: u.isActive,
      createdAt: u.createdAt.toISOString(),
      lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
      assignedIp: u.vps,
      totalChannels: activeChannels.length,
      channelsAddedToday: addedToday,
      channelsRemovedToday: removedToday,
      totalEarnings,
      totalAutomations: u._count.automations,
    }
  })

  const totalActive = formattedUsers.filter((u) => u.isActive).length
  const totalWithIps = formattedUsers.filter((u) => u.assignedIp !== null).length

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Page Title & Stats */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">User Management</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage user accounts, isolate data, view channel activity, and assign dedicated IPs.
          </p>
        </div>

        {/* Quick summary badges */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-card border border-border rounded-lg text-xs">
            <Users size={14} className="text-primary" />
            <span className="font-semibold text-foreground">{users.length}</span>
            <span className="text-muted-foreground">Total Users</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-card border border-border rounded-lg text-xs">
            <UserCheck size={14} className="text-emerald-500" />
            <span className="font-semibold text-foreground">{totalActive}</span>
            <span className="text-muted-foreground">Active</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-card border border-border rounded-lg text-xs">
            <Globe size={14} className="text-blue-500" />
            <span className="font-semibold text-foreground">{totalWithIps}</span>
            <span className="text-muted-foreground">With Assigned IP</span>
          </div>
        </div>
      </div>

      {/* Main Interactive Table */}
      <UsersTable initialUsers={formattedUsers} availableIps={availableIps} />
    </div>
  )
}
