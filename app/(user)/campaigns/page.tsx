import { requireUser } from '@/lib/auth-helpers'
import { prisma } from '@/lib/db'
import { CampaignsCatalogClient } from '@/components/user/campaigns-catalog-client'
import { Megaphone } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function UserCampaignsPage() {
  const session = await requireUser()
  const userId = session.user.id

  // Fetch campaigns granted to this specific user (or all users)
  const campaigns = await prisma.campaign.findMany({
    where: {
      status: { in: ['active', 'paused'] },
      userAccess: {
        some: { userId },
      },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      minViews: true,
      config: true,
      createdAt: true,
    },
  })

  const formatted = campaigns.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    status: c.status,
    minViews: c.minViews,
    config: c.config,
    createdAt: c.createdAt.toISOString(),
  }))

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Available Campaigns</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Explore campaigns assigned to your workspace. Review view thresholds, requirements, and run automations.
        </p>
      </div>

      <CampaignsCatalogClient initialCampaigns={formatted} />
    </div>
  )
}
