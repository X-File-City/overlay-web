'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { AlertCircle, Send, Loader2 } from 'lucide-react'
import { convex } from '@/lib/convex'

type ComputerStatus = 'pending_payment' | 'provisioning' | 'ready' | 'error' | 'past_due' | 'deleted'

interface Computer {
  _id: string
  name: string
  status: ComputerStatus
  provisioningStep?: string
  errorMessage?: string
  hetznerServerIp?: string
  gatewayToken?: string
  pastDueAt?: number
}

interface LogEvent {
  _id: string
  type: string
  message: string
  createdAt: number
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

// Provisioning stepper steps
function stepIndex(step?: string): number {
  if (!step) return 0
  const map: Record<string, number> = { creating_server: 1, server_created: 2, openclaw_starting: 3 }
  return map[step] ?? 0
}

function ProvisioningView({ step, logs }: { step?: string; logs: LogEvent[] }) {
  const current = stepIndex(step)
  const labels = ['Paid', 'Server', 'Docker', 'Ready']
  const messages: Record<string, string> = {
    creating_server:   'Creating server on Hetzner… (1–2 min)',
    server_created:    'Pulling OpenClaw image and preparing host CLI…',
    openclaw_starting: 'Starting OpenClaw gateway and onboarding… (3–5 min total)',
  }
  const terminalRef = useRef<HTMLDivElement>(null)

  // Flatten all log event messages into individual lines
  const lines = logs
    .filter(e => e.type === 'provisioning_log' || e.type === 'provision_log')
    .flatMap(e => e.message.split('\n'))

  // Auto-scroll terminal to bottom when new lines arrive
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight
    }
  }, [lines.length])

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Stepper + status */}
      <div className="flex flex-col items-center pt-10 pb-6 gap-6 px-8 shrink-0">
        <div className="w-full max-w-sm space-y-6">
          <div className="flex items-center gap-0">
            {labels.map((label, i) => {
              const done = i < current
              const active = i === current
              return (
                <div key={label} className="flex items-center flex-1 last:flex-none">
                  <div className="flex flex-col items-center gap-1.5">
                    <div className={`h-3 w-3 rounded-full border-2 transition-all ${
                      done    ? 'bg-[#0a0a0a] border-[#0a0a0a]' :
                      active  ? 'bg-white border-[#0a0a0a] ring-2 ring-[#0a0a0a]/20' :
                                'bg-white border-[#ddd]'
                    }`} />
                    <span className={`text-[10px] ${done || active ? 'text-[#0a0a0a] font-medium' : 'text-[#bbb]'}`}>
                      {label}
                    </span>
                  </div>
                  {i < labels.length - 1 && (
                    <div className={`flex-1 h-px mb-4 mx-1 ${i < current ? 'bg-[#0a0a0a]' : 'bg-[#e5e5e5]'}`} />
                  )}
                </div>
              )
            })}
          </div>
          <div className="text-center space-y-1">
            <p className="text-sm text-[#525252]">
              {step ? (messages[step] ?? 'Setting up your computer…') : 'Waiting for server creation…'}
            </p>
            <p className="text-xs text-[#aaa]">This usually takes 10–15 minutes in total</p>
          </div>
        </div>
      </div>

      {/* Terminal */}
      <div className="flex-1 overflow-hidden px-6 pb-6 min-h-0">
        <div
          ref={terminalRef}
          className="h-full bg-[#0a0a0a] rounded-xl overflow-y-auto p-4 font-mono text-xs leading-relaxed"
        >
          {lines.length === 0 ? (
            <span className="text-[#444]">Waiting for VPS setup logs…</span>
          ) : (
            lines.map((line, i) => (
              <div key={i} className="text-[#4ade80] whitespace-pre">{line || '\u00a0'}</div>
            ))
          )}
          <div className="inline-block w-2 h-3.5 bg-[#4ade80] animate-pulse ml-0.5 align-text-bottom" />
        </div>
      </div>
    </div>
  )
}

function ChatView({ ip, token }: { ip: string; token: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function sendMessage() {
    const text = input.trim()
    if (!text || sending) return
    setInput('')
    setSending(true)

    const userMsg: ChatMessage = { role: 'user', content: text }
    setMessages((prev) => [...prev, userMsg])

    try {
      const res = await fetch(`http://${ip}:18789/api/agent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message: text }),
      })

      if (!res.ok) throw new Error(`Gateway returned ${res.status}`)

      // Handle streaming or JSON response
      const contentType = res.headers.get('content-type') ?? ''
      let reply = ''

      if (contentType.includes('text/event-stream') || contentType.includes('text/plain')) {
        const reader = res.body?.getReader()
        const decoder = new TextDecoder()
        setMessages((prev) => [...prev, { role: 'assistant', content: '' }])
        if (reader) {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            const chunk = decoder.decode(value)
            reply += chunk
            setMessages((prev) => {
              const next = [...prev]
              next[next.length - 1] = { role: 'assistant', content: reply }
              return next
            })
          }
        }
      } else {
        const data = await res.json()
        reply = data.message ?? data.content ?? data.response ?? JSON.stringify(data)
        setMessages((prev) => [...prev, { role: 'assistant', content: reply }])
      }
    } catch (err) {
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : 'Failed to reach gateway'}`,
      }])
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-[#aaa] text-sm">
            Send a message to start
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[75%] rounded-xl px-3.5 py-2.5 text-sm whitespace-pre-wrap ${
              msg.role === 'user'
                ? 'bg-[#0a0a0a] text-white'
                : 'bg-[#f0f0f0] text-[#0a0a0a]'
            }`}>
              {msg.content}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-[#e5e5e5] px-4 py-3 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
          placeholder="Message OpenClaw…"
          className="flex-1 text-sm border border-[#e5e5e5] rounded-lg px-3.5 py-2 outline-none placeholder-[#bbb] focus:border-[#0a0a0a] transition-colors bg-white"
          disabled={sending}
        />
        <button
          onClick={sendMessage}
          disabled={!input.trim() || sending}
          className="h-9 w-9 flex items-center justify-center rounded-lg bg-[#0a0a0a] text-white disabled:opacity-30 hover:bg-[#222] transition-colors shrink-0"
        >
          {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        </button>
      </div>
    </div>
  )
}

export default function ComputerDetailClient({
  computerId,
  userId,
  accessToken,
}: {
  computerId: string
  userId: string
  accessToken: string
}) {
  const searchParams = useSearchParams()
  const justPaid = searchParams.get('paid') === '1'
  const [now] = useState(Date.now)
  const [computer, setComputer] = useState<Computer | null | undefined>(undefined)
  const [logs, setLogs] = useState<LogEvent[]>([])

  const fetchComputer = useCallback(async () => {
    const result = await convex.query<Computer>('computers:get', {
      computerId,
      userId,
      accessToken,
    })
    setComputer(result)
  }, [computerId, userId, accessToken])

  const fetchLogs = useCallback(async () => {
    const result = await convex.query<LogEvent[]>('computers:listEvents', {
      computerId,
      userId,
      accessToken,
    })
    if (result) setLogs(result)
  }, [computerId, userId, accessToken])

  useEffect(() => {
    fetchComputer()
  }, [fetchComputer])

  // Poll while provisioning, slower when ready
  useEffect(() => {
    if (computer === undefined) return // still loading
    const interval = computer?.status === 'provisioning' || computer?.status === 'pending_payment'
      ? 4000
      : 20000
    const id = setInterval(fetchComputer, interval)
    return () => clearInterval(id)
  }, [computer?.status, fetchComputer])

  // Poll logs every 5s while provisioning
  useEffect(() => {
    if (computer?.status !== 'provisioning') return
    fetchLogs()
    const id = setInterval(fetchLogs, 5000)
    return () => clearInterval(id)
  }, [computer?.status, fetchLogs])

  // Loading
  if (computer === undefined) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 size={20} className="text-[#aaa] animate-spin" />
      </div>
    )
  }

  // Not found / access denied
  if (computer === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-[#aaa]">Computer not found.</p>
      </div>
    )
  }

  const daysLeft = computer?.pastDueAt
    ? Math.max(0, 7 - Math.floor((now - computer.pastDueAt) / (1000 * 60 * 60 * 24)))
    : null

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-16 items-center justify-between border-b border-[#e5e5e5] px-6 shrink-0">
        <h2 className="text-sm font-medium text-[#0a0a0a]">{computer.name}</h2>
        {computer.status === 'ready' && (
          <div className="flex items-center gap-2 text-xs text-[#888]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#27ae60]" />
            Online · {computer.hetznerServerIp}
          </div>
        )}
        {computer.status === 'provisioning' && (
          <div className="flex items-center gap-2 text-xs text-[#f5a623]">
            <Loader2 size={11} className="animate-spin" />
            Setting up…
          </div>
        )}
        {computer.status === 'pending_payment' && (
          <div className="text-xs text-[#f5a623]">
            {justPaid ? 'Payment received — provisioning soon…' : 'Awaiting payment'}
          </div>
        )}
      </div>

      {/* Body by status */}
      {(computer.status === 'pending_payment' || computer.status === 'provisioning') && (
        computer.status === 'pending_payment'
          ? (
            <div className="flex flex-col items-center justify-center flex-1 gap-4 text-center px-8">
              <Loader2 size={24} className="text-[#aaa] animate-spin" />
              <p className="text-sm text-[#525252]">
                {justPaid
                  ? 'Payment confirmed. Your server will start provisioning in a moment…'
                  : 'Awaiting payment confirmation…'}
              </p>
              <p className="text-xs text-[#aaa]">This page will update automatically</p>
            </div>
          )
          : <ProvisioningView step={computer.provisioningStep} logs={logs} />
      )}

      {computer.status === 'ready' && computer.hetznerServerIp && computer.gatewayToken && (
        <ChatView ip={computer.hetznerServerIp} token={computer.gatewayToken} />
      )}

      {computer.status === 'past_due' && (
        <div className="flex flex-col items-center justify-center flex-1 gap-4 px-8 text-center">
          <AlertCircle size={32} className="text-[#e74c3c]" strokeWidth={1.5} />
          <div className="space-y-1">
            <p className="text-sm font-medium text-[#0a0a0a]">Payment failed</p>
            <p className="text-xs text-[#888]">
              {daysLeft !== null
                ? `Your computer will be deleted in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}.`
                : 'Your computer will be deleted soon.'}
            </p>
          </div>
          <a
            href="https://billing.stripe.com/p/login/test_00g00000000000"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-[#0a0a0a] underline underline-offset-2"
          >
            Update payment method ↗
          </a>
        </div>
      )}

      {computer.status === 'error' && (
        <div className="flex flex-col items-center justify-center flex-1 gap-4 px-8 text-center">
          <AlertCircle size={32} className="text-[#e74c3c]" strokeWidth={1.5} />
          <div className="space-y-1">
            <p className="text-sm font-medium text-[#0a0a0a]">Setup failed</p>
            <p className="text-xs text-[#888]">{computer.errorMessage ?? 'An unexpected error occurred.'}</p>
          </div>
          <p className="text-xs text-[#aaa]">Please contact support or delete and recreate.</p>
        </div>
      )}

      {computer.status === 'deleted' && (
        <div className="flex flex-col items-center justify-center flex-1 gap-2 text-center">
          <p className="text-sm text-[#aaa]">This computer has been deleted.</p>
        </div>
      )}
    </div>
  )
}
