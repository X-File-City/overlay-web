import { v } from 'convex/values'
import { mutation, query } from './_generated/server'

export const list = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query('projects')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .order('asc')
      .collect()
  },
})

export const get = query({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }) => {
    return await ctx.db.get(projectId)
  },
})

export const create = mutation({
  args: {
    userId: v.string(),
    name: v.string(),
    parentId: v.optional(v.string()),
  },
  handler: async (ctx, { userId, name, parentId }) => {
    const now = Date.now()
    return await ctx.db.insert('projects', { userId, name, parentId, createdAt: now, updatedAt: now })
  },
})

export const update = mutation({
  args: { projectId: v.id('projects'), name: v.optional(v.string()) },
  handler: async (ctx, { projectId, name }) => {
    const patch: Record<string, unknown> = { updatedAt: Date.now() }
    if (name !== undefined) patch.name = name
    await ctx.db.patch(projectId, patch)
  },
})

// Removes a single project and all its chats/notes/agents (no child-project cascade — handle that in the API layer).
export const remove = mutation({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }) => {
    const pid = projectId as string

    const [chats, notes, agents] = await Promise.all([
      ctx.db.query('chats').withIndex('by_projectId', (q) => q.eq('projectId', pid)).collect(),
      ctx.db.query('notes').withIndex('by_projectId', (q) => q.eq('projectId', pid)).collect(),
      ctx.db.query('agents').withIndex('by_projectId', (q) => q.eq('projectId', pid)).collect(),
    ])

    for (const chat of chats) {
      const messages = await ctx.db.query('messages').withIndex('by_chatId', (q) => q.eq('chatId', chat._id)).collect()
      for (const msg of messages) await ctx.db.delete(msg._id)
      await ctx.db.delete(chat._id)
    }
    for (const note of notes) await ctx.db.delete(note._id)
    for (const agent of agents) {
      const messages = await ctx.db.query('agentMessages').withIndex('by_agentId', (q) => q.eq('agentId', agent._id)).collect()
      for (const msg of messages) await ctx.db.delete(msg._id)
      await ctx.db.delete(agent._id)
    }

    await ctx.db.delete(projectId)
  },
})
