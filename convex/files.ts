import { v } from 'convex/values'
import { Id } from './_generated/dataModel'
import { internal } from './_generated/api'
import { mutation, query } from './_generated/server'

// ─── Queries ──────────────────────────────────────────────────────────────────

export const list = query({
  args: {
    userId: v.string(),
    projectId: v.optional(v.string()),
  },
  handler: async (ctx, { userId, projectId }) => {
    const allFiles = await ctx.db
      .query('files')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .order('asc')
      .collect()

    const filtered =
      projectId !== undefined
        ? allFiles.filter((f) => f.projectId === projectId)
        : allFiles

    return Promise.all(
      filtered.map(async (file) => {
        const content = file.storageId
          ? (await ctx.storage.getUrl(file.storageId)) ?? ''
          : (file.content ?? '')
        return {
          _id: file._id,
          userId: file.userId,
          name: file.name,
          type: file.type,
          parentId: file.parentId ?? null,
          content,
          projectId: file.projectId,
          createdAt: file.createdAt,
          updatedAt: file.updatedAt,
        }
      })
    )
  },
})

export const get = query({
  args: { fileId: v.id('files') },
  handler: async (ctx, { fileId }) => {
    const file = await ctx.db.get(fileId)
    if (!file) return null
    const content = file.storageId
      ? (await ctx.storage.getUrl(file.storageId)) ?? ''
      : (file.content ?? '')
    return {
      _id: file._id,
      userId: file.userId,
      name: file.name,
      type: file.type,
      parentId: file.parentId ?? null,
      content,
      projectId: file.projectId,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
    }
  },
})

// ─── Mutations ────────────────────────────────────────────────────────────────

export const create = mutation({
  args: {
    userId: v.string(),
    name: v.string(),
    type: v.union(v.literal('file'), v.literal('folder')),
    parentId: v.optional(v.string()),
    content: v.optional(v.string()),
    projectId: v.optional(v.string()),
  },
  handler: async (ctx, { userId, name, type, parentId, content, projectId }) => {
    const now = Date.now()
    const id = await ctx.db.insert('files', {
      userId,
      name,
      type,
      parentId,
      content: content ?? '',
      projectId,
      createdAt: now,
      updatedAt: now,
    })
    if (type === 'file' && (content ?? '').trim()) {
      await ctx.scheduler.runAfter(0, internal.knowledge.reindexFileInternal, { fileId: id })
    }
    return id
  },
})

export const createWithStorage = mutation({
  args: {
    userId: v.string(),
    name: v.string(),
    parentId: v.optional(v.string()),
    storageId: v.id('_storage'),
    projectId: v.optional(v.string()),
  },
  handler: async (ctx, { userId, name, parentId, storageId, projectId }) => {
    const now = Date.now()
    const id = await ctx.db.insert('files', {
      userId,
      name,
      type: 'file',
      parentId,
      storageId,
      projectId,
      createdAt: now,
      updatedAt: now,
    })
    return id
  },
})

export const update = mutation({
  args: {
    fileId: v.id('files'),
    name: v.optional(v.string()),
    content: v.optional(v.string()),
  },
  handler: async (ctx, { fileId, name, content }) => {
    const patch: Record<string, unknown> = { updatedAt: Date.now() }
    if (name !== undefined) patch.name = name
    if (content !== undefined) patch.content = content
    await ctx.db.patch(fileId, patch)
    const after = await ctx.db.get(fileId)
    if (after?.type === 'file' && !after.storageId) {
      await ctx.scheduler.runAfter(0, internal.knowledge.reindexFileInternal, { fileId })
    }
  },
})

export const remove = mutation({
  args: { fileId: v.id('files') },
  handler: async (ctx, { fileId }) => {
    async function deleteSubtree(id: Id<'files'>) {
      const children = await ctx.db
        .query('files')
        .withIndex('by_parentId', (q) => q.eq('parentId', id as string))
        .collect()
      for (const child of children) {
        await deleteSubtree(child._id)
      }
      const file = (await ctx.db.get(id)) as { type?: string; storageId?: Id<'_storage'> } | null
      if (file?.type === 'file') {
        await ctx.runMutation(internal.knowledge.purgeKnowledgeSource, {
          sourceKind: 'file',
          sourceId: id,
        })
      }
      if (file?.storageId) {
        await ctx.storage.delete(file.storageId)
      }
      await ctx.db.delete(id)
    }
    await deleteSubtree(fileId)
  },
})

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl()
  },
})
