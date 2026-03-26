'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { FileViewer, getFileType, isEditableType } from './FileViewer'

function isSilentReadDenied(reason: string | null): boolean {
  if (!reason) return false
  const lower = reason.toLowerCase()
  return lower.includes('operator.read') || lower.includes('denied read access')
}

function isRepairableGatewayError(reason: string | null): boolean {
  if (!reason) return false
  const lower = reason.toLowerCase()
  return (
    lower.includes('gateway is unreachable') ||
    lower.includes('timed out') ||
    lower.includes('failed to open openclaw gateway websocket')
  )
}

export default function ComputerWorkspaceFileView({
  computerId,
  fileName,
  isEditingMarkdown = false,
  onEditingMarkdownChange,
}: {
  computerId: string
  fileName: string
  isEditingMarkdown?: boolean
  onEditingMarkdownChange?: (value: boolean) => void
}) {
  const [file, setFile] = useState<{ name: string; content: string; missing: boolean } | null>(null)
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadNonce, setReloadNonce] = useState(0)
  const [fileContent, setFileContent] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isRepairing, setIsRepairing] = useState(false)
  const [repairMessage, setRepairMessage] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 12000)

    fetch(`/api/app/computer-workspace?computerId=${computerId}&name=${encodeURIComponent(fileName)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null)
        if (response.ok) {
          return payload
        }
        throw new Error(
          typeof payload?.error === 'string' && payload.error.trim()
            ? payload.error.trim()
            : 'Failed to load workspace file'
        )
      })
      .then((data) => {
        if (cancelled) return
        setUnavailableReason(
          typeof data?.unavailableReason === 'string' && data.unavailableReason.trim()
            ? data.unavailableReason.trim()
            : null
        )
        if (cancelled || !data?.file) return
        setFile({
          name: data.file.name,
          content: data.file.content ?? '',
          missing: Boolean(data.file.missing),
        })
        setFileContent(data.file.content ?? '')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const message =
          error instanceof Error && error.name === 'AbortError'
            ? 'Loading workspace file timed out.'
            : error instanceof Error && error.message.trim()
              ? error.message.trim()
              : 'Failed to load workspace file'
        setUnavailableReason(message)
      })
      .finally(() => {
        window.clearTimeout(timeoutId)
        if (!cancelled) {
          onEditingMarkdownChange?.(false)
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
      controller.abort()
      window.clearTimeout(timeoutId)
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
    }
  }, [computerId, fileName, onEditingMarkdownChange, reloadNonce])

  useEffect(() => {
    if (!isRepairableGatewayError(unavailableReason)) return
    const timeoutId = window.setTimeout(() => {
      setReloadNonce((current) => current + 1)
    }, 3000)
    return () => window.clearTimeout(timeoutId)
  }, [unavailableReason])

  async function handleRepair() {
    setIsRepairing(true)
    setRepairMessage(null)
    try {
      const response = await fetch('/api/app/computer-reconfigure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ computerId }),
      })
      const data = await response.json().catch(() => null)
      if (response.ok && data?.ok) {
        setRepairMessage('Access repaired. Reloading…')
        setTimeout(() => window.location.reload(), 2000)
      } else {
        setRepairMessage(
          typeof data?.message === 'string' && data.message.trim()
            ? data.message.trim()
            : typeof data?.error === 'string' && data.error.trim()
              ? data.error.trim()
              : 'Repair failed. You may need to re-provision your computer.'
        )
      }
    } catch {
      setRepairMessage('Repair failed. You may need to re-provision your computer.')
    } finally {
      setIsRepairing(false)
    }
  }

  function handleContentChange(value: string) {
    setFileContent(value)
    setSaveError(null)
    if (!file) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      setIsSaving(true)
      try {
        const response = await fetch('/api/app/computer-workspace', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            computerId,
            name: file.name,
            content: value,
          }),
        })

        if (!response.ok) {
          const payload = await response.json().catch(() => null)
          throw new Error(
            typeof payload?.error === 'string' && payload.error.trim()
              ? payload.error.trim()
              : 'Failed to save workspace file'
          )
        }

        window.dispatchEvent(
          new CustomEvent('overlay:computer-workspace-updated', {
            detail: {
              computerId,
              fileName: file.name,
            },
          })
        )
      } catch (error) {
        setSaveError(
          error instanceof Error && error.message.trim()
            ? error.message.trim()
            : 'Failed to save workspace file'
        )
      } finally {
        setIsSaving(false)
      }
    }, 800)
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-[#888]">
        <Loader2 size={16} className="animate-spin" />
      </div>
    )
  }

  if (!file) {
    const showRepair = isRepairableGatewayError(unavailableReason)
    const visibleReason = isSilentReadDenied(unavailableReason) ? null : unavailableReason
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 max-w-sm text-center">
          <p className="text-sm text-[#888]">
            {repairMessage ?? visibleReason ?? 'Workspace file not found'}
          </p>
          {showRepair && !repairMessage && (
            <button
              onClick={handleRepair}
              disabled={isRepairing}
              className="flex items-center gap-1.5 rounded-md border border-[#e0e0e0] bg-white px-3 py-1.5 text-xs text-[#333] hover:bg-[#f5f5f5] disabled:opacity-50 transition-colors"
            >
              {isRepairing ? <Loader2 size={12} className="animate-spin" /> : null}
              {isRepairing ? 'Repairing…' : 'Repair Access'}
            </button>
          )}
        </div>
      </div>
    )
  }

  const fileType = getFileType(file.name)
  const editable = isEditableType(file.name)
  const showMarkdownPreview = fileType === 'markdown' && !isEditingMarkdown

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      {unavailableReason && !isSilentReadDenied(unavailableReason) ? (
        <div className="border-b border-[#eee] bg-[#fffaf0] px-6 py-2 text-xs text-[#946200]">
          {unavailableReason}
        </div>
      ) : null}
      {saveError ? (
        <div className="border-b border-[#eee] bg-[#fff7f7] px-6 py-2 text-xs text-[#b42318]">
          {saveError}
        </div>
      ) : null}
      {editable && (fileType === 'text' || isEditingMarkdown || file.missing) ? (
        <div className="relative flex-1">
          {isSaving && (
            <div className="absolute right-6 top-4 z-10 flex items-center gap-1.5 rounded-full bg-white/95 px-2 py-1 text-[11px] text-[#888] shadow-sm">
              <Loader2 size={12} className="animate-spin text-[#aaa]" />
              Saving
            </div>
          )}
          <textarea
            value={fileContent}
            onChange={(event) => handleContentChange(event.target.value)}
            placeholder="Start typing..."
            className="flex-1 h-full w-full resize-none bg-white px-6 py-4 text-sm leading-8 text-[#0a0a0a] outline-none placeholder:text-[#aaa]"
          />
        </div>
      ) : showMarkdownPreview ? (
        <div className="flex-1" onDoubleClick={() => onEditingMarkdownChange?.(true)}>
          <FileViewer name={file.name} content={fileContent} />
        </div>
      ) : (
        <FileViewer name={file.name} content={fileContent} />
      )}
    </div>
  )
}
