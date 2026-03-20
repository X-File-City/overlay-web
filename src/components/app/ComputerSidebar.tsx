'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import {
  Plus,
  Cpu,
  Circle,
  Trash2,
  Loader2,
  ChevronRight,
  FolderOpen,
  FileText,
  MessageSquare,
} from 'lucide-react'
import { convex } from '@/lib/convex'

type ComputerStatus = 'pending_payment' | 'provisioning' | 'ready' | 'past_due' | 'error' | 'deleted'

interface ComputerItem {
  _id: string
  name: string
  status: ComputerStatus
}

interface WorkspaceFileItem {
  name: string
  path: string
  missing: boolean
  updatedAtMs?: number
}

interface SessionItem {
  key: string
  title: string
  updatedAt: number | null
}

interface ComputerTreeData {
  activeSessionKey: string | null
  files: WorkspaceFileItem[]
  sessions: SessionItem[]
}

const STATUS_COLORS: Record<ComputerStatus, string> = {
  pending_payment: 'text-[#f5a623]',
  provisioning: 'text-[#f5a623]',
  ready: 'text-[#27ae60]',
  past_due: 'text-[#e74c3c]',
  error: 'text-[#e74c3c]',
  deleted: 'text-[#bbb]',
}

function StatusDot({ status }: { status: ComputerStatus }) {
  return <Circle size={6} className={`shrink-0 fill-current ${STATUS_COLORS[status]}`} />
}

function buildComputerHref(computerId: string, params?: Record<string, string | undefined>) {
  const search = new URLSearchParams()
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value) search.set(key, value)
  })
  const query = search.toString()
  return query ? `/app/computer/${computerId}?${query}` : `/app/computer/${computerId}`
}

function TreeRow({
  depth,
  active,
  onClick,
  icon,
  title,
  trailing,
  muted,
}: {
  depth: number
  active?: boolean
  onClick?: () => void
  icon: React.ReactNode
  title: string
  trailing?: React.ReactNode
  muted?: boolean
}) {
  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-1.5 py-1 rounded-md text-xs transition-colors ${
        onClick ? 'cursor-pointer' : ''
      } ${
        active
          ? 'bg-[#e8e8e8] text-[#0a0a0a]'
          : muted
            ? 'text-[#9a9a9a]'
            : 'text-[#525252] hover:bg-[#ebebeb] hover:text-[#0a0a0a]'
      }`}
      style={{ paddingLeft: `${depth * 16 + 8}px`, paddingRight: '8px' }}
    >
      {icon}
      <span className="flex-1 truncate">{title}</span>
      {trailing}
    </div>
  )
}

function ComputerNode({
  computer,
  pathname,
  searchParams,
  deleting,
  isOpen,
  onToggle,
  onDelete,
}: {
  computer: ComputerItem
  pathname: string
  searchParams: ReturnType<typeof useSearchParams>
  deleting: boolean
  isOpen: boolean
  onToggle: (computerId: string, event: React.MouseEvent) => void
  onDelete: (computerId: string, computerName: string, event: React.MouseEvent) => void
}) {
  const router = useRouter()
  const [details, setDetails] = useState<ComputerTreeData | null>(null)
  const [loadingDetails, setLoadingDetails] = useState(false)

  const isComputerRoute = pathname === `/app/computer/${computer._id}`
  const currentView = searchParams.get('view')
  const currentFile = searchParams.get('file')
  const currentSessionKey = searchParams.get('sessionKey')
  const activeSessionKey = currentSessionKey || details?.activeSessionKey || null
  const computerRowActive = isComputerRoute && !currentView && !activeSessionKey

  useEffect(() => {
    if (!isOpen || details !== null) return
    let cancelled = false

    async function loadDetails() {
      setLoadingDetails(true)
      try {
        const [workspaceRes, sessionsRes] = await Promise.all([
          fetch(`/api/app/computer-workspace?computerId=${computer._id}`),
          fetch(`/api/app/computer-sessions?computerId=${computer._id}`),
        ])

        if (cancelled) return

        const workspaceData = workspaceRes.ok ? await workspaceRes.json() : null
        const sessionsData = sessionsRes.ok ? await sessionsRes.json() : null

        if (!cancelled) {
          setDetails({
            activeSessionKey: sessionsData?.activeSessionKey ?? null,
            files: Array.isArray(workspaceData?.files) ? workspaceData.files : [],
            sessions: Array.isArray(sessionsData?.sessions) ? sessionsData.sessions : [],
          })
        }
      } finally {
        if (!cancelled) {
          setLoadingDetails(false)
        }
      }
    }

    void loadDetails()
    return () => {
      cancelled = true
    }
  }, [computer._id, details, isOpen])

  return (
    <div>
      <div
        onClick={() => router.push(buildComputerHref(computer._id))}
        className={`group flex items-center gap-1.5 py-1.5 rounded-md cursor-pointer text-xs transition-colors ${
          computerRowActive
            ? 'bg-[#e8e8e8] text-[#0a0a0a]'
            : 'text-[#525252] hover:bg-[#ebebeb] hover:text-[#0a0a0a]'
        }`}
        style={{ paddingLeft: '8px', paddingRight: '8px' }}
      >
        <button
          onClick={(event) => onToggle(computer._id, event)}
          className="shrink-0 p-0.5 rounded hover:bg-[#d8d8d8] transition-colors"
        >
          <ChevronRight size={10} className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} />
        </button>
        <Cpu size={12} className="shrink-0 text-[#888]" />
        <span className="flex-1 truncate">{computer.name}</span>
        <StatusDot status={computer.status} />
        <button
          onClick={(event) => onDelete(computer._id, computer.name, event)}
          disabled={deleting}
          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-[#d8d8d8] transition-opacity shrink-0 disabled:opacity-100 disabled:cursor-wait"
          aria-label={`Delete ${computer.name}`}
          title={`Delete ${computer.name}`}
        >
          {deleting ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} className="text-[#c33]" />}
        </button>
      </div>

      {isOpen && (
        <>
          <TreeRow
            depth={1}
            icon={<FolderOpen size={11} className="shrink-0 text-[#888]" />}
            title=".openclaw"
            muted
          />

          <TreeRow
            depth={2}
            icon={<FolderOpen size={11} className="shrink-0 text-[#888]" />}
            title="workspace"
            muted
          />

          {loadingDetails && (
            <div className="flex items-center py-1" style={{ paddingLeft: `${3 * 16 + 8}px` }}>
              <Loader2 size={10} className="animate-spin text-[#bbb]" />
            </div>
          )}

          {!loadingDetails && details && details.files.map((file) => {
            const active = isComputerRoute && currentView === 'file' && currentFile === file.name
            return (
              <TreeRow
                key={file.name}
                depth={3}
                active={active}
                onClick={() =>
                  router.push(
                    buildComputerHref(computer._id, {
                      view: 'file',
                      file: file.name,
                    })
                  )
                }
                icon={<FileText size={10} className="shrink-0 text-[#aaa]" />}
                title={file.name}
                muted={file.missing}
              />
            )
          })}

          {!loadingDetails && details && (
            <>
              <TreeRow
                depth={2}
                icon={<FolderOpen size={11} className="shrink-0 text-[#888]" />}
                title="agents"
                muted
              />
              <TreeRow
                depth={3}
                icon={<FolderOpen size={11} className="shrink-0 text-[#888]" />}
                title="main"
                muted
              />
              <TreeRow
                depth={4}
                icon={<FolderOpen size={11} className="shrink-0 text-[#888]" />}
                title="sessions"
                muted
              />

              {details.sessions.map((session) => {
                const active = Boolean(
                  isComputerRoute &&
                  (currentView === 'session' || currentSessionKey || (!currentView && activeSessionKey)) &&
                  activeSessionKey === session.key
                )

                return (
                  <TreeRow
                    key={session.key}
                    depth={5}
                    active={active}
                    onClick={() =>
                      router.push(
                        buildComputerHref(computer._id, {
                          view: 'session',
                          sessionKey: session.key,
                        })
                      )
                    }
                    icon={<MessageSquare size={10} className="shrink-0 text-[#aaa]" />}
                    title={session.title}
                  />
                )
              })}

              {details.sessions.length === 0 && (
                <p
                  className="py-1 text-[10px] text-[#bbb]"
                  style={{ paddingLeft: `${5 * 16 + 18}px` }}
                >
                  No chats yet
                </p>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

export default function ComputerSidebar({ userId, accessToken }: { userId: string; accessToken: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [computers, setComputers] = useState<ComputerItem[]>([])
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const fetchComputers = useCallback(async () => {
    const result = await convex.query<ComputerItem[]>('computers:list', { userId, accessToken })
    if (result) setComputers(result)
  }, [userId, accessToken])

  const handleDeleteComputer = useCallback(async (computerId: string, computerName: string, event: React.MouseEvent) => {
    event.stopPropagation()

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

      setComputers((prev) => prev.filter((computer) => computer._id !== computerId))

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

  const handleToggleComputer = useCallback((computerId: string, event: React.MouseEvent) => {
    event.stopPropagation()
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(computerId)) {
        next.delete(computerId)
      } else {
        next.add(computerId)
      }
      return next
    })
  }, [])

  useEffect(() => {
    fetchComputers()
    const interval = setInterval(fetchComputers, 10000)
    return () => clearInterval(interval)
  }, [fetchComputers])

  useEffect(() => {
    const match = pathname.match(/^\/app\/computer\/([^/]+)/)
    const computerId = match?.[1]
    if (!computerId) return
    setExpandedIds((prev) => {
      if (prev.has(computerId)) return prev
      const next = new Set(prev)
      next.add(computerId)
      return next
    })
  }, [pathname, searchParams])

  return (
    <div className="w-52 h-full flex flex-col border-r border-[#e5e5e5] bg-[#f5f5f5] shrink-0">
      <div className="flex h-16 items-center border-b border-[#e5e5e5] px-3 shrink-0">
        <button
          onClick={() => router.push('/app/computer/new')}
          className="flex items-center gap-1.5 w-full px-3 py-1.5 rounded-md text-sm bg-[#0a0a0a] text-[#fafafa] hover:bg-[#222] transition-colors"
        >
          <Plus size={13} />
          New Computer
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-1.5 px-1.5">
        {computers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2 text-[#aaa] text-center">
            <Cpu size={24} strokeWidth={1} className="opacity-40" />
            <p className="text-xs">No computers yet</p>
            <p className="text-[10px]">Click &quot;New Computer&quot; to add one</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {computers.map((computer) => (
              <ComputerNode
                key={computer._id}
                computer={computer}
                pathname={pathname}
                searchParams={searchParams}
                deleting={deletingId === computer._id}
                isOpen={expandedIds.has(computer._id)}
                onToggle={handleToggleComputer}
                onDelete={handleDeleteComputer}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
