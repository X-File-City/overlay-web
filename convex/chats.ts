import { v } from 'convex/values'
import { mutation, query } from './_generated/server'

// Returns only chats NOT scoped to a project (for the main Chats tab).
export const list = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const all = await ctx.db
      .query('chats')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .order('desc')
      .take(200)
    return all.filter((c) => !c.projectId).slice(0, 100)
  },
})

// Returns chats belonging to a specific project.
export const listByProject = query({
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }) => {
    return await ctx.db
      .query('chats')
      .withIndex('by_projectId', (q) => q.eq('projectId', projectId))
      .order('desc')
      .collect()
  },
})

export const get = query({
  args: { chatId: v.id('chats') },
  handler: async (ctx, { chatId }) => {
    return await ctx.db.get(chatId)
  },
})

export const create = mutation({
  args: {
    userId: v.string(),
    title: v.string(),
    model: v.string(),
    projectId: v.optional(v.string()),
  },
  handler: async (ctx, { userId, title, model, projectId }) => {
    return await ctx.db.insert('chats', {
      userId,
      title,
      model,
      projectId,
      lastModified: Date.now(),
    })
  },
})

export const update = mutation({
  args: { chatId: v.id('chats'), title: v.optional(v.string()), model: v.optional(v.string()) },
  handler: async (ctx, { chatId, title, model }) => {
    const updates: Record<string, unknown> = { lastModified: Date.now() }
    if (title !== undefined) updates.title = title
    if (model !== undefined) updates.model = model
    await ctx.db.patch(chatId, updates)
  },
})

export const remove = mutation({
  args: { chatId: v.id('chats') },
  handler: async (ctx, { chatId }) => {
    const messages = await ctx.db
      .query('messages')
      .withIndex('by_chatId', (q) => q.eq('chatId', chatId))
      .collect()
    for (const msg of messages) {
      await ctx.db.delete(msg._id)
    }
    await ctx.db.delete(chatId)
  },
})

export const getMessages = query({
  args: { chatId: v.id('chats') },
  handler: async (ctx, { chatId }) => {
    return await ctx.db
      .query('messages')
      .withIndex('by_chatId', (q) => q.eq('chatId', chatId))
      .order('asc')
      .collect()
  },
})

export const addMessage = mutation({
  args: {
    chatId: v.id('chats'),
    userId: v.string(),
    role: v.union(v.literal('user'), v.literal('assistant')),
    content: v.string(),
    model: v.optional(v.string()),
    tokens: v.optional(v.object({ input: v.number(), output: v.number() })),
  },
  handler: async (ctx, args) => {
    const msgId = await ctx.db.insert('messages', {
      ...args,
      createdAt: Date.now(),
    })
    await ctx.db.patch(args.chatId, { lastModified: Date.now() })
    return msgId
  },
})
