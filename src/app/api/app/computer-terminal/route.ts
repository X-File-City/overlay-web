import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/workos-auth'
import { getInternalApiSecret } from '@/lib/internal-api-secret'
import { createComputerTerminalBridgeToken } from '@/lib/computer-terminal-bridge'
import { convex } from '@/lib/convex'

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

    const bridge = createComputerTerminalBridgeToken({
      computerId,
      userId: session.user.id,
    })

    return NextResponse.json({
      terminalUrl: `/api/app/computer-terminal/view?bridge=${encodeURIComponent(bridge)}`,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get terminal access'
    const status = message === 'Unauthorized' ? 401 : message === 'Computer is not ready' ? 503 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
