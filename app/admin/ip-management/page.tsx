import { requireAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/db'
import { decryptIfPresent } from '@/lib/encryption'
import { IpManagementClient } from '@/components/admin/ip-management-client'
import { Globe, Server, CheckCircle2, UserCheck } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function IpManagementPage() {
  await requireAdmin()

  // Fetch all IPs with assigned user relations
  const ips = await prisma.ipAddress.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  })

  // Fetch all users for assignment options
  const users = await prisma.user.findMany({
    where: { role: 'user' },
    select: {
      id: true,
      name: true,
      email: true,
    },
    orderBy: { name: 'asc' },
  })

  // Format IPs safely decrypting passwords for admin
  const formattedIps = ips.map((ip) => ({
    id: ip.id,
    ipAddress: ip.ipAddress,
    port: ip.port,
    username: ip.username,
    password: ip.passwordEnc ? decryptIfPresent(ip.passwordEnc) : null,
    label: ip.label,
    notes: ip.notes,
    isAvailable: ip.isAvailable,
    assignedTo: ip.assignedTo,
    assignedAt: ip.assignedAt ? ip.assignedAt.toISOString() : null,
    createdAt: ip.createdAt.toISOString(),
    user: ip.user,
  }))

  const totalAssigned = formattedIps.filter((i) => i.assignedTo !== null).length
  const totalAvailable = formattedIps.filter((i) => i.isAvailable && !i.assignedTo).length

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Title & Quick Stats */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">VPS & IP Pool Management</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Maintain dedicated IP addresses and VPS connection credentials. Assign exactly 1 IP per user.
          </p>
        </div>

        {/* Quick summary badges */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-card border border-border rounded-lg text-xs">
            <Server size={14} className="text-primary" />
            <span className="font-semibold text-foreground">{formattedIps.length}</span>
            <span className="text-muted-foreground">Total Nodes</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-card border border-border rounded-lg text-xs">
            <CheckCircle2 size={14} className="text-emerald-500" />
            <span className="font-semibold text-foreground">{totalAvailable}</span>
            <span className="text-muted-foreground">Available in Pool</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-card border border-border rounded-lg text-xs">
            <UserCheck size={14} className="text-blue-500" />
            <span className="font-semibold text-foreground">{totalAssigned}</span>
            <span className="text-muted-foreground">Assigned</span>
          </div>
        </div>
      </div>

      {/* Main Interactive Client Table */}
      <IpManagementClient initialIps={formattedIps} users={users} />
    </div>
  )
}
