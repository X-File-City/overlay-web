import { NextRequest, NextResponse } from 'next/server'
import { getInternalApiSecret } from '@/lib/internal-api-secret'
import { getSession } from '@/lib/workos-auth'
import { convex } from '@/lib/convex'

export async function GET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const serverSecret = getInternalApiSecret()
    const computers = await convex.query('computers:list', {
      userId: session.user.id,
      serverSecret,
    })

    return NextResponse.json({ computers: computers || [] })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch computers'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const serverSecret = getInternalApiSecret()
    const { name, region }: { name?: string; region?: 'eu-central' | 'us-east' } = await request.json()

    if (!name?.trim()) {
      return NextResponse.json({ error: 'name required' }, { status: 400 })
    }

    if (region !== 'eu-central' && region !== 'us-east') {
      return NextResponse.json({ error: 'region required' }, { status: 400 })
    }

    const id = await convex.mutation<string>('computers:create', {
      userId: session.user.id,
      serverSecret,
      name: name.trim(),
      region,
    })

    return NextResponse.json({ id })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create computer'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
