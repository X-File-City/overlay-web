import { v } from 'convex/values'
import { mutation, query, internalMutation } from './_generated/server'

function getPastWeekDates(): string[] {
  const dates: string[] = []
  const now = new Date()
  for (let i = 0; i < 7; i++) {
    const date = new Date(now)
    date.setDate(now.getDate() - i)
    dates.push(date.toISOString().split('T')[0])
  }
  return dates
}

function validateAccessToken(accessToken: string): boolean {
  if (!accessToken || typeof accessToken !== 'string') return false
  const trimmed = accessToken.trim()
  if (trimmed.length < 20) return false

  // If it looks like a JWT, validate expiry
  const parts = trimmed.split('.')
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf-8')
      )
      if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) {
        return false
      }
    } catch {
      // Not a valid JWT payload — still accept as opaque token
    }
  }

  return true
}

export const getEntitlements = query({
  args: { accessToken: v.optional(v.string()), userId: v.string() },
  handler: async (ctx, { accessToken, userId }) => {
    if (accessToken && !validateAccessToken(accessToken)) {
      return null
    }
    const subscription = await ctx.db
      .query('subscriptions')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first()

    const today = new Date().toISOString().split('T')[0]
    const dailyUsage = await ctx.db
      .query('dailyUsage')
      .withIndex('by_userId_date', (q) => q.eq('userId', userId).eq('date', today))
      .first()

    const billingPeriodStart = subscription?.currentPeriodStart
      ? new Date(subscription.currentPeriodStart).toISOString().split('T')[0]
      : today

    const tokenUsage = await ctx.db
      .query('tokenUsage')
      .withIndex('by_userId_period', (q) =>
        q.eq('userId', userId).eq('billingPeriodStart', billingPeriodStart)
      )
      .first()

    const tier = subscription?.tier || 'free'

    const tierDefaults = {
      free: {
        creditsTotal: 0,
        dailyLimits: { ask: 15, write: 15, agent: 15 },
        transcriptionSecondsLimit: 600,
        localTranscriptionEnabled: false
      },
      pro: {
        creditsTotal: 15,
        dailyLimits: { ask: Infinity, write: Infinity, agent: Infinity },
        transcriptionSecondsLimit: Infinity,
        localTranscriptionEnabled: true
      },
      max: {
        creditsTotal: 90,
        dailyLimits: { ask: Infinity, write: Infinity, agent: Infinity },
        transcriptionSecondsLimit: Infinity,
        localTranscriptionEnabled: true
      }
    }

    const defaults = tierDefaults[tier]
    const credits = tokenUsage?.creditsUsed ?? tokenUsage?.costAccrued ?? 0

    let weeklyTranscriptionSeconds = 0
    if (tier === 'free') {
      const pastWeekDates = getPastWeekDates()
      const weeklyUsageRecords = await Promise.all(
        pastWeekDates.map(date =>
          ctx.db
            .query('dailyUsage')
            .withIndex('by_userId_date', (q) => q.eq('userId', userId).eq('date', date))
            .first()
        )
      )
      weeklyTranscriptionSeconds = weeklyUsageRecords.reduce(
        (sum, record) => sum + (record?.transcriptionSeconds ?? 0),
        0
      )
    }

    let weeklyUsage = { ask: 0, write: 0, agent: 0 }
    if (tier === 'free') {
      const pastWeekDates = getPastWeekDates()
      const weeklyUsageRecords = await Promise.all(
        pastWeekDates.map(date =>
          ctx.db
            .query('dailyUsage')
            .withIndex('by_userId_date', (q) => q.eq('userId', userId).eq('date', date))
            .first()
        )
      )
      weeklyUsage = weeklyUsageRecords.reduce(
        (acc, record) => ({
          ask: acc.ask + (record?.askCount ?? 0),
          write: acc.write + (record?.writeCount ?? 0),
          agent: acc.agent + (record?.agentCount ?? 0)
        }),
        { ask: 0, write: 0, agent: 0 }
      )
    }

    return {
      tier,
      creditsUsed: credits,
      creditsTotal: defaults.creditsTotal,
      dailyUsage: tier === 'free' ? weeklyUsage : {
        ask: dailyUsage?.askCount || 0,
        write: dailyUsage?.writeCount || 0,
        agent: dailyUsage?.agentCount || 0
      },
      dailyLimits: defaults.dailyLimits,
      transcriptionSecondsUsed: tier === 'free' ? weeklyTranscriptionSeconds : 0,
      transcriptionSecondsLimit: defaults.transcriptionSecondsLimit,
      localTranscriptionEnabled: defaults.localTranscriptionEnabled,
      resetAt: getNextWeeklyReset(),
      billingPeriodEnd: subscription?.currentPeriodEnd
        ? new Date(subscription.currentPeriodEnd).toISOString()
        : '',
      lastSyncedAt: Date.now()
    }
  }
})

// Record a batch of usage events — requires valid access token
export const recordBatch = mutation({
  args: {
    accessToken: v.string(),
    userId: v.string(),
    events: v.array(
      v.object({
        type: v.union(
          v.literal('ask'),
          v.literal('write'),
          v.literal('agent'),
          v.literal('embedding'),
          v.literal('transcription')
        ),
        modelId: v.optional(v.string()),
        inputTokens: v.optional(v.number()),
        outputTokens: v.optional(v.number()),
        cachedTokens: v.optional(v.number()),
        cost: v.number(),
        timestamp: v.number()
      })
    )
  },
  handler: async (ctx, { accessToken, userId, events }) => {
    if (!validateAccessToken(accessToken)) {
      throw new Error('Unauthorized: invalid or expired access token')
    }

    const today = new Date().toISOString().split('T')[0]

    let dailyUsage = await ctx.db
      .query('dailyUsage')
      .withIndex('by_userId_date', (q) => q.eq('userId', userId).eq('date', today))
      .first()

    if (!dailyUsage) {
      await ctx.db.insert('dailyUsage', {
        userId,
        date: today,
        askCount: 0,
        agentCount: 0,
        writeCount: 0,
        transcriptionSeconds: 0
      })
      dailyUsage = await ctx.db
        .query('dailyUsage')
        .withIndex('by_userId_date', (q) => q.eq('userId', userId).eq('date', today))
        .first()
    }

    const subscription = await ctx.db
      .query('subscriptions')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first()

    const billingPeriodStart = subscription?.currentPeriodStart
      ? new Date(subscription.currentPeriodStart).toISOString().split('T')[0]
      : today

    let tokenUsage = await ctx.db
      .query('tokenUsage')
      .withIndex('by_userId_period', (q) =>
        q.eq('userId', userId).eq('billingPeriodStart', billingPeriodStart)
      )
      .first()

    if (!tokenUsage) {
      await ctx.db.insert('tokenUsage', {
        userId,
        billingPeriodStart,
        creditsUsed: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0
      })
      tokenUsage = await ctx.db
        .query('tokenUsage')
        .withIndex('by_userId_period', (q) =>
          q.eq('userId', userId).eq('billingPeriodStart', billingPeriodStart)
        )
        .first()
    }

    for (const event of events) {
      if (dailyUsage) {
        if (event.type === 'ask') {
          await ctx.db.patch(dailyUsage._id, { askCount: dailyUsage.askCount + 1 })
          dailyUsage.askCount++
        } else if (event.type === 'write') {
          await ctx.db.patch(dailyUsage._id, { writeCount: dailyUsage.writeCount + 1 })
          dailyUsage.writeCount++
        } else if (event.type === 'agent') {
          await ctx.db.patch(dailyUsage._id, { agentCount: dailyUsage.agentCount + 1 })
          dailyUsage.agentCount++
        } else if (event.type === 'transcription') {
          const additionalSeconds = Math.max(0, Math.round(event.cost))
          const currentSeconds = dailyUsage.transcriptionSeconds ?? 0
          await ctx.db.patch(dailyUsage._id, {
            transcriptionSeconds: currentSeconds + additionalSeconds
          })
          dailyUsage.transcriptionSeconds = currentSeconds + additionalSeconds
        }
      }

      if (tokenUsage && event.cost > 0) {
        const currentCredits = tokenUsage.creditsUsed ?? tokenUsage.costAccrued ?? 0
        await ctx.db.patch(tokenUsage._id, {
          creditsUsed: currentCredits + event.cost,
          inputTokens: tokenUsage.inputTokens + (event.inputTokens || 0),
          cachedInputTokens: tokenUsage.cachedInputTokens + (event.cachedTokens || 0),
          outputTokens: tokenUsage.outputTokens + (event.outputTokens || 0)
        })
      }
    }

    return { success: true, eventsProcessed: events.length }
  }
})

// Record a single usage event — requires valid access token
export const recordUsage = mutation({
  args: {
    accessToken: v.string(),
    userId: v.string(),
    type: v.union(
      v.literal('ask'),
      v.literal('write'),
      v.literal('agent'),
      v.literal('embedding'),
      v.literal('transcription')
    ),
    modelId: v.optional(v.string()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    cachedTokens: v.optional(v.number()),
    cost: v.number()
  },
  handler: async (ctx, args) => {
    if (!validateAccessToken(args.accessToken)) {
      throw new Error('Unauthorized: invalid or expired access token')
    }

    const today = new Date().toISOString().split('T')[0]

    let dailyUsage = await ctx.db
      .query('dailyUsage')
      .withIndex('by_userId_date', (q) => q.eq('userId', args.userId).eq('date', today))
      .first()

    if (!dailyUsage) {
      await ctx.db.insert('dailyUsage', {
        userId: args.userId,
        date: today,
        askCount: 0,
        agentCount: 0,
        writeCount: 0,
        transcriptionSeconds: 0
      })
      dailyUsage = await ctx.db
        .query('dailyUsage')
        .withIndex('by_userId_date', (q) => q.eq('userId', args.userId).eq('date', today))
        .first()
    }

    if (dailyUsage) {
      if (args.type === 'ask') {
        await ctx.db.patch(dailyUsage._id, { askCount: dailyUsage.askCount + 1 })
      } else if (args.type === 'write') {
        await ctx.db.patch(dailyUsage._id, { writeCount: dailyUsage.writeCount + 1 })
      } else if (args.type === 'agent') {
        await ctx.db.patch(dailyUsage._id, { agentCount: dailyUsage.agentCount + 1 })
      } else if (args.type === 'transcription') {
        const additionalSeconds = Math.max(0, Math.round(args.cost))
        const currentSeconds = dailyUsage.transcriptionSeconds ?? 0
        await ctx.db.patch(dailyUsage._id, {
          transcriptionSeconds: currentSeconds + additionalSeconds
        })
      }
    }

    return { success: true }
  }
})

// Reset token usage for new billing period — internal only
export const resetTokenUsage = internalMutation({
  args: {
    userId: v.string(),
    newPeriodStart: v.string()
  },
  handler: async (ctx, { userId, newPeriodStart }) => {
    const existing = await ctx.db
      .query('tokenUsage')
      .withIndex('by_userId_period', (q) =>
        q.eq('userId', userId).eq('billingPeriodStart', newPeriodStart)
      )
      .first()

    if (!existing) {
      await ctx.db.insert('tokenUsage', {
        userId,
        billingPeriodStart: newPeriodStart,
        creditsUsed: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0
      })
    }

    return { success: true, periodStart: newPeriodStart }
  }
})

function getNextWeeklyReset(): string {
  const now = new Date()
  const daysUntilMonday = (8 - now.getUTCDay()) % 7 || 7
  const nextMonday = new Date(now)
  nextMonday.setUTCDate(now.getUTCDate() + daysUntilMonday)
  nextMonday.setUTCHours(0, 0, 0, 0)
  return nextMonday.toISOString()
}
