import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth-helpers'
import { prisma } from '@/lib/db'
import { encryptIfPresent, decryptIfPresent } from '@/lib/encryption'
import { verifyGoogleRefreshToken } from '@/lib/youtube-auth'
import { z } from 'zod'

const updateChannelSchema = z.object({
  channelName: z.string().min(1, 'Channel Name is required').optional(),
  channelHandle: z.string().min(1, 'Channel Handle is required').optional(),
  channelEmail: z.string().email('Valid YouTube email is required').optional(),
  whopEmail: z.string().email('Valid Whop email is required').optional(),
  niche: z.string().min(1, 'Niche is required').optional(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  refreshToken: z.string().optional(),
  status: z.enum(['active', 'inactive', 'pending', 'error']).optional(),
  extraData: z.any().optional(),
})

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireUser()
    const userId = session.user.id
    const { id } = params

    const channel = await prisma.channel.findFirst({
      where: { id, userId, removedAt: null },
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
      },
    })

    if (!channel) {
      return NextResponse.json({ error: 'Channel not found.' }, { status: 404 })
    }

    return NextResponse.json({ channel })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error.' }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireUser()
    const userId = session.user.id
    const { id } = params
    const body = await req.json()
    const data = updateChannelSchema.parse(body)

    const existing = await prisma.channel.findFirst({
      where: { id, userId, removedAt: null },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Channel not found or already removed.' }, { status: 404 })
    }

    const extra = (existing.extraData as Record<string, any>) || {}
    let updatedExtra = data.extraData !== undefined ? data.extraData : extra

    // If user is manually re-activating the channel, clear cooldown and error
    if (data.status === 'active') {
      const { uploadCooldownUntil, lastUploadError, ...rest } = updatedExtra
      updatedExtra = rest
    }

    // Check if new credentials were submitted
    let newClientSecretEnc = existing.clientSecretEnc
    let newRefreshTokenEnc = existing.refreshTokenEnc
    let newChannelIdExt = existing.channelIdExt

    const isUpdatingCredentials = !!(data.clientSecret?.trim() || data.refreshToken?.trim())
    if (isUpdatingCredentials) {
      const effectiveClientId = data.clientId?.trim() || existing.clientId || ''
      const effectiveSecret = data.clientSecret?.trim() || decryptIfPresent(existing.clientSecretEnc) || ''
      const effectiveToken = data.refreshToken?.trim() || decryptIfPresent(existing.refreshTokenEnc) || ''

      if (!effectiveClientId || !effectiveSecret || !effectiveToken) {
        return NextResponse.json(
          { error: 'Both Client Secret and Refresh Token are required when updating credentials.' },
          { status: 400 }
        )
      }

      // Verify new credentials with Google OAuth
      const verifyRes = await verifyGoogleRefreshToken(effectiveClientId, effectiveSecret, effectiveToken)
      if (!verifyRes.valid) {
        return NextResponse.json(
          { error: `Google OAuth verification failed: ${verifyRes.error}` },
          { status: 400 }
        )
      }

      if (data.clientSecret?.trim()) {
        newClientSecretEnc = encryptIfPresent(data.clientSecret.trim())
      }
      if (data.refreshToken?.trim()) {
        newRefreshTokenEnc = encryptIfPresent(data.refreshToken.trim())
      }
      if (verifyRes.channelIdExt) {
        newChannelIdExt = verifyRes.channelIdExt
      }
    }

    const cleanHandle = data.channelHandle !== undefined
      ? (data.channelHandle.trim().startsWith('@') ? data.channelHandle.trim() : `@${data.channelHandle.trim()}`)
      : undefined

    const updated = await prisma.channel.update({
      where: { id },
      data: {
        ...(data.channelName !== undefined && { channelName: data.channelName.trim() }),
        ...(cleanHandle !== undefined && { channelHandle: cleanHandle }),
        ...(data.channelEmail !== undefined && { channelEmail: data.channelEmail.trim().toLowerCase() }),
        ...(data.whopEmail !== undefined && { whopEmail: data.whopEmail.trim().toLowerCase() }),
        ...(data.niche !== undefined && { niche: data.niche.trim() }),
        ...(data.clientId !== undefined && { clientId: data.clientId.trim() }),
        ...(data.status !== undefined && { status: data.status }),
        clientSecretEnc: newClientSecretEnc,
        refreshTokenEnc: newRefreshTokenEnc,
        channelIdExt: newChannelIdExt,
        extraData: updatedExtra,
      },
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
      },
    })

    return NextResponse.json({ success: true, channel: updated, message: 'Channel updated successfully!' })
  } catch (err: any) {
    if (err.name === 'ZodError') return NextResponse.json({ error: err.errors[0]?.message || 'Validation error' }, { status: 400 })
    return NextResponse.json({ error: err.message || 'Internal server error.' }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireUser()
    const userId = session.user.id
    const { id } = params

    const existing = await prisma.channel.findFirst({
      where: { id, userId, removedAt: null },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Channel not found.' }, { status: 404 })
    }

    // Soft delete: sets removedAt timestamp to now
    await prisma.channel.update({
      where: { id },
      data: {
        removedAt: new Date(),
        status: 'inactive',
      },
    })

    return NextResponse.json({ success: true, message: 'Channel removed successfully.' })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error.' }, { status: 500 })
  }
}
