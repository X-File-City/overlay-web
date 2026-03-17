'use client'

import { Cpu } from 'lucide-react'

export default function ComputerView() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center border-b border-[#e5e5e5] px-6">
        <h2 className="text-sm font-medium text-[#0a0a0a]">Computer</h2>
      </div>
      <div className="flex flex-col items-center justify-center flex-1 gap-4 text-[#888]">
        <Cpu size={40} strokeWidth={1} className="opacity-30" />
        <div className="text-center space-y-1">
          <p className="text-sm font-medium text-[#525252]">No computer selected</p>
          <p className="text-xs text-[#aaa]">Create a new computer to run tasks autonomously in the cloud</p>
        </div>
      </div>
    </div>
  )
}
