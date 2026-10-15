import { requireAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/db'
import { getAllVpsNodes } from '@/lib/vps-service'
import { IpManagementClient } from '@/components/admin/ip-management-client'
import { Server, CheckCircle2, UserCheck, Activity } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function IpManagementPage() {
  await requireAdmin()

  // Fetch formatted VPS nodes with Main VPS ensured
  const vpsNodes = await getAllVpsNodes()

  // Fetch all registered users for assignment modal
  const users = await prisma.user.findMany({
    where: { role: 'user' },
    select: {
      id: true,
      name: true,
      email: true,
      vpsId: true,
    },
    orderBy: { name: 'asc' },
  })

  const onlineNodes = vpsNodes.filter((n) => n.status === 'online').length
  const totalSlots = vpsNodes.reduce((acc, curr) => acc + curr.maxUsers, 0)
  const usedSlots = vpsNodes.reduce((acc, curr) => acc + curr.assignedCount, 0)

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Title & Quick Stats */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <Server className="text-purple-500" size={26} />
            Dedicated Upload VPS Management
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage Dedicated Upload Nodes. Each VPS node (including Main Server) supports up to 2 users for upload isolation.
          </p>
        </div>

        {/* Quick summary badges */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-card border border-border rounded-lg text-xs">
            <Server size={14} className="text-primary" />
            <span className="font-semibold text-foreground">{vpsNodes.length}</span>
            <span className="text-muted-foreground">Total VPS Nodes</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-card border border-border rounded-lg text-xs">
            <Activity size={14} className="text-emerald-500" />
            <span className="font-semibold text-foreground">{onlineNodes}</span>
            <span className="text-muted-foreground">Online</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-card border border-border rounded-lg text-xs">
            <UserCheck size={14} className="text-blue-500" />
            <span className="font-semibold text-foreground">{usedSlots} / {totalSlots}</span>
            <span className="text-muted-foreground">User Capacity</span>
          </div>
        </div>
      </div>

      {/* Main Interactive Client Table */}
      <IpManagementClient initialIps={vpsNodes as any} users={users} />
    </div>
  )
}
