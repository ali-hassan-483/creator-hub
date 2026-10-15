import { requireUser } from '@/lib/auth-helpers'
import { prisma } from '@/lib/db'
import { DeadChannelsClient, DeadChannelItem } from '@/components/user/dead-channels-client'

export const dynamic = 'force-dynamic'

export default async function DeadChannelsPage() {
  const session = await requireUser()
  const userId = session.user.id

  // Fetch all user channels with their latest 10 videos
  const channels = await prisma.channel.findMany({
    where: { userId, removedAt: null },
    orderBy: { addedAt: 'desc' },
    include: {
      videoAnalytics: {
        orderBy: { publishedAt: 'desc' },
        take: 10,
      },
    },
  })

  // Filter dead channels:
  // Has at least 1 video, and ALL videos in the latest up to 10 videos have < 100 views
  const initialDeadChannels: DeadChannelItem[] = []

  for (const ch of channels) {
    const extra = (ch.extraData as Record<string, any>) || {}
    const videos = ch.videoAnalytics

    const hasVideos = videos.length > 0
    const viewCounts = videos.map((v) => Number(v.viewCount))
    const maxViews = hasVideos ? Math.max(...viewCounts) : 0
    const avgViews = hasVideos ? Math.round(viewCounts.reduce((a, b) => a + b, 0) / viewCounts.length) : 0
    const isDead = (hasVideos && viewCounts.every((cnt) => cnt < 100)) || extra.isDead === true

    if (isDead) {
      initialDeadChannels.push({
        id: ch.id,
        channelName: ch.channelName || 'YouTube Channel',
        channelHandle: ch.channelHandle || '@channel',
        channelIdExt: ch.channelIdExt,
        channelEmail: ch.channelEmail || '',
        whopEmail: ch.whopEmail || '',
        niche: ch.niche || 'General',
        status: ch.status,
        isDead: true,
        deadDetectedAt: extra.deadDetectedAt || ch.addedAt.toISOString(),
        videoCount: videos.length,
        maxViews,
        avgViews,
        videos: videos.map((v) => {
          const vExtra = (v.extraData as Record<string, any>) || {}
          return {
            videoIdExt: v.videoIdExt,
            title: v.title || 'Untitled Video',
            viewCount: Number(v.viewCount),
            likes: vExtra.likes || 0,
            thumbnail: vExtra.thumbnail || `https://i.ytimg.com/vi/${v.videoIdExt}/mqdefault.jpg`,
            publishedAt: v.publishedAt ? v.publishedAt.toISOString() : new Date().toISOString(),
          }
        }),
      })
    }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <DeadChannelsClient
        initialChannels={initialDeadChannels}
        initialStats={{
          totalDead: initialDeadChannels.length,
          scanInterval: '24 Hours',
          lastScannedAt: new Date().toISOString(),
        }}
      />
    </div>
  )
}
