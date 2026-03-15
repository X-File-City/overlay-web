import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/workos-auth'
import { convex } from '@/lib/convex'

interface APIKeyResponse {
  key: string | null
}

async function getComposioApiKey(accessToken: string): Promise<string | null> {
  try {
    const result = await convex.action<APIKeyResponse>('keys:getAPIKey', {
      provider: 'composio',
      accessToken,
    })
    return result?.key ?? process.env.COMPOSIO_API_KEY ?? null
  } catch {
    return process.env.COMPOSIO_API_KEY ?? null
  }
}

// GET - list connected integrations
export async function GET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const apiKey = await getComposioApiKey(session.accessToken)
    if (!apiKey) return NextResponse.json({ connected: [] })

    const res = await fetch('https://backend.composio.dev/api/v1/connectedAccounts?page=1&pageSize=100', {
      headers: { 'x-api-key': apiKey },
    })

    if (!res.ok) return NextResponse.json({ connected: [] })
    const data = await res.json()
    const connected: string[] = (data.items || []).map(
      (item: { appName: string }) => item.appName?.toLowerCase()
    ).filter(Boolean)

    return NextResponse.json({ connected: [...new Set(connected)] })
  } catch {
    return NextResponse.json({ connected: [] })
  }
}

// POST - initiate connection (returns redirect URL) or disconnect
export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { action, toolkit } = await request.json()
    if (!toolkit) return NextResponse.json({ error: 'toolkit required' }, { status: 400 })

    const apiKey = await getComposioApiKey(session.accessToken)
    if (!apiKey) return NextResponse.json({ error: 'Composio not configured' }, { status: 503 })

    if (action === 'disconnect') {
      // Find connected account and delete it
      const listRes = await fetch(
        `https://backend.composio.dev/api/v1/connectedAccounts?appName=${toolkit}&page=1&pageSize=10`,
        { headers: { 'x-api-key': apiKey } }
      )
      if (listRes.ok) {
        const listData = await listRes.json()
        const account = listData.items?.[0]
        if (account?.id) {
          await fetch(`https://backend.composio.dev/api/v1/connectedAccounts/${account.id}`, {
            method: 'DELETE',
            headers: { 'x-api-key': apiKey },
          })
        }
      }
      return NextResponse.json({ success: true })
    }

    // action === 'connect' — get OAuth redirect URL
    const res = await fetch('https://backend.composio.dev/api/v1/connectedAccounts', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appName: toolkit,
        authMode: 'OAUTH2',
        redirectUri: `${process.env.NEXT_PUBLIC_APP_URL || 'https://getoverlay.io'}/app/integrations`,
      }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return NextResponse.json({ error: err.message || 'Failed to initiate connection' }, { status: res.status })
    }

    const data = await res.json()
    return NextResponse.json({ redirectUrl: data.redirectUrl || data.connectionId })
  } catch {
    return NextResponse.json({ error: 'Failed to process integration request' }, { status: 500 })
  }
}
