import { requireUser } from '@/lib/auth-helpers'
import { prisma } from '@/lib/db'
import Link from 'next/link'

export default async function DiscordConfigPage() {
  const session = await requireUser()
  const userId = session.user.id

  const config = await prisma.discordConfig.findUnique({ where: { userId } })

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Discord Config</h1>
        <p className="text-muted-foreground text-sm mt-1">Configure your Discord webhook for notifications</p>
      </div>

      <div className="bg-card border border-border rounded-xl p-6">
        {config ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">{config.label || 'Discord Webhook'}</p>
                <p className="text-xs text-muted-foreground">
                  Webhook: {config.webhookUrlEnc ? '••••••••••••••••' : 'Not set'}
                </p>
              </div>
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  config.isActive
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {config.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Last updated: {config.updatedAt.toLocaleDateString()}
            </p>
            <Link
              href="/discord/edit"
              className="inline-block px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              Edit Config
            </Link>
          </div>
        ) : (
          <div className="text-center py-6">
            <p className="text-muted-foreground text-sm mb-4">
              No Discord webhook configured. Add one to receive automation notifications.
            </p>
            <Link
              href="/discord/edit"
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              Add Webhook
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
