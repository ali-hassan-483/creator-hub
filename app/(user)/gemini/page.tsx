import { requireUser } from '@/lib/auth-helpers'
import { prisma } from '@/lib/db'
import Link from 'next/link'

export default async function GeminiConfigPage() {
  const session = await requireUser()
  const userId = session.user.id

  const config = await prisma.geminiConfig.findUnique({ where: { userId } })

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Gemini Config</h1>
        <p className="text-muted-foreground text-sm mt-1">Configure your Gemini AI API key</p>
      </div>

      <div className="bg-card border border-border rounded-xl p-6 space-y-4">
        {config ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">API Key</p>
                <p className="text-xs text-muted-foreground">
                  {config.apiKeyEnc ? '••••••••••••••••••••••••••••••••' : 'Not set'}
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
              href="/gemini/edit"
              className="inline-block px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              Edit Config
            </Link>
          </div>
        ) : (
          <div className="text-center py-6">
            <p className="text-muted-foreground text-sm mb-4">
              No Gemini configuration found. Add your API key to enable AI features.
            </p>
            <Link
              href="/gemini/edit"
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              Add Gemini API Key
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
