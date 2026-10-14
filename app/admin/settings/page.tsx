import { requireAdmin } from '@/lib/auth-helpers'
import { AdminSettingsClient } from '@/components/admin/admin-settings-client'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Settings & Alerts | Creator Hub Admin',
}

export default async function AdminSettingsPage() {
  await requireAdmin()

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Admin Settings & Integrations</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Configure automated Discord alert channels and platform integrations.
        </p>
      </div>

      <AdminSettingsClient />
    </div>
  )
}
