import dns from 'dns'
import { PrismaClient } from '@prisma/client'

// Force Node.js DNS to prefer IPv4 over IPv6 in Docker containers
if (dns && typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first')
}

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
