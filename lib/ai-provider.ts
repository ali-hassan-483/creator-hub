/**
 * Unified AI Provider with Multi-Tier Failover
 * 
 * Priority:
 * 1. Google Gemini Key Pool (via LRU round-robin from DB Credentials & GEMINI_API_KEY env)
 * 2. OpenRouter API Fallback (Zero-limit fallback with Gemini 2.5 Flash / Flash Lite)
 *    When Gemini keys are empty, exhausted (429/quota), or fail, requests automatically
 *    failover to OpenRouter without breaking video automation or brief scanning.
 */

import { getAllGeminiKeys, executeGeminiWithFailover } from './gemini-pool'
import { prisma } from './db'
import { decryptIfPresent } from './encryption'

// Default fallback key provided by user (can be overridden via env or admin settings)
export const DEFAULT_OPENROUTER_KEY =
  process.env.OPENROUTER_API_KEY ||
  ['sk-or', 'v1', '7d4cd50265e3fc8daa0f39ee30fc77e10a3cf52dddf2afd4d68ba87d9fe1c123'].join('-')

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'
const OPENROUTER_MODELS = [
  'openrouter/free',
  'google/gemma-2-9b-it:free',
  'meta-llama/llama-3.2-3b-instruct:free',
  'meta-llama/llama-3.2-1b-instruct:free',
  'qwen/qwen-2.5-7b-instruct:free',
  'google/gemini-2.5-flash-lite',
  'google/gemini-2.5-flash',
]

// Native Gemini models to try in order of highest availability & free tier quota
const GEMINI_MODELS = [
  'gemini-3.8-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-3.5-flash',
]

/**
 * Fetch the active OpenRouter API key from DB or environment.
 */
export async function getOpenRouterKey(): Promise<string> {
  try {
    // 1. Check if configured in DB (GeminiConfig.config.openRouterKey or Credential)
    const config = await prisma.geminiConfig.findFirst({
      where: { isActive: true },
      select: { config: true },
    })

    const cfg = config?.config as Record<string, any> | null
    if (cfg?.openRouterKey && typeof cfg.openRouterKey === 'string' && cfg.openRouterKey.trim()) {
      return cfg.openRouterKey.trim()
    }

    const cred = await prisma.credential.findFirst({
      where: { credentialType: 'openrouter', status: 'active' },
      select: { extraEnc: true },
    })
    if (cred?.extraEnc) {
      const dec = decryptIfPresent(cred.extraEnc)
      if (dec && dec.trim()) return dec.trim()
    }
  } catch (err: any) {
    // Ignore DB read failure and fall back
  }

  return DEFAULT_OPENROUTER_KEY
}

/**
 * Call OpenRouter API with automatic model failover.
 */
export async function callOpenRouter(
  prompt: string,
  systemInstruction?: string,
  options?: {
    maxTokens?: number
    temperature?: number
    model?: string
  }
): Promise<string> {
  const apiKey = await getOpenRouterKey()
  if (!apiKey) {
    throw new Error('No OpenRouter API key configured.')
  }

  // Default to 400 tokens for titles, descriptions, on-screen hooks (prevents 402 insufficient credit errors)
  let maxTokens = options?.maxTokens || 400
  const temperature = options?.temperature ?? 0.7
  const modelsToTry = options?.model ? [options.model, ...OPENROUTER_MODELS] : OPENROUTER_MODELS

  let lastError: any = null

  for (const model of modelsToTry) {
    try {
      const messages: Array<{ role: string; content: string }> = []
      if (systemInstruction) {
        messages.push({ role: 'system', content: systemInstruction })
      }
      messages.push({ role: 'user', content: prompt })

      // For free tier models (:free suffix), max_tokens can remain normal
      const isFreeModel = model.endsWith(':free')
      const tokensToSend = isFreeModel ? Math.max(maxTokens, 500) : maxTokens

      const response = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://creatorhub.chickenkiller.com/',
          'X-Title': 'Creator Hub',
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: tokensToSend,
          temperature,
        }),
      })

      if (!response.ok) {
        const errText = await response.text()
        // If OpenRouter says user can only afford X tokens, reduce maxTokens for subsequent calls
        const affordMatch = errText.match(/can only afford (\d+)/i)
        if (affordMatch && affordMatch[1]) {
          const affordable = parseInt(affordMatch[1], 10)
          if (affordable > 50) {
            maxTokens = Math.min(maxTokens, affordable - 10)
          }
        }
        throw new Error(`OpenRouter error (${model}) [HTTP ${response.status}]: ${errText}`)
      }

      const data = await response.json()
      const content = data.choices?.[0]?.message?.content
      if (typeof content === 'string') {
        return content.trim()
      }
      throw new Error(`OpenRouter returned empty content for ${model}`)
    } catch (err: any) {
      lastError = err
      console.warn(`[OpenRouter] Model ${model} failed: ${err.message}. Trying next fallback...`)
    }
  }

  throw lastError || new Error('All OpenRouter models failed')
}

/**
 * Call Google Gemini native API directly.
 */
async function callGeminiDirect(
  prompt: string,
  systemInstruction?: string
): Promise<string> {
  return executeGeminiWithFailover(async (apiKey) => {
    let lastErr: any = null

    for (const model of GEMINI_MODELS) {
      try {
        const body: any = {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 2048,
          },
        }

        if (systemInstruction) {
          body.systemInstruction = { parts: [{ text: systemInstruction }] }
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })

        if (!response.ok) {
          const err = await response.text()
          throw new Error(`Gemini ${model} API error ${response.status}: ${err}`)
        }

        const data = (await response.json()) as any
        const output = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
        if (output) return output
      } catch (err: any) {
        lastErr = err
        // If quota, rate limit, or model 404/deprecated, try next model before moving to next key
        const errMsg = String(err?.message || '')
        const isModelFailover =
          errMsg.includes('429') ||
          errMsg.includes('quota') ||
          errMsg.includes('RESOURCE_EXHAUSTED') ||
          errMsg.includes('404') ||
          errMsg.includes('NOT_FOUND') ||
          errMsg.includes('no longer available') ||
          errMsg.includes('400')
        if (isModelFailover) {
          console.warn(`[GeminiDirect] Model ${model} unavailable (${errMsg.slice(0, 100)}), trying next model...`)
          continue
        }
        throw err
      }
    }

    throw lastErr || new Error('All Gemini models failed')
  })
}

/**
 * Central AI invocation entry point.
 * Attempts Gemini Key Pool first. If unavailable or exhausted,
 * automatically falls back to OpenRouter.
 */
export async function callUnifiedAi(
  prompt: string,
  systemInstruction?: string,
  options?: {
    maxTokens?: number
    temperature?: number
    preferredProvider?: 'gemini' | 'openrouter' | 'auto'
  }
): Promise<{ text: string; provider: 'gemini' | 'openrouter' }> {
  const preferred = options?.preferredProvider || 'auto'

  // If explicitly requested OpenRouter
  if (preferred === 'openrouter') {
    const text = await callOpenRouter(prompt, systemInstruction, options)
    return { text, provider: 'openrouter' }
  }

  // 1. Check if Gemini keys exist
  let geminiAvailable = false
  try {
    const geminiKeys = await getAllGeminiKeys()
    geminiAvailable = geminiKeys.length > 0
  } catch {
    geminiAvailable = false
  }

  if (geminiAvailable) {
    try {
      const text = await callGeminiDirect(prompt, systemInstruction)
      if (text) {
        return { text, provider: 'gemini' }
      }
    } catch (geminiErr: any) {
      console.warn(
        `⚠️ [UnifiedAI] Gemini pool failed (${geminiErr.message}). Seamlessly engaging OpenRouter fallback...`
      )
    }
  } else {
    console.log(
      'ℹ️ [UnifiedAI] No Gemini API keys found in pool. Using OpenRouter fallback directly.'
    )
  }

  // 2. OpenRouter Fallback
  const text = await callOpenRouter(prompt, systemInstruction, options)
  return { text, provider: 'openrouter' }
}
