import { requireUser } from '@/lib/auth-helpers'
import PendingTasksClient from '@/components/user/pending-tasks-client'

export const metadata = {
  title: 'Pending Tasks | Creator Hub',
  description: 'Submit proof and review qualifying clips awaiting manual submission',
}

export default async function PendingTasksPage() {
  await requireUser()

  return <PendingTasksClient />
}
