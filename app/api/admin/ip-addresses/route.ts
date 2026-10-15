import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/db'
import { encryptIfPresent, decryptIfPresent } from '@/lib/encryption'
import { getAllVpsNodes, ensureMainVpsExists } from '@/lib/vps-service'
import crypto from 'crypto'
import { z } from 'zod'

const addVpsSchema = z.object({
  ipAddress: z.string().min(1, 'IP Address is required'),
  port: z.number().optional().nullable(),
  username: z.string().optional().nullable(),
  password: z.string().optional().nullable(),
  label: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  maxUsers: z.number().min(1).max(10).optional().default(2),
  userIds: z.array(z.string()).optional().default([]),
})

export async function POST(req: NextRequest) {
  try {
    await requireAdmin()
    const body = await req.json()
    const data = addVpsSchema.parse(body)

    if (data.userIds && data.userIds.length > (data.maxUsers || 2)) {
      return NextResponse.json(
        { error: `Cannot assign more than ${data.maxUsers || 2} users to this VPS node.` },
        { status: 400 }
      )
    }

    const apiKey = 'vps_live_' + crypto.randomBytes(16).toString('hex')

    const vps = await prisma.ipAddress.create({
      data: {
        ipAddress: data.ipAddress.trim(),
        port: data.port || 22,
        username: data.username?.trim() || 'root',
        passwordEnc: encryptIfPresent(data.password),
        label: data.label?.trim() || 'Worker VPS',
        notes: data.notes?.trim() || null,
        maxUsers: data.maxUsers || 2,
        apiKey,
        isMainVps: false,
        status: 'offline',
        isAvailable: data.userIds.length < (data.maxUsers || 2),
      },
    })

    // Assign users if provided
    if (data.userIds && data.userIds.length > 0) {
      await prisma.user.updateMany({
        where: { id: { in: data.userIds } },
        data: { vpsId: vps.id },
      })
    }

    const created = await prisma.ipAddress.findUnique({
      where: { id: vps.id },
      include: {
        users: { select: { id: true, name: true, email: true } },
      },
    })

    return NextResponse.json(created, { status: 201 })
  } catch (err: any) {
    if (err.name === 'ZodError') {
      return NextResponse.json({ error: err.errors[0]?.message || 'Validation error' }, { status: 400 })
    }
    return NextResponse.json({ error: err.message || 'Internal server error.' }, { status: 500 })
  }
}

export async function GET() {
  try {
    await requireAdmin()
    const nodes = await getAllVpsNodes()
    return NextResponse.json(nodes)
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error.' }, { status: 500 })
  }
}
