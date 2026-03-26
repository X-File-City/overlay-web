import { type NextRequest, NextResponse } from 'next/server'

import { convex } from '@/lib/convex'
import {
  resolveComputerTerminalProxyTarget,
  verifyComputerTerminalBridgeToken,
} from '@/lib/computer-terminal-bridge'
import { getInternalApiSecret } from '@/lib/internal-api-secret'

function resolveBridgeTokenFromRequest(request: NextRequest): string | null {
  const direct = request.nextUrl.searchParams.get('bridge')?.trim()
  if (direct) {
    return direct
  }

  const referer = request.headers.get('referer')?.trim()
  if (!referer) {
    return null
  }

  try {
    return new URL(referer).searchParams.get('bridge')?.trim() || null
  } catch {
    return null
  }
}

function buildTerminalTokenUrl(terminalUrl: string): string {
  const parsed = new URL(terminalUrl)
  const basePath = parsed.pathname.endsWith('/') ? parsed.pathname.slice(0, -1) : parsed.pathname
  parsed.pathname = `${basePath}/token`.replace(/\/{2,}/g, '/')
  parsed.search = ''
  return parsed.toString()
}

export async function GET(request: NextRequest) {
  const bridgeToken = resolveBridgeTokenFromRequest(request)
  const payload = verifyComputerTerminalBridgeToken(bridgeToken)

  if (!payload) {
    return NextResponse.json({ error: 'Terminal session expired.' }, { status: 401 })
  }

  try {
    const serverSecret = getInternalApiSecret()
    const result = await convex.query<{ terminalUrl: string } | null>('computers:getTerminalAccess', {
      computerId: payload.computerId,
      userId: payload.userId,
      serverSecret,
    })

    if (!result) {
      return NextResponse.json({ error: 'Terminal is not available yet.' }, { status: 503 })
    }

    const target = resolveComputerTerminalProxyTarget(result.terminalUrl)
    const upstream = await fetch(buildTerminalTokenUrl(target.httpUrl), {
      cache: 'no-store',
      headers: target.authorizationHeader
        ? {
            authorization: target.authorizationHeader,
          }
        : undefined,
    })

    const body = await upstream.text()

    return new NextResponse(body, {
      status: upstream.status,
      headers: {
        'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to refresh terminal token.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
