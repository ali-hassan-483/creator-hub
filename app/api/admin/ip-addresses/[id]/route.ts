import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/db'
import { encryptIfPresent } from '@/lib/encryption'
import { z } from 'zod'

const updateIpSchema = z.object({
  ipAddress: z.string().min(1).optional(),
  port: z.number().nullable().optional(),
  username: z.string().nullable().optional(),
  password: z.string().nullable().optional(),
  label: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  assignedTo: z.string().nullable().optional(), // pass null to unassign, or user id to assign
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireAdmin()
    const { id } = params
    const body = await req.json()
    const data = updateIpSchema.parse(body)

    const existingIp = await prisma.ipAddress.findUnique({ where: { id } })
    if (!existingIp) {
      return NextResponse.json({ error: 'IP address not found.' }, { status: 404 })
    }

    // If assigning to a new user, check if that user already has an IP assigned
    if (data.assignedTo && data.assignedTo !== existingIp.assignedTo) {
      const userCurrentIp = await prisma.ipAddress.findFirst({
        where: { assignedTo: data.assignedTo },
      })
      if (userCurrentIp && userCurrentIp.id !== id) {
        // Automatically unassign the previous IP from that user
        await prisma.ipAddress.update({
          where: { id: userCurrentIp.id },
          data: { assignedTo: null, assignedAt: null, isAvailable: true },
        })
      }
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

    if (data.assignedTo !== undefined) {
      updatePayload.assignedTo = data.assignedTo
      updatePayload.assignedAt = data.assignedTo ? new Date() : null
      updatePayload.isAvailable = !data.assignedTo
    }

    const updated = await prisma.ipAddress.update({
      where: { id },
      data: updatePayload,
      include: {
        user: { select: { id: true, name: true, email: true } },
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
    await requireAdmin()
    const { id } = params

    await prisma.ipAddress.delete({
      where: { id },
    })

    return NextResponse.json({ success: true, message: 'IP address removed.' })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error.' }, { status: 500 })
  }
}
