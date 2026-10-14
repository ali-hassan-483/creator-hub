import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth-helpers'
import { verifyGoogleRefreshToken } from '@/lib/youtube-auth'
import { z } from 'zod'

const verifySchema = z.object({
  clientId: z.string().min(1, 'Client ID is required'),
  clientSecret: z.string().min(1, 'Client Secret is required'),
  refreshToken: z.string().min(1, 'Refresh Token is required'),
})

export async function POST(req: NextRequest) {
  try {
    await requireUser()
    const body = await req.json()
    const data = verifySchema.parse(body)

    const result = await verifyGoogleRefreshToken(
      data.clientId,
      data.clientSecret,
      data.refreshToken
    )

    if (!result.valid) {
      return NextResponse.json(
        { error: result.error || 'Verification failed. Refresh token does not match Client ID & Secret.' },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Verified! Refresh token successfully generated with this Client ID & Secret.',
      channelTitle: result.channelTitle,
      channelIdExt: result.channelIdExt,
      channelHandle: result.channelHandle,
    })
  } catch (err: any) {
    if (err.name === 'ZodError') return NextResponse.json({ error: err.errors[0]?.message || 'Validation error' }, { status: 400 })
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
