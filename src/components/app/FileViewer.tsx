'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { FileText, Music, FileQuestion, Download } from 'lucide-react'

// ─── Type detection ───────────────────────────────────────────────────────────

export type FileViewerType =
  | 'text' | 'markdown' | 'csv'
  | 'image' | 'audio' | 'video' | 'pdf'
  | 'binary'

export function getFileType(filename: string): FileViewerType {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  if (['md', 'markdown'].includes(ext)) return 'markdown'
  if (['txt', 'log', 'sh', 'py', 'js', 'ts', 'tsx', 'jsx', 'json', 'html', 'css', 'xml', 'yaml', 'yml', 'toml', 'go', 'rs', 'java', 'c', 'cpp', 'h'].includes(ext)) return 'text'
  if (['csv'].includes(ext)) return 'csv'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'].includes(ext)) return 'image'
  if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus'].includes(ext)) return 'audio'
  if (['mp4', 'mov', 'mkv', 'webm', 'avi', 'ogv', 'm4v'].includes(ext)) return 'video'
  if (['pdf'].includes(ext)) return 'pdf'
  return 'binary'
}

export function isEditableType(filename: string): boolean {
  const type = getFileType(filename)
  return type === 'text' || type === 'markdown'
}

/** Read a File object as the right content string (text or base64 data URL) */
export async function readFileAsContent(file: File): Promise<string> {
  const type = getFileType(file.name)
  if (type === 'text' || type === 'markdown' || type === 'csv') {
    return file.text()
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// ─── CSV renderer ─────────────────────────────────────────────────────────────

/** RFC 4180-style: commas/newlines inside `"..."` stay in one cell. */
function parseCSV(raw: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let inQ = false
  const s = raw.replace(/^\uFEFF/, '')

  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!
    if (inQ) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQ = false
        }
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQ = true
    } else if (ch === ',') {
      row.push(cur)
      cur = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++
      row.push(cur)
      cur = ''
      if (row.some((c) => c.length > 0) || row.length > 1) {
        rows.push(row)
      }
      row = []
    } else {
      cur += ch
    }
  }
  row.push(cur)
  if (row.some((c) => c.length > 0) || row.length > 1) {
    rows.push(row)
  }
  return rows
}

// ─── FileViewer ───────────────────────────────────────────────────────────────

export function FileViewer({ name, content }: { name: string; content: string }) {
  const type = getFileType(name)
  const ext = name.split('.').pop()?.toLowerCase() ?? ''

  if (type === 'markdown') {
    return (
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="prose prose-sm max-w-2xl text-[#0a0a0a]
          prose-headings:font-semibold prose-headings:text-[#0a0a0a]
          prose-a:text-blue-600 prose-code:bg-[#f0f0f0] prose-code:px-1 prose-code:rounded
          prose-pre:bg-[#f5f5f5] prose-pre:text-[#0a0a0a]
          prose-blockquote:border-[#0a0a0a] prose-blockquote:text-[#525252]">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      </div>
    )
  }

  if (type === 'text') {
    return (
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <pre className="text-sm text-[#0a0a0a] leading-relaxed font-mono whitespace-pre-wrap">{content}</pre>
      </div>
    )
  }

  if (type === 'csv') {
    const rows = parseCSV(content)
    const headers = rows[0] ?? []
    const body = rows.slice(1)
    return (
      <div className="flex-1 overflow-auto px-4 py-4">
        <table className="text-xs border-collapse">
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={i} className="border border-[#e5e5e5] px-3 py-2 text-left font-medium bg-[#f5f5f5] text-[#0a0a0a] whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, i) => (
              <tr key={i} className={i % 2 === 0 ? '' : 'bg-[#fafafa]'}>
                {row.map((cell, j) => (
                  <td
                    key={j}
                    className="border border-[#e5e5e5] px-3 py-1.5 text-[#525252] max-w-md align-top whitespace-pre-wrap break-words"
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  if (type === 'image') {
    return (
      <div className="flex-1 flex items-center justify-center overflow-auto p-8 bg-[#f9f9f9]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={content} alt={name} className="max-w-full max-h-full object-contain rounded-lg shadow-sm" />
      </div>
    )
  }

  if (type === 'audio') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
        <div className="w-16 h-16 rounded-2xl bg-[#f0f0f0] flex items-center justify-center">
          <Music size={28} className="text-[#888]" />
        </div>
        <p className="text-sm font-medium text-[#525252]">{name}</p>
        <audio controls src={content} className="w-full max-w-lg" />
      </div>
    )
  }

  if (type === 'video') {
    return (
      <div className="flex-1 flex items-center justify-center overflow-hidden p-4 bg-black">
        <video controls src={content} className="max-w-full max-h-full" />
      </div>
    )
  }

  if (type === 'pdf') {
    const c = content.trim()
    const isIframeSrc =
      c.startsWith('http://') ||
      c.startsWith('https://') ||
      c.startsWith('data:') ||
      c.startsWith('blob:')
    if (isIframeSrc && c.length < 20_000) {
      return (
        <div className="flex-1 overflow-hidden">
          <iframe src={c} className="w-full h-full border-none" title={name} />
        </div>
      )
    }
    return (
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <p className="text-xs text-[#888] mb-4 max-w-2xl">
          This PDF is stored as extracted text for search and the notebook (not the original layout).
        </p>
        <pre className="text-sm text-[#0a0a0a] leading-relaxed whitespace-pre-wrap max-w-3xl">{content}</pre>
      </div>
    )
  }

  // binary: docx, pptx, xlsx, epub, etc.
  const labels: Record<string, string> = {
    docx: 'Word Document', doc: 'Word Document',
    xlsx: 'Excel Spreadsheet', xls: 'Excel Spreadsheet',
    pptx: 'PowerPoint Presentation', ppt: 'PowerPoint Presentation',
    epub: 'EPUB Book',
    zip: 'ZIP Archive', gz: 'GZip Archive', tar: 'TAR Archive',
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-[#888]">
      <div className="w-16 h-16 rounded-2xl bg-[#f0f0f0] flex items-center justify-center">
        {labels[ext] ? (
          <FileText size={28} className="text-[#888]" />
        ) : (
          <FileQuestion size={28} className="text-[#888]" />
        )}
      </div>
      <div className="text-center">
        <p className="text-sm font-medium text-[#525252]">{name}</p>
        <p className="text-xs text-[#aaa] mt-1">{labels[ext] ?? 'Binary file'} — preview not available</p>
      </div>
      {content && (
        <a
          href={content}
          download={name}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-[#0a0a0a] text-[#fafafa] hover:bg-[#222] transition-colors"
        >
          <Download size={12} />
          Download
        </a>
      )}
    </div>
  )
}

// ─── Standalone file viewer with header (for project/knowledge views) ─────────

export function FileViewerPanel({
  name,
  content,
  isSaving,
  isEditable,
  onContentChange,
}: {
  name: string
  content: string
  isSaving?: boolean
  isEditable?: boolean
  onContentChange?: (val: string) => void
}) {
  const type = getFileType(name)
  const editable = isEditable && (type === 'text' || type === 'markdown') && onContentChange

  return (
    <>
      <div className="flex h-16 items-center justify-between border-b border-[#e5e5e5] px-6 shrink-0">
        <span className="text-sm font-medium text-[#0a0a0a] truncate">{name}</span>
        {isSaving && (
          <span className="text-xs text-[#aaa] flex items-center gap-1 shrink-0 ml-2">
            Saving...
          </span>
        )}
      </div>
      {editable ? (
        <>
          <textarea
            value={content}
            onChange={(e) => onContentChange(e.target.value)}
            placeholder="Start typing..."
            className="flex-1 resize-none outline-none px-8 py-6 text-sm text-[#0a0a0a] leading-relaxed font-mono placeholder-[#aaa] bg-white"
          />
          <div className="px-8 py-2 border-t border-[#e5e5e5] text-[11px] text-[#aaa]">
            Reference in chat with{' '}
            <code className="bg-[#f0f0f0] px-1 py-0.5 rounded font-mono">@{name}</code>
          </div>
        </>
      ) : (
        <FileViewer name={name} content={content} />
      )}
    </>
  )
}
