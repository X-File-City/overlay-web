import { type NextRequest, NextResponse } from 'next/server'

import { convex } from '@/lib/convex'
import {
  resolveComputerTerminalProxyTarget,
  verifyComputerTerminalBridgeToken,
} from '@/lib/computer-terminal-bridge'
import { getInternalApiSecret } from '@/lib/internal-api-secret'

function buildTerminalProxyBootstrap(bridgeToken: string): string {
  const encodedBridge = JSON.stringify(bridgeToken)
  return `<script>
(() => {
  const bridgeToken = ${encodedBridge};
  const proxyWsUrl =
    (window.location.protocol === 'https:' ? 'wss://' : 'ws://') +
    window.location.host +
    '/api/app/computer-terminal/socket?bridge=' +
    encodeURIComponent(bridgeToken);
  const NativeWebSocket = window.WebSocket;
  function ProxyWebSocket(url, protocols) {
    return new NativeWebSocket(proxyWsUrl, protocols);
  }
  ProxyWebSocket.prototype = NativeWebSocket.prototype;
  Object.setPrototypeOf(ProxyWebSocket, NativeWebSocket);
  ProxyWebSocket.CONNECTING = NativeWebSocket.CONNECTING;
  ProxyWebSocket.OPEN = NativeWebSocket.OPEN;
  ProxyWebSocket.CLOSING = NativeWebSocket.CLOSING;
  ProxyWebSocket.CLOSED = NativeWebSocket.CLOSED;
  window.WebSocket = ProxyWebSocket;
})();
</script>`
}

function injectTerminalProxyBootstrap(html: string, bridgeToken: string): string {
  const bootstrap = buildTerminalProxyBootstrap(bridgeToken)
  if (html.includes('</head>')) {
    return html.replace('</head>', `${bootstrap}</head>`)
  }
  if (html.includes('<body')) {
    return html.replace('<body', `${bootstrap}<body`)
  }
  return `${bootstrap}${html}`
}

function renderTerminalErrorHtml(message: string): string {
  const safeMessage = message
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Terminal Unavailable</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #111;
        color: #d6d6d6;
        font: 13px/1.6 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .card {
        max-width: 380px;
        padding: 18px 20px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.04);
        box-shadow: 0 16px 36px rgba(0, 0, 0, 0.25);
      }
      .eyebrow {
        margin: 0 0 6px;
        color: rgba(255, 255, 255, 0.55);
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      p {
        margin: 0;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <p class="eyebrow">Terminal</p>
      <p>${safeMessage}</p>
    </div>
  </body>
</html>`
}

export async function GET(request: NextRequest) {
  const bridgeToken = request.nextUrl.searchParams.get('bridge')
  const payload = verifyComputerTerminalBridgeToken(bridgeToken)

  if (!payload) {
    return new NextResponse(renderTerminalErrorHtml('Terminal session expired. Reopen the terminal panel.'), {
      status: 401,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      },
    })
  }

  try {
    const serverSecret = getInternalApiSecret()
    const result = await convex.query<{ terminalUrl: string } | null>('computers:getTerminalAccess', {
      computerId: payload.computerId,
      userId: payload.userId,
      serverSecret,
    })

    if (!result) {
      return new NextResponse(renderTerminalErrorHtml('Terminal is not available yet.'), {
        status: 503,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        },
      })
    }

    const target = resolveComputerTerminalProxyTarget(result.terminalUrl)
    const upstream = await fetch(target.httpUrl, {
      cache: 'no-store',
      headers: target.authorizationHeader
        ? {
            authorization: target.authorizationHeader,
          }
        : undefined,
    })

    const html = injectTerminalProxyBootstrap(await upstream.text(), bridgeToken!)

    return new NextResponse(html, {
      status: upstream.status,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load terminal.'
    return new NextResponse(renderTerminalErrorHtml(message), {
      status: 500,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      },
    })
  }
}
