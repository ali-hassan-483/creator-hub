import { requireUser } from '@/lib/auth-helpers'
import { prisma } from '@/lib/db'
import { Tv, Zap, Clock, ClipboardList, DollarSign, Activity } from 'lucide-react'

export default async function UserDashboardPage() {
  const session = await requireUser()
  const userId = session.user.id

  const [channels, runningAutos, scheduledAutos, pendingTasks, earnings] = await Promise.all([
    prisma.channel.count({ where: { userId, removedAt: null } }),
    prisma.automation.count({ where: { userId, status: 'running' } }),
    prisma.scheduledAutomation.count({ where: { userId, status: 'active' } }),
    prisma.pendingTask.count({ where: { userId, status: { in: ['pending', 'requirements_completed', 'ready_for_review'] } } }),
    prisma.earning.aggregate({
      _sum: { amount: true },
      where: { userId, status: { in: ['confirmed', 'paid'] } },
    }),
  ])

  const stats = [
    { label: 'Channels', value: channels, icon: <Tv size={20} className="text-sky-500" /> },
    { label: 'Running Automations', value: runningAutos, icon: <Zap size={20} className="text-amber-500" /> },
    { label: 'Scheduled', value: scheduledAutos, icon: <Clock size={20} className="text-orange-500" /> },
    { label: 'Pending Tasks', value: pendingTasks, icon: <ClipboardList size={20} className="text-purple-500" /> },
    {
      label: 'Total Earned',
      value: `$${(Number(earnings._sum.amount) || 0).toFixed(2)}`,
      icon: <DollarSign size={20} className="text-emerald-500" />,
    },
  ]

  // Recent automations
  const recentAutos = await prisma.automation.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: {
      id: true,
      name: true,
      status: true,
      runType: true,
      createdAt: true,
      errorMessage: true,
    },
  })

  const autoStatusColors: Record<string, string> = {
    queued: 'bg-muted text-muted-foreground',
    running: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
    completed: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    failed: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
    cancelled: 'bg-muted text-muted-foreground',
  }

  return (
    <div className="p-6 sm:p-8 space-y-8 font-sans max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#2b3345] dark:text-[#e2e8f0] tracking-tight">
          Welcome back, {session.user?.name || session.user?.email}
        </h1>
        <p className="text-sm text-[#6c7a9c] dark:text-[#94a3b8] mt-1">Your content automation overview</p>
      </div>

      {/* Neumorphic Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-5">
        {stats.map(stat => (
          <div key={stat.label} className="neu-flat rounded-3xl p-5 flex flex-col justify-between space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#6c7a9c] dark:text-[#94a3b8]">{stat.label}</span>
              <div className="p-2 rounded-xl neu-button">{stat.icon}</div>
            </div>
            <p className="text-2xl font-extrabold text-[#2b3345] dark:text-[#e2e8f0]">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Neumorphic Recent Automations Card */}
      <div className="neu-flat rounded-3xl p-6 space-y-4">
        <h2 className="text-base font-bold text-[#2b3345] dark:text-[#e2e8f0]">
          Recent Automations
        </h2>
        <div className="divide-y divide-black/5 dark:divide-white/5">
          {recentAutos.length === 0 && (
            <div className="py-12 text-center text-xs text-[#718096] dark:text-[#94a3b8]">
              No automations yet. Go to Run Automation to start one.
            </div>
          )}
          {recentAutos.map(auto => (
            <div key={auto.id} className="flex items-center justify-between py-3.5 first:pt-0 last:pb-0">
              <div>
                <p className="text-xs font-bold text-[#2b3345] dark:text-[#e2e8f0]">
                  {auto.name || `Automation ${auto.id.slice(0, 8)}`}
                </p>
                <p className="text-[11px] text-[#718096] dark:text-[#94a3b8] mt-0.5">
                  {auto.runType} · {auto.createdAt.toLocaleDateString()}
                </p>
                {auto.errorMessage && (
                  <p className="text-[11px] text-destructive mt-0.5 truncate max-w-sm">{auto.errorMessage}</p>
                )}
              </div>
              <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold ${autoStatusColors[auto.status] || 'bg-muted text-muted-foreground'}`}>
                {auto.status}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
