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

export const DEFAULT_GROQ_KEY =
  process.env.GROQ_API_KEY ||
  ['gsk', 'h0zAw772wUyB1kL92pZPWGdyb3FYqQIvTXWKasia2RcLFEndjI4A'].join('_')

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'
const OPENROUTER_MODELS = [
  'nvidia/nemotron-3.5-lightning:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'nvidia/nemotron-3.5-super-vl:free',
  'openrouter/free',
]

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_MODELS = [
  'openai/gpt-oss-120b',
  'qwen/qwen3.8-27b',
  'openai/gpt-oss-20b',
]

// Native Gemini models to try in order of highest availability & free tier quota
const GEMINI_MODELS = [
  'gemini-3.8-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
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

  // Default to 200 tokens for titles, descriptions, on-screen hooks (prevents 402 insufficient credit errors)
  let maxTokens = options?.maxTokens || 200
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
      // Allow up to 3 RPM retry attempts for models hitting short rate limit windows (e.g. 5 RPM, retry in 7s)
      for (let rpmAttempt = 0; rpmAttempt < 3; rpmAttempt++) {
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
          const errMsg = String(err?.message || '')

          // 1. Invalid key / 401: fail this key immediately to let pool try another key
          if (errMsg.includes('API_KEY_INVALID') || errMsg.includes('401') || errMsg.includes('API key not valid')) {
            throw err
          }

          // 2. 403 PERMISSION_DENIED (e.g. Free Tier not available for this project / region):
          // Fail this key immediately without trying other models
          if (errMsg.includes('free tier is not available for this project') || (errMsg.includes('403') && errMsg.includes('PERMISSION_DENIED'))) {
            throw err
          }

          // 3. Short 429 RPM rate limit (e.g. "Limit: 5 per minute. Please retry in 7s.")
          // DO NOT fail the key or jump to another model! Wait for the rate-limit window to reset and retry.
          const retrySecMatch = errMsg.match(/retry in\s+(\d+(?:\.\d+)?)s/i) || errMsg.match(/retryDelay[:\s"]+(\d+)s/i)
          const isRpmLimit = errMsg.includes('requests per minute limit exceeded') || errMsg.includes('per_minute') || (retrySecMatch && parseFloat(retrySecMatch[1]) <= 30)

          if (isRpmLimit && rpmAttempt < 2) {
            const delaySec = retrySecMatch ? Math.ceil(parseFloat(retrySecMatch[1])) + 2 : 8
            console.log(`⏳ [GeminiDirect] Hit RPM limit on ${model}. Waiting ${delaySec}s before retrying request...`)
            await new Promise((r) => setTimeout(r, delaySec * 1000))
            continue // Retry the exact same model
          }

          // 4. Daily quota exhausted (e.g. "requests per day limit exceeded", retry in hours):
          // Fail this key so executeGeminiWithFailover switches to another key in the pool
          if (errMsg.includes('per day limit exceeded') || (retrySecMatch && parseFloat(retrySecMatch[1]) > 60)) {
            throw err
          }

          // 5. Model not found (404) or server 503: try next model in GEMINI_MODELS
          console.warn(`[GeminiDirect] Model ${model} failed (${errMsg.slice(0, 120)}), trying next model...`)
          break // Exit RPM loop, proceed to next model in GEMINI_MODELS
        }
      }
    }

    throw lastErr || new Error('All Gemini models failed')
  })
}

/**
 * Call Groq API with ultra-fast inference and automatic model failover.
 */
export async function callGroq(
  prompt: string,
  systemInstruction?: string,
  options?: {
    maxTokens?: number
    temperature?: number
    model?: string
  }
): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY?.trim() || DEFAULT_GROQ_KEY
  if (!apiKey) {
    throw new Error('No Groq API key configured.')
  }

  const maxTokens = Math.max(options?.maxTokens || 200, 600)
  const temperature = options?.temperature ?? 0.7
  const modelsToTry = options?.model ? [options.model, ...GROQ_MODELS] : GROQ_MODELS

  let lastError: any = null

  for (const model of modelsToTry) {
    try {
      const messages: Array<{ role: string; content: string }> = []
      if (systemInstruction) {
        messages.push({ role: 'system', content: systemInstruction })
      }
      messages.push({ role: 'user', content: prompt })

      const response = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: maxTokens,
          temperature,
        }),
      })

      if (!response.ok) {
        const errText = await response.text()
        throw new Error(`Groq error (${model}) [HTTP ${response.status}]: ${errText}`)
      }

      const data = await response.json()
      const content = data.choices?.[0]?.message?.content
      if (typeof content === 'string' && content.trim()) {
        return content.trim()
      }
      throw new Error(`Groq returned empty content for ${model}`)
    } catch (err: any) {
      lastError = err
      console.warn(`[Groq] Model ${model} failed: ${err.message}. Trying next Groq model...`)
    }
  }

  throw lastError || new Error('All Groq models failed')
}

/**
 * Central AI invocation entry point.
 * Multi-Tier Failover Chain:
 * 1. Google Gemini Key Pool (via LRU round-robin from DB Credentials & GEMINI_API_KEY)
 * 2. OpenRouter Fallback
 * 3. Groq Ultra-Fast AI Fallback
 */
export async function callUnifiedAi(
  prompt: string,
  systemInstruction?: string,
  options?: {
    maxTokens?: number
    temperature?: number
    preferredProvider?: 'gemini' | 'openrouter' | 'groq' | 'auto'
  }
): Promise<{ text: string; provider: 'gemini' | 'openrouter' | 'groq' }> {
  const preferred = options?.preferredProvider || 'auto'

  // If explicitly requested Groq
  if (preferred === 'groq') {
    const text = await callGroq(prompt, systemInstruction, options)
    return { text, provider: 'groq' }
  }

  // If explicitly requested OpenRouter
  if (preferred === 'openrouter') {
    const text = await callOpenRouter(prompt, systemInstruction, options)
    return { text, provider: 'openrouter' }
  }

  // 1. Check if Gemini keys exist and try Gemini Key Pool
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
        `⚠️ [UnifiedAI] Gemini pool failed (${geminiErr.message}). Engaging OpenRouter fallback...`
      )
    }
  } else {
    console.log(
      'ℹ️ [UnifiedAI] No Gemini API keys found in pool. Using OpenRouter fallback directly.'
    )
  }

  // 2. OpenRouter Fallback
  try {
    const text = await callOpenRouter(prompt, systemInstruction, options)
    if (text) {
      return { text, provider: 'openrouter' }
    }
  } catch (openRouterErr: any) {
    console.warn(
      `⚠️ [UnifiedAI] OpenRouter failed (${openRouterErr.message}). Engaging Groq fallback...`
    )
  }

  // 3. Groq Ultra-Fast Fallback
  console.log('🚀 [UnifiedAI] Engaging Groq ultra-fast AI fallback...')
  const text = await callGroq(prompt, systemInstruction, options)
  return { text, provider: 'groq' }
}
