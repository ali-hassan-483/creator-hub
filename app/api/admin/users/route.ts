import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { z } from 'zod'

const createUserSchema = z.object({
  email: z.string().email('Valid email address is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().optional().nullable(),
  role: z.enum(['user', 'admin']).default('user'),
  ipAddressId: z.string().optional().nullable(),
})

export async function POST(req: NextRequest) {
  try {
    await requireAdmin()
    const body = await req.json()
    const data = createUserSchema.parse(body)

    const existing = await prisma.user.findUnique({ where: { email: data.email.toLowerCase().trim() } })
    if (existing) {
      return NextResponse.json({ error: 'Email already registered.' }, { status: 409 })
    }

    const passwordHash = await bcrypt.hash(data.password, 12)

    const user = await prisma.user.create({
      data: {
        email: data.email.toLowerCase().trim(),
        passwordHash,
        name: data.name?.trim() || null,
        role: data.role,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    })

    // If a VPS was selected during user creation, assign it
    if (data.ipAddressId) {
      await prisma.user.update({
        where: { id: user.id },
        data: { vpsId: data.ipAddressId },
      })
    }

    return NextResponse.json(user, { status: 201 })
  } catch (err: any) {
    if (err.name === 'ZodError') return NextResponse.json({ error: err.errors[0]?.message || 'Validation error' }, { status: 400 })
    return NextResponse.json({ error: err.message || 'Internal server error.' }, { status: 500 })
  }
}

export async function GET() {
  try {
    await requireAdmin()

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
        lastLoginAt: true,
        vps: {
          select: {
            id: true,
            ipAddress: true,
            port: true,
            label: true,
            isMainVps: true,
            status: true,
          },
        },
        channels: {
          select: {
            id: true,
            addedAt: true,
            removedAt: true,
            status: true,
          },
        },
        earnings: {
          where: { status: 'confirmed' },
          select: {
            amount: true,
          },
        },
        _count: {
          select: {
            automations: true,
          },
        },
      },
    })

    const formatted = users.map((u) => {
      const activeChannels = u.channels.filter((c) => c.removedAt === null)
      const addedToday = u.channels.filter(
        (c) => c.addedAt >= todayStart && c.removedAt === null
      ).length
      const removedToday = u.channels.filter(
        (c) => c.removedAt && c.removedAt >= todayStart
      ).length

      const totalEarnings = u.earnings.reduce(
        (acc, curr) => acc + Number(curr.amount || 0),
        0
      )

      return {
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        isActive: u.isActive,
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt,
        vps: u.vps,
        assignedIp: u.vps,
        totalChannels: activeChannels.length,
        channelsAddedToday: addedToday,
        channelsRemovedToday: removedToday,
        totalEarnings,
        totalAutomations: u._count.automations,
      }
    })

    return NextResponse.json(formatted)
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error.' }, { status: 500 })
  }
}
