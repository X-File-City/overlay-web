import { getSession } from '@/lib/workos-auth'
import NewComputerClient from './NewComputerClient'

export default async function NewComputerPage() {
  const session = await getSession()
  return (
    <NewComputerClient
      userId={session!.user.id}
      email={session!.user.email}
      accessToken={session!.accessToken}
    />
  )
}
