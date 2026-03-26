import { getSession } from '@/lib/workos-auth'
import { redirect } from 'next/navigation'
import NewComputerClient from './NewComputerClient'

export default async function NewComputerPage() {
  const session = await getSession()
  if (!session) redirect('/auth/sign-in?redirect=%2Fapp%2Fcomputer%2Fnew')
  return (
    <NewComputerClient
      userId={session.user.id}
      email={session.user.email}
      accessToken={session.accessToken}
    />
  )
}
