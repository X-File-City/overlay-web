'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { FileViewer, getFileType, isEditableType } from './FileViewer'

export default function ComputerWorkspaceFileView({
  computerId,
  fileName,
}: {
  computerId: string
  fileName: string
}) {
  const [file, setFile] = useState<{ name: string; content: string; missing: boolean } | null>(null)
  const [loading, setLoading] = useState(true)
  const [fileContent, setFileContent] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isEditingMarkdown, setIsEditingMarkdown] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/app/computer-workspace?computerId=${computerId}&name=${encodeURIComponent(fileName)}`)
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (cancelled || !data?.file) return
        setFile({
          name: data.file.name,
          content: data.file.content ?? '',
          missing: Boolean(data.file.missing),
        })
        setFileContent(data.file.content ?? '')
      })
      .finally(() => {
        if (!cancelled) {
          setIsEditingMarkdown(false)
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
    }
  }, [computerId, fileName])

  function handleContentChange(value: string) {
    setFileContent(value)
    if (!file) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      setIsSaving(true)
      await fetch('/api/app/computer-workspace', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          computerId,
          name: file.name,
          content: value,
        }),
      })
      window.dispatchEvent(
        new CustomEvent('overlay:computer-workspace-updated', {
          detail: {
            computerId,
            fileName: file.name,
          },
        })
      )
      setIsSaving(false)
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
    return (
      <div className="flex-1 flex items-center justify-center text-[#aaa] text-sm">
        Workspace file not found
      </div>
    )
  }

  const fileType = getFileType(file.name)
  const editable = isEditableType(file.name)
  const showMarkdownPreview = fileType === 'markdown' && !isEditingMarkdown

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      {editable && (
        <div className="flex h-12 items-center justify-end gap-2 border-b border-[#e5e5e5] px-6 shrink-0">
          {isSaving && <Loader2 size={14} className="animate-spin text-[#aaa]" />}
          {fileType === 'markdown' && (
            <button
              onClick={() => setIsEditingMarkdown((current) => !current)}
              className="rounded-md bg-[#f0f0f0] px-2.5 py-1 text-[11px] text-[#525252] transition-colors hover:bg-[#e8e8e8]"
            >
              {isEditingMarkdown ? 'Preview' : 'Edit'}
            </button>
          )}
        </div>
      )}

      {editable && (fileType === 'text' || isEditingMarkdown) ? (
        <textarea
          value={fileContent}
          onChange={(event) => handleContentChange(event.target.value)}
          placeholder="Start typing..."
          className="flex-1 resize-none bg-white px-6 py-4 text-sm leading-8 text-[#0a0a0a] outline-none placeholder:text-[#aaa]"
        />
      ) : showMarkdownPreview ? (
        <div className="flex-1" onDoubleClick={() => setIsEditingMarkdown(true)}>
          <FileViewer name={file.name} content={fileContent} />
        </div>
      ) : (
        <FileViewer name={file.name} content={fileContent} />
      )}
    </div>
  )
}
