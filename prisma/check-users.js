const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, role: true }
  })
  console.log('USERS:', JSON.stringify(users, null, 2))
}

main().catch(console.error).finally(() => prisma.$disconnect())
