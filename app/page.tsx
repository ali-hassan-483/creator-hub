import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'

export default async function HomePage() {
  const session = await auth()
  if (!session) redirect('/login')
  const role = (session.user as any)?.role
  redirect(role === 'admin' ? '/admin/dashboard' : '/dashboard')
}
