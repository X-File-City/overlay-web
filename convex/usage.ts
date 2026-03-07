import { v } from 'convex/values'
import { mutation, query } from './_generated/server'

// Helper to get dates for the past 7 days
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

// Get user entitlements (subscription + usage data)
export const getEntitlements = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    // Get subscription
    const subscription = await ctx.db
      .query('subscriptions')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first()

    // Get today's date for daily usage
    const today = new Date().toISOString().split('T')[0]
    const dailyUsage = await ctx.db
      .query('dailyUsage')
      .withIndex('by_userId_date', (q) => q.eq('userId', userId).eq('date', today))
      .first()

    // Get billing period usage for paid tiers
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

    // Build entitlements response
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

    // Handle both new creditsUsed and legacy costAccrued field
    const credits = tokenUsage?.creditsUsed ?? tokenUsage?.costAccrued ?? 0

    // For free tier, calculate weekly transcription usage (past 7 days)
    // For paid tiers, transcription is unlimited so we don't need to track it
    let weeklyTranscriptionSeconds = 0
    if (tier === 'free') {
      const pastWeekDates = getPastWeekDates()
      // Query all daily usage records for the past 7 days
      const weeklyUsageRecords = await Promise.all(
        pastWeekDates.map(date =>
          ctx.db
            .query('dailyUsage')
            .withIndex('by_userId_date', (q) => q.eq('userId', userId).eq('date', date))
            .first()
        )
      )
      // Sum up transcription seconds from all days
      weeklyTranscriptionSeconds = weeklyUsageRecords.reduce(
        (sum, record) => sum + (record?.transcriptionSeconds ?? 0),
        0
      )
    }

    // Also calculate weekly usage counts (ask/write/agent) for free tier
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

// Record a batch of usage events
export const recordBatch = mutation({
  args: {
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
  handler: async (ctx, { userId, events }) => {
    const today = new Date().toISOString().split('T')[0]

    // Get or create daily usage record
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

    // Get subscription for billing period
    const subscription = await ctx.db
      .query('subscriptions')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first()

    const billingPeriodStart = subscription?.currentPeriodStart
      ? new Date(subscription.currentPeriodStart).toISOString().split('T')[0]
      : today

    // Get or create token usage record
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

    // Process each event
    for (const event of events) {
      // Update daily usage
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
        } else if (event.type === 'embedding') {
          // Embedding usage contributes to billing credits only, not daily action counts.
        } else if (event.type === 'transcription') {
          // For transcription, cost represents seconds
          const additionalSeconds = Math.round(event.cost)
          const currentSeconds = dailyUsage.transcriptionSeconds ?? 0
          await ctx.db.patch(dailyUsage._id, {
            transcriptionSeconds: currentSeconds + additionalSeconds
          })
          dailyUsage.transcriptionSeconds = currentSeconds + additionalSeconds
        }
      }

      // Update token usage (for paid tiers)
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

// Record a single usage event (convenience mutation)
export const recordUsage = mutation({
  args: {
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
    const today = new Date().toISOString().split('T')[0]

    // Update daily usage
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
      } else if (args.type === 'embedding') {
        // Embedding usage contributes to billing credits only, not daily action counts.
      } else if (args.type === 'transcription') {
        const additionalSeconds = Math.round(args.cost)
        const currentSeconds = dailyUsage.transcriptionSeconds ?? 0
        await ctx.db.patch(dailyUsage._id, {
          transcriptionSeconds: currentSeconds + additionalSeconds
        })
      }
    }

    return { success: true }
  }
})

// Reset token usage for new billing period
export const resetTokenUsage = mutation({
  args: {
    userId: v.string(),
    newPeriodStart: v.string()
  },
  handler: async (ctx, { userId, newPeriodStart }) => {
    // Create new token usage record for the new billing period
    // Old records are kept for historical purposes
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

// Helper function to get next weekly reset time (Monday 00:00 UTC)
function getNextWeeklyReset(): string {
  const now = new Date()
  const daysUntilMonday = (8 - now.getUTCDay()) % 7 || 7 // Days until next Monday
  const nextMonday = new Date(now)
  nextMonday.setUTCDate(now.getUTCDate() + daysUntilMonday)
  nextMonday.setUTCHours(0, 0, 0, 0)
  return nextMonday.toISOString()
}
