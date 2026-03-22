import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { IMAGE_MODELS, VIDEO_MODELS } from '@/lib/models'

/**
 * Non-Composio native tools for the web app.
 * Analogous to unified-tools.ts in the desktop app.
 * These tools call internal API routes so they work within
 * the serverless Next.js environment.
 */

export interface WebToolsOptions {
  userId: string
  accessToken?: string
  conversationId?: string
  /** When the chat belongs to a project, scopes hybrid search to that project plus global notes/memories. */
  projectId?: string
  baseUrl?: string
}

function toolAuthBody(options: WebToolsOptions): { userId: string; accessToken?: string } {
  return { userId: options.userId, accessToken: options.accessToken }
}

async function callInternalApi(
  path: string,
  body: Record<string, unknown>,
  accessToken?: string,
  baseUrl?: string,
  method: 'POST' | 'PATCH' | 'DELETE' = 'POST',
): Promise<Response> {
  const url = baseUrl ? `${baseUrl}${path}` : path
  return fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

export function createWebTools(options: WebToolsOptions): ToolSet {
  const { conversationId, baseUrl, projectId } = options

  const tools: ToolSet = {}

  tools.search_knowledge = tool({
    description:
      'Search the user\'s saved knowledge: notebook files and memories. Uses hybrid semantic + keyword retrieval. ' +
      'Call this when you need facts from their knowledge base, prior notes, or stored context that is not in the chat transcript.',
    inputSchema: z.object({
      query: z.string().describe('Search query: keywords or a short natural-language question'),
      sourceKind: z
        .enum(['file', 'memory'])
        .optional()
        .describe('Limit to files only or memories only (omit to search both)'),
    }),
    execute: async ({ query, sourceKind }) => {
      try {
        const res = await callInternalApi(
          '/api/app/knowledge/search',
          {
            query,
            projectId,
            sourceKind,
            ...toolAuthBody(options),
          },
          options.accessToken,
          baseUrl,
        )
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Search failed' }))
          return { success: false, error: (err as { error?: string }).error ?? 'Search failed' }
        }
        const data = (await res.json()) as { chunks?: Array<Record<string, unknown>> }
        return { success: true, chunks: data.chunks ?? [] }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Search failed',
        }
      }
    },
  })

  tools.save_memory = tool({
    description:
      'Save a durable memory about the user (preferences, facts, standing instructions). ' +
      'You MUST call this when they state personal preferences or long-lived facts (e.g. "I like pasta", "I am vegetarian", "always cite sources"). ' +
      'Use one short factual sentence per call. Skip for pure small talk or one-off requests.',
    inputSchema: z.object({
      content: z.string().describe('The memory text to store'),
      source: z
        .enum(['chat', 'note', 'manual'])
        .optional()
        .describe('How the memory was captured (default: chat when learning from conversation)'),
    }),
    execute: async ({ content, source }) => {
      try {
        const res = await callInternalApi(
          '/api/app/memory',
          {
            content,
            source: source ?? 'chat',
            ...toolAuthBody(options),
          },
          options.accessToken,
          baseUrl,
        )
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Failed to save' }))
          return { success: false, error: (err as { error?: string }).error ?? 'Failed to save memory' }
        }
        const data = (await res.json()) as { id?: string }
        return { success: true, memoryId: data.id }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Failed to save memory',
        }
      }
    },
  })

  tools.update_memory = tool({
    description: 'Replace the text of an existing memory by id (use after listing or saving a memory).',
    inputSchema: z.object({
      memoryId: z.string().describe('Convex document id of the memory'),
      content: z.string().describe('New full text for the memory'),
    }),
    execute: async ({ memoryId, content }) => {
      try {
        const res = await callInternalApi(
          '/api/app/memory',
          { memoryId, content, ...toolAuthBody(options) },
          options.accessToken,
          baseUrl,
          'PATCH',
        )
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Failed to update' }))
          return { success: false, error: (err as { error?: string }).error ?? 'Failed to update memory' }
        }
        return { success: true }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Failed to update memory',
        }
      }
    },
  })

  tools.delete_memory = tool({
    description: 'Delete a memory by id.',
    inputSchema: z.object({
      memoryId: z.string().describe('Convex document id of the memory to remove'),
    }),
    execute: async ({ memoryId }) => {
      try {
        const res = await callInternalApi(
          '/api/app/memory',
          { memoryId, ...toolAuthBody(options) },
          options.accessToken,
          baseUrl,
          'DELETE',
        )
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Failed to delete' }))
          return { success: false, error: (err as { error?: string }).error ?? 'Failed to delete memory' }
        }
        return { success: true }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Failed to delete memory',
        }
      }
    },
  })

  tools.generate_image = tool({
    description:
      'Generate an image from a text prompt using AI image generation models. ' +
      'Returns a data URL of the generated image. ' +
      'Tries models in priority order: Gemini Flash Image → GPT Image 1.5 → FLUX 2 Max → Grok Image Pro → Grok Image → FLUX Schnell. ' +
      'Use this whenever the user asks to create, draw, or generate an image or picture.',
    inputSchema: z.object({
      prompt: z.string().describe('Detailed description of the image to generate'),
      modelId: z
        .enum(IMAGE_MODELS.map((m) => m.id) as [string, ...string[]])
        .optional()
        .describe('Specific image model to use (optional — uses priority fallback by default)'),
      aspectRatio: z
        .enum(['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'])
        .optional()
        .describe('Aspect ratio of the generated image (default: 1:1)'),
    }),
    execute: async ({ prompt, modelId, aspectRatio }) => {
      try {
        const res = await callInternalApi(
          '/api/app/generate-image',
          { prompt, modelId, aspectRatio, conversationId },
          options.accessToken,
          baseUrl,
        )
        if (!res.ok) {
          const err = await res.json().catch(() => ({ message: 'Unknown error' }))
          return {
            success: false,
            error: (err as { message?: string }).message ?? 'Image generation failed',
          }
        }
        const data = await res.json() as { outputId?: string; url?: string; modelUsed?: string }
        return {
          success: true,
          outputId: data.outputId,
          url: data.url,
          modelUsed: data.modelUsed,
          message: `Image generated successfully with ${data.modelUsed}. OutputId: ${data.outputId}`,
        }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Image generation failed',
        }
      }
    },
  })

  tools.generate_video = tool({
    description:
      'Generate a video from a text prompt using AI video generation models. ' +
      'Video generation is asynchronous and can take 1–5 minutes. ' +
      'Returns immediately with a job ID; the video will appear in the Outputs tab when complete. ' +
      'Tries models in priority order: Veo 3.1 → Veo 3.1 Fast → Seedance v1.5 Pro → Grok Video → Wan v2.6. ' +
      'Use this when the user asks to create, animate, or generate a video or clip.',
    inputSchema: z.object({
      prompt: z.string().describe('Detailed description of the video to generate'),
      modelId: z
        .enum(VIDEO_MODELS.map((m) => m.id) as [string, ...string[]])
        .optional()
        .describe('Specific video model to use (optional — uses priority fallback by default)'),
      aspectRatio: z
        .enum(['16:9', '9:16', '1:1', '4:3'])
        .optional()
        .describe('Aspect ratio of the generated video (default: 16:9)'),
      duration: z
        .number()
        .min(3)
        .max(60)
        .optional()
        .describe('Duration of the video in seconds (default: 8)'),
    }),
    execute: async ({ prompt, modelId, aspectRatio, duration }) => {
      try {
        const res = await callInternalApi(
          '/api/app/generate-video',
          { prompt, modelId, aspectRatio, duration, conversationId },
          options.accessToken,
          baseUrl,
        )

        if (!res.ok) {
          const err = await res.json().catch(() => ({ message: 'Unknown error' }))
          return {
            success: false,
            status: 'failed',
            error: (err as { message?: string }).message ?? 'Video generation failed',
          }
        }

        // SSE stream — read first event for the started signal, then drain for completion
        const reader = res.body?.getReader()
        if (!reader) {
          return { success: false, status: 'failed', error: 'No response stream' }
        }

        const decoder = new TextDecoder()
        let buffer = ''
        let outputId: string | null = null
        let finalResult: Record<string, unknown> | null = null

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            try {
              const event = JSON.parse(line.slice(6)) as Record<string, unknown>
              if (event.type === 'started') {
                outputId = event.outputId as string
              } else if (event.type === 'completed') {
                finalResult = event
              } else if (event.type === 'failed') {
                return {
                  success: false,
                  status: 'failed',
                  outputId: outputId ?? (event.outputId as string),
                  error: event.error,
                }
              }
            } catch {
              // ignore malformed SSE lines
            }
          }
        }

        if (finalResult) {
          return {
            success: true,
            status: 'completed',
            outputId: finalResult.outputId,
            url: finalResult.url,
            modelUsed: finalResult.modelUsed,
            message: `Video generated successfully with ${finalResult.modelUsed}. OutputId: ${finalResult.outputId}`,
          }
        }

        return {
          success: true,
          status: 'pending',
          outputId,
          message: `Video generation started (outputId: ${outputId}). It will appear in the Outputs tab when complete.`,
        }
      } catch (err) {
        return {
          success: false,
          status: 'failed',
          error: err instanceof Error ? err.message : 'Video generation failed',
        }
      }
    },
  })

  return tools
}
