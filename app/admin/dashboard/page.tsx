import { requireAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/db'
import {
  Users,
  Tv,
  Zap,
  Clock,
  DollarSign,
  Activity,
} from 'lucide-react'

export default async function AdminDashboardPage() {
  await requireAdmin()

  // Aggregate stats
  const [totalUsers, totalChannels, activeChannels, runningAutos, scheduledAutos, totalEarnings] =
    await Promise.all([
      prisma.user.count({ where: { role: 'user', isActive: true } }),
      prisma.channel.count({ where: { removedAt: null } }),
      prisma.channel.count({ where: { status: 'active', removedAt: null } }),
      prisma.automation.count({ where: { status: 'running' } }),
      prisma.scheduledAutomation.count({ where: { status: 'active' } }),
      prisma.earning.aggregate({ _sum: { amount: true }, where: { status: 'confirmed' } }),
    ])

  const stats = [
    { label: 'Total Users', value: totalUsers, icon: <Users size={20} />, color: 'text-blue-500' },
    { label: 'Total Channels', value: totalChannels, icon: <Tv size={20} />, color: 'text-purple-500' },
    { label: 'Active Channels', value: activeChannels, icon: <Activity size={20} />, color: 'text-green-500' },
    { label: 'Running Automations', value: runningAutos, icon: <Zap size={20} />, color: 'text-yellow-500' },
    { label: 'Scheduled Automations', value: scheduledAutos, icon: <Clock size={20} />, color: 'text-orange-500' },
    {
      label: 'Confirmed Earnings',
      value: `$${(Number(totalEarnings._sum.amount) || 0).toFixed(2)}`,
      icon: <DollarSign size={20} />,
      color: 'text-emerald-500',
    },
  ]

  // Recent users
  const recentUsers = await prisma.user.findMany({
    where: { role: 'user' },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: {
      id: true,
      name: true,
      email: true,
      createdAt: true,
      isActive: true,
      _count: { select: { channels: { where: { removedAt: null } } } },
    },
  })

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Admin Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">Platform-wide overview</p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {stats.map(stat => (
          <div key={stat.label} className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-muted-foreground">{stat.label}</span>
              <span className={stat.color}>{stat.icon}</span>
            </div>
            <p className="text-2xl font-bold text-foreground">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Recent users table */}
      <div className="bg-card border border-border rounded-xl">
        <div className="px-6 py-4 border-b border-border">
          <h2 className="font-semibold text-foreground">Recent Users</h2>
        </div>
        <div className="divide-y divide-border">
          {recentUsers.length === 0 && (
            <p className="px-6 py-8 text-center text-muted-foreground text-sm">No users yet.</p>
          )}
          {recentUsers.map(user => (
            <div key={user.id} className="flex items-center justify-between px-6 py-4">
              <div>
                <p className="text-sm font-medium text-foreground">{user.name || user.email}</p>
                <p className="text-xs text-muted-foreground">{user.email}</p>
              </div>
              <div className="flex items-center gap-4 text-right">
                <div>
                  <p className="text-sm font-semibold text-foreground">{user._count.channels}</p>
                  <p className="text-xs text-muted-foreground">channels</p>
                </div>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    user.isActive
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {user.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
