const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const ips = await prisma.ipAddress.findMany({
    include: {
      user: {
        select: { id: true, email: true }
      }
    }
  })
  console.log('ASSIGNED IPS IN DB:', JSON.stringify(ips, null, 2))
}

main().catch(console.error).finally(() => prisma.$disconnect())
