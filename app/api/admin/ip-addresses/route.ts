import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/db'
import { encryptIfPresent, decryptIfPresent } from '@/lib/encryption'
import { z } from 'zod'

const addIpSchema = z.object({
  ipAddress: z.string().min(1, 'IP Address is required'),
  port: z.number().optional().nullable(),
  username: z.string().optional().nullable(),
  password: z.string().optional().nullable(),
  label: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  assignedTo: z.string().optional().nullable(),
})

export async function POST(req: NextRequest) {
  try {
    await requireAdmin()
    const body = await req.json()
    const data = addIpSchema.parse(body)

    // Check if assignedTo user already has an IP
    if (data.assignedTo) {
      const existingAssignment = await prisma.ipAddress.findFirst({
        where: { assignedTo: data.assignedTo },
      })
      if (existingAssignment) {
        return NextResponse.json(
          { error: 'Selected user already has an assigned IP. Please unassign their current IP first.' },
          { status: 400 }
        )
      }
    }

    const ip = await prisma.ipAddress.create({
      data: {
        ipAddress: data.ipAddress.trim(),
        port: data.port || null,
        username: data.username?.trim() || null,
        passwordEnc: encryptIfPresent(data.password),
        label: data.label?.trim() || null,
        notes: data.notes?.trim() || null,
        assignedTo: data.assignedTo || null,
        assignedAt: data.assignedTo ? new Date() : null,
        isAvailable: !data.assignedTo,
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    })

    return NextResponse.json(
      {
        ...ip,
        password: data.password || null,
      },
      { status: 201 }
    )
  } catch (err: any) {
    if (err.name === 'ZodError') return NextResponse.json({ error: err.errors[0]?.message || 'Validation error' }, { status: 400 })
    return NextResponse.json({ error: err.message || 'Internal server error.' }, { status: 500 })
  }
}

export async function GET() {
  try {
    await requireAdmin()
    const ips = await prisma.ipAddress.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    })

    // Decrypt passwords safely for admin view
    const formatted = ips.map((ip) => ({
      id: ip.id,
      ipAddress: ip.ipAddress,
      port: ip.port,
      username: ip.username,
      password: ip.passwordEnc ? decryptIfPresent(ip.passwordEnc) : null,
      label: ip.label,
      notes: ip.notes,
      isAvailable: ip.isAvailable,
      assignedTo: ip.assignedTo,
      assignedAt: ip.assignedAt,
      createdAt: ip.createdAt,
      user: ip.user,
    }))

    return NextResponse.json(formatted)
  } catch {
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 })
  }
}
