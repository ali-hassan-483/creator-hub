import { requireAdmin } from '@/lib/auth-helpers'
import { Sidebar } from '@/components/layout/sidebar'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdmin()
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar
        role="admin"
        userName={session.user?.name}
        userEmail={session.user?.email}
      />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}
