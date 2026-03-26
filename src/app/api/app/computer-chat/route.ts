import { NextRequest, NextResponse } from 'next/server'
import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from 'ai'
import { getInternalApiSecret } from '@/lib/internal-api-secret'
import { convex } from '@/lib/convex'
import {
  attachDevelopmentGatewayDeviceIdentity,
  buildGatewayConnectDevice,
  type GatewayDeviceIdentity,
} from '@/lib/openclaw-gateway-device'
import { getSession } from '@/lib/workos-auth'
import { DEFAULT_MODEL_ID, getModel } from '@/lib/models'
import { calculateTokenCost, isPremiumModel } from '@/lib/model-pricing'

export const maxDuration = 300
const GATEWAY_PROTOCOL_VERSION = 3

interface Entitlements {
  tier: 'free' | 'pro' | 'max'
  creditsUsed: number
  creditsTotal: number
  dailyUsage: { ask: number; write: number; agent: number }
}

interface ComputerConnectionInfo {
  gatewayToken: string
  hooksToken: string
  hetznerServerIp: string
  gatewayDeviceIdentity?: GatewayDeviceIdentity
}

interface GatewaySessionModelState {
  sessionKey: string
  provider?: string
  model?: string
  tokenSnapshot?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    cacheRead: number
  }
}

interface GatewaySessionsPatchPayload {
  ok?: boolean
  key?: string
  resolved?: {
    modelProvider?: string
    model?: string
  }
}

interface GatewaySessionsListPayload {
  sessions?: Array<{
    key?: string
    modelProvider?: string | null
    model?: string | null
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
    cacheRead?: number
  }>
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

interface GatewayChatAcceptedPayload {
  runId?: string
  status?: string
}

interface GatewayChatFinalPayload extends GatewayChatAcceptedPayload {
  summary?: string
  result?: unknown
  message?: OpenClawTranscriptMessage
}

interface GatewayChatEventPayload {
  runId?: string
  sessionKey?: string
  state?: 'delta' | 'final' | 'aborted' | 'error'
  seq?: number
  message?: OpenClawTranscriptMessage
  errorMessage?: string
}

interface StreamResult {
  text: string
  usage: OpenClawTranscriptUsage | null
}

interface GatewayEventFrame {
  type?: string
  event?: string
  payload?: GatewayChatEventPayload
}

interface OpenClawTranscriptUsage {
  input?: number
  output?: number
  totalTokens?: number
  inputTokens?: number
  outputTokens?: number
  cacheRead?: number
  cacheWrite?: number
  /** AI SDK / provider-style aliases (Vercel AI Gateway, OpenAI, etc.) */
  promptTokens?: number
  completionTokens?: number
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

interface OpenClawTranscriptMessage {
  role?: string
  provider?: string
  model?: string
  text?: string
  content?: string | Array<{
    type?: string
    text?: string
  }>
  usage?: OpenClawTranscriptUsage
  cost?: {
    total?: number
  }
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

interface AuthenticatedComputerContext {
  serverSecret: string
  computerId: string
  connection: ComputerConnectionInfo
  persistedRequestedModelId?: string
  persistedSessionKey?: string
  userId: string
}

export async function POST(request: NextRequest) {
  try {
    const { messages, computerId, modelId, sessionKey: requestedSessionKey }: {
      messages: UIMessage[]
      computerId?: string
      modelId?: string
      sessionKey?: string
    } = await request.json()

    if (!computerId) {
      return NextResponse.json({ error: 'Computer ID is required' }, { status: 400 })
    }

    const latestUserText = extractLatestUserText(messages)
    if (!latestUserText) {
      return NextResponse.json({ error: 'Message cannot be empty' }, { status: 400 })
    }

    const { serverSecret, connection, persistedRequestedModelId, persistedSessionKey, userId } =
      await getAuthenticatedComputerContext(computerId)
    let activeConnection = connection

    const sessionKey =
      requestedSessionKey?.trim() ||
      persistedSessionKey?.trim() ||
      buildFallbackComputerSessionKey(computerId)
    const selectedModelId =
      modelId?.trim() || persistedRequestedModelId?.trim() || DEFAULT_MODEL_ID
    const requestedModelRef =
      resolveOpenClawModelRef(selectedModelId) ?? resolveOpenClawModelRef(DEFAULT_MODEL_ID)
    let sessionModelBefore = await readGatewaySessionModel({
      ip: activeConnection.hetznerServerIp,
      gatewayToken: activeConnection.gatewayToken,
      gatewayDeviceIdentity: activeConnection.gatewayDeviceIdentity,
      sessionKey,
    }).catch(() => null)

    // ── Subscription enforcement ──────────────────────────────────────────────────
    const entitlements = await convex.query<Entitlements>('usage:getEntitlementsByServer', {
      serverSecret,
      userId,
    })

    if (!entitlements) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Could not verify subscription. Try signing out and back in.' },
        { status: 401 },
      )
    }

    const { tier, creditsUsed, creditsTotal } = entitlements
    const creditsTotalCents = creditsTotal * 100
    const remainingCents = creditsTotalCents - creditsUsed
    const usedPct = creditsTotalCents > 0 ? ((creditsUsed / creditsTotalCents) * 100).toFixed(2) : '0.00'
    console.log(`[Computer Chat] 📊 Entitlements: tier=${tier} | used=${creditsUsed}¢ / ${creditsTotalCents}¢ (${usedPct}% used, $${(remainingCents / 100).toFixed(4)} remaining) | model=${selectedModelId} | userId=${userId}`)
    if (tier === 'free') {
      return NextResponse.json(
        { error: 'subscription_required', message: 'Computer chat requires a Pro or Max subscription.' },
        { status: 403 }
      )
    }
    if (remainingCents <= 0 && isPremiumModel(selectedModelId)) {
      console.log(`[Computer Chat] ⛔ Blocked: no credits remaining (${creditsUsed}¢ / ${creditsTotalCents}¢) | model=${selectedModelId}`)
      return NextResponse.json(
        { error: 'insufficient_credits', message: 'No credits remaining. Please check your subscription.' },
        { status: 402 }
      )
    }

    console.log('[Computer Chat API][Debug] POST start', {
      computerId,
      sessionKey,
      latestUserText,
      requestedModelIdFromBody: modelId?.trim() || null,
      persistedRequestedModelId: persistedRequestedModelId?.trim() || null,
      selectedModelId,
      requestedModelRef,
      sessionModelBefore,
    })

    if (!/^\/model\b/i.test(latestUserText)) {
      const appliedSessionModel = await applyPreferredModel({
        ip: activeConnection.hetznerServerIp,
        gatewayToken: activeConnection.gatewayToken,
        gatewayDeviceIdentity: activeConnection.gatewayDeviceIdentity,
        sessionKey,
        modelId: selectedModelId,
        modelRef: requestedModelRef,
      }).catch((error) => {
        console.warn('[Computer Chat API] Failed to sync OpenClaw session model before POST:', {
          sessionKey,
          selectedModelId,
          requestedModelRef,
          error: getErrorMessage(error),
        })
        return null
      })

      if (appliedSessionModel) {
        sessionModelBefore = appliedSessionModel
      }
    }

    await convex.mutation(
      'computers:addChatMessage',
      {
        computerId,
        userId,
        serverSecret,
        role: 'user',
        content: latestUserText,
        sessionKey,
      },
      { throwOnError: true, timeoutMs: 30_000 }
    )

    const baselineHistory = await fetchSessionHistorySnapshot({
      ip: activeConnection.hetznerServerIp,
      gatewayToken: activeConnection.gatewayToken,
      gatewayDeviceIdentity: activeConnection.gatewayDeviceIdentity,
      sessionKey,
    })
    const baselineSeq = getHighestTranscriptSeq(baselineHistory.messages)
    const baselineHasConversationHistory = hasRealConversationHistory(baselineHistory.messages)
    const hookMessage = buildHookMessage({
      messages,
      latestUserText,
      sessionHasConversationHistory: baselineHasConversationHistory,
    })

    console.log('[Computer Chat API][Debug] POST baseline', {
      computerId,
      sessionKey,
      baselineSeq,
      baselineHistoryCount: baselineHistory.messages.length,
      baselineHasConversationHistory,
      baselineTail: summarizeTranscriptTail(baselineHistory.messages),
      hookMessagePreview: hookMessage.slice(0, 240),
    })

    const stream = createUIMessageStream<UIMessage>({
      originalMessages: messages,
      execute: async ({ writer }) => {
        const textId = crypto.randomUUID()
        let assistantText = ''

        try {
          writer.write({ type: 'text-start', id: textId })

          const sessionTokensBeforeRun = await readGatewaySessionModel({
            ip: activeConnection.hetznerServerIp,
            gatewayToken: activeConnection.gatewayToken,
            gatewayDeviceIdentity: activeConnection.gatewayDeviceIdentity,
            sessionKey,
          }).catch(() => null)

          let streamResult: StreamResult
          try {
            streamResult = await streamAssistantReplyFromGateway({
              ip: activeConnection.hetznerServerIp,
              gatewayToken: activeConnection.gatewayToken,
              sessionKey,
              message: hookMessage,
              onText: (delta) => {
                if (!delta) return
                writer.write({ type: 'text-delta', id: textId, delta })
              },
            })
          } catch (error) {
            if (!isGatewayAuthenticationFailure(error)) {
              throw error
            }

            const refreshedContext = await getAuthenticatedComputerContext(computerId)
            const refreshedConnection = refreshedContext.connection
            console.warn('[Computer Chat API] Retrying POST with refreshed gateway connection after auth failure:', {
              computerId,
              sessionKey,
              previousIp: activeConnection.hetznerServerIp,
              refreshedIp: refreshedConnection.hetznerServerIp,
              sameToken: activeConnection.gatewayToken === refreshedConnection.gatewayToken,
              sameIp: activeConnection.hetznerServerIp === refreshedConnection.hetznerServerIp,
            })
            activeConnection = refreshedConnection

            streamResult = await streamAssistantReplyFromGateway({
              ip: activeConnection.hetznerServerIp,
              gatewayToken: activeConnection.gatewayToken,
              sessionKey,
              message: hookMessage,
              onText: (delta) => {
                if (!delta) return
                writer.write({ type: 'text-delta', id: textId, delta })
              },
            })
          }
          assistantText = streamResult.text

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
              serverSecret,
              role: 'assistant',
              content: finalText,
              sessionKey,
            },
            { throwOnError: true, timeoutMs: 30_000 }
          )

          const latestHistory = await fetchSessionHistorySnapshot({
            ip: activeConnection.hetznerServerIp,
            gatewayToken: activeConnection.gatewayToken,
            gatewayDeviceIdentity: activeConnection.gatewayDeviceIdentity,
            sessionKey,
          }).catch(() => null)
          const latestAssistantMessage = latestHistory
            ? findAssistantMessageAfterSeq(latestHistory, baselineSeq)
            : null
          const latestSessionModel = await readGatewaySessionModel({
            ip: activeConnection.hetznerServerIp,
            gatewayToken: activeConnection.gatewayToken,
            gatewayDeviceIdentity: activeConnection.gatewayDeviceIdentity,
            sessionKey,
          }).catch(() => null)

          console.log('[Computer Chat API][Debug] POST finish', {
            computerId,
            sessionKey,
            selectedModelId,
            requestedModelRef,
            finalTextPreview: finalText.slice(0, 240),
            latestAssistantMessage: latestAssistantMessage
              ? {
                  role: latestAssistantMessage.role,
                  provider: latestAssistantMessage.provider,
                  model: latestAssistantMessage.model,
                  text: extractTranscriptMessageText(latestAssistantMessage).slice(0, 200),
                  usage: extractTranscriptMessageUsage(latestAssistantMessage),
                  seq: latestAssistantMessage.__openclaw?.seq ?? null,
                }
              : null,
            latestSessionModel,
            latestHistoryTail: latestHistory ? summarizeTranscriptTail(latestHistory.messages) : [],
          })

          // ── Usage recording ────────────────────────────────────────────────────
          const streamUsage = streamResult.usage
          const transcriptUsage = latestAssistantMessage
            ? (latestAssistantMessage.usage ?? null)
            : null
          const outputText = latestAssistantMessage
            ? extractTranscriptMessageText(latestAssistantMessage)
            : finalText

          const billing = resolveComputerChatBillingTokens({
            streamUsage,
            transcriptUsage,
            baselineMessages: baselineHistory.messages,
            latestUserText,
            assistantTextForCharEst: outputText || finalText,
            sessionBefore: sessionTokensBeforeRun?.tokenSnapshot,
            sessionAfter: latestSessionModel?.tokenSnapshot,
          })

          const finalInputTokens = billing.inputTokens
          const finalOutputTokens = billing.outputTokens
          const finalCacheRead = billing.cacheRead

          const costDollars = calculateTokenCost(selectedModelId, finalInputTokens, finalCacheRead, finalOutputTokens)
          const costCents = Math.ceil(costDollars * 100)
          console.log(
            `[Computer Chat] 💰 Cost (${billing.source}): model=${selectedModelId} | ` +
            `in=${finalInputTokens} out=${finalOutputTokens} cacheRead=${finalCacheRead} | ` +
            `$${costDollars.toFixed(4)} = ${costCents}¢`
          )
          console.log('[Computer Chat] 💳 Usage detail', {
            note:
              'transcriptUsageNorm.input is the raw gateway/OpenClaw field (often hook-sized, not full prompt). ' +
              'Billed input is inputBreakdown.billedInputTokens (max of transcript floor vs implied prompt from message total−output when sane).',
            transcriptChars: billing.transcriptChars,
            transcriptFloorOnly: billing.transcriptTokenFloor,
            streamUsage: streamUsage ? normalizeOpenClawUsage(streamUsage) : null,
            transcriptUsageNorm: transcriptUsage ? normalizeOpenClawUsage(transcriptUsage) : null,
            inputBreakdown: billing.inputBreakdown,
            sessionOutDelta:
              sessionTokensBeforeRun?.tokenSnapshot?.outputTokens != null &&
              latestSessionModel?.tokenSnapshot?.outputTokens != null
                ? latestSessionModel.tokenSnapshot.outputTokens -
                  sessionTokensBeforeRun.tokenSnapshot.outputTokens
                : null,
          })
          if (costCents > 0) {
            try {
              await convex.mutation('usage:recordBatch', {
                serverSecret,
                userId,
                events: [{
                  type: 'ask',
                  modelId: selectedModelId,
                  inputTokens: finalInputTokens,
                  outputTokens: finalOutputTokens,
                  cachedTokens: finalCacheRead,
                  cost: costCents,
                  timestamp: Date.now(),
                }],
              })
              console.log(`[Computer Chat] ✅ Usage recorded: ${costCents}¢ for model=${selectedModelId}`)
              const afterEntitlements = await convex.query<Entitlements>('usage:getEntitlementsByServer', {
                serverSecret,
                userId,
              })
              if (afterEntitlements) {
                const totalC = afterEntitlements.creditsTotal * 100
                const usedPct =
                  totalC > 0
                    ? ((afterEntitlements.creditsUsed / totalC) * 100).toFixed(2)
                    : '0.00'
                console.log(
                  `[Computer Chat] 📊 Credits after record: used=${afterEntitlements.creditsUsed}¢ / ${totalC}¢ ` +
                  `(${usedPct}% used, $${((totalC - afterEntitlements.creditsUsed) / 100).toFixed(4)} remaining)`
                )
              }
            } catch (err) {
              console.error('[Computer Chat] Failed to record usage:', err)
            }
          } else {
            console.log(`[Computer Chat] ⚠️  Cost is 0¢ for model=${selectedModelId} — free model or no pricing data`)
          }

          await convex.mutation(
            'computers:setChatRuntimeState',
            {
              computerId,
              userId,
              serverSecret,
              sessionKey: latestSessionModel?.sessionKey ?? sessionKey,
              requestedModelId: selectedModelId,
              requestedModelRef: requestedModelRef ?? undefined,
              effectiveProvider: latestSessionModel?.provider ?? latestAssistantMessage?.provider,
              effectiveModel: latestSessionModel?.model ?? latestAssistantMessage?.model,
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
              serverSecret,
              message: `Error: ${message}`,
              sessionKey,
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

export async function PATCH(request: NextRequest) {
  try {
    const {
      computerId,
      modelId,
      sessionKey: requestedSessionKey,
    }: {
      computerId?: string
      modelId?: string
      sessionKey?: string
    } = await request.json()

    if (!computerId) {
      return NextResponse.json({ error: 'Computer ID is required' }, { status: 400 })
    }

    const selectedModelId = modelId?.trim() || DEFAULT_MODEL_ID
    const requestedModelRef =
      resolveOpenClawModelRef(selectedModelId) ?? resolveOpenClawModelRef(DEFAULT_MODEL_ID)

    if (!requestedModelRef) {
      return NextResponse.json({ error: 'Unknown model selection' }, { status: 400 })
    }

    const { serverSecret, connection, persistedSessionKey, userId } =
      await getAuthenticatedComputerContext(computerId)
    const sessionKey =
      requestedSessionKey?.trim() ||
      persistedSessionKey?.trim() ||
      buildFallbackComputerSessionKey(computerId)
    const sessionModelBefore = await readGatewaySessionModel({
      ip: connection.hetznerServerIp,
      gatewayToken: connection.gatewayToken,
      gatewayDeviceIdentity: connection.gatewayDeviceIdentity,
      sessionKey,
    }).catch(() => null)

    console.log('[Computer Chat API][Debug] PATCH start', {
      computerId,
      sessionKey,
      selectedModelId,
      requestedModelRef,
      sessionModelBefore,
    })

    const appliedSessionModel = await applyPreferredModel({
      ip: connection.hetznerServerIp,
      gatewayToken: connection.gatewayToken,
      gatewayDeviceIdentity: connection.gatewayDeviceIdentity,
      sessionKey,
      modelId: selectedModelId,
      modelRef: requestedModelRef,
    })

    const latestSessionModel =
      appliedSessionModel ||
      (await readGatewaySessionModel({
        ip: connection.hetznerServerIp,
        gatewayToken: connection.gatewayToken,
        gatewayDeviceIdentity: connection.gatewayDeviceIdentity,
        sessionKey,
      }).catch(() => null))
    const latestHistory = await fetchSessionHistorySnapshot({
      ip: connection.hetznerServerIp,
      gatewayToken: connection.gatewayToken,
      gatewayDeviceIdentity: connection.gatewayDeviceIdentity,
      sessionKey,
    }).catch(() => null)

    console.log('[Computer Chat API][Debug] PATCH finish', {
      computerId,
      sessionKey,
      selectedModelId,
      requestedModelRef,
      latestSessionModel,
      latestHistoryTail: latestHistory ? summarizeTranscriptTail(latestHistory.messages) : [],
    })

    await convex.mutation(
      'computers:setChatRuntimeState',
      {
        computerId,
        userId,
        serverSecret,
        sessionKey: latestSessionModel?.sessionKey ?? sessionKey,
        requestedModelId: selectedModelId,
        requestedModelRef: requestedModelRef ?? undefined,
        effectiveProvider: latestSessionModel?.provider,
        effectiveModel: latestSessionModel?.model,
      },
      { throwOnError: true, timeoutMs: 30_000 }
    )

    return NextResponse.json({
      ok: true,
      requestedModelId: selectedModelId,
      requestedModelRef,
      sessionKey: latestSessionModel?.sessionKey ?? sessionKey,
      effectiveProvider: latestSessionModel?.provider ?? null,
      effectiveModel: latestSessionModel?.model ?? null,
    })
  } catch (error) {
    console.error('[Computer Chat API] Model update error:', error)
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 })
  }
}

async function getAuthenticatedComputerContext(
  computerId: string
): Promise<AuthenticatedComputerContext> {
  const session = await getSession()
  if (!session) {
    throw new Error('Unauthorized')
  }

  const userId = session.user.id
  const serverSecret = getInternalApiSecret()

  const baseConnection = await convex.query<ComputerConnectionInfo>(
    'computers:getChatConnection',
    {
      computerId,
      userId,
      serverSecret,
    },
    { throwOnError: true, timeoutMs: 30_000 }
  )

  if (!baseConnection) {
    throw new Error('Computer is not ready')
  }

  const connection = await attachDevelopmentGatewayDeviceIdentity({
    computerId,
    connection: baseConnection,
  })

  const computer = await convex.query<{
    chatRequestedModelId?: string
    chatSessionKey?: string
  } | null>(
    'computers:get',
    {
      computerId,
      userId,
      serverSecret,
    },
    { throwOnError: true, timeoutMs: 30_000 }
  )

  return {
    serverSecret,
    computerId,
    connection,
    persistedRequestedModelId: computer?.chatRequestedModelId,
    persistedSessionKey: computer?.chatSessionKey,
    userId,
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
  sessionHasConversationHistory: boolean
}): string {
  void params.messages
  void params.sessionHasConversationHistory

  if (isStandaloneCommandMessage(params.latestUserText)) {
    return params.latestUserText
  }

  return params.latestUserText
}

async function fetchSessionHistorySnapshot(params: {
  ip: string
  gatewayToken: string
  gatewayDeviceIdentity?: GatewayDeviceIdentity
  sessionKey: string
}): Promise<{ sessionKey: string; messages: OpenClawTranscriptMessage[] }> {
  const ws = await openGatewaySocket(params.ip)
  try {
    await connectGatewaySocket(ws, params.gatewayToken, params.gatewayDeviceIdentity)
    const response = await waitForGatewayResponse(ws, {
      requestId: crypto.randomUUID(),
      method: 'chat.history',
      params: {
        sessionKey: params.sessionKey,
        limit: 200,
      },
    })

    const payload =
      response.payload && typeof response.payload === 'object'
        ? (response.payload as SessionHistoryResponse)
        : null

    return {
      sessionKey: payload?.sessionKey?.trim() || params.sessionKey,
      messages: payload ? normalizeTranscriptMessages(payload) : [],
    }
  } catch (error) {
    const message = getErrorMessage(error)
    if (message.includes('session not found') || message.includes('404')) {
      return { sessionKey: params.sessionKey, messages: [] }
    }
    if (shouldIgnoreGatewayReadError(error)) {
      console.warn('[Computer Chat API] Ignoring session history read failure:', {
        sessionKey: params.sessionKey,
        error: message,
      })
      return { sessionKey: params.sessionKey, messages: [] }
    }
    throw error
  } finally {
    ws.close()
  }
}

async function streamAssistantReplyFromGateway(params: {
  ip: string
  gatewayToken: string
  sessionKey: string
  message: string
  onText: (delta: string) => void
}): Promise<StreamResult> {
  const response = await fetch(`http://${params.ip}:18789/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.gatewayToken}`,
      'Content-Type': 'application/json',
      'x-openclaw-agent-id': 'default',
      'x-openclaw-session-key': params.sessionKey,
    },
    body: JSON.stringify({
      model: 'openclaw:default',
      user: params.sessionKey,
      stream: false,
      messages: [
        {
          role: 'user',
          content: params.message,
        },
      ],
    }),
    signal: AbortSignal.timeout(240_000),
  })

  if (!response.ok) {
    const responseText = await response.text().catch(() => '')
    const gatewayMessage = responseText.trim()
    if (response.status === 404) {
      throw new Error(
        'This computer was provisioned before Overlay chat support. Delete and recreate it to enable in-page OpenClaw chat.'
      )
    }
    if (response.status === 401) {
      throw new Error('OpenClaw gateway authentication failed.')
    }
    throw new Error(gatewayMessage || `OpenClaw gateway returned HTTP ${response.status}.`)
  }

  const data = (await response.json().catch(() => null)) as unknown
  const text = extractCompletionAssistantContent(data)
  if (!text) {
    throw new Error('OpenClaw returned an empty response.')
  }

  params.onText(text)
  return {
    text,
    usage: extractCompletionUsage(data),
  }
}

function normalizeTranscriptMessages(payload: SessionHistoryResponse): OpenClawTranscriptMessage[] {
  const messages = payload.messages ?? payload.items ?? []
  return Array.isArray(messages) ? messages : []
}

function extractTranscriptMessageText(message: OpenClawTranscriptMessage): string {
  if (typeof message.text === 'string') {
    return message.text.trim()
  }

  if (typeof message.content === 'string') {
    return message.content.trim()
  }

  return (
    message.content
      && Array.isArray(message.content)
      ? message.content
        ?.filter((part) => part.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text?.trim() || '')
        .filter(Boolean)
        .join('\n')
        .trim()
      : ''
  )
}

/**
 * OpenClaw injects system prompt, tools, skills metadata, and bootstrap files on every run.
 * A char-count of transcript text alone under-counts vs real provider billing.
 * @see https://docs.openclaw.ai/reference/token-use
 */
const OPENCLAW_SYSTEM_PROMPT_OVERHEAD_TOKENS = 2200

function pickFirstFinite(...vals: Array<number | undefined | null>): number | undefined {
  for (const v of vals) {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
      return v
    }
  }
  return undefined
}

/**
 * Flatten Vercel AI Gateway / AI SDK usage shapes into one numeric view.
 */
function normalizeOpenClawUsage(
  u: OpenClawTranscriptUsage | null | undefined
): { input?: number; output?: number; total?: number; cacheRead?: number } {
  if (!u) {
    return {}
  }
  const cacheRead = pickFirstFinite(u.cacheRead, u.cache_read_input_tokens)
  const input = pickFirstFinite(
    u.input,
    u.inputTokens,
    u.promptTokens,
    u.prompt_tokens
  )
  const output = pickFirstFinite(
    u.output,
    u.outputTokens,
    u.completionTokens,
    u.completion_tokens
  )
  const total = pickFirstFinite(u.totalTokens, u.total_tokens)
  return { input, output, total, cacheRead }
}

function mergeUsagePreferStream(
  stream: OpenClawTranscriptUsage | null,
  transcript: OpenClawTranscriptUsage | null
): OpenClawTranscriptUsage | null {
  if (!stream && !transcript) {
    return null
  }
  if (!stream) {
    return transcript
  }
  if (!transcript) {
    return stream
  }
  return { ...transcript, ...stream }
}

function impliedPromptTokensFromTotal(
  total: number,
  output: number,
  cacheRead: number
): number {
  const v = total - output - Math.max(0, cacheRead)
  return Number.isFinite(v) && v > 0 ? Math.round(v) : 0
}

function estimateTranscriptPromptTokenFloor(
  messages: OpenClawTranscriptMessage[],
  latestUserText: string
): { transcriptChars: number; tokenFloor: number } {
  let chars = 0
  for (const m of messages) {
    chars += extractTranscriptMessageText(m).length
  }
  const trimmed = latestUserText.trim()
  if (trimmed) {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')
    const lastTxt = lastUser ? extractTranscriptMessageText(lastUser).trim() : ''
    if (lastTxt !== trimmed) {
      chars += trimmed.length
    }
  }
  const tokenFloor = Math.max(1, Math.ceil(chars / 4) + OPENCLAW_SYSTEM_PROMPT_OVERHEAD_TOKENS)
  return { transcriptChars: chars, tokenFloor }
}

interface GatewayTokenSnapshotShape {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cacheRead?: number
}

/**
 * OpenClaw / gateway often report tiny `input`/`inputTokens` (e.g. hook-only) while
 * `totalTokens` and session output deltas reflect real work. Combine transcript floor,
 * normalized usage, and session output delta so subscription billing matches reality.
 */
function resolveComputerChatBillingTokens(params: {
  streamUsage: OpenClawTranscriptUsage | null
  transcriptUsage: OpenClawTranscriptUsage | null
  baselineMessages: OpenClawTranscriptMessage[]
  latestUserText: string
  assistantTextForCharEst: string
  sessionBefore: GatewayTokenSnapshotShape | null | undefined
  sessionAfter: GatewayTokenSnapshotShape | null | undefined
}): {
  inputTokens: number
  outputTokens: number
  cacheRead: number
  source: string
  transcriptChars: number
  transcriptTokenFloor: number
  /** Why billed input can differ from `transcriptUsageNorm.input` in logs */
  inputBreakdown: {
    providerReportedInputTokens: number | undefined
    messageTotalTokens: number | undefined
    outputUsedForImpliedPrompt: number | undefined
    impliedPromptTokens: number
    transcriptTokenFloor: number
    billedInputTokens: number
  }
} {
  const merged = normalizeOpenClawUsage(
    mergeUsagePreferStream(params.streamUsage, params.transcriptUsage) ?? undefined
  )

  const { transcriptChars, tokenFloor: transcriptTokenFloor } = estimateTranscriptPromptTokenFloor(
    params.baselineMessages,
    params.latestUserText
  )

  let outputFromSessionDelta: number | undefined
  if (
    params.sessionBefore &&
    params.sessionAfter &&
    typeof params.sessionBefore.outputTokens === 'number' &&
    typeof params.sessionAfter.outputTokens === 'number' &&
    params.sessionAfter.outputTokens >= params.sessionBefore.outputTokens
  ) {
    outputFromSessionDelta = params.sessionAfter.outputTokens - params.sessionBefore.outputTokens
  }

  const charOutputEst = Math.max(1, Math.ceil(params.assistantTextForCharEst.length / 4))
  const reportedOut = merged.output
  const finalOutput = pickFirstFinite(outputFromSessionDelta, reportedOut, charOutputEst) ?? charOutputEst

  const reportedIn = merged.input
  const total = merged.total
  const cacheRead = merged.cacheRead ?? 0

  let impliedIn = 0
  const outForImplied = pickFirstFinite(reportedOut, finalOutput)
  if (total !== undefined && outForImplied !== undefined && total > outForImplied) {
    impliedIn = impliedPromptTokensFromTotal(total, outForImplied, cacheRead)
  }
  const inputBreakdown = {
    providerReportedInputTokens: reportedIn,
    messageTotalTokens: total,
    outputUsedForImpliedPrompt: outForImplied,
    impliedPromptTokens: impliedIn,
    transcriptTokenFloor,
    billedInputTokens: 0,
  }

  const reportedInputSuspicious =
    reportedIn !== undefined && reportedIn < 48 && transcriptTokenFloor > 600

  const impliedUpperBound = Math.floor(transcriptTokenFloor * 3) + 8000
  const impliedConsistentWithTranscript =
    impliedIn > 0 &&
    impliedIn >= Math.floor(transcriptTokenFloor * 0.35) &&
    impliedIn <= impliedUpperBound

  const inputParts: number[] = [transcriptTokenFloor]
  if (reportedIn !== undefined && reportedIn > 0 && !reportedInputSuspicious) {
    inputParts.push(reportedIn)
  }
  if (impliedConsistentWithTranscript) {
    inputParts.push(impliedIn)
  }

  const inputTokens = Math.max(...inputParts)
  inputBreakdown.billedInputTokens = inputTokens

  const parts: string[] = []
  if (outputFromSessionDelta !== undefined && outputFromSessionDelta > 0) {
    parts.push('session-output-delta')
  }
  if (merged.input !== undefined || merged.output !== undefined) {
    parts.push('normalized-usage')
  }
  if (reportedInputSuspicious) {
    parts.push('ignored-suspicious-input')
  }
  if (impliedConsistentWithTranscript) {
    parts.push('implied-from-total')
  }
  parts.push('transcript-floor')

  return {
    inputTokens,
    outputTokens: Math.max(1, finalOutput),
    cacheRead,
    source: parts.filter(Boolean).join('+'),
    transcriptChars,
    transcriptTokenFloor,
    inputBreakdown,
  }
}

function extractTranscriptMessageUsage(message: OpenClawTranscriptMessage): {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
} | null {
  const usage = message.usage
  if (!usage) {
    return null
  }

  const n = normalizeOpenClawUsage(usage)
  if (n.input === undefined && n.output === undefined && n.cacheRead === undefined) {
    return null
  }

  return {
    inputTokens: n.input,
    outputTokens: n.output,
    cacheReadTokens: n.cacheRead,
  }
}

function summarizeTranscriptTail(messages: OpenClawTranscriptMessage[], limit = 4) {
  return messages.slice(-limit).map((message) => ({
    role: message.role ?? null,
    provider: message.provider ?? null,
    model: message.model ?? null,
    seq: message.__openclaw?.seq ?? null,
    text: extractTranscriptMessageText(message).slice(0, 160),
  }))
}

function hasRealConversationHistory(messages: OpenClawTranscriptMessage[]): boolean {
  return messages.some((message) => {
    if (message.role !== 'user') {
      return false
    }

    const text = extractTranscriptMessageText(message)
    return Boolean(text) && !isStandaloneCommandMessage(text)
  })
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

  if (Array.isArray(payload)) {
    candidates.push(...payload)
  } else if (payload && typeof payload === 'object') {
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

function buildFallbackComputerSessionKey(computerId: string): string {
  return `agent:main:dashboard:overlay:computer:${computerId}:${crypto.randomUUID()}`
}

function isStandaloneCommandMessage(value: string): boolean {
  const trimmed = value.trim()
  return /^\/[^\s]+(?:\s.*)?$/.test(trimmed) || /^![\s\S]+$/.test(trimmed)
}

function resolveOpenClawModelRef(modelId: string): string | null {
  const model = getModel(modelId)
  return model?.openClawRef ?? null
}

function resolveOpenClawSessionModelCandidates(modelId: string): string[] {
  const candidates = new Set<string>()
  const model = getModel(modelId)
  const trimmedId = modelId.trim()
  if (trimmedId) {
    candidates.add(trimmedId)
  }
  const ref = model?.openClawRef?.trim()
  if (ref) {
    candidates.add(ref)
    const strippedGatewayPrefix = ref.replace(/^vercel-ai-gateway\//, '').trim()
    if (strippedGatewayPrefix) {
      candidates.add(strippedGatewayPrefix)
    }
  }
  return [...candidates]
}

async function applyPreferredModel(params: {
  ip: string
  gatewayToken: string
  gatewayDeviceIdentity?: GatewayDeviceIdentity
  sessionKey: string
  modelId: string
  modelRef: string | null
}): Promise<GatewaySessionModelState | null> {
  const candidates = resolveOpenClawSessionModelCandidates(params.modelId)
  let lastError: Error | null = null

  const ws = await openGatewaySocket(params.ip)

  try {
    try {
      await connectGatewaySocket(ws, params.gatewayToken, params.gatewayDeviceIdentity)
    } catch (error) {
      if (shouldIgnoreGatewayModelPatchError(error)) {
        console.warn('[Computer Chat API] Ignoring model sync handshake failure:', {
          sessionKey: params.sessionKey,
          modelId: params.modelId,
          modelRef: params.modelRef,
          error: getErrorMessage(error),
        })
        return null
      }
      throw error
    }

    for (const candidate of candidates) {
      try {
        const response = await waitForGatewayResponse(ws, {
          requestId: crypto.randomUUID(),
          method: 'sessions.patch',
          params: {
            key: params.sessionKey,
            model: candidate,
          },
        })

        const payload =
          response.payload && typeof response.payload === 'object'
            ? (response.payload as GatewaySessionsPatchPayload)
            : null

        const modelState = {
          sessionKey: payload?.key?.trim() || params.sessionKey,
          provider: payload?.resolved?.modelProvider?.trim() || undefined,
          model: payload?.resolved?.model?.trim() || undefined,
        }

        console.log('[Computer Chat API] OpenClaw model switched via sessions.patch:', {
          sessionKey: params.sessionKey,
          canonicalSessionKey: modelState.sessionKey,
          modelId: params.modelId,
          attemptedModel: candidate,
          modelRef: params.modelRef,
          resolvedProvider: modelState.provider ?? null,
          resolvedModel: modelState.model ?? null,
        })

        return modelState
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(getErrorMessage(error))
        if (shouldIgnoreGatewayModelPatchError(lastError)) {
          console.warn('[Computer Chat API] Ignoring model sync failure:', {
            sessionKey: params.sessionKey,
            modelId: params.modelId,
            attemptedModel: candidate,
            modelRef: params.modelRef,
            error: getErrorMessage(lastError),
          })
          return null
        }
        console.warn('[Computer Chat API] OpenClaw sessions.patch model candidate failed:', {
          sessionKey: params.sessionKey,
          modelId: params.modelId,
          attemptedModel: candidate,
          modelRef: params.modelRef,
          error: getErrorMessage(lastError),
        })
      }
    }
  } finally {
    ws.close()
  }

  if (lastError) {
    throw lastError
  }
  return null
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

async function connectGatewaySocket(
  ws: WebSocket,
  gatewayToken: string,
  gatewayDeviceIdentity?: GatewayDeviceIdentity
): Promise<void> {
  const challenge = await waitForGatewayConnectChallenge(ws)
  const nonce = challenge?.nonce?.trim() || ''
  const authVariants = [
    { token: gatewayToken, password: gatewayToken },
    { password: gatewayToken },
    { token: gatewayToken },
  ]
  const clientId = gatewayDeviceIdentity?.clientId?.trim() || 'gateway-client'
  const clientMode = gatewayDeviceIdentity?.clientMode?.trim() || 'backend'
  const platform = gatewayDeviceIdentity?.platform?.trim() || process.platform
  const deviceFamily = gatewayDeviceIdentity?.deviceFamily?.trim() || undefined
  let response: GatewayResponseFrame | null = null
  let lastError: unknown = null

  for (const auth of authVariants) {
    try {
      const signedAtMs = Date.now()
      const device = gatewayDeviceIdentity
        ? buildGatewayConnectDevice({
            identity: gatewayDeviceIdentity,
            clientId,
            clientMode,
            role: 'operator',
            scopes: ['operator.admin', 'operator.read', 'operator.write'],
            signedAtMs,
            token: 'token' in auth ? auth.token : null,
            nonce,
            platform,
            deviceFamily,
          })
        : undefined

      response = await waitForGatewayResponse(ws, {
        requestId: crypto.randomUUID(),
        params: {
          minProtocol: GATEWAY_PROTOCOL_VERSION,
          maxProtocol: GATEWAY_PROTOCOL_VERSION,
          client: {
            id: clientId,
            version: '1.0.0',
            platform,
            deviceFamily,
            mode: clientMode,
          },
          caps: [],
          commands: [],
          permissions: {},
          role: 'operator',
          scopes: ['operator.admin', 'operator.read', 'operator.write'],
          auth,
          device,
        },
        method: 'connect',
      })
      break
    } catch (error) {
      lastError = error
      const message = getErrorMessage(error).toLowerCase()
      const shouldRetry =
        message.includes('provide gateway auth password') ||
        message.includes('gateway password missing') ||
        message.includes('provide gateway auth token') ||
        message.includes('gateway token missing')
      if (!shouldRetry) {
        throw error
      }
    }
  }

  if (!response) {
    throw (lastError instanceof Error ? lastError : new Error(getErrorMessage(lastError)))
  }

  const payload =
    response.payload && typeof response.payload === 'object'
      ? (response.payload as { type?: string })
      : null

  if (payload?.type !== 'hello-ok') {
    throw new Error('OpenClaw gateway websocket handshake failed.')
  }
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

async function waitForGatewayConnectChallenge(
  ws: WebSocket,
): Promise<{ nonce?: string; ts?: number } | null> {
  return await new Promise<{ nonce?: string; ts?: number } | null>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      cleanup()
      reject(new Error('Timed out waiting for OpenClaw connect.challenge event.'))
    }, 5_000)

    const cleanup = () => {
      clearTimeout(timeoutId)
      ws.removeEventListener('message', handleMessage)
      ws.removeEventListener('error', handleError)
      ws.removeEventListener('close', handleClose)
    }

    const handleError = () => {
      cleanup()
      reject(new Error('OpenClaw websocket errored before connect.challenge.'))
    }

    const handleClose = () => {
      cleanup()
      reject(new Error('OpenClaw websocket closed before connect.challenge.'))
    }

    const handleMessage = (event: MessageEvent) => {
      const frame = parseGatewayFrame(event.data)
      if (!frame || !isGatewayEventFrame(frame) || frame.event !== 'connect.challenge') {
        return
      }

      cleanup()
      const payload =
        frame.payload && typeof frame.payload === 'object'
          ? (frame.payload as { nonce?: string; ts?: number })
          : null
      resolve(payload)
    }

    ws.addEventListener('message', handleMessage)
    ws.addEventListener('error', handleError)
    ws.addEventListener('close', handleClose)
  })
}

function extractGatewayAssistantDelta(
  payload: GatewayChatEventPayload,
  accumulatedText: string
): string {
  const text = extractTranscriptMessageText(payload.message ?? {})
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

function extractCompletionUsage(data: unknown): OpenClawTranscriptUsage | null {
  if (!data || typeof data !== 'object') {
    return null
  }

  const usageRaw = (data as { usage?: unknown }).usage
  if (!usageRaw || typeof usageRaw !== 'object') {
    return null
  }

  const usage = usageRaw as {
    prompt_tokens?: unknown
    completion_tokens?: unknown
    total_tokens?: unknown
    prompt_tokens_details?: unknown
  }

  let cached_tokens = 0
  if (usage.prompt_tokens_details && typeof usage.prompt_tokens_details === 'object') {
    const details = usage.prompt_tokens_details as { cached_tokens?: unknown }
    cached_tokens = typeof details.cached_tokens === 'number' ? details.cached_tokens : 0
  }

  return {
    prompt_tokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0,
    completion_tokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0,
    total_tokens: typeof usage.total_tokens === 'number' ? usage.total_tokens : 0,
    cache_read_input_tokens: cached_tokens,
  }
}

function extractCompletionAssistantContent(data: unknown): string {
  if (!data || typeof data !== 'object') {
    return ''
  }

  const choices = (data as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) {
    return ''
  }

  const firstChoice = choices[0]
  if (!firstChoice || typeof firstChoice !== 'object') {
    return ''
  }

  const message = (firstChoice as { message?: unknown }).message
  if (!message || typeof message !== 'object') {
    return ''
  }

  const content = (message as { content?: unknown }).content
  if (typeof content === 'string') {
    return content.trim()
  }

  if (!Array.isArray(content)) {
    return ''
  }

  return content
    .map((part) => {
      if (!part || typeof part !== 'object') {
        return ''
      }
      const text = (part as { text?: unknown }).text
      return typeof text === 'string' ? text : ''
    })
    .join('')
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
  gatewayDeviceIdentity?: GatewayDeviceIdentity
  sessionKey: string
}): Promise<GatewaySessionModelState | null> {
  const ws = await openGatewaySocket(params.ip)
  try {
    await connectGatewaySocket(ws, params.gatewayToken, params.gatewayDeviceIdentity)
    const response = await waitForGatewayResponse(ws, {
      requestId: crypto.randomUUID(),
      method: 'sessions.list',
      params: {},
    })
    const payload =
      response.payload && typeof response.payload === 'object'
        ? (response.payload as GatewaySessionsListPayload)
        : null
    const exact = payload?.sessions?.find((session) => session.key === params.sessionKey) ?? null
    const sessionRow =
      exact ??
      payload?.sessions?.find((session) => {
        const key = session.key?.trim().toLowerCase()
        return key?.endsWith(`:${params.sessionKey.toLowerCase()}`) ?? false
      }) ??
      null

    if (!sessionRow) {
      return null
    }

    return {
      sessionKey: sessionRow.key?.trim() || params.sessionKey,
      provider: sessionRow.modelProvider?.trim() || undefined,
      model: sessionRow.model?.trim() || undefined,
      tokenSnapshot: {
        inputTokens: sessionRow.inputTokens ?? 0,
        outputTokens: sessionRow.outputTokens ?? 0,
        totalTokens: sessionRow.totalTokens ?? 0,
        cacheRead: sessionRow.cacheRead ?? 0,
      },
    }
  } catch (error) {
    if (shouldIgnoreGatewayReadError(error)) {
      console.warn('[Computer Chat API] Ignoring session model read failure:', {
        sessionKey: params.sessionKey,
        error: getErrorMessage(error),
      })
      return null
    }
    throw error
  } finally {
    ws.close()
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') {
    return 'OpenClaw request timed out after 4 minutes.'
  }
  return error instanceof Error ? error.message : 'Computer chat request failed'
}

function isGatewayAuthenticationFailure(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase()
  return (
    message.includes('gateway authentication failed') ||
    message.includes('gateway token mismatch') ||
    message.includes('provide gateway auth token') ||
    message.includes('unauthorized')
  )
}

function shouldIgnoreGatewayModelPatchError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase()
  return (
    message.includes('missing scope: operator.admin') ||
    message.includes('gateway token mismatch') ||
    message.includes('provide gateway auth token') ||
    message.includes('provide gateway auth password') ||
    message.includes('gateway password missing')
  )
}

function shouldIgnoreGatewayReadError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase()
  return (
    message.includes('missing scope: operator.read') ||
    message.includes('gateway token mismatch') ||
    message.includes('provide gateway auth token') ||
    message.includes('provide gateway auth password') ||
    message.includes('gateway password missing')
  )
}
