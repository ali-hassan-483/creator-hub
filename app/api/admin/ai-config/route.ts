import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/db'
import { getAllGeminiKeys } from '@/lib/gemini-pool'
import { getOpenRouterKey, DEFAULT_OPENROUTER_KEY } from '@/lib/ai-provider'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await requireAdmin()

    const currentKey = await getOpenRouterKey()
    const isCustom = currentKey !== DEFAULT_OPENROUTER_KEY
    const maskedKey = currentKey
      ? `${currentKey.slice(0, 10)}...${currentKey.slice(-6)}`
      : 'Not configured'

    let geminiCount = 0
    try {
      const keys = await getAllGeminiKeys()
      geminiCount = keys.length
    } catch {}

    return NextResponse.json({
      configured: true,
      openRouterKey: currentKey,
      maskedKey,
      isCustom,
      geminiKeyCount: geminiCount,
      models: ['google/gemini-2.0-flash-exp:free', 'google/gemini-2.5-flash-lite', 'google/gemini-2.5-flash'],
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to load AI config' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAdmin()
    const userId = session.user.id
    const { openRouterKey } = await req.json()

    const keyToSave = typeof openRouterKey === 'string' ? openRouterKey.trim() : ''

    // Update or create GeminiConfig with openRouterKey in config json
    await prisma.geminiConfig.upsert({
      where: { userId },
      update: {
        config: {
          openRouterKey: keyToSave || DEFAULT_OPENROUTER_KEY,
          updatedAt: new Date().toISOString(),
        },
      },
      create: {
        userId,
        isActive: true,
        config: {
          openRouterKey: keyToSave || DEFAULT_OPENROUTER_KEY,
          createdAt: new Date().toISOString(),
        },
      },
    })

    return NextResponse.json({
      success: true,
      message: 'OpenRouter AI Fallback configuration saved successfully!',
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to save AI config' }, { status: 500 })
  }
}
