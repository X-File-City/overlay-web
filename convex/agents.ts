import { v } from 'convex/values'
import { mutation, query } from './_generated/server'

// Returns only agents NOT scoped to a project (for the main Agents tab).
export const list = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const all = await ctx.db
      .query('agents')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .order('desc')
      .take(200)
    return all.filter((a) => !a.projectId).slice(0, 100)
  },
})

// Returns agents belonging to a specific project.
export const listByProject = query({
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }) => {
    return await ctx.db
      .query('agents')
      .withIndex('by_projectId', (q) => q.eq('projectId', projectId))
      .order('desc')
      .collect()
  },
})

export const get = query({
  args: { agentId: v.id('agents') },
  handler: async (ctx, { agentId }) => {
    return await ctx.db.get(agentId)
  },
})

export const create = mutation({
  args: {
    userId: v.string(),
    title: v.string(),
    projectId: v.optional(v.string()),
  },
  handler: async (ctx, { userId, title, projectId }) => {
    return await ctx.db.insert('agents', {
      userId,
      title,
      projectId,
      lastModified: Date.now(),
    })
  },
})

export const update = mutation({
  args: { agentId: v.id('agents'), title: v.optional(v.string()) },
  handler: async (ctx, { agentId, title }) => {
    const updates: Record<string, unknown> = { lastModified: Date.now() }
    if (title !== undefined) updates.title = title
    await ctx.db.patch(agentId, updates)
  },
})

export const remove = mutation({
  args: { agentId: v.id('agents') },
  handler: async (ctx, { agentId }) => {
    const messages = await ctx.db
      .query('agentMessages')
      .withIndex('by_agentId', (q) => q.eq('agentId', agentId))
      .collect()
    for (const msg of messages) {
      await ctx.db.delete(msg._id)
    }
    await ctx.db.delete(agentId)
  },
})

export const getMessages = query({
  args: { agentId: v.id('agents') },
  handler: async (ctx, { agentId }) => {
    return await ctx.db
      .query('agentMessages')
      .withIndex('by_agentId', (q) => q.eq('agentId', agentId))
      .order('asc')
      .collect()
  },
})

export const addMessage = mutation({
  args: {
    agentId: v.id('agents'),
    userId: v.string(),
    role: v.union(v.literal('user'), v.literal('assistant')),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const msgId = await ctx.db.insert('agentMessages', {
      ...args,
      createdAt: Date.now(),
    })
    await ctx.db.patch(args.agentId, { lastModified: Date.now() })
    return msgId
  },
})
