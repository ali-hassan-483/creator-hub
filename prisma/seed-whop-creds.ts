import { prisma } from '../lib/db'
import { encrypt } from '../lib/encryption'

async function seedWhopCreds() {
  const users = await prisma.user.findMany({
    where: { email: { in: ['sh8989483@gmail.com', 'ah8989483@gmail.com'] } },
  })

  const sampleCookies = JSON.stringify({
    cookies: [
      {
        name: '__Secure-whop-session',
        value: 'mock_whop_session_token_test_123456789',
        domain: '.whop.com',
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      },
      {
        name: 'whop_user_id',
        value: 'user_whop_test_abc',
        domain: '.whop.com',
        path: '/',
        httpOnly: false,
        secure: true,
        sameSite: 'Lax',
      },
    ],
  })

  for (const u of users) {
    const existing = await prisma.credential.findFirst({
      where: { userId: u.id, credentialType: 'whop', email: u.email },
    })

    const cookiesEnc = encrypt(sampleCookies)

    if (existing) {
      await prisma.credential.update({
        where: { id: existing.id },
        data: { cookiesEnc, status: 'active', updatedAt: new Date() },
      })
      console.log('Updated existing whop credential for:', u.email)
    } else {
      await prisma.credential.create({
        data: {
          userId: u.id,
          credentialType: 'whop',
          email: u.email,
          label: `Whop Account (${u.email})`,
          cookiesEnc,
          status: 'active',
        },
      })
      console.log('Created whop credential for:', u.email)
    }
  }
}

seedWhopCreds()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
