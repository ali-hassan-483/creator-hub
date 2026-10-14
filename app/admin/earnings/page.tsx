import { requireAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/db'

export default async function AdminEarningsPage() {
  await requireAdmin()

  const earnings = await prisma.earning.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      user: { select: { name: true, email: true } },
      campaign: { select: { name: true } },
    },
  })

  const totals = await prisma.earning.groupBy({
    by: ['status'],
    _sum: { amount: true },
    _count: true,
  })

  const statusColors: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    confirmed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    paid: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Earnings</h1>
        <p className="text-muted-foreground text-sm mt-1">Platform-wide earnings overview</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {totals.map(t => (
          <div key={t.status} className="bg-card border border-border rounded-xl p-5">
            <p className="text-sm text-muted-foreground capitalize mb-1">{t.status}</p>
            <p className="text-2xl font-bold text-foreground">
              ${(Number(t._sum.amount) || 0).toFixed(2)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">{t._count} records</p>
          </div>
        ))}
        {totals.length === 0 && (
          <div className="bg-card border border-border rounded-xl p-5 col-span-3 text-center text-muted-foreground text-sm">
            No earnings recorded yet.
          </div>
        )}
      </div>

      {/* Earnings table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h2 className="font-semibold text-foreground">Recent Earnings</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left px-6 py-3 text-muted-foreground font-medium">User</th>
              <th className="text-left px-6 py-3 text-muted-foreground font-medium">Campaign</th>
              <th className="text-left px-6 py-3 text-muted-foreground font-medium">Amount</th>
              <th className="text-left px-6 py-3 text-muted-foreground font-medium">Status</th>
              <th className="text-left px-6 py-3 text-muted-foreground font-medium">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {earnings.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">
                  No earnings yet.
                </td>
              </tr>
            )}
            {earnings.map(e => (
              <tr key={e.id} className="hover:bg-muted/30 transition-colors">
                <td className="px-6 py-4">
                  <p className="font-medium text-foreground">{e.user.name || e.user.email}</p>
                  <p className="text-xs text-muted-foreground">{e.user.email}</p>
                </td>
                <td className="px-6 py-4 text-foreground">{e.campaign?.name || '—'}</td>
                <td className="px-6 py-4 font-semibold text-foreground">
                  {e.currency} {Number(e.amount).toFixed(2)}
                </td>
                <td className="px-6 py-4">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[e.status] || 'bg-muted text-muted-foreground'}`}>
                    {e.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-muted-foreground text-xs">
                  {e.createdAt.toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
