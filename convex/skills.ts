import { v } from 'convex/values'
import { mutation, query } from './_generated/server'

export const list = query({
  args: { userId: v.string(), projectId: v.optional(v.string()) },
  handler: async (ctx, { userId, projectId }) => {
    const all = await ctx.db
      .query('skills')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .order('desc')
      .collect()
    if (projectId !== undefined) {
      return all.filter((s) => s.projectId === projectId)
    }
    // Global skills = no projectId
    return all.filter((s) => !s.projectId)
  },
})

export const get = query({
  args: { skillId: v.id('skills') },
  handler: async (ctx, { skillId }) => {
    return await ctx.db.get(skillId)
  },
})

export const create = mutation({
  args: {
    userId: v.string(),
    name: v.string(),
    description: v.string(),
    instructions: v.string(),
    projectId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    return await ctx.db.insert('skills', { ...args, createdAt: now, updatedAt: now })
  },
})

export const update = mutation({
  args: {
    skillId: v.id('skills'),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    instructions: v.optional(v.string()),
  },
  handler: async (ctx, { skillId, ...updates }) => {
    const patch: Record<string, unknown> = { updatedAt: Date.now() }
    if (updates.name !== undefined) patch.name = updates.name
    if (updates.description !== undefined) patch.description = updates.description
    if (updates.instructions !== undefined) patch.instructions = updates.instructions
    await ctx.db.patch(skillId, patch)
  },
})

export const remove = mutation({
  args: { skillId: v.id('skills') },
  handler: async (ctx, { skillId }) => {
    await ctx.db.delete(skillId)
  },
})
