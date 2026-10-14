import { requireAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/db'
import { AdminSandboxTestClient } from '@/components/admin/admin-sandbox-test-client'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Sandbox Style Test | Admin | Creator Hub',
  description: 'Test compile sample vertical video clips and verify styling and AI metadata before launching campaigns.',
}

export default async function AdminSandboxTestPage() {
  await requireAdmin()

  const campaigns = await prisma.campaign.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      status: true,
      description: true,
      config: true,
    },
  })

  return <AdminSandboxTestClient initialCampaigns={campaigns} />
}
