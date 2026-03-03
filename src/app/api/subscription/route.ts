import { NextRequest, NextResponse } from 'next/server'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../../../../convex/_generated/api'

// Use production Convex URL
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL || 'https://colorful-chickadee-419.convex.cloud'
const convex = new ConvexHttpClient(CONVEX_URL)

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const userId = searchParams.get('userId')

  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 })
  }

  try {
    // Fetch user's subscription from Convex
    const entitlements = await convex.query(api.usage.getEntitlements, { userId })

    if (!entitlements) {
      return NextResponse.json({ tier: 'free', status: 'active' })
    }

    return NextResponse.json({
      tier: entitlements.tier || 'free',
      status: 'active',
      creditsUsed: entitlements.creditsUsed || 0,
      creditsTotal: entitlements.creditsTotal || 0,
      billingPeriodEnd: entitlements.billingPeriodEnd || null
    })
  } catch (error) {
    console.error('[Subscription API] Error fetching subscription:', error)
    return NextResponse.json({ tier: 'free', status: 'active' })
  }
}
