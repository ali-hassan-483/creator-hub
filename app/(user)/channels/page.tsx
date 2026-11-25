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

  // Fetch all channels for this user (including dead ones — shown with a warning badge)
  const rawChannels = await prisma.channel.findMany({
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
      videoAnalytics: {
        orderBy: { publishedAt: 'desc' },
        take: 10,
        select: { viewCount: true },
      },
      _count: {
        select: { videoAnalytics: true, automationChannels: true },
      },
    },
  })

  // All channels shown; compute isDead flag per channel for UI badge
  const channels = rawChannels.map((c) => {
    const extra = (c.extraData as Record<string, any>) || {}
    const videos = c.videoAnalytics || []
    const hasEnoughVideos = videos.length >= 10
    const totalViews = hasEnoughVideos
      ? videos.reduce((acc, v) => acc + Number(v.viewCount || 0), 0)
      : null
    const isDead = extra.isDead === true || (hasEnoughVideos && totalViews !== null && totalViews < 100)
    return { ...c, isDead }
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
    status: (c.status === 'inactive' && c.isDead ? 'active' : c.status) as 'active' | 'inactive' | 'pending' | 'error',
    isDead: c.isDead,
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
    activeCount: formattedChannels.filter((c) => c.status === 'active').length,
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
