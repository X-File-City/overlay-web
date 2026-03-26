import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/workos-auth'
import { getInternalApiSecret } from '@/lib/internal-api-secret'
import { convex } from '@/lib/convex'

function normalizeTerminalUrl(terminalUrl: string): string {
  try {
    const parsed = new URL(terminalUrl)
    const token = parsed.searchParams.get('token')?.trim()
    if (!token) {
      return terminalUrl
    }

    parsed.username = 'overlay'
    parsed.password = token
    parsed.searchParams.delete('token')
    if (!parsed.pathname || parsed.pathname === '') {
      parsed.pathname = '/'
    }
    return parsed.toString()
  } catch {
    return terminalUrl
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const computerId = request.nextUrl.searchParams.get('computerId')
    if (!computerId) {
      return NextResponse.json({ error: 'computerId is required' }, { status: 400 })
    }

    const serverSecret = getInternalApiSecret()
    const result = await convex.query<{ terminalUrl: string } | null>('computers:getTerminalAccess', {
      computerId,
      userId: session.user.id,
      serverSecret,
    })

    if (!result) {
      return NextResponse.json({ error: 'Terminal is not available yet.' }, { status: 503 })
    }

    return NextResponse.json({
      terminalUrl: normalizeTerminalUrl(result.terminalUrl),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get terminal access'
    const status = message === 'Unauthorized' ? 401 : message === 'Computer is not ready' ? 503 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
