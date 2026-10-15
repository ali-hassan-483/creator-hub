import { NextRequest, NextResponse } from 'next/server'
import { validateVpsApiKey } from '@/lib/vps-service'

export const dynamic = 'force-dynamic'

/**
 * POST /api/worker/heartbeat
 * Worker VPS sends periodic heartbeat ping (every 30-60s)
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { apiKey } = body

    if (!apiKey) {
      return NextResponse.json({ error: 'Missing apiKey' }, { status: 401 })
    }

    const vps = await validateVpsApiKey(apiKey)
    if (!vps) {
      return NextResponse.json({ error: 'Invalid or unregistered VPS API Key' }, { status: 403 })
    }

    return NextResponse.json({
      success: true,
      status: 'online',
      vps: {
        id: vps.id,
        label: vps.label,
        ipAddress: vps.ipAddress,
        isMainVps: vps.isMainVps,
        assignedUsers: vps.users.map((u) => ({ id: u.id, email: u.email })),
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Heartbeat error' }, { status: 500 })
  }
}
