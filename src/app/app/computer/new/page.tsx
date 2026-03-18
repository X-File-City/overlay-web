'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Cpu, Sparkles, Server, Settings, Check, Cloud, Shield, Zap } from 'lucide-react'

type SetupOption = 'managed' | 'byoc' | 'custom'

export default function NewComputerPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<SetupOption>('managed')

  return (
    <div className="flex h-full flex-col bg-[#fafafa]">
      {/* Header */}
      <div className="flex h-16 items-center gap-3 border-b border-[#e5e5e5] px-6 shrink-0">
        <button
          onClick={() => router.back()}
          className="p-1.5 rounded-md text-[#888] hover:text-[#0a0a0a] hover:bg-[#f0f0f0] transition-colors"
        >
          <ArrowLeft size={15} />
        </button>
        <h2 className="text-sm font-medium text-[#0a0a0a]">New Computer</h2>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-10 space-y-8">

          {/* Name field */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-[#525252] uppercase tracking-[0.1em]">
              Name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Work Assistant, Research Bot…"
              autoFocus
              className="w-full text-sm border border-[#e5e5e5] rounded-lg px-3.5 py-2.5 outline-none placeholder-[#bbb] focus:border-[#0a0a0a] transition-colors bg-white"
            />
          </div>

          {/* Setup options */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-[#525252] uppercase tracking-[0.1em]">
              Setup
            </label>
            <div className="space-y-2">

              {/* Option 1 — Managed (recommended) */}
              <button
                onClick={() => setSelected('managed')}
                className={`w-full text-left rounded-xl border-2 p-4 transition-all ${
                  selected === 'managed'
                    ? 'border-[#0a0a0a] bg-white'
                    : 'border-[#e5e5e5] bg-white hover:border-[#ccc]'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                    selected === 'managed' ? 'bg-[#0a0a0a]' : 'bg-[#f0f0f0]'
                  }`}>
                    <Sparkles size={16} className={selected === 'managed' ? 'text-white' : 'text-[#888]'} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-[#0a0a0a]">
                        Set up new computer instance
                      </span>
                      <span className="text-[10px] font-medium bg-[#0a0a0a] text-white px-2 py-0.5 rounded-full uppercase tracking-[0.08em]">
                        Recommended
                      </span>
                    </div>
                    <p className="text-xs text-[#888] mt-0.5">
                      One-click setup. We provision a cloud VPS and install OpenClaw for you.
                    </p>

                    {/* Expanded detail when selected */}
                    {selected === 'managed' && (
                      <div className="mt-4 space-y-3">
                        <div className="grid grid-cols-3 gap-2">
                          <div className="flex flex-col items-center gap-1.5 rounded-lg bg-[#f5f5f5] px-3 py-2.5 text-center">
                            <Cloud size={15} className="text-[#525252]" />
                            <span className="text-[10px] text-[#525252] font-medium">Hetzner VPS</span>
                            <span className="text-[10px] text-[#aaa]">EU / US regions</span>
                          </div>
                          <div className="flex flex-col items-center gap-1.5 rounded-lg bg-[#f5f5f5] px-3 py-2.5 text-center">
                            <Zap size={15} className="text-[#525252]" />
                            <span className="text-[10px] text-[#525252] font-medium">Always on</span>
                            <span className="text-[10px] text-[#aaa]">24/7 uptime</span>
                          </div>
                          <div className="flex flex-col items-center gap-1.5 rounded-lg bg-[#f5f5f5] px-3 py-2.5 text-center">
                            <Shield size={15} className="text-[#525252]" />
                            <span className="text-[10px] text-[#525252] font-medium">Private</span>
                            <span className="text-[10px] text-[#aaa]">Your data only</span>
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          {[
                            'Runs OpenClaw Gateway with all your notes, memories & connectors',
                            'Access from any device via Overlay',
                            'Persistent workspace — survives restarts',
                          ].map((item) => (
                            <div key={item} className="flex items-start gap-2">
                              <Check size={12} className="mt-0.5 shrink-0 text-[#525252]" />
                              <span className="text-xs text-[#525252]">{item}</span>
                            </div>
                          ))}
                        </div>

                        <div className="flex items-center gap-1.5 rounded-lg bg-[#f5f5f5] px-3 py-2">
                          <Cpu size={12} className="text-[#aaa] shrink-0" />
                          <span className="text-[11px] text-[#888]">
                            ~$10/month · 2 vCPU · 4 GB RAM · Hetzner CX22
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {selected === 'managed' && (
                    <div className="mt-0.5 shrink-0 h-4 w-4 rounded-full bg-[#0a0a0a] flex items-center justify-center">
                      <Check size={9} className="text-white" />
                    </div>
                  )}
                </div>
              </button>

              {/* Option 2 — Bring your own */}
              <button
                onClick={() => setSelected('byoc')}
                className={`w-full text-left rounded-xl border-2 p-4 transition-all ${
                  selected === 'byoc'
                    ? 'border-[#0a0a0a] bg-white'
                    : 'border-[#e5e5e5] bg-white hover:border-[#ccc]'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                    selected === 'byoc' ? 'bg-[#0a0a0a]' : 'bg-[#f0f0f0]'
                  }`}>
                    <Server size={16} className={selected === 'byoc' ? 'text-white' : 'text-[#888]'} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-[#0a0a0a]">
                        Bring your own OpenClaw instance
                      </span>
                      <span className="text-[10px] font-medium text-[#bbb] border border-[#e5e5e5] px-2 py-0.5 rounded-full uppercase tracking-[0.08em]">
                        Coming soon
                      </span>
                    </div>
                    <p className="text-xs text-[#888] mt-0.5">
                      Connect an existing OpenClaw Gateway running on your own server or VPS.
                    </p>
                  </div>
                  {selected === 'byoc' && (
                    <div className="mt-0.5 shrink-0 h-4 w-4 rounded-full bg-[#0a0a0a] flex items-center justify-center">
                      <Check size={9} className="text-white" />
                    </div>
                  )}
                </div>
              </button>

              {/* Option 3 — Custom */}
              <button
                onClick={() => setSelected('custom')}
                className={`w-full text-left rounded-xl border-2 p-4 transition-all ${
                  selected === 'custom'
                    ? 'border-[#0a0a0a] bg-white'
                    : 'border-[#e5e5e5] bg-white hover:border-[#ccc]'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                    selected === 'custom' ? 'bg-[#0a0a0a]' : 'bg-[#f0f0f0]'
                  }`}>
                    <Settings size={16} className={selected === 'custom' ? 'text-white' : 'text-[#888]'} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-[#0a0a0a]">Custom setup</span>
                      <span className="text-[10px] font-medium text-[#bbb] border border-[#e5e5e5] px-2 py-0.5 rounded-full uppercase tracking-[0.08em]">
                        Coming soon
                      </span>
                    </div>
                    <p className="text-xs text-[#888] mt-0.5">
                      Configure your own runtime, Docker image, or environment from scratch.
                    </p>
                  </div>
                  {selected === 'custom' && (
                    <div className="mt-0.5 shrink-0 h-4 w-4 rounded-full bg-[#0a0a0a] flex items-center justify-center">
                      <Check size={9} className="text-white" />
                    </div>
                  )}
                </div>
              </button>

            </div>
          </div>

          {/* Continue button */}
          <button
            disabled={!name.trim()}
            className="w-full py-2.5 rounded-lg text-sm font-medium bg-[#0a0a0a] text-white disabled:opacity-30 hover:bg-[#222] transition-colors"
          >
            Continue
          </button>

        </div>
      </div>
    </div>
  )
}
