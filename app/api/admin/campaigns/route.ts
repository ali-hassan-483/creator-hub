import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/db'
import { z } from 'zod'

const createCampaignSchema = z.object({
  name: z.string().min(1, 'Campaign name is required'),
  description: z.string().optional().nullable(),
  status: z.enum(['draft', 'active', 'paused', 'ended']).default('active'),
  minViews: z.number().nullable().optional(),
  config: z.record(z.any()).optional().nullable(),
  assignedUserIds: z.array(z.string()).optional(), // specific users or empty/all
  assignAllUsers: z.boolean().optional().default(false),
})

export async function GET() {
  try {
    await requireAdmin()

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

    const { countEditedClips, getSourcesDir } = await import('@/tools/campaign-processor')
    const fs = await import('fs')

    const formatted = campaigns.map((c) => {
      let editedClipsCount = 0
      let sourceFilesCount = 0
      try {
        editedClipsCount = countEditedClips(c.id)
        const sourcesDir = getSourcesDir(c.id)
        if (fs.existsSync(sourcesDir)) {
          sourceFilesCount = fs.readdirSync(sourcesDir).filter((f) => !f.startsWith('.')).length
        }
      } catch {}

      return {
        id: c.id,
        name: c.name,
        description: c.description,
        status: c.status,
        minViews: c.minViews,
        config: c.config,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
        assignedUsers: c.userAccess.map((ua) => ua.user),
        pendingTasksCount: c._count.pendingTasks,
        automationsCount: c._count.automations,
        earningsCount: c._count.earnings,
        availableClips: editedClipsCount,
        sourceFilesCount,
      }
    })

    return NextResponse.json(formatted)
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAdmin()
    const adminId = session.user.id
    const body = await req.json()
    const data = createCampaignSchema.parse(body)

    const campaign = await prisma.campaign.create({
      data: {
        name: data.name.trim(),
        description: data.description ? data.description.trim() : null,
        status: data.status,
        minViews: data.minViews || null,
        config: data.config || {},
        createdBy: adminId,
      },
    })

    // Assign users
    if (data.assignAllUsers) {
      const allUsers = await prisma.user.findMany({
        where: { role: 'user', isActive: true },
        select: { id: true },
      })
      if (allUsers.length > 0) {
        await prisma.campaignUserAccess.createMany({
          data: allUsers.map((u) => ({
            campaignId: campaign.id,
            userId: u.id,
          })),
          skipDuplicates: true,
        })
      }
    } else if (data.assignedUserIds && data.assignedUserIds.length > 0) {
      await prisma.campaignUserAccess.createMany({
        data: data.assignedUserIds.map((userId) => ({
          campaignId: campaign.id,
          userId,
        })),
        skipDuplicates: true,
      })
    }

    // 🚀 Auto-trigger campaign setup (download sources, logos, hooks, transcripts) in background
    const cfg = (data.config || {}) as Record<string, any>
    const sourceUrls = cfg.sourceVideoUrls || cfg.driveYoutubeUrls || ''

    if (sourceUrls.trim()) {
      // Fire-and-forget background setup
      import('@/tools/campaign-processor').then(async ({ runCampaignSetup, isSetupComplete }) => {
        try {
          // Import the tracker from setup-status to register progress
          const { getSetupTracker } = await import('@/app/api/admin/campaigns/setup-status/route')
          const tracker = getSetupTracker()
          
          tracker.set(campaign.id, {
            status: 'downloading' as const,
            progress: '📥 Starting campaign setup...',
            startedAt: Date.now(),
          })

          const result = await runCampaignSetup(campaign.id, {
            ...cfg,
            campaignName: data.name.trim(),
            niche: cfg.niche || 'general',
          }, (progressMsg) => {
            const entry = tracker.get(campaign.id)
            if (entry) entry.progress = progressMsg
          })

          tracker.set(campaign.id, {
            status: 'completed' as const,
            progress: `✅ Setup complete! ${result.sourceVideoPaths.length} sources downloaded.`,
            startedAt: tracker.get(campaign.id)?.startedAt || Date.now(),
          })
          console.log(`[AutoSetup] ✅ Campaign "${data.name}" (${campaign.id}) — ${result.sourceVideoPaths.length} sources downloaded`)
        } catch (err: any) {
          console.error(`[AutoSetup] ❌ Campaign "${data.name}" (${campaign.id}) setup failed:`, err.message)
          try {
            const { getSetupTracker } = await import('@/app/api/admin/campaigns/setup-status/route')
            const tracker = getSetupTracker()
            tracker.set(campaign.id, {
              status: 'error' as const,
              progress: `❌ Setup failed: ${err.message}`,
              startedAt: tracker.get(campaign.id)?.startedAt || Date.now(),
              error: err.message,
            })
          } catch {}
        }
      }).catch((err) => {
        console.error(`[AutoSetup] Failed to import campaign-processor:`, err.message)
      })
    }

    return NextResponse.json(campaign, { status: 201 })
  } catch (err: any) {
    if (err.name === 'ZodError') return NextResponse.json({ error: err.errors[0]?.message || 'Validation error' }, { status: 400 })
    return NextResponse.json({ error: err.message || 'Internal server error.' }, { status: 500 })
  }
}
