import { requireUser } from '@/lib/auth-helpers'
import { prisma } from '@/lib/db'
import { ChannelsClient } from '@/components/user/channels-client'
import { Tv, Sparkles } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function ChannelsPage() {
  const session = await requireUser()
  const userId = session.user.id

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  // Strictly isolate data to this authenticated user only
  const channels = await prisma.channel.findMany({
    where: { userId, removedAt: null },
    orderBy: { addedAt: 'desc' },
    select: {
      id: true,
      channelName: true,
      channelHandle: true,
      channelIdExt: true,
      channelEmail: true,
      whopEmail: true,
      niche: true,
      clientId: true,
      platform: true,
      status: true,
      extraData: true,
      addedAt: true,
      _count: {
        select: { videoAnalytics: true, automationChannels: true },
      },
    },
  })

  const addedToday = await prisma.channel.count({
    where: { userId, addedAt: { gte: todayStart }, removedAt: null },
  })

  const removedToday = await prisma.channel.count({
    where: { userId, removedAt: { gte: todayStart } },
  })

  const formattedChannels = channels.map((c) => ({
    id: c.id,
    channelName: c.channelName,
    channelHandle: c.channelHandle,
    channelIdExt: c.channelIdExt,
    channelEmail: c.channelEmail,
    whopEmail: c.whopEmail,
    niche: c.niche,
    clientId: c.clientId,
    platform: c.platform,
    status: c.status,
    extraData: c.extraData,
    addedAt: c.addedAt.toISOString(),
    _count: {
      videoAnalytics: c._count.videoAnalytics,
      automations: c._count.automationChannels,
    },
  }))

  const stats = {
    totalChannels: channels.length,
    addedToday,
    removedToday,
    activeCount: channels.filter((c) => c.status === 'active').length,
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Channel Management</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Add, monitor, and manage your YouTube channels. Connect them to automated clipping & uploading campaigns.
        </p>
      </div>

      <ChannelsClient initialChannels={formattedChannels} stats={stats} />
    </div>
  )
}
