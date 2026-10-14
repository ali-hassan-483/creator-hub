import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/db'

export async function GET(req: NextRequest) {
  try {
    await requireAdmin()

    const { searchParams } = new URL(req.url)
    const format = searchParams.get('format') || 'json'
    const campaignId = searchParams.get('id')

    const whereClause: any = {}
    if (campaignId) {
      whereClause.id = campaignId
    }

    const campaigns = await prisma.campaign.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      include: {
        userAccess: {
          include: {
            user: {
              select: { id: true, name: true, email: true },
            },
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

    const exportData = campaigns.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      status: c.status,
      minViews: c.minViews,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      assignedUsers: c.userAccess.map((ua) => ({
        id: ua.user.id,
        name: ua.user.name,
        email: ua.user.email,
      })),
      stats: {
        pendingTasksCount: c._count.pendingTasks,
        automationsCount: c._count.automations,
        earningsCount: c._count.earnings,
      },
      config: c.config || {},
    }))

    const dateStr = new Date().toISOString().split('T')[0]

    if (format === 'csv') {
      // Generate CSV
      const headers = [
        'ID',
        'Campaign Name',
        'Status',
        'Min Views',
        'Niche',
        'Ready To Post',
        'Whop Submission Link',
        'Whop Channel Name',
        'Fix YT Mentions',
        'Pending Tasks Enabled',
        'Daily Post Limit',
        'Clipping Strategies',
        'Short Duration (s)',
        'Start Offset (s)',
        'FTC Disclosure',
        'On-Screen Max Chars',
        'Max Title Chars',
        'Predefined Description',
        'Assigned Users Count',
        'Created At',
      ]

      const rows = exportData.map((c) => {
        const cfg = (c.config as any) || {}
        return [
          `"${c.id}"`,
          `"${(c.name || '').replace(/"/g, '""')}"`,
          `"${c.status}"`,
          c.minViews || 0,
          `"${(cfg.niche || '').replace(/"/g, '""')}"`,
          `"${cfg.readyToPost || 'no'}"`,
          `"${(cfg.submissionLink || '').replace(/"/g, '""')}"`,
          `"${(cfg.whopChannelName || '').replace(/"/g, '""')}"`,
          `"${cfg.fixYoutubeMentions || 'no'}"`,
          `"${cfg.enablePendingTasks || 'disabled'}"`,
          cfg.dailyPostLimit || 45,
          `"${Array.isArray(cfg.clippingStrategies) ? cfg.clippingStrategies.join('; ') : ''}"`,
          cfg.shortDuration || 25,
          cfg.startOffset || 0,
          cfg.volumeMultiplier || 1.0,
          `"${(cfg.ftcDisclosure || '').replace(/"/g, '""')}"`,
          cfg.onScreenMaxCharacters || 50,
          cfg.maxTitleCharacters || 60,
          `"${(cfg.predefinedDescription || '').replace(/"/g, '""')}"`,
          c.assignedUsers.length,
          `"${c.createdAt}"`,
        ].join(',')
      })

      const csvContent = [headers.join(','), ...rows].join('\n')

      return new NextResponse(csvContent, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="campaigns_export_${dateStr}.csv"`,
        },
      })
    }

    // Default JSON export
    return new NextResponse(JSON.stringify(exportData, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="campaigns_export_${dateStr}.json"`,
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Export failed.' }, { status: 500 })
  }
}
