import ToolsView from '@/components/app/ToolsView'
import { getSession } from '@/lib/workos-auth'
import { redirect } from 'next/navigation'

export default async function ToolsPage() {
  const session = await getSession()
  if (!session) {
    redirect('/auth/sign-in?redirect=%2Fapp%2Ftools')
  }
  return <ToolsView userId={session.user.id} />
}
