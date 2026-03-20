'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { FileViewerPanel, isEditableType } from './FileViewer'

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

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <FileViewerPanel
        name={file.name}
        content={fileContent}
        isSaving={isSaving}
        isEditable={isEditableType(file.name)}
        onContentChange={handleContentChange}
      />
    </div>
  )
}
