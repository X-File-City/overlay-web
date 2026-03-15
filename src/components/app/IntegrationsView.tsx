'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, CheckCircle2, Circle } from 'lucide-react'

interface Integration {
  id: string
  composioId: string
  name: string
  description: string
  icon: string // emoji fallback
}

const INTEGRATIONS: Integration[] = [
  { id: 'gmail', composioId: 'gmail', name: 'Gmail', description: 'Compose, send, and search emails', icon: '📧' },
  { id: 'google-calendar', composioId: 'googlecalendar', name: 'Google Calendar', description: 'Read and create calendar events', icon: '📅' },
  { id: 'google-sheets', composioId: 'googlesheets', name: 'Google Sheets', description: 'Read, update, and create spreadsheets', icon: '📊' },
  { id: 'google-drive', composioId: 'googledrive', name: 'Google Drive', description: 'Search and manage Drive files', icon: '📁' },
  { id: 'notion', composioId: 'notion', name: 'Notion', description: 'Create pages and manage workspace', icon: '📝' },
  { id: 'slack', composioId: 'slack', name: 'Slack', description: 'Send messages and manage channels', icon: '💬' },
  { id: 'outlook', composioId: 'outlook', name: 'Outlook', description: 'Send emails and manage calendar', icon: '📨' },
  { id: 'x-twitter', composioId: 'twitter', name: 'X (Twitter)', description: 'Post tweets and manage your account', icon: '🐦' },
  { id: 'asana', composioId: 'asana', name: 'Asana', description: 'Create tasks and manage projects', icon: '✅' },
  { id: 'linkedin', composioId: 'linkedin', name: 'LinkedIn', description: 'Manage posts and profile actions', icon: '💼' },
]

export default function IntegrationsView({ userId: _userId }: { userId: string }) {
  void _userId
  const [connected, setConnected] = useState<Set<string>>(new Set())
  const [isLoading, setIsLoading] = useState(true)
  const [connecting, setConnecting] = useState<string | null>(null)

  const loadConnected = useCallback(async () => {
    try {
      const res = await fetch('/api/app/integrations')
      if (res.ok) {
        const data = await res.json()
        setConnected(new Set(data.connected || []))
      }
    } catch {
      // ignore
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { loadConnected() }, [loadConnected])

  // Refresh on focus (user may have completed OAuth in another tab)
  useEffect(() => {
    const onFocus = () => loadConnected()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [loadConnected])

  async function handleConnect(integration: Integration) {
    if (connecting) return
    setConnecting(integration.composioId)
    try {
      if (connected.has(integration.composioId)) {
        // Disconnect
        await fetch('/api/app/integrations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'disconnect', toolkit: integration.composioId }),
        })
        setConnected((prev) => { const next = new Set(prev); next.delete(integration.composioId); return next })
      } else {
        // Connect — get OAuth URL and open in new tab
        const res = await fetch('/api/app/integrations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'connect', toolkit: integration.composioId }),
        })
        if (res.ok) {
          const data = await res.json()
          if (data.redirectUrl) {
            window.open(data.redirectUrl, '_blank')
          }
        }
      }
    } finally {
      setConnecting(null)
    }
  }

  const connectedList = INTEGRATIONS.filter((i) => connected.has(i.composioId))
  const availableList = INTEGRATIONS.filter((i) => !connected.has(i.composioId))

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-16 items-center border-b border-[#e5e5e5] px-6">
        <h2 className="text-sm font-medium text-[#0a0a0a]">Integrations</h2>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 size={20} className="animate-spin text-[#888]" />
          </div>
        ) : (
          <div className="mx-auto max-w-2xl px-6 py-6 space-y-8">
            <p className="text-sm text-[#888]">
              Connect your apps so the agent can act on your behalf.
            </p>

            {connectedList.length > 0 && (
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#888] mb-3">Connected</p>
                <div className="space-y-1">
                  {connectedList.map((integration) => (
                    <IntegrationRow
                      key={integration.id}
                      integration={integration}
                      isConnected={true}
                      isConnecting={connecting === integration.composioId}
                      onAction={handleConnect}
                    />
                  ))}
                </div>
              </div>
            )}

            <div>
              {connectedList.length > 0 && (
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#888] mb-3">Available</p>
              )}
              <div className="space-y-1">
                {availableList.map((integration) => (
                  <IntegrationRow
                    key={integration.id}
                    integration={integration}
                    isConnected={false}
                    isConnecting={connecting === integration.composioId}
                    onAction={handleConnect}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function IntegrationRow({
  integration,
  isConnected,
  isConnecting,
  onAction,
}: {
  integration: Integration
  isConnected: boolean
  isConnecting: boolean
  onAction: (i: Integration) => void
}) {
  return (
    <div className="flex items-center justify-between px-3 py-3 rounded-lg hover:bg-[#f5f5f5] transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-lg flex-shrink-0 w-7 text-center">{integration.icon}</span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-[#0a0a0a]">{integration.name}</p>
            {isConnected && <CheckCircle2 size={13} className="text-emerald-500 flex-shrink-0" />}
            {!isConnected && <Circle size={13} className="text-[#d4d4d4] flex-shrink-0" />}
          </div>
          <p className="text-xs text-[#888] truncate">{integration.description}</p>
        </div>
      </div>
      <button
        onClick={() => onAction(integration)}
        disabled={isConnecting}
        className={`flex-shrink-0 ml-4 text-xs px-3 py-1.5 rounded-md transition-colors disabled:opacity-50 ${
          isConnected
            ? 'text-[#525252] hover:bg-[#f0f0f0]'
            : 'bg-[#0a0a0a] text-[#fafafa] hover:bg-[#222]'
        }`}
      >
        {isConnecting ? (
          <Loader2 size={11} className="animate-spin" />
        ) : isConnected ? (
          'Disconnect'
        ) : (
          'Connect'
        )}
      </button>
    </div>
  )
}
