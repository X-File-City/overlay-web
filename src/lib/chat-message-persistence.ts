type MessagePartLike = {
  type: string
  text?: string
  url?: string
  mediaType?: string
}

type PersistedTextPart = {
  type: 'text'
  text: string
}

interface PersistenceOptions {
  attachmentNames?: string[]
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

export function summarizeAttachmentParts(
  parts?: MessagePartLike[],
  options: PersistenceOptions = {}
): string | null {
  if (!parts?.length) return null

  let imageCount = 0
  let videoCount = 0
  let fileCount = 0

  for (const part of parts) {
    if (part.type !== 'file') continue
    if (part.mediaType?.startsWith('image/')) {
      imageCount++
      continue
    }
    if (part.mediaType?.startsWith('video/')) {
      videoCount++
      continue
    }
    fileCount++
  }

  const segments: string[] = []
  if (imageCount > 0) segments.push(pluralize(imageCount, 'image'))
  if (videoCount > 0) segments.push(pluralize(videoCount, 'video'))
  if (fileCount > 0) segments.push(pluralize(fileCount, 'file'))
  if (segments.length === 0) return null

  const attachmentNames = (options.attachmentNames ?? [])
    .map((name) => name.trim())
    .filter(Boolean)
  const namesSuffix = attachmentNames.length
    ? `: ${attachmentNames.slice(0, 3).join(', ')}${attachmentNames.length > 3 ? ` +${attachmentNames.length - 3} more` : ''}`
    : ''

  return `[Attached ${segments.join(', ')}${namesSuffix}]`
}

export function sanitizeMessagePartsForPersistence(
  parts?: MessagePartLike[],
  options: PersistenceOptions = {}
): PersistedTextPart[] | undefined {
  if (!parts?.length) return undefined

  const persistedParts: PersistedTextPart[] = []

  for (const part of parts) {
    if (part.type !== 'text') continue
    const text = part.text?.trim()
    if (!text) continue
    persistedParts.push({ type: 'text', text })
  }

  const attachmentSummary = summarizeAttachmentParts(parts, options)
  if (attachmentSummary) {
    persistedParts.push({ type: 'text', text: attachmentSummary })
  }

  return persistedParts.length > 0 ? persistedParts : undefined
}

export function buildPersistedMessageContent(
  content: string | undefined,
  parts?: MessagePartLike[],
  options: PersistenceOptions = {}
): string {
  const trimmed = content?.trim()
  if (trimmed) return trimmed
  return summarizeAttachmentParts(parts, options) ?? ''
}
