import KnowledgeView from '@/components/app/KnowledgeView'
import { getSession } from '@/lib/workos-auth'

export default async function KnowledgePage() {
  const session = await getSession()
  return <KnowledgeView userId={session!.user.id} />
}
