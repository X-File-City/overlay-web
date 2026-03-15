import IntegrationsView from '@/components/app/IntegrationsView'
import { getSession } from '@/lib/workos-auth'

export default async function IntegrationsPage() {
  const session = await getSession()
  return <IntegrationsView userId={session!.user.id} />
}
