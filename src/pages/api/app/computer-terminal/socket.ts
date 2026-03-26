import type { IncomingMessage, Server as HTTPServer } from 'node:http'
import type { Socket } from 'node:net'

import type { NextApiRequest, NextApiResponse } from 'next'
import { WebSocket, WebSocketServer, type RawData } from 'ws'

import { convex } from '@/lib/convex'
import {
  resolveComputerTerminalProxyTarget,
  verifyComputerTerminalBridgeToken,
} from '@/lib/computer-terminal-bridge'
import { getInternalApiSecret } from '@/lib/internal-api-secret'

export const config = {
  api: {
    bodyParser: false,
  },
}

type NextApiResponseWithSocket = NextApiResponse & {
  socket: Socket & {
    server: HTTPServer & {
      overlayComputerTerminalSocketWss?: WebSocketServer
      overlayComputerTerminalSocketUpgradeAttached?: boolean
    }
  }
}

function buildRequestUrl(request: IncomingMessage): URL | null {
  const host = request.headers.host
  const rawUrl = request.url
  if (!host || !rawUrl) {
    return null
  }

  try {
    return new URL(rawUrl, `http://${host}`)
  } catch {
    return null
  }
}

function bridgeSocketData(source: WebSocket, target: WebSocket) {
  source.on('message', (data: RawData, isBinary: boolean) => {
    if (target.readyState !== WebSocket.OPEN) {
      return
    }
    target.send(data, { binary: isBinary })
  })
}

function closeSocket(socket: WebSocket, code: number, reason: string) {
  if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
    socket.close(code, reason)
  }
}

async function handleTerminalSocketConnection(client: WebSocket, request: IncomingMessage) {
  const requestUrl = buildRequestUrl(request)
  const bridgeToken = requestUrl?.searchParams.get('bridge')
  const payload = verifyComputerTerminalBridgeToken(bridgeToken)

  if (!payload) {
    closeSocket(client, 1008, 'Invalid terminal bridge token')
    return
  }

  try {
    const serverSecret = getInternalApiSecret()
    const result = await convex.query<{ terminalUrl: string } | null>('computers:getTerminalAccess', {
      computerId: payload.computerId,
      userId: payload.userId,
      serverSecret,
    })

    if (!result) {
      closeSocket(client, 1013, 'Terminal unavailable')
      return
    }

    const target = resolveComputerTerminalProxyTarget(result.terminalUrl)
    const remote = new WebSocket(target.wsUrl, {
      headers: target.authorizationHeader
        ? {
            authorization: target.authorizationHeader,
          }
        : undefined,
    })

    const closeBoth = (code: number, reason: string) => {
      closeSocket(client, code, reason)
      closeSocket(remote, code, reason)
    }

    remote.once('open', () => {
      bridgeSocketData(client, remote)
      bridgeSocketData(remote, client)
    })

    remote.once('error', () => {
      closeBoth(1011, 'Terminal upstream error')
    })

    remote.once('close', () => {
      closeSocket(client, 1000, 'Terminal closed')
    })

    client.once('close', () => {
      closeSocket(remote, 1000, 'Client closed')
    })

    client.once('error', () => {
      closeSocket(remote, 1011, 'Client error')
    })
  } catch {
    closeSocket(client, 1011, 'Failed to start terminal bridge')
  }
}

function ensureTerminalSocketServer(response: NextApiResponseWithSocket) {
  const server = response.socket.server
  if (server.overlayComputerTerminalSocketWss) {
    return
  }

  const wss = new WebSocketServer({ noServer: true })
  wss.on('connection', (client, request) => {
    void handleTerminalSocketConnection(client, request)
  })

  if (!server.overlayComputerTerminalSocketUpgradeAttached) {
    server.on('upgrade', (request: IncomingMessage, socket: Socket, head: Buffer) => {
      const requestUrl = buildRequestUrl(request)
      if (requestUrl?.pathname !== '/api/app/computer-terminal/socket') {
        return
      }

      wss.handleUpgrade(request, socket, head, (client) => {
        wss.emit('connection', client, request)
      })
    })
    server.overlayComputerTerminalSocketUpgradeAttached = true
  }

  server.overlayComputerTerminalSocketWss = wss
}

export default function handler(_request: NextApiRequest, response: NextApiResponseWithSocket) {
  ensureTerminalSocketServer(response)
  response.status(200).json({ ok: true })
}
