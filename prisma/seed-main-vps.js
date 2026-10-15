const { PrismaClient } = require('@prisma/client')
const crypto = require('crypto')
const prisma = new PrismaClient()

async function main() {
  let mainVps = await prisma.ipAddress.findFirst({
    where: { isMainVps: true },
    include: { users: true },
  })

  if (!mainVps) {
    const defaultApiKey = 'vps_main_' + crypto.randomBytes(16).toString('hex')
    mainVps = await prisma.ipAddress.create({
      data: {
        ipAddress: '217.77.1.57',
        label: 'Main Server (Contabo)',
        isMainVps: true,
        maxUsers: 2,
        status: 'online',
        apiKey: defaultApiKey,
        notes: 'Primary server running video processing, database, and background workers.',
        isAvailable: true,
      },
      include: { users: true },
    })
    console.log('✅ Created Main VPS:', mainVps)
  } else {
    console.log('ℹ️ Main VPS already exists:', mainVps)
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
