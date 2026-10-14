const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const users = await prisma.user.findMany({
    where: { email: { in: ['sh8989483@gmail.com', 'ah8989483@gmail.com'] } },
  })

  for (const user of users) {
    // Check if IP is already assigned
    const existing = await prisma.ipAddress.findFirst({
      where: { assignedTo: user.id },
    })

    if (!existing) {
      await prisma.ipAddress.create({
        data: {
          ipAddress: '48.45.117.109',
          port: 12323,
          username: '14a2d0478b643',
          passwordEnc: 'd3b8fc65de', // plaintext fallback when unencrypted
          label: 'Dedicated VPS Proxy Node',
          isAvailable: false,
          assignedTo: user.id,
          assignedAt: new Date(),
        },
      })
      console.log(`Assigned proxy 48.45.117.109 to ${user.email}`)
    } else {
      await prisma.ipAddress.update({
        where: { id: existing.id },
        data: {
          ipAddress: '48.45.117.109',
          port: 12323,
          username: '14a2d0478b643',
          passwordEnc: 'd3b8fc65de',
        },
      })
      console.log(`Updated proxy for ${user.email}`)
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect())
