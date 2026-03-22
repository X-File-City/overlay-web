import { convex } from '@/lib/convex'
import type { HybridSearchChunk } from '../../convex/knowledge'

const MIN_USER_CHARS = 8
const MAX_QUERY_CHARS = 500
const BLOCK_CHAR_BUDGET = 9000

/**
 * Runs hybrid search on the latest user message and returns a system-prompt extension
 * so Ask/Act always see top notebook + memory chunks (not only when the model calls tools).
 */
export async function buildAutoRetrievalSystemExtension(args: {
  userMessage: string
  userId: string
  accessToken: string
  projectId?: string
}): Promise<string> {
  const q = args.userMessage.trim()
  if (q.length < MIN_USER_CHARS) return ''

  try {
    const result = await convex.action<{ chunks: HybridSearchChunk[] } | null>('knowledge:hybridSearch', {
      accessToken: args.accessToken,
      userId: args.userId,
      query: q.slice(0, MAX_QUERY_CHARS),
      projectId: args.projectId,
      m: 10,
      kVec: 40,
      kLex: 40,
    })
    const chunks = result?.chunks ?? []
    if (chunks.length === 0) return ''

    const lines: string[] = [
      '---',
      'AUTO_RETRIEVED_KNOWLEDGE (from the user\'s indexed notebook files and saved memories).',
      'Some items may be irrelevant — ignore what does not apply.',
      'If you use any passage below in your answer, end your reply with a **Sources:** line listing only the numbers you used, e.g. `Sources: [1] Notes/egypt.md; [2] Memory`.',
      '---',
    ]

    let used = 0
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i]!
      const kind = c.sourceKind === 'file' ? 'file' : 'memory'
      const title =
        (c.title && c.title.trim()) || (kind === 'file' ? 'Notebook file' : 'Memory')
      const block = `[${i + 1}] (${kind}) ${title}\n${c.text}`
      if (used + block.length > BLOCK_CHAR_BUDGET) break
      lines.push(block, '')
      used += block.length
    }

    return '\n\n' + lines.join('\n')
  } catch (e) {
    console.warn('[ask-knowledge-context] hybridSearch failed:', e)
    return ''
  }
}
