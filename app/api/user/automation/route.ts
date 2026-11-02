import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * GET /api/user/automation
 * Returns channels, active campaigns, and scheduled automations for the signed-in user
 */
export async function GET() {
  const session = await requireAuth()
  const userId = session.user.id

  try {
    // 1. Fetch user channels with emails and usage
    const channels = await prisma.channel.findMany({
      where: { userId, removedAt: null },
      orderBy: { addedAt: 'desc' },
      select: {
        id: true,
        channelName: true,
        channelHandle: true,
        channelEmail: true,
        whopEmail: true,
        niche: true,
        status: true,
        _count: {
          select: { automationChannels: true },
        },
      },
    })

    // 2. Fetch accessible active campaigns for user
    const campaigns = await prisma.campaign.findMany({
      where: {
        status: 'active',
        userAccess: {
          some: { userId },
        },
      },
      select: {
        id: true,
        name: true,
        description: true,
        config: true,
      },
    })

    // 3. Fetch active schedules
    const schedules = await prisma.scheduledAutomation.findMany({
      where: { userId, status: 'active' },
      orderBy: { createdAt: 'desc' },
      include: {
        campaign: { select: { name: true } },
        channels: { include: { channel: { select: { channelHandle: true, channelName: true } } } },
      },
    })

    // 4. Fetch Whop credentials status
    const whopCreds = await prisma.credential.findMany({
      where: {
        userId,
        credentialType: 'whop',
        cookiesEnc: { not: null },
      },
      select: { email: true, cookiesEnc: true },
    })
    const configuredWhopEmails = new Set(
      whopCreds
        .filter(c => !!c.cookiesEnc && c.cookiesEnc.length > 10)
        .map(c => c.email?.trim().toLowerCase())
        .filter(Boolean)
    )

    return NextResponse.json({
      channels: channels.map(c => {
        const wEmail = c.whopEmail?.trim().toLowerCase()
        const hasWhopCookies = wEmail ? configuredWhopEmails.has(wEmail) : false
        return {
          id: c.id,
          name: c.channelName || 'YouTube Channel',
          handle: c.channelHandle || '',
          niche: c.niche || 'General',
          email: c.channelEmail || 'No Email',
          whopEmail: c.whopEmail || 'No Whop Email',
          hasWhopCookies,
          status: c.status,
          usedCount: c._count.automationChannels || 0,
        }
      }),
      campaigns,
      schedules,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to fetch automation context' }, { status: 500 })
  }
}

/**
 * POST /api/user/automation
 * Execute Instant Run OR Save Schedule Cycle
 */
export async function POST(req: NextRequest) {
  const session = await requireAuth()
  const userId = session.user.id

  try {
    const body = await req.json()
    const { action, channelIds, campaignId, scheduleConfig } = body

    if (!channelIds || !Array.isArray(channelIds) || channelIds.length === 0) {
      return NextResponse.json({ error: 'Please select at least one channel' }, { status: 400 })
    }

    // Deduplicate channelIds so a single channel is never queued multiple times in one automation
    const uniqueChannelIds = Array.from(new Set(channelIds.map((cid: string) => String(cid).trim()).filter(Boolean)))
    if (uniqueChannelIds.length === 0) {
      return NextResponse.json({ error: 'Please select at least one valid channel' }, { status: 400 })
    }

    if (!campaignId) {
      return NextResponse.json({ error: 'Please select a campaign' }, { status: 400 })
    }

    // ── Check Whop Cookies Requirement for Selected Channels ──
    const selectedChannels = await prisma.channel.findMany({
      where: { id: { in: uniqueChannelIds }, userId },
      select: { id: true, channelName: true, whopEmail: true },
    })

    const whopEmails = Array.from(
      new Set(
        selectedChannels
          .map((c) => c.whopEmail?.trim().toLowerCase())
          .filter(Boolean) as string[]
      )
    )

    if (whopEmails.length > 0) {
      const existingWhopCreds = await prisma.credential.findMany({
        where: {
          userId,
          credentialType: 'whop',
          cookiesEnc: { not: null },
        },
        select: { email: true, cookiesEnc: true },
      })

      const missingWhopEmails = whopEmails.filter((we) => {
        return !existingWhopCreds.some(
          (c) => c.email?.trim().toLowerCase() === we && !!c.cookiesEnc && c.cookiesEnc.length > 10
        )
      })

      if (missingWhopEmails.length > 0) {
        return NextResponse.json(
          {
            error: `Whop session cookies are missing for account(s): ${missingWhopEmails.join(', ')}. Please add your Whop cookies in Credentials before starting automation.`,
            missingWhopEmails,
          },
          { status: 400 }
        )
      }
    }

    // Instant Run Now
    if (action === 'run_now') {
      const automation = await prisma.automation.create({
        data: {
          userId,
          campaignId,
          name: `Instant Run - ${Date.now()}`,
          runType: 'immediate',
          status: 'queued',
          channels: {
            create: uniqueChannelIds.map((cid: string) => ({
              channelId: cid,
            })),
          },
        },
      })

      return NextResponse.json({
        success: true,
        message: 'Clipping cycle queued successfully!',
        automationId: automation.id,
      })
    }

    // Schedule Cycle
    if (action === 'schedule_cycle') {
      const {
        repeatDays = 7,
        timesPerDay = 1,
        autoRerunOnFailure = 0,
        cancelOnFailure = false,
        parallelFixer = false,
        scheduleTimes = ['09:00 AM'],
      } = scheduleConfig || {}

      const schedule = await prisma.scheduledAutomation.create({
        data: {
          userId,
          campaignId,
          name: `Schedule Cycle (${repeatDays} days, ${timesPerDay}x daily)`,
          recurrenceType: 'daily',
          status: 'active',
          options: {
            repeatDays: Number(repeatDays),
            timesPerDay: Number(timesPerDay),
            autoRerunOnFailure: Number(autoRerunOnFailure),
            cancelOnFailure: Boolean(cancelOnFailure),
            parallelFixer: Boolean(parallelFixer),
            scheduleTimes,
          },
          channels: {
            create: uniqueChannelIds.map((cid: string) => ({
              channelId: cid,
            })),
          },
        },
      })

      return NextResponse.json({
        success: true,
        message: `Schedule created successfully! Running ${timesPerDay} time(s) a day for ${repeatDays} days.`,
        scheduleId: schedule.id,
      })
    }

    // Clear inactive / all schedules
    if (action === 'clear_inactive') {
      await prisma.scheduledAutomation.updateMany({
        where: { userId },
        data: { status: 'paused' },
      })
      return NextResponse.json({ success: true, message: 'Cleared schedules' })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Automation request failed' }, { status: 500 })
  }
}
