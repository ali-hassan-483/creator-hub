import { requireAdmin } from '@/lib/auth-helpers'
import { WhopAccountsClient } from '@/components/admin/whop-accounts-client'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Whop Accounts | Creator Hub Admin',
}

export default async function AdminWhopAccountsPage() {
  await requireAdmin()

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <WhopAccountsClient />
    </div>
  )
}
