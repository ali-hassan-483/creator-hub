const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  await prisma.ipAddress.deleteMany({})
  console.log('Cleared all seeded IP addresses from database.')
}

main().catch(console.error).finally(() => prisma.$disconnect())
