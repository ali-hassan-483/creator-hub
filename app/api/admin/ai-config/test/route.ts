import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth-helpers'
import { callOpenRouter } from '@/lib/ai-provider'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    await requireAdmin()

    const body = await req.json().catch(() => ({}))
    const customKey = body.openRouterKey ? String(body.openRouterKey).trim() : undefined

    const startTime = Date.now()
    const testPrompt =
      'Respond with a 1-sentence viral hook for a video about financial freedom. Be punchy and direct.'

    const responseText = await callOpenRouter(
      testPrompt,
      'You are a viral social media strategist. Keep answer under 15 words.',
      {
        maxTokens: 100,
        temperature: 0.7,
      }
    )

    const latencyMs = Date.now() - startTime

    return NextResponse.json({
      success: true,
      model: 'google/gemini-2.5-flash',
      response: responseText,
      latencyMs,
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'OpenRouter test failed' },
      { status: 500 }
    )
  }
}
