/**
 * Gemini Multi-Key Rotation & Failover Pool Manager
 * 
 * Aggregates all Gemini API keys from:
 * 1. Database: All users who saved Gemini keys in Credentials (credentialType: 'gemini')
 * 2. Environment variables: GEMINI_API_KEY, GEMINI_API_KEYS (comma-separated)
 * 
 * Features:
 * - Dynamic Key Pool: Collects all unique keys added by all users
 * - Automatic Failover: If Key #1 fails (Quota exceeded, Rate limit 429, Invalid, etc.),
 *   automatically tries Key #2, Key #3... until request succeeds
 * - Round-Robin load distribution
 */

import { prisma } from './db'
import { decrypt } from './encryption'

let cachedKeys: string[] = []
let lastCacheTime = 0
const CACHE_TTL_MS = 2 * 60 * 1000 // Cache for 2 minutes

/**
 * Fetch all available Gemini API keys across all users & environment.
 */
export async function getAllGeminiKeys(): Promise<string[]> {
  const now = Date.now()
  if (cachedKeys.length > 0 && now - lastCacheTime < CACHE_TTL_MS) {
    return cachedKeys
  }

  const keysSet = new Set<string>()

  // 1. Env keys
  if (process.env.GEMINI_API_KEY) {
    keysSet.add(process.env.GEMINI_API_KEY.trim())
  }
  if (process.env.GEMINI_API_KEYS) {
    process.env.GEMINI_API_KEYS.split(',').map(k => k.trim()).filter(Boolean).forEach(k => keysSet.add(k))
  }

  // 2. Database keys from all users
  try {
    const creds = await prisma.credential.findMany({
      where: { credentialType: 'gemini', status: 'active' },
      select: { extraEnc: true },
    })

    for (const c of creds) {
      if (!c.extraEnc) continue
      try {
        const decrypted = decrypt(c.extraEnc)
        const parsed = JSON.parse(decrypted)
        if (Array.isArray(parsed)) {
          parsed.forEach((k: string) => {
            if (typeof k === 'string' && k.trim()) keysSet.add(k.trim())
          })
        } else if (typeof parsed === 'string' && parsed.trim()) {
          keysSet.add(parsed.trim())
        }
      } catch {}
    }
  } catch (err: any) {
    console.warn(`[GeminiKeyPool] Could not load DB keys: ${err.message}`)
  }

  cachedKeys = Array.from(keysSet).filter(k => k.length > 10)
  lastCacheTime = now
  return cachedKeys
}

let keyCursor = 0

/**
 * Execute Gemini API request with automatic Multi-Key failover.
 * Tries each available key in round-robin until one succeeds.
 */
export async function executeGeminiWithFailover<T>(
  apiFn: (apiKey: string) => Promise<T>
): Promise<T> {
  const keys = await getAllGeminiKeys()

  if (keys.length === 0) {
    throw new Error('No Gemini API keys found. Please add keys in the Credentials tab or set GEMINI_API_KEY in .env.')
  }

  let lastError: any = null
  const startIndex = keyCursor % keys.length

  // Try each key once
  for (let attempt = 0; attempt < keys.length; attempt++) {
    const currentIndex = (startIndex + attempt) % keys.length
    const currentKey = keys[currentIndex]
    const maskedKey = `${currentKey.slice(0, 8)}...${currentKey.slice(-4)}`

    try {
      const result = await apiFn(currentKey)
      // Advance cursor for next request (round-robin)
      keyCursor = (currentIndex + 1) % keys.length
      return result
    } catch (err: any) {
      lastError = err
      const isQuotaOrRateLimit =
        err?.message?.includes('429') ||
        err?.message?.includes('quota') ||
        err?.message?.includes('RESOURCE_EXHAUSTED') ||
        err?.message?.includes('rate limit') ||
        err?.message?.includes('API_KEY_INVALID')

      console.warn(
        `⚠️ [GeminiKeyPool] Key [${maskedKey}] failed: ${err.message}. ${
          attempt < keys.length - 1 ? 'Switching to next key...' : 'All keys failed.'
        }`
      )

      if (!isQuotaOrRateLimit && attempt >= 2) {
        // If it's a prompt syntax or internal error (not quota), don't loop endlessly
        throw err
      }
    }
  }

  throw new Error(`All ${keys.length} Gemini API key(s) failed. Last error: ${lastError?.message || 'Unknown error'}`)
}
