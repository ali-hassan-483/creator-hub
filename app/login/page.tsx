import { LoginForm } from '@/components/auth/login-form'
import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'

export default async function LoginPage() {
  const session = await auth()
  if (session) {
    const role = (session.user as any)?.role
    redirect(role === 'admin' ? '/admin/dashboard' : '/dashboard')
  }
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-md px-4">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-foreground">Content Platform</h1>
          <p className="text-muted-foreground mt-2">Sign in to your account</p>
        </div>
        <LoginForm />
      </div>
    </div>
  )
}
