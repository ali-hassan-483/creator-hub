import { requireUser } from '@/lib/auth-helpers'
import { Sidebar } from '@/components/layout/sidebar'

export default async function UserLayout({ children }: { children: React.ReactNode }) {
  const session = await requireUser()
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar
        role="user"
        userName={session.user?.name}
        userEmail={session.user?.email}
      />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}
