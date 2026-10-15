import { prisma } from './db'
import crypto from 'crypto'

/**
 * Ensures the primary Main Server VPS node exists in the database.
 * The Main Server can also have up to 2 users assigned for uploading.
 */
export async function ensureMainVpsExists() {
  let mainVps = await prisma.ipAddress.findFirst({
    where: { isMainVps: true },
    include: {
      users: { select: { id: true, name: true, email: true } },
    },
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
      include: {
        users: { select: { id: true, name: true, email: true } },
      },
    })
  }

  return mainVps
}

/**
 * Fetches all VPS nodes formatted with live online/offline status and assigned user capacity.
 */
export async function getAllVpsNodes() {
  await ensureMainVpsExists()

  const nodes = await prisma.ipAddress.findMany({
    orderBy: [{ isMainVps: 'desc' }, { createdAt: 'desc' }],
    include: {
      users: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  })

  const now = Date.now()

  return nodes.map((node) => {
    const isRecentlyActive =
      node.lastPing && now - new Date(node.lastPing).getTime() < 120_000 // 2 minutes window
    const isOnline = node.isMainVps ? true : Boolean(isRecentlyActive)
    const maxUsers = node.maxUsers || 2
    const assignedCount = node.users.length
    const isAvailable = assignedCount < maxUsers

    return {
      id: node.id,
      ipAddress: node.ipAddress,
      port: node.port || 22,
      username: node.username || 'root',
      label: node.label || (node.isMainVps ? 'Main Server' : 'Worker VPS'),
      notes: node.notes,
      isMainVps: node.isMainVps,
      maxUsers,
      assignedCount,
      isAvailable,
      status: isOnline ? 'online' : 'offline',
      lastPing: node.lastPing ? node.lastPing.toISOString() : null,
      apiKey: node.apiKey,
      createdAt: node.createdAt.toISOString(),
      users: node.users,
    }
  })
}

/**
 * Validates a VPS API key and updates its heartbeat.
 */
export async function validateVpsApiKey(apiKey: string) {
  if (!apiKey || typeof apiKey !== 'string') return null

  const vps = await prisma.ipAddress.findUnique({
    where: { apiKey },
    include: {
      users: {
        select: {
          id: true,
          name: true,
          email: true,
          isActive: true,
        },
      },
    },
  })

  if (!vps) return null

  // Update heartbeat ping
  await prisma.ipAddress.update({
    where: { id: vps.id },
    data: {
      lastPing: new Date(),
      status: 'online',
    },
  })

  return vps
}
