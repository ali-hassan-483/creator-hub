const { PrismaClient, Role } = require('@prisma/client')
const bcrypt = require('bcryptjs')

const prisma = new PrismaClient()

async function seed() {
  const email = process.env.ADMIN_EMAIL || 'admin@creatorhub.com'
  const password = process.env.ADMIN_PASSWORD || 'AdminPassword123!'
  const name = process.env.ADMIN_NAME || 'Super Admin'

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    console.log('✅ Admin user already exists:', existing.email)
    return
  }

  const passwordHash = await bcrypt.hash(password, 12)
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      role: Role.admin,
      name,
      isActive: true,
    },
  })
  console.log('✅ Admin user created successfully:', user.email, '| Role:', user.role)
}

seed()
  .catch((e) => console.error('❌ Error seeding admin:', e))
  .finally(() => prisma.$disconnect())
