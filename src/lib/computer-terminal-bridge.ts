import crypto from 'node:crypto'

import { getInternalApiSecret } from '@/lib/internal-api-secret'

const COMPUTER_TERMINAL_BRIDGE_VERSION = 'v1'
const COMPUTER_TERMINAL_BRIDGE_TTL_MS = 1000 * 60 * 30

export interface ComputerTerminalBridgePayload {
  version: typeof COMPUTER_TERMINAL_BRIDGE_VERSION
  computerId: string
  userId: string
  expiresAtMs: number
}

export interface ComputerTerminalProxyTarget {
  authorizationHeader?: string
  httpUrl: string
  wsUrl: string
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/g, '')
}

function base64UrlDecode(value: string): string {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4)
  return Buffer.from(padded, 'base64').toString('utf8')
}

function signBridgeBody(body: string): string {
  return crypto
    .createHmac('sha256', getInternalApiSecret())
    .update(body)
    .digest('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/g, '')
}

export function createComputerTerminalBridgeToken(params: {
  computerId: string
  userId: string
  ttlMs?: number
}): string {
  const payload: ComputerTerminalBridgePayload = {
    version: COMPUTER_TERMINAL_BRIDGE_VERSION,
    computerId: params.computerId,
    userId: params.userId,
    expiresAtMs: Date.now() + (params.ttlMs ?? COMPUTER_TERMINAL_BRIDGE_TTL_MS),
  }
  const body = base64UrlEncode(JSON.stringify(payload))
  const signature = signBridgeBody(body)
  return `${body}.${signature}`
}

export function verifyComputerTerminalBridgeToken(
  token: string | null | undefined
): ComputerTerminalBridgePayload | null {
  const trimmed = token?.trim()
  if (!trimmed) {
    return null
  }

  const [body, signature] = trimmed.split('.')
  if (!body || !signature) {
    return null
  }

  const expectedSignature = signBridgeBody(body)
  if (
    signature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
  ) {
    return null
  }

  try {
    const parsed = JSON.parse(base64UrlDecode(body)) as Partial<ComputerTerminalBridgePayload>
    if (
      parsed.version !== COMPUTER_TERMINAL_BRIDGE_VERSION ||
      typeof parsed.computerId !== 'string' ||
      typeof parsed.userId !== 'string' ||
      typeof parsed.expiresAtMs !== 'number'
    ) {
      return null
    }

    if (parsed.expiresAtMs <= Date.now()) {
      return null
    }

    return {
      version: COMPUTER_TERMINAL_BRIDGE_VERSION,
      computerId: parsed.computerId,
      userId: parsed.userId,
      expiresAtMs: parsed.expiresAtMs,
    }
  } catch {
    return null
  }
}

function buildBasicAuthorizationHeader(url: URL): string | undefined {
  if (!url.username && !url.password) {
    return undefined
  }

  const username = decodeURIComponent(url.username)
  const password = decodeURIComponent(url.password)
  return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`
}

function buildTerminalWebSocketPath(pathname: string): string {
  const basePath = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  const nextPath = `${basePath}/ws`
  return nextPath.startsWith('/') ? nextPath : `/${nextPath}`
}

export function resolveComputerTerminalProxyTarget(terminalUrl: string): ComputerTerminalProxyTarget {
  const httpUrl = new URL(terminalUrl)
  const authorizationHeader = buildBasicAuthorizationHeader(httpUrl)

  if (authorizationHeader) {
    httpUrl.username = ''
    httpUrl.password = ''
  }

  const wsUrl = new URL(httpUrl.toString())
  wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  wsUrl.pathname = buildTerminalWebSocketPath(wsUrl.pathname)

  return {
    authorizationHeader,
    httpUrl: httpUrl.toString(),
    wsUrl: wsUrl.toString(),
  }
}
