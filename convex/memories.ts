import { v } from 'convex/values'
import { internal } from './_generated/api'
import { mutation, query } from './_generated/server'

export const list = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query('memories')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .order('desc')
      .take(100)
  },
})

export const add = mutation({
  args: {
    userId: v.string(),
    content: v.string(),
    source: v.union(v.literal('chat'), v.literal('note'), v.literal('manual')),
  },
  handler: async (ctx, args) => {
    const memoryId = await ctx.db.insert('memories', { ...args, createdAt: Date.now() })
    await ctx.scheduler.runAfter(0, internal.knowledge.reindexMemoryInternal, { memoryId })
    return memoryId
  },
})

export const update = mutation({
  args: {
    memoryId: v.id('memories'),
    content: v.string(),
  },
  handler: async (ctx, { memoryId, content }) => {
    await ctx.db.patch(memoryId, { content })
    await ctx.scheduler.runAfter(0, internal.knowledge.reindexMemoryInternal, { memoryId })
  },
})

export const remove = mutation({
  args: { memoryId: v.id('memories') },
  handler: async (ctx, { memoryId }) => {
    await ctx.runMutation(internal.knowledge.purgeKnowledgeSource, {
      sourceKind: 'memory',
      sourceId: memoryId,
    })
    await ctx.db.delete(memoryId)
  },
})
