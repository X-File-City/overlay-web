import { NextRequest, NextResponse } from 'next/server'
import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from 'ai'
import { convex } from '@/lib/convex'
import { getSession } from '@/lib/workos-auth'
import { DEFAULT_MODEL_ID, getModel } from '@/lib/models'

export const maxDuration = 300
const GATEWAY_PROTOCOL_VERSION = 3

interface ComputerConnectionInfo {
  gatewayToken: string
  hooksToken: string
  hetznerServerIp: string
}

interface ToolInvokeResponse<T> {
  ok?: boolean
  result?: T
  error?: {
    message?: string
  }
}

interface SessionStatusToolResult {
  content?: Array<{
    type?: string
    text?: string
  }>
  details?: {
    statusText?: string
  }
}

interface GatewaySessionModelState {
  sessionKey: string
  provider?: string
  model?: string
}

interface GatewayErrorShape {
  message?: string
}

interface GatewayResponseFrame {
  type?: string
  id?: string
  ok?: boolean
  payload?: unknown
  error?: GatewayErrorShape
}

interface GatewayAgentAcceptedPayload {
  runId?: string
  status?: string
}

interface GatewayAgentFinalPayload extends GatewayAgentAcceptedPayload {
  summary?: string
  result?: unknown
}

interface GatewayAgentEventPayload {
  runId?: string
  sessionKey?: string
  stream?: string
  data?: {
    text?: string
    delta?: string
    phase?: string
    error?: string
  }
}

interface GatewayEventFrame {
  type?: string
  event?: string
  payload?: GatewayAgentEventPayload
}

interface OpenClawTranscriptMessage {
  role?: string
  provider?: string
  model?: string
  content?: Array<{
    type?: string
    text?: string
  }>
  __openclaw?: {
    seq?: number
    id?: string
  }
}

interface SessionHistoryResponse {
  sessionKey?: string
  items?: OpenClawTranscriptMessage[]
  messages?: OpenClawTranscriptMessage[]
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { messages, computerId, modelId }: {
      messages: UIMessage[]
      computerId?: string
      modelId?: string
    } = await request.json()

    if (!computerId) {
      return NextResponse.json({ error: 'Computer ID is required' }, { status: 400 })
    }

    const latestUserText = extractLatestUserText(messages)
    if (!latestUserText) {
      return NextResponse.json({ error: 'Message cannot be empty' }, { status: 400 })
    }

    const userId = session.user.id
    const accessToken = session.accessToken

    const connection = await convex.query<ComputerConnectionInfo>(
      'computers:getChatConnection',
      {
        computerId,
        userId,
        accessToken,
      },
      { throwOnError: true, timeoutMs: 30_000 }
    )

    if (!connection) {
      return NextResponse.json({ error: 'Computer is not ready' }, { status: 400 })
    }

    await convex.mutation(
      'computers:addChatMessage',
      {
        computerId,
        userId,
        accessToken,
        role: 'user',
        content: latestUserText,
      },
      { throwOnError: true, timeoutMs: 30_000 }
    )

    const sessionKey = getComputerSessionKey(userId, computerId)
    const selectedModelId = modelId?.trim() || DEFAULT_MODEL_ID
    const requestedModelRef =
      resolveOpenClawModelRef(selectedModelId) ?? resolveOpenClawModelRef(DEFAULT_MODEL_ID)
    const baselineHistory = await fetchSessionHistorySnapshot({
      ip: connection.hetznerServerIp,
      gatewayToken: connection.gatewayToken,
      sessionKey,
    })
    const baselineSeq = getHighestTranscriptSeq(baselineHistory.messages)
    const hookMessage = buildHookMessage({
      messages,
      latestUserText,
      sessionHasHistory: baselineHistory.messages.length > 0,
    })

    const stream = createUIMessageStream<UIMessage>({
      originalMessages: messages,
      execute: async ({ writer }) => {
        const textId = crypto.randomUUID()
        let assistantText = ''

        try {
          writer.write({ type: 'text-start', id: textId })

          assistantText = await streamAssistantReplyFromGateway({
            ip: connection.hetznerServerIp,
            gatewayToken: connection.gatewayToken,
            sessionKey,
            message: hookMessage,
            model: requestedModelRef,
            onText: (delta) => {
              if (!delta) return
              writer.write({ type: 'text-delta', id: textId, delta })
            },
          })

          writer.write({ type: 'text-end', id: textId })

          const finalText = assistantText.trim()
          if (!finalText) {
            throw new Error('OpenClaw returned an empty response.')
          }

          await convex.mutation(
            'computers:addChatMessage',
            {
              computerId,
              userId,
              accessToken,
              role: 'assistant',
              content: finalText,
            },
            { throwOnError: true, timeoutMs: 30_000 }
          )

          const latestHistory = await fetchSessionHistorySnapshot({
            ip: connection.hetznerServerIp,
            gatewayToken: connection.gatewayToken,
            sessionKey,
          }).catch(() => null)
          const latestAssistantMessage = latestHistory
            ? findAssistantMessageAfterSeq(latestHistory.messages, baselineSeq)
            : null
          const latestSessionModel = await readGatewaySessionModel({
            ip: connection.hetznerServerIp,
            gatewayToken: connection.gatewayToken,
            sessionKey,
          }).catch(() => null)

          await convex.mutation(
            'computers:setChatRuntimeState',
            {
              computerId,
              userId,
              accessToken,
              sessionKey: latestSessionModel?.sessionKey ?? sessionKey,
              requestedModelId: selectedModelId,
              requestedModelRef: requestedModelRef ?? undefined,
              effectiveProvider: latestAssistantMessage?.provider ?? latestSessionModel?.provider,
              effectiveModel: latestAssistantMessage?.model ?? latestSessionModel?.model,
            },
            { throwOnError: true, timeoutMs: 30_000 }
          )
        } catch (error) {
          const message = getErrorMessage(error)
          await convex.mutation(
            'computers:addChatError',
            {
              computerId,
              userId,
              accessToken,
              message: `Error: ${message}`,
            },
            { throwOnError: true, timeoutMs: 30_000 }
          )
          throw error
        }
      },
      onError: (error) => getErrorMessage(error),
    })

    return createUIMessageStreamResponse({ stream })
  } catch (error) {
    console.error('[Computer Chat API] Error:', error)
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 })
  }
}

function extractTextFromUiMessage(message: UIMessage | undefined): string {
  if (!message?.parts) return ''
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => ('text' in part && typeof part.text === 'string' ? part.text : ''))
    .join('')
    .trim()
}

function extractLatestUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') {
      return extractTextFromUiMessage(messages[i])
    }
  }
  return ''
}

function buildHookMessage(params: {
  messages: UIMessage[]
  latestUserText: string
  sessionHasHistory: boolean
}): string {
  if (params.sessionHasHistory) {
    return params.latestUserText
  }

  const transcript = params.messages
    .map((message) => {
      const text = extractTextFromUiMessage(message)
      if (!text) {
        return null
      }

      if (message.role === 'user') {
        return `User: ${text}`
      }
      if (message.role === 'assistant') {
        return `Assistant: ${text}`
      }
      if (message.role === 'system') {
        return `System: ${text}`
      }
      return null
    })
    .filter((line): line is string => Boolean(line))
    .join('\n\n')
    .trim()

  if (!transcript || transcript === `User: ${params.latestUserText}`) {
    return params.latestUserText
  }

  return [
    'Use the following transcript as prior conversation context and continue naturally.',
    'Respond only to the latest user message.',
    '',
    transcript,
  ].join('\n')
}

async function fetchSessionHistorySnapshot(params: {
  ip: string
  gatewayToken: string
  sessionKey: string
}): Promise<{ sessionKey: string; messages: OpenClawTranscriptMessage[] }> {
  const response = await fetch(
    `http://${params.ip}:18789/sessions/${encodeURIComponent(params.sessionKey)}/history`,
    {
      headers: {
        Authorization: `Bearer ${params.gatewayToken}`,
      },
      signal: AbortSignal.timeout(30_000),
    }
  )

  if (response.status === 404) {
    return { sessionKey: params.sessionKey, messages: [] }
  }

  if (!response.ok) {
    throw new Error(
      `Failed to load OpenClaw session history: ${response.status} ${await response.text()}`
    )
  }

  const body = (await response.json()) as SessionHistoryResponse
  return {
    sessionKey: body.sessionKey?.trim() || params.sessionKey,
    messages: normalizeTranscriptMessages(body),
  }
}

async function streamAssistantReplyFromGateway(params: {
  ip: string
  gatewayToken: string
  sessionKey: string
  message: string
  model?: string | null
  onText: (delta: string) => void
}): Promise<string> {
  const ws = await openGatewaySocket(params.ip)
  let assistantText = ''

  try {
    await connectGatewaySocket(ws, params.gatewayToken)

    assistantText = await runGatewayAgentStream(ws, {
      message: params.message,
      sessionKey: params.sessionKey,
      model: params.model,
      onText: (delta) => {
        if (!delta) return
        assistantText += delta
        params.onText(delta)
      },
    })
  } finally {
    ws.close()
  }

  return assistantText
}

function normalizeTranscriptMessages(payload: SessionHistoryResponse): OpenClawTranscriptMessage[] {
  const messages = payload.messages ?? payload.items ?? []
  return Array.isArray(messages) ? messages : []
}

function getHighestTranscriptSeq(messages: OpenClawTranscriptMessage[]): number {
  return messages.reduce((highest, message) => {
    const seq = typeof message.__openclaw?.seq === 'number' ? message.__openclaw.seq : 0
    return seq > highest ? seq : highest
  }, 0)
}

function findAssistantMessageAfterSeq(
  payload: unknown,
  baselineSeq: number
): OpenClawTranscriptMessage | null {
  const candidates: OpenClawTranscriptMessage[] = []

  if (payload && typeof payload === 'object') {
    const maybePayload = payload as {
      message?: OpenClawTranscriptMessage
      messages?: OpenClawTranscriptMessage[]
      items?: OpenClawTranscriptMessage[]
    }

    if (maybePayload.message) {
      candidates.push(maybePayload.message)
    }
    if (Array.isArray(maybePayload.messages)) {
      candidates.push(...maybePayload.messages)
    }
    if (Array.isArray(maybePayload.items)) {
      candidates.push(...maybePayload.items)
    }
  }

  let latestAssistant: OpenClawTranscriptMessage | null = null
  let latestSeq = baselineSeq

  for (const message of candidates) {
    if (message.role !== 'assistant') {
      continue
    }
    const seq = typeof message.__openclaw?.seq === 'number' ? message.__openclaw.seq : 0
    if (seq <= baselineSeq || seq < latestSeq) {
      continue
    }
    latestAssistant = message
    latestSeq = seq
  }

  return latestAssistant
}

function getComputerSessionKey(userId: string, computerId: string): string {
  return `hook:computer:v1:${userId}:${computerId}`
}

function resolveOpenClawModelRef(modelId: string): string | null {
  const model = getModel(modelId)
  return model?.openClawRef ?? null
}

async function openGatewaySocket(ip: string): Promise<WebSocket> {
  const ws = new WebSocket(`ws://${ip}:18789`)
  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      cleanup()
      reject(new Error('Timed out opening OpenClaw gateway websocket.'))
    }, 30_000)

    const cleanup = () => {
      clearTimeout(timeoutId)
      ws.removeEventListener('open', handleOpen)
      ws.removeEventListener('error', handleError)
    }

    const handleOpen = () => {
      cleanup()
      resolve()
    }

    const handleError = () => {
      cleanup()
      reject(new Error('Failed to open OpenClaw gateway websocket.'))
    }

    ws.addEventListener('open', handleOpen, { once: true })
    ws.addEventListener('error', handleError, { once: true })
  })
  return ws
}

async function connectGatewaySocket(ws: WebSocket, gatewayToken: string): Promise<void> {
  const response = await waitForGatewayResponse(ws, {
    requestId: crypto.randomUUID(),
    params: {
      minProtocol: GATEWAY_PROTOCOL_VERSION,
      maxProtocol: GATEWAY_PROTOCOL_VERSION,
      client: {
        id: 'gateway-client',
        version: '1.0.0',
        platform: 'overlay-nextjs',
        mode: 'backend',
      },
      role: 'operator',
      scopes: ['operator.admin', 'operator.read', 'operator.write'],
      auth: {
        token: gatewayToken,
      },
    },
    method: 'connect',
  })

  const payload =
    response.payload && typeof response.payload === 'object'
      ? (response.payload as { type?: string })
      : null

  if (payload?.type !== 'hello-ok') {
    throw new Error('OpenClaw gateway websocket handshake failed.')
  }
}

async function runGatewayAgentStream(
  ws: WebSocket,
  params: {
    message: string
    sessionKey: string
    model?: string | null
    onText: (delta: string) => void
  }
): Promise<string> {
  const requestId = crypto.randomUUID()
  const idempotencyKey = crypto.randomUUID()
  let assistantText = ''

  return await new Promise<string>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      cleanup()
      reject(new Error('OpenClaw request timed out after 4 minutes.'))
    }, 240_000)
    let runId: string | null = null
    let accepted = false

    const cleanup = () => {
      clearTimeout(timeoutId)
      ws.removeEventListener('message', handleMessage)
      ws.removeEventListener('error', handleError)
      ws.removeEventListener('close', handleClose)
    }

    const finish = (value: string) => {
      cleanup()
      resolve(value)
    }

    const fail = (error: Error) => {
      cleanup()
      reject(error)
    }

    const handleError = () => {
      fail(new Error('OpenClaw gateway websocket errored during the run.'))
    }

    const handleClose = () => {
      fail(new Error('OpenClaw gateway websocket closed before the run completed.'))
    }

    const handleMessage = (event: MessageEvent) => {
      const frame = parseGatewayFrame(event.data)
      if (!frame) {
        return
      }

      if (isGatewayEventFrame(frame) && frame.event === 'agent') {
        const payload = frame.payload
        if (!accepted || !runId || payload?.runId !== runId) {
          return
        }

        if (payload.stream === 'assistant') {
          const delta = extractGatewayAssistantDelta(payload, assistantText)
          if (!delta) {
            return
          }
          assistantText += delta
          params.onText(delta)
        }
        return
      }

      if (!isGatewayResponseFrame(frame) || frame.id !== requestId) {
        return
      }

      if (!accepted) {
        if (!frame.ok) {
          fail(buildGatewayResponseError(frame, 'OpenClaw rejected the chat request.'))
          return
        }

        const payload =
          frame.payload && typeof frame.payload === 'object'
            ? (frame.payload as GatewayAgentAcceptedPayload)
            : null
        const nextRunId = payload?.runId?.trim()
        if (!nextRunId) {
          fail(new Error('OpenClaw did not return a run ID for this chat request.'))
          return
        }

        runId = nextRunId
        accepted = true
        return
      }

      if (!frame.ok) {
        fail(buildGatewayResponseError(frame, 'OpenClaw run failed.'))
        return
      }

      const payload =
        frame.payload && typeof frame.payload === 'object'
          ? (frame.payload as GatewayAgentFinalPayload)
          : null

      if (payload?.status === 'error') {
        fail(new Error(payload.summary || 'OpenClaw run failed.'))
        return
      }

      if (!assistantText) {
        const resultText = extractGatewayResultText(payload?.result)
        if (resultText) {
          assistantText = resultText
          params.onText(resultText)
        }
      }

      finish(assistantText.trim())
    }

    ws.addEventListener('message', handleMessage)
    ws.addEventListener('error', handleError)
    ws.addEventListener('close', handleClose)

    ws.send(
      JSON.stringify({
        type: 'req',
        id: requestId,
        method: 'agent',
        params: {
          message: params.message,
          sessionKey: params.sessionKey,
          deliver: false,
          timeout: 240,
          idempotencyKey,
          ...(params.model ? { model: params.model } : {}),
        },
      })
    )
  })
}

async function waitForGatewayResponse(
  ws: WebSocket,
  params: {
    method: string
    requestId: string
    params?: unknown
  }
): Promise<GatewayResponseFrame> {
  return await new Promise<GatewayResponseFrame>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out waiting for OpenClaw websocket response to ${params.method}.`))
    }, 30_000)

    const cleanup = () => {
      clearTimeout(timeoutId)
      ws.removeEventListener('message', handleMessage)
      ws.removeEventListener('error', handleError)
      ws.removeEventListener('close', handleClose)
    }

    const handleError = () => {
      cleanup()
      reject(new Error(`OpenClaw websocket errored during ${params.method}.`))
    }

    const handleClose = () => {
      cleanup()
      reject(new Error(`OpenClaw websocket closed during ${params.method}.`))
    }

    const handleMessage = (event: MessageEvent) => {
      const frame = parseGatewayFrame(event.data)
      if (!frame || !isGatewayResponseFrame(frame) || frame.id !== params.requestId) {
        return
      }
      cleanup()
      if (!frame.ok) {
        reject(buildGatewayResponseError(frame, `OpenClaw ${params.method} request failed.`))
        return
      }
      resolve(frame)
    }

    ws.addEventListener('message', handleMessage)
    ws.addEventListener('error', handleError)
    ws.addEventListener('close', handleClose)
    ws.send(
      JSON.stringify({
        type: 'req',
        id: params.requestId,
        method: params.method,
        params: params.params,
      })
    )
  })
}

function parseGatewayFrame(rawData: unknown): GatewayResponseFrame | GatewayEventFrame | null {
  if (typeof rawData === 'string') {
    return parseGatewayFrameText(rawData)
  }

  if (rawData instanceof ArrayBuffer) {
    return parseGatewayFrameText(new TextDecoder().decode(rawData))
  }

  if (ArrayBuffer.isView(rawData)) {
    return parseGatewayFrameText(
      new TextDecoder().decode(rawData.buffer.slice(rawData.byteOffset, rawData.byteOffset + rawData.byteLength))
    )
  }

  return null
}

function parseGatewayFrameText(text: string): GatewayResponseFrame | GatewayEventFrame | null {
  if (!text.trim()) {
    return null
  }

  try {
    return JSON.parse(text) as GatewayResponseFrame | GatewayEventFrame
  } catch {
    return null
  }
}

function isGatewayResponseFrame(frame: GatewayResponseFrame | GatewayEventFrame): frame is GatewayResponseFrame {
  return frame.type === 'res'
}

function isGatewayEventFrame(frame: GatewayResponseFrame | GatewayEventFrame): frame is GatewayEventFrame {
  return frame.type === 'event'
}

function extractGatewayAssistantDelta(
  payload: GatewayAgentEventPayload,
  accumulatedText: string
): string {
  const delta = payload.data?.delta
  if (typeof delta === 'string' && delta.length > 0) {
    return delta
  }

  const text = payload.data?.text
  if (typeof text !== 'string' || text.length === 0) {
    return ''
  }

  if (accumulatedText && text.startsWith(accumulatedText)) {
    return text.slice(accumulatedText.length)
  }

  return text
}

function extractGatewayResultText(result: unknown): string {
  if (!result || typeof result !== 'object') {
    return ''
  }

  const payloads = Array.isArray((result as { payloads?: unknown[] }).payloads)
    ? (result as { payloads: Array<{ text?: unknown }> }).payloads
    : []

  return payloads
    .map((payload) => (typeof payload?.text === 'string' ? payload.text : ''))
    .join('\n')
    .trim()
}

function buildGatewayResponseError(frame: GatewayResponseFrame, fallbackMessage: string): Error {
  const payload =
    frame.payload && typeof frame.payload === 'object'
      ? (frame.payload as { summary?: string; status?: string })
      : null

  return new Error(payload?.summary || frame.error?.message || fallbackMessage)
}

async function readGatewaySessionModel(params: {
  ip: string
  gatewayToken: string
  sessionKey: string
}): Promise<GatewaySessionModelState | null> {
  return await invokeSessionStatusTool({
    ip: params.ip,
    gatewayToken: params.gatewayToken,
    sessionKey: params.sessionKey,
  })
}

async function invokeSessionStatusTool(params: {
  ip: string
  gatewayToken: string
  sessionKey: string
  model?: string
}): Promise<GatewaySessionModelState | null> {
  const response = await fetch(`http://${params.ip}:18789/tools/invoke`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.gatewayToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      tool: 'session_status',
      sessionKey: params.sessionKey,
      args: {
        sessionKey: params.sessionKey,
        ...(params.model ? { model: params.model } : {}),
      },
    }),
    signal: AbortSignal.timeout(30_000),
  })

  if (!response.ok) {
    return null
  }

  try {
    const body = (await response.json()) as ToolInvokeResponse<SessionStatusToolResult>
    if (body.ok !== true) {
      return null
    }

    const statusText =
      body.result?.details?.statusText ||
      body.result?.content
        ?.filter((part) => part.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text || '')
        .join('\n') ||
      ''

    const parsed = parseModelFromStatusText(statusText)
    return {
      sessionKey: params.sessionKey,
      provider: parsed?.provider,
      model: parsed?.model,
    }
  } catch {
    return null
  }
}

function parseModelFromStatusText(statusText: string): { provider?: string; model?: string } | null {
  const modelLine = statusText
    .split('\n')
    .find((line) => line.trim().startsWith('🧠 Model:'))

  if (!modelLine) {
    return null
  }

  const rawLabel = modelLine.replace(/^🧠 Model:\s*/, '').split(' · ')[0]?.trim()
  if (!rawLabel) {
    return null
  }

  const slashIndex = rawLabel.indexOf('/')
  if (slashIndex === -1) {
    return { model: rawLabel }
  }

  return {
    provider: rawLabel.slice(0, slashIndex).trim() || undefined,
    model: rawLabel.slice(slashIndex + 1).trim() || undefined,
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') {
    return 'OpenClaw request timed out after 4 minutes.'
  }
  return error instanceof Error ? error.message : 'Computer chat request failed'
}
