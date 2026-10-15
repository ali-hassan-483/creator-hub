import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { prisma } from '@/lib/db'
import { encrypt, decrypt, encryptIfPresent, decryptIfPresent } from '@/lib/encryption'

export const dynamic = 'force-dynamic'

/**
 * GET /api/user/credentials-manager
 * Returns all prerequisites & cookie credentials status for the signed-in user
 */
export async function GET() {
  const session = await requireAuth()
  const userId = session.user.id

  try {
    const credentials = await prisma.credential.findMany({
      where: { userId },
    })

    // Look for user assigned VPS
    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        vps: {
          select: { ipAddress: true, port: true, label: true, isMainVps: true },
        },
      },
    })
    const assignedIp = currentUser?.vps

    // Fetch user channels to get all registered YouTube channelEmails and whopEmails
    const userChannels = await prisma.channel.findMany({
      where: { userId, removedAt: null },
      select: { channelEmail: true, whopEmail: true },
    })

    const channelEmails = Array.from(
      new Set(userChannels.map(c => c.channelEmail).filter(Boolean) as string[])
    )
    const whopEmails = Array.from(
      new Set(userChannels.map(c => c.whopEmail).filter(Boolean) as string[])
    )

    // Match credentials per email
    const youtubeCreds = credentials.filter(c => c.credentialType === 'youtube_cookies')
    const whopCreds = credentials.filter(c => c.credentialType === 'whop')
    const geminiCred = credentials.find(c => c.credentialType === 'gemini')
    const discordCred = credentials.find(c => c.credentialType === 'discord')

    // Parse Gemini keys array from decrypted JSON
    let geminiKeys: string[] = []
    if (geminiCred?.extraEnc) {
      try {
        const decrypted = decrypt(geminiCred.extraEnc)
        geminiKeys = JSON.parse(decrypted)
      } catch {}
    }

    // Check if every channel has required YouTube and Whop credentials configured
    const missingYoutubeEmails = channelEmails.filter(email => !youtubeCreds.some(c => c.email?.toLowerCase() === email.toLowerCase()))
    const missingWhopEmails = whopEmails.filter(email => !whopCreds.some(c => c.email?.toLowerCase() === email.toLowerCase()))

    return NextResponse.json({
      channelEmails,
      whopEmails,
      missingYoutubeEmails,
      missingWhopEmails,
      canStartUploading: missingYoutubeEmails.length === 0 && missingWhopEmails.length === 0,
      youtubeCredsByEmail: youtubeCreds.map(c => ({ email: c.email, status: c.status })),
      whopCredsByEmail: whopCreds.map(c => ({ email: c.email, status: c.status })),
      prerequisites: {
        whopCookies: {
          configured: whopEmails.length > 0 ? missingWhopEmails.length === 0 : whopCreds.length > 0,
          missingCount: missingWhopEmails.length,
        },
        proxyIp: {
          assigned: !!assignedIp,
          ip: assignedIp ? `${assignedIp.ipAddress}${assignedIp.port ? `:${assignedIp.port}` : ''}` : null,
          label: assignedIp?.label || null,
        },
        gemini: {
          configured: geminiKeys.length > 0,
          keysCount: geminiKeys.length,
          keys: geminiKeys,
        },
        discord: {
          configured: !!discordCred,
          webhookUrl: discordCred?.extraEnc ? decrypt(discordCred.extraEnc) : '',
        },
        youtubeCookies: {
          configured: channelEmails.length > 0 ? missingYoutubeEmails.length === 0 : youtubeCreds.length > 0,
          missingCount: missingYoutubeEmails.length,
        },
      },
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to fetch credentials' }, { status: 500 })
  }
}

/**
 * POST /api/user/credentials-manager
 * Saves or updates specific credential types: 'whop', 'youtube_cookies', 'gemini', 'discord'
 */
export async function POST(req: NextRequest) {
  const session = await requireAuth()
  const userId = session.user.id

  try {
    const body = await req.json()
    const { action, email, data } = body

    if (action === 'save_youtube_cookies') {
      const targetEmail = (email || session.user.email).trim().toLowerCase()
      const existing = await prisma.credential.findFirst({
        where: { userId, credentialType: 'youtube_cookies', email: targetEmail },
      })

      const cookiesEnc = encrypt(data || '')

      if (existing) {
        await prisma.credential.update({
          where: { id: existing.id },
          data: { cookiesEnc, status: 'active', updatedAt: new Date() },
        })
      } else {
        await prisma.credential.create({
          data: {
            userId,
            credentialType: 'youtube_cookies',
            email: targetEmail,
            label: `YouTube Cookies (${targetEmail})`,
            cookiesEnc,
            status: 'active',
          },
        })
      }

      return NextResponse.json({ success: true, message: `YouTube Cookies for ${targetEmail} saved successfully` })
    }

    if (action === 'save_whop') {
      const targetEmail = (email || session.user.email).trim().toLowerCase()
      const existing = await prisma.credential.findFirst({
        where: { userId, credentialType: 'whop', email: targetEmail },
      })

      const cookiesEnc = encrypt(data || '')

      if (existing) {
        await prisma.credential.update({
          where: { id: existing.id },
          data: { cookiesEnc, status: 'active', updatedAt: new Date() },
        })
      } else {
        await prisma.credential.create({
          data: {
            userId,
            credentialType: 'whop',
            email: targetEmail,
            label: `Whop Submission Cookies (${targetEmail})`,
            cookiesEnc,
            status: 'active',
          },
        })
      }

      return NextResponse.json({ success: true, message: `Whop credentials for ${targetEmail} saved successfully` })
    }

    if (action === 'save_gemini') {
      const keysArray = Array.isArray(data) ? data : [data]
      const existing = await prisma.credential.findFirst({
        where: { userId, credentialType: 'gemini' },
      })

      const extraEnc = encrypt(JSON.stringify(keysArray))

      if (existing) {
        await prisma.credential.update({
          where: { id: existing.id },
          data: { extraEnc, status: 'active', updatedAt: new Date() },
        })
      } else {
        await prisma.credential.create({
          data: {
            userId,
            credentialType: 'gemini',
            label: 'Gemini API Keys Pool',
            extraEnc,
            status: 'active',
          },
        })
      }

      return NextResponse.json({ success: true, message: `Saved ${keysArray.length} Gemini API Key(s)` })
    }

    if (action === 'save_discord') {
      const webhookUrl = (data || '').trim()
      const existing = await prisma.credential.findFirst({
        where: { userId, credentialType: 'discord' },
      })

      const extraEnc = encrypt(webhookUrl)

      if (existing) {
        await prisma.credential.update({
          where: { id: existing.id },
          data: { extraEnc, status: 'active', updatedAt: new Date() },
        })
      } else {
        await prisma.credential.create({
          data: {
            userId,
            credentialType: 'discord',
            label: 'Discord Webhook Alert',
            extraEnc,
            status: 'active',
          },
        })
      }

      return NextResponse.json({ success: true, message: 'Discord webhook URL saved' })
    }

    if (action === 'test_discord') {
      const webhookUrl = (data || '').trim()
      if (!webhookUrl.startsWith('https://discord.com/api/webhooks/')) {
        return NextResponse.json({ success: false, error: 'Invalid Discord webhook URL' }, { status: 400 })
      }

      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: '🔔 **Creator Hub Test Alert**: Your Discord webhook is configured and working perfectly!',
        }),
      })

      if (!res.ok) {
        return NextResponse.json({ success: false, error: `Discord responded with ${res.status}` }, { status: 400 })
      }

      return NextResponse.json({ success: true, message: 'Test message sent to Discord successfully!' })
    }

    if (action === 'test_gemini') {
      const keyToTest = (data || '').trim()
      if (!keyToTest) {
        return NextResponse.json({ success: false, error: 'No key provided' }, { status: 400 })
      }

      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${keyToTest}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Ping' }] }],
        }),
      })

      if (!res.ok) {
        const errText = await res.text()
        return NextResponse.json({ success: false, error: `Invalid Gemini Key: ${errText.slice(0, 150)}` }, { status: 400 })
      }

      return NextResponse.json({ success: true, message: 'Gemini Key verified successfully!' })
    }

    if (action === 'delete_credential') {
      const credType = body.credentialType
      await prisma.credential.deleteMany({
        where: { userId, credentialType: credType },
      })
      return NextResponse.json({ success: true, message: `${credType} credential deleted` })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Operation failed' }, { status: 500 })
  }
}
