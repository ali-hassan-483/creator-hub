import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/db'
import { encryptIfPresent } from '@/lib/encryption'
import crypto from 'crypto'
import { z } from 'zod'

const updateVpsSchema = z.object({
  ipAddress: z.string().min(1).optional(),
  port: z.number().nullable().optional(),
  username: z.string().nullable().optional(),
  password: z.string().nullable().optional(),
  label: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  maxUsers: z.number().min(1).max(10).optional(),
  userIds: z.array(z.string()).optional(), // Users assigned to this VPS
  regenerateKey: z.boolean().optional(),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireAdmin()
    const { id } = params
    const body = await req.json()
    const data = updateVpsSchema.parse(body)

    const existing = await prisma.ipAddress.findUnique({
      where: { id },
      include: { users: true },
    })

    if (!existing) {
      return NextResponse.json({ error: 'VPS node not found.' }, { status: 404 })
    }

    const maxUsers = data.maxUsers !== undefined ? data.maxUsers : existing.maxUsers

    if (data.userIds && data.userIds.length > maxUsers) {
      return NextResponse.json(
        { error: `Cannot assign more than ${maxUsers} users to this VPS node.` },
        { status: 400 }
      )
    }

    const updatePayload: any = {}
    if (data.ipAddress !== undefined) updatePayload.ipAddress = data.ipAddress.trim()
    if (data.port !== undefined) updatePayload.port = data.port
    if (data.username !== undefined) updatePayload.username = data.username ? data.username.trim() : null
    if (data.password !== undefined) {
      updatePayload.passwordEnc = data.password ? encryptIfPresent(data.password) : null
    }
    if (data.label !== undefined) updatePayload.label = data.label ? data.label.trim() : null
    if (data.notes !== undefined) updatePayload.notes = data.notes ? data.notes.trim() : null
    if (data.maxUsers !== undefined) updatePayload.maxUsers = data.maxUsers
    if (data.regenerateKey) {
      const prefix = existing.isMainVps ? 'vps_main_' : 'vps_live_'
      updatePayload.apiKey = prefix + crypto.randomBytes(16).toString('hex')
    }

    // Update VPS entity
    await prisma.ipAddress.update({
      where: { id },
      data: updatePayload,
    })

    // Update assigned users if userIds provided
    if (data.userIds !== undefined) {
      // 1. Unassign users currently linked to this VPS but not in the new list
      await prisma.user.updateMany({
        where: {
          vpsId: id,
          id: { notIn: data.userIds },
        },
        data: { vpsId: null },
      })

      // 2. Assign the selected users to this VPS
      if (data.userIds.length > 0) {
        await prisma.user.updateMany({
          where: { id: { in: data.userIds } },
          data: { vpsId: id },
        })
      }

      // Update availability status
      await prisma.ipAddress.update({
        where: { id },
        data: { isAvailable: data.userIds.length < maxUsers },
      })
    }

    const updated = await prisma.ipAddress.findUnique({
      where: { id },
      include: {
        users: { select: { id: true, name: true, email: true } },
      },
    })

    return NextResponse.json(updated)
  } catch (err: any) {
    if (err.name === 'ZodError') {
      return NextResponse.json({ error: err.errors[0]?.message || 'Validation error' }, { status: 400 })
    }
    return NextResponse.json({ error: err.message || 'Internal server error.' }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireAdmin()
    const { id } = params

    const existing = await prisma.ipAddress.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'VPS node not found.' }, { status: 404 })
    }

    if (existing.isMainVps) {
      return NextResponse.json(
        { error: 'Primary Main Server cannot be deleted. You can unassign users instead.' },
        { status: 400 }
      )
    }

    // Unassign users
    await prisma.user.updateMany({
      where: { vpsId: id },
      data: { vpsId: null },
    })

    await prisma.ipAddress.delete({
      where: { id },
    })

    return NextResponse.json({ success: true, message: 'VPS node removed successfully.' })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error.' }, { status: 500 })
  }
}
