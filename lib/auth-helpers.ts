import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'

export interface AuthenticatedUser {
  id: string
  role: 'admin' | 'user'
  email: string
  name?: string | null
}

export interface AuthenticatedSession {
  user: AuthenticatedUser
  expires: string
}

export async function requireAuth(): Promise<AuthenticatedSession> {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')
  return session as unknown as AuthenticatedSession
}

export async function requireAdmin(): Promise<AuthenticatedSession> {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')
  if ((session.user as any).role !== 'admin') redirect('/dashboard')
  return session as unknown as AuthenticatedSession
}

export async function requireUser(): Promise<AuthenticatedSession> {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')
  return session as unknown as AuthenticatedSession
}

export function isAdmin(session: any): boolean {
  return session?.user?.role === 'admin'
}
