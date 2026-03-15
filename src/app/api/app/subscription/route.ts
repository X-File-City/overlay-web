import { NextResponse } from 'next/server'
import { getSession } from '@/lib/workos-auth'
import { convex } from '@/lib/convex'

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const entitlements = await convex.query('usage:getEntitlements', {
    accessToken: session.accessToken,
    userId: session.user.id,
  })

  if (!entitlements) {
    return NextResponse.json({
      tier: 'free',
      creditsUsed: 0,
      creditsTotal: 0,
      dailyUsage: { ask: 0, write: 0, agent: 0 },
      dailyLimits: { ask: 15, write: 15, agent: 15 },
      transcriptionSecondsUsed: 0,
      transcriptionSecondsLimit: 600,
    })
  }

  return NextResponse.json(entitlements)
}
