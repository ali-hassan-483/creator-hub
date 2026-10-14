import { requireUser } from '@/lib/auth-helpers'
import AnalyticsClient from '@/components/user/analytics-client'

export const metadata = {
  title: 'Analytics | Creator Hub',
  description: 'Multi-channel video analytics and automatic threshold detection',
}

export default async function AnalyticsPage() {
  await requireUser()

  return <AnalyticsClient />
}
