'use client'

import { useMemo } from 'react'
import { Download } from 'lucide-react'
import { MarkdownMessage } from '@/components/app/MarkdownMessage'
import {
  type ComputerCommandResult,
  type ComputerCommandField,
} from '@/lib/computer-commands'

function FieldGrid({ fields }: { fields: ComputerCommandField[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map((field) => (
        <div key={`${field.label}:${field.value}`} className="rounded-xl border border-[#e8e8e8] bg-[#fafafa] p-3">
          <div className="text-[11px] uppercase tracking-[0.12em] text-[#8a8a8a]">{field.label}</div>
          <div className="mt-1 break-words text-sm text-[#111]">{field.value}</div>
        </div>
      ))}
    </div>
  )
}

function ResultCard({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-3xl border border-[#e5e5e5] bg-white p-5 shadow-sm">
      <div className="mb-4 text-[11px] uppercase tracking-[0.14em] text-[#7a7a7a]">{title}</div>
      {children}
    </div>
  )
}

function DownloadButton({
  filename,
  mimeType,
  content,
}: {
  filename: string
  mimeType: string
  content: string
}) {
  const href = useMemo(() => {
    const blob = new Blob([content], { type: mimeType })
    return URL.createObjectURL(blob)
  }, [content, mimeType])

  return (
    <a
      href={href}
      download={filename}
      className="inline-flex items-center gap-2 rounded-xl bg-[#0a0a0a] px-3 py-2 text-xs text-white transition-colors hover:bg-[#222]"
    >
      <Download size={13} />
      Download
    </a>
  )
}

export function CommandBubble({ command }: { command: string }) {
  return (
    <div className="max-w-[75%] rounded-2xl rounded-br-sm bg-[#0a0a0a] px-4 py-2.5 text-sm text-[#fafafa]">
      <span className="whitespace-pre-wrap">{command}</span>
    </div>
  )
}

export function CommandResultCard({ result }: { result: ComputerCommandResult }) {
  if (result.kind === 'catalog') {
    return (
      <ResultCard title={result.title}>
        <div className="space-y-5">
          {result.sections.map((section) => (
            <div key={section.label}>
              <div className="mb-2 text-xs font-medium text-[#444]">{section.label}</div>
              <div className="space-y-2">
                {section.items.map((item) => (
                  <div key={item.command} className="flex items-start justify-between gap-4 rounded-xl border border-[#efefef] bg-[#fafafa] px-3 py-2">
                    <div className="text-sm font-medium text-[#111]">{item.command}</div>
                    <div className="min-w-0 text-right text-xs text-[#666]">
                      <div>{item.description}</div>
                      {item.disabledReason && <div className="mt-1 text-[#9a9a9a]">{item.disabledReason}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </ResultCard>
    )
  }

  if (result.kind === 'status') {
    return (
      <ResultCard title={result.title}>
        <div className="space-y-4">
          <FieldGrid fields={result.summary} />
          {result.details && result.details.length > 0 && <FieldGrid fields={result.details} />}
          {result.usage && result.usage.length > 0 && <FieldGrid fields={result.usage} />}
          {result.providerUsage && result.providerUsage.length > 0 && <FieldGrid fields={result.providerUsage} />}
          {result.session && result.session.length > 0 && <FieldGrid fields={result.session} />}
        </div>
      </ResultCard>
    )
  }

  if (result.kind === 'identity') {
    return (
      <ResultCard title={result.title}>
        <FieldGrid fields={result.fields} />
      </ResultCard>
    )
  }

  if (result.kind === 'settings') {
    return (
      <ResultCard title={result.title}>
        <div className="space-y-4">
          <div className={`text-sm ${result.status === 'error' ? 'text-[#c33]' : 'text-[#333]'}`}>{result.message}</div>
          <FieldGrid fields={result.fields} />
          {result.options && result.options.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {result.options.map((option) => (
                <div
                  key={`${option.label}:${option.value}`}
                  className={`rounded-full border px-2.5 py-1 text-[11px] ${
                    option.active
                      ? 'border-[#111] bg-[#111] text-white'
                      : 'border-[#ddd] bg-white text-[#666]'
                  }`}
                >
                  {option.label}
                </div>
              ))}
            </div>
          )}
        </div>
      </ResultCard>
    )
  }

  if (result.kind === 'model') {
    return (
      <ResultCard title={result.title}>
        <div className="space-y-4">
          <FieldGrid fields={result.fields} />
          <div className="space-y-2">
            {result.options.map((option) => (
              <div
                key={`${option.label}:${option.value}`}
                className={`flex items-center justify-between rounded-xl border px-3 py-2 text-sm ${
                  option.active ? 'border-[#111] bg-[#111] text-white' : 'border-[#ececec] bg-[#fafafa] text-[#222]'
                }`}
              >
                <span>{option.label}</span>
                <span className={`text-xs ${option.active ? 'text-white/70' : 'text-[#777]'}`}>{option.value}</span>
              </div>
            ))}
          </div>
        </div>
      </ResultCard>
    )
  }

  if (result.kind === 'usage') {
    return (
      <ResultCard title={result.title}>
        <div className="space-y-4">
          <FieldGrid fields={result.fields} />
          {result.tables?.map((table, index) => (
            <div key={index} className="overflow-x-auto rounded-xl border border-[#ececec]">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-[#fafafa] text-[#666]">
                  <tr>
                    {table.columns.map((column) => (
                      <th key={column} className="px-3 py-2 font-medium">{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row, rowIndex) => (
                    <tr key={rowIndex} className="border-t border-[#f0f0f0]">
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex} className="px-3 py-2 text-[#222]">{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </ResultCard>
    )
  }

  if (result.kind === 'context') {
    return (
      <ResultCard title={result.title}>
        <div className="space-y-4">
          <FieldGrid fields={result.fields} />
          {result.blocks?.map((block) => (
            <div key={block.label} className="rounded-2xl border border-[#ececec] bg-[#fafafa] p-4">
              <div className="mb-2 text-xs font-medium text-[#555]">{block.label}</div>
              <div className="text-sm leading-relaxed text-[#111]">
                <MarkdownMessage text={block.content} isStreaming={false} />
              </div>
            </div>
          ))}
        </div>
      </ResultCard>
    )
  }

  if (result.kind === 'btw') {
    return (
      <ResultCard title={result.title}>
        <div className="space-y-4">
          <div className="rounded-2xl border border-[#ececec] bg-[#fafafa] p-4">
            <div className="mb-2 text-xs font-medium text-[#666]">Question</div>
            <div className="text-sm text-[#111]">{result.question}</div>
          </div>
          <div className="rounded-2xl border border-[#ececec] bg-white p-4">
            <div className="text-sm leading-relaxed text-[#111]">
              <MarkdownMessage text={result.answer} isStreaming={false} />
            </div>
          </div>
        </div>
      </ResultCard>
    )
  }

  if (result.kind === 'export') {
    return (
      <ResultCard title={result.title}>
        <div className="space-y-4">
          <FieldGrid fields={result.fields} />
          <DownloadButton filename={result.filename} mimeType={result.mimeType} content={result.content} />
        </div>
      </ResultCard>
    )
  }

  if (result.kind === 'admin-table') {
    return (
      <ResultCard title={result.title}>
        <div className="space-y-4">
          {result.fields && result.fields.length > 0 && <FieldGrid fields={result.fields} />}
          {result.tables.map((table, index) => (
            <div key={index} className="overflow-x-auto rounded-xl border border-[#ececec]">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-[#fafafa] text-[#666]">
                  <tr>
                    {table.columns.map((column) => (
                      <th key={column} className="px-3 py-2 font-medium">{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.length === 0 ? (
                    <tr>
                      <td className="px-3 py-3 text-[#888]" colSpan={table.columns.length}>No rows.</td>
                    </tr>
                  ) : (
                    table.rows.map((row, rowIndex) => (
                      <tr key={rowIndex} className="border-t border-[#f0f0f0]">
                        {row.map((cell, cellIndex) => (
                          <td key={cellIndex} className="px-3 py-2 text-[#222]">{cell}</td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </ResultCard>
    )
  }

  if (result.kind === 'action') {
    return (
      <ResultCard title={result.title}>
        <div className="space-y-4">
          <div className={`text-sm ${result.status === 'error' ? 'text-[#c33]' : 'text-[#333]'}`}>{result.message}</div>
          {result.fields && result.fields.length > 0 && <FieldGrid fields={result.fields} />}
        </div>
      </ResultCard>
    )
  }

  if (result.kind === 'raw') {
    return (
      <ResultCard title={result.title}>
        <div className="text-sm leading-relaxed text-[#111]">
          <MarkdownMessage text={result.markdown} isStreaming={false} />
        </div>
      </ResultCard>
    )
  }

  return (
    <ResultCard title={result.title}>
      <div className="text-sm text-[#555]">{result.message}</div>
    </ResultCard>
  )
}
