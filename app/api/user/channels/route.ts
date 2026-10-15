import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth-helpers'
import { prisma } from '@/lib/db'
import { encryptIfPresent, decryptIfPresent } from '@/lib/encryption'
import { verifyGoogleRefreshToken } from '@/lib/youtube-auth'
import { z } from 'zod'

const addChannelSchema = z.object({
  channelName: z.string().min(1, 'Channel Name is required'),
  channelHandle: z.string().min(1, 'Channel Handler / Handle is required'),
  channelEmail: z.string().email('Valid Channel / YouTube Email is required'),
  whopEmail: z.string().email('Valid Whop Account Email is required'),
  niche: z.string().min(1, 'Niche is required'),
  clientId: z.string().min(1, 'Client ID is required'),
  clientSecret: z.string().min(1, 'Client Secret is required'),
  refreshToken: z.string().min(1, 'Refresh Token is required'),
  status: z.enum(['active', 'inactive']).default('active'),
})

const bulkChannelSchema = z.object({
  channels: z.array(addChannelSchema).min(1, 'At least one channel is required'),
})

export async function GET() {
  try {
    const session = await requireUser()
    const userId = session.user.id

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

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
        clientId: true,
        platform: true,
        status: true,
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

    return NextResponse.json({
      channels,
      stats: {
        totalChannels: channels.length,
        addedToday,
        removedToday,
        activeCount: channels.filter((c) => c.status === 'active').length,
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireUser()
    const userId = session.user.id
    const body = await req.json()

    // 1. Bulk Channels Insertion with verification
    if (body.channels && Array.isArray(body.channels)) {
      const data = bulkChannelSchema.parse(body)

      const preparedList = []
      for (const ch of data.channels) {
        // MANDATORY: Verify that refresh token was generated with this client_id & client_secret
        const verifyRes = await verifyGoogleRefreshToken(ch.clientId, ch.clientSecret, ch.refreshToken)
        if (!verifyRes.valid) {
          return NextResponse.json(
            { error: `Verification failed for channel "${ch.channelName}": ${verifyRes.error}` },
            { status: 400 }
          )
        }

        preparedList.push({
          userId,
          channelName: ch.channelName.trim(),
          channelHandle: ch.channelHandle.trim().startsWith('@') ? ch.channelHandle.trim() : `@${ch.channelHandle.trim()}`,
          channelIdExt: verifyRes.channelIdExt || ch.channelHandle.trim(),
          channelEmail: ch.channelEmail.trim().toLowerCase(),
          whopEmail: ch.whopEmail.trim().toLowerCase(),
          niche: ch.niche.trim(),
          clientId: ch.clientId.trim(),
          clientSecretEnc: encryptIfPresent(ch.clientSecret.trim()),
          refreshTokenEnc: encryptIfPresent(ch.refreshToken.trim()),
          status: ch.status,
          platform: 'youtube',
          addedAt: new Date(),
        })
      }

      await prisma.channel.createMany({ data: preparedList })

      return NextResponse.json({
        success: true,
        count: preparedList.length,
        message: `Successfully verified and added ${preparedList.length} channels.`,
      }, { status: 201 })
    }

    // 2. Single Channel Addition with mandatory token verification
    const data = addChannelSchema.parse(body)

    // MANDATORY VERIFICATION: Google OAuth test
    const verification = await verifyGoogleRefreshToken(
      data.clientId,
      data.clientSecret,
      data.refreshToken
    )

    if (!verification.valid) {
      return NextResponse.json(
        {
          error: `Token Verification Failed: ${verification.error}. Make sure this Refresh Token was generated using the provided Client ID & Client Secret.`,
        },
        { status: 400 }
      )
    }

    const cleanHandle = data.channelHandle.trim().startsWith('@')
      ? data.channelHandle.trim()
      : `@${data.channelHandle.trim()}`

    const newChannel = await prisma.channel.create({
      data: {
        userId,
        channelName: data.channelName.trim(),
        channelHandle: cleanHandle,
        channelIdExt: verification.channelIdExt || cleanHandle,
        channelEmail: data.channelEmail.trim().toLowerCase(),
        whopEmail: data.whopEmail.trim().toLowerCase(),
        niche: data.niche.trim(),
        clientId: data.clientId.trim(),
        clientSecretEnc: encryptIfPresent(data.clientSecret.trim()),
        refreshTokenEnc: encryptIfPresent(data.refreshToken.trim()),
        status: data.status,
        platform: 'youtube',
        addedAt: new Date(),
      },
      select: {
        id: true,
        channelName: true,
        channelHandle: true,
        channelEmail: true,
        whopEmail: true,
        niche: true,
        clientId: true,
        status: true,
        platform: true,
        addedAt: true,
      },
    })

    return NextResponse.json(
      {
        ...newChannel,
        verified: true,
        message: 'Credentials verified and channel created successfully!',
      },
      { status: 201 }
    )
  } catch (err: any) {
    if (err.name === 'ZodError') return NextResponse.json({ error: err.errors[0]?.message || 'Validation error' }, { status: 400 })
    return NextResponse.json({ error: err.message || 'Internal server error.' }, { status: 500 })
  }
}

// Bulk Delete channels
export async function DELETE(req: NextRequest) {
  try {
    const session = await requireUser()
    const userId = session.user.id
    const body = await req.json()

    const { channelIds } = body
    if (!channelIds || !Array.isArray(channelIds) || channelIds.length === 0) {
      return NextResponse.json({ error: 'channelIds array is required.' }, { status: 400 })
    }

    // Soft delete: set removedAt + inactive for all matching channels
    const result = await prisma.channel.updateMany({
      where: {
        id: { in: channelIds },
        userId,
        removedAt: null,
      },
      data: {
        removedAt: new Date(),
        status: 'inactive',
      },
    })

    return NextResponse.json({
      success: true,
      count: result.count,
      message: `Successfully removed ${result.count} channel(s).`,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error.' }, { status: 500 })
  }
}

// Bulk Edit channels (status, niche, channelEmail, whopEmail)
export async function PATCH(req: NextRequest) {
  try {
    const session = await requireUser()
    const userId = session.user.id
    const body = await req.json()

    const { channelIds, updates } = body
    if (!channelIds || !Array.isArray(channelIds) || channelIds.length === 0) {
      return NextResponse.json({ error: 'channelIds array is required.' }, { status: 400 })
    }
    if (!updates || typeof updates !== 'object') {
      return NextResponse.json({ error: 'updates object is required.' }, { status: 400 })
    }

    const updateData: Record<string, any> = {}
    if (updates.status && ['active', 'inactive'].includes(updates.status)) {
      updateData.status = updates.status
    }
    if (updates.niche && updates.niche.trim()) {
      updateData.niche = updates.niche.trim()
    }
    if (updates.channelEmail && updates.channelEmail.trim()) {
      updateData.channelEmail = updates.channelEmail.trim().toLowerCase()
    }
    if (updates.whopEmail && updates.whopEmail.trim()) {
      updateData.whopEmail = updates.whopEmail.trim().toLowerCase()
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update.' }, { status: 400 })
    }

    const result = await prisma.channel.updateMany({
      where: {
        id: { in: channelIds },
        userId,
        removedAt: null,
      },
      data: updateData,
    })

    return NextResponse.json({
      success: true,
      count: result.count,
      message: `Successfully updated ${result.count} channel(s).`,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error.' }, { status: 500 })
  }
}
