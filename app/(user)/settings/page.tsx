import { requireUser } from '@/lib/auth-helpers'
import { prisma } from '@/lib/db'
import { decryptIfPresent } from '@/lib/encryption'
import { ShieldCheck, Copy } from 'lucide-react'

export const metadata = {
  title: 'Proxy Settings | Creator Hub',
  description: 'View your assigned proxy credentials',
}

export default async function UserSettingsPage() {
  const session = await requireUser()
  const userId = session.user!.id

  const ip = await prisma.ipAddress.findFirst({
    where: { assignedTo: userId },
  })

  let passwordDisplay = '—'
  if (ip?.passwordEnc) {
    try {
      passwordDisplay = decryptIfPresent(ip.passwordEnc) || '—'
    } catch {
      passwordDisplay = ip.passwordEnc || '—'
    }
  }

  return (
    <div className="p-6 space-y-6 min-h-screen">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Assigned Proxy Settings</h1>
      </div>

      <div className="neu-flat rounded-3xl p-8 max-w-2xl space-y-6">
        <div>
          <h2 className="text-base font-bold text-[var(--text-primary)]">
            Your Assigned Proxy Credentials
          </h2>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Use these proxy settings to configure external scrapers or verify connections.
          </p>
        </div>

        {!ip ? (
          <div className="neu-pressed rounded-2xl p-8 text-center text-xs text-[var(--text-muted)]">
            No proxy settings currently assigned to your account.
          </div>
        ) : (
          <div className="space-y-4 pt-2">
            {/* Host */}
            <div className="flex items-center justify-between py-2 border-b border-[var(--border)]/50">
              <span className="text-sm font-semibold text-[var(--text-primary)]">Host</span>
              <span className="text-sm font-mono font-medium text-[var(--text-primary)]">
                {ip.ipAddress}
              </span>
            </div>

            {/* Port */}
            <div className="flex items-center justify-between py-2 border-b border-[var(--border)]/50">
              <span className="text-sm font-semibold text-[var(--text-primary)]">Port</span>
              <span className="text-sm font-mono font-medium text-[var(--text-primary)]">
                {ip.port || 12323}
              </span>
            </div>

            {/* Username */}
            <div className="flex items-center justify-between py-2 border-b border-[var(--border)]/50">
              <span className="text-sm font-semibold text-[var(--text-primary)]">Username</span>
              <span className="text-sm font-mono font-medium text-[var(--text-primary)]">
                {ip.username || '—'}
              </span>
            </div>

            {/* Password */}
            <div className="flex items-center justify-between py-2">
              <span className="text-sm font-semibold text-[var(--text-primary)]">Password</span>
              <span className="text-sm font-mono font-medium text-[var(--text-primary)]">
                {passwordDisplay}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
