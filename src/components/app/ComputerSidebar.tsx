'use client'

import { useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Plus, Cpu, Circle } from 'lucide-react'

type ComputerStatus = 'running' | 'idle' | 'stopped' | 'error'

interface Computer {
  id: string
  name: string
  status: ComputerStatus
}

function StatusDot({ status }: { status: ComputerStatus }) {
  const colors: Record<ComputerStatus, string> = {
    running: 'text-green-500',
    idle: 'text-amber-400',
    stopped: 'text-[#bbb]',
    error: 'text-red-500',
  }
  return <Circle size={6} className={`shrink-0 fill-current ${colors[status]}`} />
}

// Placeholder list — will be replaced with real data once the backend is wired up
const MOCK_COMPUTERS: Computer[] = []

export default function ComputerSidebar() {
  const router = useRouter()
  const pathname = usePathname()
  const [computers] = useState<Computer[]>(MOCK_COMPUTERS)

  function handleNew() {
    router.push('/app/computer/new')
  }

  return (
    <div className="w-52 h-full flex flex-col border-r border-[#e5e5e5] bg-[#f5f5f5] shrink-0">
      {/* Header */}
      <div className="flex h-16 items-center border-b border-[#e5e5e5] px-3 shrink-0">
        <button
          onClick={handleNew}
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
            <p className="text-[10px]">Click &quot;New Computer&quot; to spin one up</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {computers.map((c) => {
              const active = pathname === `/app/computer/${c.id}`
              return (
                <div
                  key={c.id}
                  onClick={() => router.push(`/app/computer/${c.id}`)}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#e8e8e8] text-[#0a0a0a]'
                      : 'text-[#525252] hover:bg-[#ebebeb] hover:text-[#0a0a0a]'
                  }`}
                >
                  <StatusDot status={c.status} />
                  <span className="flex-1 truncate">{c.name}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
