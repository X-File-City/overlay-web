'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Plus, Cpu, Circle, Trash2 } from 'lucide-react'

type ComputerStatus = 'idle'

interface Computer {
  id: string
  name: string
  status: ComputerStatus
}

function StatusDot({ status }: { status: ComputerStatus }) {
  const colors: Record<ComputerStatus, string> = {
    idle: 'text-[#bbb]',
  }
  return <Circle size={6} className={`shrink-0 fill-current ${colors[status]}`} />
}

const STORAGE_KEY = 'overlay_computers'

function loadComputers(): Computer[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
  } catch {
    return []
  }
}

function saveComputers(computers: Computer[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(computers))
}

export default function ComputerSidebar() {
  const router = useRouter()
  const pathname = usePathname()
  const [computers, setComputers] = useState<Computer[]>([])

  useEffect(() => {
    setComputers(loadComputers())
  }, [])

  function handleNew() {
    router.push('/app/computer/new')
  }

  function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    const next = computers.filter((c) => c.id !== id)
    setComputers(next)
    saveComputers(next)
    if (pathname === `/app/computer/${id}`) {
      router.push('/app/computer')
    }
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
            <p className="text-[10px]">Click &quot;New Computer&quot; to add one</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {computers.map((c) => {
              const active = pathname === `/app/computer/${c.id}`
              return (
                <div
                  key={c.id}
                  onClick={() => router.push(`/app/computer/${c.id}`)}
                  className={`group flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#e8e8e8] text-[#0a0a0a]'
                      : 'text-[#525252] hover:bg-[#ebebeb] hover:text-[#0a0a0a]'
                  }`}
                >
                  <StatusDot status={c.status} />
                  <span className="flex-1 truncate">{c.name}</span>
                  <button
                    onClick={(e) => handleDelete(c.id, e)}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-[#d8d8d8] transition-opacity shrink-0"
                  >
                    <Trash2 size={10} />
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
