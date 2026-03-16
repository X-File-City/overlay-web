import { getSession } from '@/lib/workos-auth'
import ProjectsView from '@/components/app/ProjectsView'

export default async function ProjectsPage() {
  const session = await getSession()
  return <ProjectsView userId={session!.user.id} />
}
