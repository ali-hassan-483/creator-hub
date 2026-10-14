import { requireUser } from '@/lib/auth-helpers'
import UnifiedCredentialsClient from '@/components/user/unified-credentials-client'

export const metadata = {
  title: 'Prerequisites & Cookie Credentials | Creator Hub',
}

export default async function CredentialsPage() {
  await requireUser()

  return <UnifiedCredentialsClient />
}
