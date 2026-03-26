import { Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import { getSession } from '@/lib/workos-auth'
import { redirect } from 'next/navigation'
import ComputerDetailClient from './ComputerDetailClient'

export default async function ComputerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSession()
  if (!session) redirect(`/auth/sign-in?redirect=${encodeURIComponent(`/app/computer/${id}`)}`)
  return (
    <Suspense fallback={
      <div className="flex h-full items-center justify-center">
        <Loader2 size={20} className="text-[#aaa] animate-spin" />
      </div>
    }>
      <ComputerDetailClient computerId={id} />
    </Suspense>
  )
}
