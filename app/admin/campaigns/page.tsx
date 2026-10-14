import { requireAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/db'
import { CampaignsClient } from '@/components/admin/campaigns-client'
import { Megaphone } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function AdminCampaignsPage() {
  await requireAdmin()

  // Fetch campaigns
  const campaigns = await prisma.campaign.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      userAccess: {
        select: {
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

  // Fetch all users for assignment
  const users = await prisma.user.findMany({
    where: { role: 'user', isActive: true },
    select: { id: true, name: true, email: true },
    orderBy: { name: 'asc' },
  })

  const formattedCampaigns = campaigns.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    status: c.status,
    minViews: c.minViews,
    config: c.config,
    createdAt: c.createdAt.toISOString(),
    assignedUsers: c.userAccess.map((ua) => ua.user),
    pendingTasksCount: c._count.pendingTasks,
    automationsCount: c._count.automations,
    earningsCount: c._count.earnings,
  }))

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Campaign Management</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Create clipping campaigns, set minimum-view goals for pending tasks, and grant user access.
        </p>
      </div>

      <CampaignsClient initialCampaigns={formattedCampaigns} allUsers={users} />
    </div>
  )
}
