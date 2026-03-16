import ToolsView from '@/components/app/ToolsView'
import { getSession } from '@/lib/workos-auth'

export default async function ToolsPage() {
  const session = await getSession()
  return <ToolsView userId={session!.user.id} />
}
