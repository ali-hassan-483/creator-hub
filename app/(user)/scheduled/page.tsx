import { requireUser } from '@/lib/auth-helpers'
import RunLogsClient from '@/components/user/run-logs-client'

export const metadata = {
  title: 'Run Logs | Creator Hub',
  description: 'Automation run history, logs, and pending manual video/Whop submissions',
}

export default async function ScheduledPage() {
  await requireUser()

  return <RunLogsClient />
}
