import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth-helpers'
import { prisma } from '@/lib/db'
import { z } from 'zod'

const updateChannelSchema = z.object({
  channelName: z.string().optional(),
  status: z.enum(['active', 'inactive', 'pending', 'error']).optional(),
  extraData: z.any().optional(),
})

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

    const updated = await prisma.channel.update({
      where: { id },
      data: {
        ...(data.channelName !== undefined && { channelName: data.channelName.trim() }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.extraData !== undefined && { extraData: data.extraData }),
      },
    })

    return NextResponse.json(updated)
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
    // This allows daily activity tracking (Channels removed today)
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
