import { convex } from '@/lib/convex'
import type { HybridSearchChunk } from '../../convex/knowledge'

/** OpenRouter / OpenAI-compatible `tools` payload for chat completions (non-streaming tool loop). */
export const OPENROUTER_KNOWLEDGE_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'search_knowledge',
      description:
        "Search the user's notebook files and saved memories (hybrid semantic + keyword). " +
        'Use for facts stored outside this chat.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Keywords or a short natural-language question' },
          sourceKind: {
            type: 'string',
            enum: ['file', 'memory'],
            description: 'Optional: only search files or only memories',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'save_memory',
      description:
        'Save a durable memory about the user. REQUIRED when they share personal preferences or long-lived facts (e.g. liking a food, work role, formatting preferences). Use one short factual line. Skip for small talk only.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string' },
          source: {
            type: 'string',
            enum: ['chat', 'note', 'manual'],
            description: 'Default: chat',
          },
        },
        required: ['content'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'update_memory',
      description: 'Replace the full text of an existing memory (use memory id from search results or save_memory).',
      parameters: {
        type: 'object',
        properties: {
          memoryId: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['memoryId', 'content'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'delete_memory',
      description: 'Delete a memory by id.',
      parameters: {
        type: 'object',
        properties: {
          memoryId: { type: 'string' },
        },
        required: ['memoryId'],
      },
    },
  },
]

export function createKnowledgeToolExecutor(ctx: {
  userId: string
  accessToken: string
  projectId?: string
}) {
  return async function executeKnowledgeTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    try {
      switch (name) {
        case 'search_knowledge': {
          const query = String(args.query ?? '')
          if (!query.trim()) return { success: false, error: 'query required' }
          const result = await convex.action<{ chunks: HybridSearchChunk[] } | null>(
            'knowledge:hybridSearch',
            {
              accessToken: ctx.accessToken,
              userId: ctx.userId,
              query,
              projectId: ctx.projectId,
              sourceKind:
                args.sourceKind === 'file' || args.sourceKind === 'memory'
                  ? args.sourceKind
                  : undefined,
            },
          )
          return { success: true, chunks: result?.chunks ?? [] }
        }
        case 'save_memory': {
          const content = String(args.content ?? '')
          if (!content.trim()) return { success: false, error: 'content required' }
          const raw = args.source
          const source =
            raw === 'chat' || raw === 'note' || raw === 'manual' ? raw : 'chat'
          const memoryId = await convex.mutation<string>('memories:add', {
            userId: ctx.userId,
            content,
            source,
          })
          return { success: true, memoryId }
        }
        case 'update_memory': {
          const memoryId = String(args.memoryId ?? '')
          const content = String(args.content ?? '')
          if (!memoryId || !content) {
            return { success: false, error: 'memoryId and content required' }
          }
          await convex.mutation('memories:update', { memoryId, content })
          return { success: true }
        }
        case 'delete_memory': {
          const memoryId = String(args.memoryId ?? '')
          if (!memoryId) return { success: false, error: 'memoryId required' }
          await convex.mutation('memories:remove', { memoryId })
          return { success: true }
        }
        default:
          return { success: false, error: `Unknown tool: ${name}` }
      }
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
      }
    }
  }
}
