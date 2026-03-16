'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus, Plug, Loader2, Sparkles } from 'lucide-react'

interface ConnectorItem {
  slug: string
  name: string
  logoUrl: string | null
}

type Tab = 'connectors' | 'skills'

function ConnectorLogo({ logoUrl, name }: { logoUrl: string | null; name: string }) {
  const [hasError, setHasError] = useState(false)
  useEffect(() => { setHasError(false) }, [logoUrl])
  return (
    <span className="inline-flex items-center justify-center shrink-0 rounded-md bg-white border border-black/10" style={{ width: 22, height: 22 }}>
      {logoUrl && !hasError ? (
        <img src={logoUrl} alt={name} width={14} height={14} className="object-contain" onError={() => setHasError(true)} />
      ) : (
        <span className="text-[9px] font-bold text-[#525252]">{name.charAt(0).toUpperCase()}</span>
      )}
    </span>
  )
}

export default function ToolsSidebar() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const currentView = searchParams.get('view') as Tab | null

  const [tab, setTab] = useState<Tab>(currentView === 'skills' ? 'skills' : 'connectors')
  const [connectors, setConnectors] = useState<ConnectorItem[]>([])
  const [loading, setLoading] = useState(true)

  const loadConnectors = useCallback(async () => {
    setLoading(true)
    try {
      const [statusRes, searchRes] = await Promise.all([
        fetch('/api/app/integrations'),
        fetch('/api/app/integrations?action=search&limit=50'),
      ])
      if (!statusRes.ok || !searchRes.ok) return
      const { connected } = await statusRes.json() as { connected: string[] }
      const { items } = await searchRes.json() as { items: Array<{ slug: string; name: string; logoUrl: string | null }> }
      const connectedSet = new Set(connected)
      setConnectors(items.filter((i) => connectedSet.has(i.slug)).map((i) => ({ slug: i.slug, name: i.name, logoUrl: i.logoUrl })))
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [])

  useEffect(() => { loadConnectors() }, [loadConnectors])

  // Sync tab with URL
  useEffect(() => {
    if (currentView === 'skills') setTab('skills')
    else if (currentView === 'connectors') setTab('connectors')
  }, [currentView])

  function navigate(view: Tab) {
    setTab(view)
    router.push(`/app/tools?view=${view}`)
  }

  return (
    <div className="w-60 h-full flex flex-col border-r border-[#e5e5e5] bg-[#f5f5f5] shrink-0">
      {/* Header — action button */}
      <div className="flex h-16 items-center border-b border-[#e5e5e5] px-3 shrink-0">
        {tab === 'connectors' ? (
          <button
            onClick={() => router.push('/app/tools?view=connectors')}
            className="flex items-center gap-1.5 w-full px-3 py-1.5 rounded-md text-sm bg-[#0a0a0a] text-[#fafafa] hover:bg-[#222] transition-colors"
          >
            <Plus size={13} />
            New Connector
          </button>
        ) : (
          <button
            onClick={() => router.push('/app/tools?view=skills')}
            className="flex items-center gap-1.5 w-full px-3 py-1.5 rounded-md text-sm bg-[#0a0a0a] text-[#fafafa] hover:bg-[#222] transition-colors"
          >
            <Plus size={13} />
            New Skill
          </button>
        )}
      </div>

      {/* Tab toggle */}
      <div className="flex gap-0.5 p-2 border-b border-[#e5e5e5] shrink-0">
        <button
          onClick={() => navigate('connectors')}
          className={`flex-1 py-1 rounded text-xs transition-colors ${
            tab === 'connectors' ? 'bg-[#0a0a0a] text-[#fafafa]' : 'text-[#525252] hover:bg-[#e8e8e8]'
          }`}
        >
          Connectors
        </button>
        <button
          onClick={() => navigate('skills')}
          className={`flex-1 py-1 rounded text-xs transition-colors ${
            tab === 'skills' ? 'bg-[#0a0a0a] text-[#fafafa]' : 'text-[#525252] hover:bg-[#e8e8e8]'
          }`}
        >
          Skills
        </button>
      </div>

      {/* Content list */}
      <div className="flex-1 overflow-y-auto py-1.5 px-1.5">
        {tab === 'connectors' ? (
          loading ? (
            <div className="flex justify-center pt-8 text-[#888]">
              <Loader2 size={14} className="animate-spin" />
            </div>
          ) : connectors.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-[#aaa] text-center">
              <Plug size={24} strokeWidth={1} className="opacity-40" />
              <p className="text-xs">No connectors yet</p>
              <p className="text-[10px]">Click "New Connector" to add one</p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {connectors.map((c) => (
                <div
                  key={c.slug}
                  onClick={() => router.push('/app/tools?view=connectors')}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-[#525252] hover:bg-[#ebebeb] hover:text-[#0a0a0a] transition-colors cursor-pointer"
                >
                  <ConnectorLogo logoUrl={c.logoUrl} name={c.name} />
                  <span className="flex-1 truncate">{c.name}</span>
                </div>
              ))}
            </div>
          )
        ) : (
          <div className="flex flex-col items-center justify-center py-10 gap-2 text-[#aaa] text-center">
            <Sparkles size={24} strokeWidth={1} className="opacity-40" />
            <p className="text-xs">No skills yet</p>
            <p className="text-[10px]">Click "New Skill" to create one</p>
          </div>
        )}
      </div>
    </div>
  )
}
