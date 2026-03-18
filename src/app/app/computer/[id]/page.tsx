'use client'

import { useEffect, useState } from 'react'
import { use } from 'react'
import { Cpu } from 'lucide-react'

const STORAGE_KEY = 'overlay_computers'

interface Computer {
  id: string
  name: string
}

export default function ComputerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [name, setName] = useState<string | null>(null)

  useEffect(() => {
    try {
      const computers: Computer[] = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
      const found = computers.find((c) => c.id === id)
      setName(found?.name ?? 'Computer')
    } catch {
      setName('Computer')
    }
  }, [id])

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center border-b border-[#e5e5e5] px-6">
        <h2 className="text-sm font-medium text-[#0a0a0a]">{name ?? '...'}</h2>
      </div>
      <div className="flex flex-col items-center justify-center flex-1 gap-4 text-[#888]">
        <Cpu size={40} strokeWidth={1} className="opacity-30" />
        <div className="text-center space-y-1">
          <p className="text-sm font-medium text-[#525252]">Computer coming soon</p>
          <p className="text-xs text-[#aaa]">This feature is under development</p>
        </div>
      </div>
    </div>
  )
}
