import { requireUser } from '@/lib/auth-helpers'
import QueueClippingAutomationClient from '@/components/user/queue-clipping-automation-client'

export const metadata = {
  title: 'Queue Clipping Automation | Creator Hub',
}

export default async function RunAutomationPage() {
  await requireUser()

  return <QueueClippingAutomationClient />
}
