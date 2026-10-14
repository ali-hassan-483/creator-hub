import { requireUser } from '@/lib/auth-helpers'
import SandboxTestClient from '@/components/user/sandbox-test-client'

export const metadata = {
  title: 'Sandbox Render Sandbox | Creator Hub',
}

export default async function SandboxTestPage() {
  await requireUser()

  return <SandboxTestClient />
}
