import { requireAdmin } from '@/lib/auth-helpers'

export default async function AdminSettingsPage() {
  await requireAdmin()

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Admin Settings</h1>
        <p className="text-muted-foreground text-sm mt-1">Platform configuration</p>
      </div>

      <div className="bg-card border border-border rounded-xl p-6">
        <p className="text-muted-foreground text-sm">
          Settings configuration will be added in a future phase.
        </p>
      </div>
    </div>
  )
}
