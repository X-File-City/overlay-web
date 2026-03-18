'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Plus, Cpu, Circle, Trash2, Loader2 } from 'lucide-react'
import { convex } from '@/lib/convex'

type ComputerStatus = 'pending_payment' | 'provisioning' | 'ready' | 'past_due' | 'error' | 'deleted'

interface ComputerItem {
  _id: string
  name: string
  status: ComputerStatus
}

const STATUS_COLORS: Record<ComputerStatus, string> = {
  pending_payment: 'text-[#f5a623]',
  provisioning:    'text-[#f5a623]',
  ready:           'text-[#27ae60]',
  past_due:        'text-[#e74c3c]',
  error:           'text-[#e74c3c]',
  deleted:         'text-[#bbb]',
}

function StatusDot({ status }: { status: ComputerStatus }) {
  return <Circle size={6} className={`shrink-0 fill-current ${STATUS_COLORS[status]}`} />
}

export default function ComputerSidebar({ userId, accessToken }: { userId: string; accessToken: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const [computers, setComputers] = useState<ComputerItem[]>([])
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const fetchComputers = useCallback(async () => {
    const result = await convex.query<ComputerItem[]>('computers:list', { userId, accessToken })
    if (result) setComputers(result)
  }, [userId, accessToken])

  const handleDeleteComputer = useCallback(async (computerId: string, computerName: string, e: React.MouseEvent) => {
    e.stopPropagation()

    if (deletingId) return

    const confirmed = window.confirm(
      `Delete "${computerName}"?\n\nThis will delete its Hetzner server, firewall, and all associated Overlay records.`
    )
    if (!confirmed) return

    setDeletingId(computerId)
    try {
      const result = await convex.action<{ queued: boolean }>('computers:deleteComputerInstance', {
        computerId,
        userId,
        accessToken,
      })

      if (!result?.queued) {
        throw new Error('Delete failed')
      }

      setComputers((prev) => prev.filter((c) => c._id !== computerId))

      if (pathname === `/app/computer/${computerId}`) {
        router.replace('/app/computer')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete computer'
      window.alert(message)
    } finally {
      setDeletingId((current) => (current === computerId ? null : current))
    }
  }, [accessToken, deletingId, pathname, router, userId])

  useEffect(() => {
    fetchComputers()
    const interval = setInterval(fetchComputers, 10000)
    return () => clearInterval(interval)
  }, [fetchComputers])

  return (
    <div className="w-52 h-full flex flex-col border-r border-[#e5e5e5] bg-[#f5f5f5] shrink-0">
      {/* Header */}
      <div className="flex h-16 items-center border-b border-[#e5e5e5] px-3 shrink-0">
        <button
          onClick={() => router.push('/app/computer/new')}
          className="flex items-center gap-1.5 w-full px-3 py-1.5 rounded-md text-sm bg-[#0a0a0a] text-[#fafafa] hover:bg-[#222] transition-colors"
        >
          <Plus size={13} />
          New Computer
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto py-1.5 px-1.5">
        {computers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2 text-[#aaa] text-center">
            <Cpu size={24} strokeWidth={1} className="opacity-40" />
            <p className="text-xs">No computers yet</p>
            <p className="text-[10px]">Click &quot;New Computer&quot; to add one</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {computers.map((c) => {
              const active = pathname === `/app/computer/${c._id}`
              const deleting = deletingId === c._id
              return (
                <div
                  key={c._id}
                  onClick={() => router.push(`/app/computer/${c._id}`)}
                  className={`group flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#e8e8e8] text-[#0a0a0a]'
                      : 'text-[#525252] hover:bg-[#ebebeb] hover:text-[#0a0a0a]'
                  }`}
                >
                  <StatusDot status={c.status} />
                  <span className="flex-1 truncate">{c.name}</span>
                  <button
                    onClick={(e) => handleDeleteComputer(c._id, c.name, e)}
                    disabled={deleting}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-[#d8d8d8] transition-opacity shrink-0 disabled:opacity-100 disabled:cursor-wait"
                    aria-label={`Delete ${c.name}`}
                    title={`Delete ${c.name}`}
                  >
                    {deleting ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} className="text-[#c33]" />}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
