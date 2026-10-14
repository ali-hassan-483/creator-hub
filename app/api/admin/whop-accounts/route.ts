import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/db'
import { encrypt, decryptIfPresent } from '@/lib/encryption'
import { triggerWhopIncognito } from '@/lib/open-whop'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/whop-accounts
 * Returns list of all user Whop accounts, associated channels, and cookie status
 */
export async function GET() {
  await requireAdmin()

  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        channels: {
          where: { removedAt: null },
          select: {
            id: true,
            channelName: true,
            channelHandle: true,
            whopEmail: true,
            niche: true,
          },
        },
        credentials: {
          where: { credentialType: 'whop' },
          select: {
            id: true,
            email: true,
            label: true,
            status: true,
            cookiesEnc: true,
            lastUsedAt: true,
            updatedAt: true,
          },
        },
      },
    })

    const accountsMap = new Map<string, any>()

    for (const u of users) {
      // 1. Collect all whopEmails from channels
      const whopEmailsFromChannels = new Set<string>()
      for (const ch of u.channels) {
        if (ch.whopEmail && ch.whopEmail.trim()) {
          whopEmailsFromChannels.add(ch.whopEmail.trim().toLowerCase())
        }
      }

      // 2. Also collect whop emails from existing credentials
      const whopEmailsFromCreds = new Set<string>()
      for (const cr of u.credentials) {
        if (cr.email && cr.email.trim()) {
          whopEmailsFromCreds.add(cr.email.trim().toLowerCase())
        }
      }

      // Merge all distinct whop emails for this user
      const allWhopEmailsList: string[] = []
      whopEmailsFromChannels.forEach((em) => {
        if (!allWhopEmailsList.includes(em)) allWhopEmailsList.push(em)
      })
      whopEmailsFromCreds.forEach((em) => {
        if (!allWhopEmailsList.includes(em)) allWhopEmailsList.push(em)
      })

      // If user has channels but no explicit whopEmail on channels or creds, fall back to user email
      if (allWhopEmailsList.length === 0 && u.channels.length > 0) {
        allWhopEmailsList.push(u.email.toLowerCase())
      }

      for (const wEmail of allWhopEmailsList) {
        const key = `${u.id}_${wEmail}`
        const matchingChannels = u.channels.filter(
          (c) => (c.whopEmail || '').trim().toLowerCase() === wEmail || allWhopEmailsList.length === 1
        )
        const matchingCred = u.credentials.find(
          (c) => (c.email || '').trim().toLowerCase() === wEmail
        ) || (u.credentials.length === 1 ? u.credentials[0] : null)

        accountsMap.set(key, {
          id: key,
          userId: u.id,
          userName: u.name || u.email.split('@')[0],
          userEmail: u.email,
          whopEmail: wEmail,
          channels: matchingChannels.map((c) => ({
            id: c.id,
            name: c.channelName || 'YouTube Channel',
            handle: c.channelHandle || '',
            niche: c.niche || '',
          })),
          credentialId: matchingCred?.id || null,
          hasCookies: !!matchingCred?.cookiesEnc,
          status: matchingCred?.cookiesEnc ? 'active' : 'missing_cookies',
          lastUsedAt: matchingCred?.lastUsedAt ? matchingCred.lastUsedAt.toISOString() : null,
          updatedAt: matchingCred?.updatedAt ? matchingCred.updatedAt.toISOString() : null,
        })
      }
    }

    const accounts = Array.from(accountsMap.values())
    return NextResponse.json({ accounts, total: accounts.length })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to fetch Whop accounts' }, { status: 500 })
  }
}

/**
 * POST /api/admin/whop-accounts
 * Actions: 'open_whop', 'update_cookies', 'delete_cookies'
 */
export async function POST(req: NextRequest) {
  await requireAdmin()

  try {
    const body = await req.json()
    const { action, userId, whopEmail, cookies, credentialId } = body

    if (action === 'open_whop') {
      if (!userId || !whopEmail) {
        return NextResponse.json({ error: 'userId and whopEmail required' }, { status: 400 })
      }

      const targetEmail = whopEmail.trim().toLowerCase()

      // Find the credential
      let cred = await prisma.credential.findFirst({
        where: {
          userId,
          credentialType: 'whop',
          email: targetEmail,
        },
      })

      // Fallback: search by userId only if single whop credential
      if (!cred) {
        cred = await prisma.credential.findFirst({
          where: { userId, credentialType: 'whop' },
        })
      }

      let decryptedCookies: string | null = null
      if (cred && cred.cookiesEnc) {
        try {
          decryptedCookies = decryptIfPresent(cred.cookiesEnc)
        } catch (e: any) {
          console.error('Failed to decrypt Whop cookies:', e.message)
        }
      }

      // Launch incognito browser
      await triggerWhopIncognito(decryptedCookies, 'https://whop.com')

      // Update lastUsedAt if cred exists
      if (cred) {
        await prisma.credential.update({
          where: { id: cred.id },
          data: { lastUsedAt: new Date() },
        })
      }

      return NextResponse.json({
        success: true,
        message: decryptedCookies
          ? `Whop opened in Incognito mode with active session cookies for ${targetEmail}!`
          : `Whop opened in Incognito mode (No saved cookies for ${targetEmail}).`,
        hasCookies: !!decryptedCookies,
      })
    }

    if (action === 'update_cookies') {
      if (!userId || !whopEmail || !cookies) {
        return NextResponse.json({ error: 'userId, whopEmail, and cookies required' }, { status: 400 })
      }

      const targetEmail = whopEmail.trim().toLowerCase()
      const cookiesEnc = encrypt(cookies.trim())

      const existing = await prisma.credential.findFirst({
        where: { userId, credentialType: 'whop', email: targetEmail },
      })

      if (existing) {
        await prisma.credential.update({
          where: { id: existing.id },
          data: {
            cookiesEnc,
            status: 'active',
            updatedAt: new Date(),
          },
        })
      } else {
        await prisma.credential.create({
          data: {
            userId,
            credentialType: 'whop',
            email: targetEmail,
            label: `Whop Account (${targetEmail})`,
            cookiesEnc,
            status: 'active',
          },
        })
      }

      return NextResponse.json({
        success: true,
        message: `Cookies updated successfully for ${targetEmail}`,
      })
    }

    if (action === 'delete_cookies') {
      if (credentialId) {
        await prisma.credential.delete({ where: { id: credentialId } }).catch(() => {})
      } else if (userId && whopEmail) {
        const targetEmail = whopEmail.trim().toLowerCase()
        const cred = await prisma.credential.findFirst({
          where: { userId, credentialType: 'whop', email: targetEmail },
        })
        if (cred) {
          await prisma.credential.delete({ where: { id: cred.id } })
        }
      }

      return NextResponse.json({ success: true, message: 'Cookies removed' })
    }

    if (action === 'get_cookies') {
      if (!userId || !whopEmail) {
        return NextResponse.json({ error: 'userId and whopEmail required' }, { status: 400 })
      }
      const targetEmail = whopEmail.trim().toLowerCase()
      const cred = await prisma.credential.findFirst({
        where: { userId, credentialType: 'whop', email: targetEmail },
      })
      if (!cred || !cred.cookiesEnc) {
        return NextResponse.json({ cookies: null, error: 'No cookies found' })
      }
      const decrypted = decryptIfPresent(cred.cookiesEnc)
      return NextResponse.json({ success: true, cookies: decrypted })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Action failed' }, { status: 500 })
  }
}
