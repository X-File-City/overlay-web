import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/workos-auth'
import { AVAILABLE_MODELS } from '@/lib/models'
import {
  callComputerGatewayMethod,
  getAuthenticatedComputerContext,
  getComputerSessionMessages,
  runComputerGatewayCommand,
} from '@/lib/computer-openclaw'
import {
  type ComputerCommandField,
  type ComputerCommandOption,
  type ComputerCommandResult,
  parseStandaloneComputerCommand,
} from '@/lib/computer-commands'

interface GatewaySessionRow {
  key?: string
  label?: string
  displayName?: string
  derivedTitle?: string
  updatedAt?: number | null
  sessionId?: string
  thinkingLevel?: string
  fastMode?: boolean
  verboseLevel?: string
  reasoningLevel?: string
  elevatedLevel?: string
  sendPolicy?: 'allow' | 'deny'
  responseUsage?: 'off' | 'tokens' | 'full' | 'on'
  modelProvider?: string | null
  model?: string | null
  contextTokens?: number | null
  totalTokens?: number | null
  estimatedCostUsd?: number | null
  status?: string
}

interface GatewaySessionsListPayload {
  sessions?: GatewaySessionRow[]
  defaults?: {
    model?: string | null
    contextTokens?: number | null
  }
}

interface GatewayStatusPayload {
  runtimeVersion?: string | null
}

interface GatewayUsageStatusPayload {
  providers?: Array<{
    id?: string
    label?: string
    error?: string | null
    windows?: Array<{
      label?: string
      remaining?: string | number | null
      resetAt?: number | null
    }>
  }>
}

interface GatewaySessionUsagePayload {
  totals?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
    costUsd?: number
    messages?: number
    toolCalls?: number
  }
  sessions?: Array<{
    key?: string
    usage?: {
      inputTokens?: number
      outputTokens?: number
      totalTokens?: number
      costUsd?: number
      messages?: number
      toolCalls?: number
    } | null
  }>
}

interface GatewayTtsStatusPayload {
  enabled?: boolean
  auto?: string
  provider?: string
  fallbackProvider?: string | null
  prefsPath?: string
  hasOpenAIKey?: boolean
  hasElevenLabsKey?: boolean
  microsoftEnabled?: boolean
}

interface GatewayTtsProvidersPayload {
  active?: string
  providers?: Array<{
    id?: string
    name?: string
    configured?: boolean
  }>
}

const EMPTY_SESSIONS_LIST: GatewaySessionsListPayload = { sessions: [], defaults: { model: null, contextTokens: null } }
const EMPTY_STATUS_PAYLOAD: GatewayStatusPayload = {}
const EMPTY_USAGE_STATUS_PAYLOAD: GatewayUsageStatusPayload = { providers: [] }
const EMPTY_SESSION_USAGE_PAYLOAD: GatewaySessionUsagePayload = { totals: {}, sessions: [] }
const EMPTY_TTS_STATUS_PAYLOAD: GatewayTtsStatusPayload = {}
const EMPTY_TTS_PROVIDERS_PAYLOAD: GatewayTtsProvidersPayload = { providers: [] }
const EMPTY_AGENTS_PAYLOAD: GatewayAgentsPayload = { agents: [] }

interface GatewayAgentsPayload {
  agents?: Array<{
    id?: string
    label?: string
    default?: boolean
    description?: string
  }>
}

function formatTimestamp(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'Unknown'
  }
  return new Date(value).toLocaleString()
}

function formatBoolean(value: boolean | null | undefined, labels: { true: string; false: string }) {
  return value ? labels.true : labels.false
}

function formatCurrency(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'Unknown'
  }
  return `$${value.toFixed(4)}`
}

function formatNumber(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'Unknown'
  }
  return value.toLocaleString()
}

function resolveCurrentSessionRow(
  payload: GatewaySessionsListPayload,
  sessionKey: string
): GatewaySessionRow | null {
  return (
    payload.sessions?.find((session) => session.key?.trim() === sessionKey) ??
    null
  )
}

function buildSettingsResult(params: {
  title: string
  message: string
  status?: 'success' | 'info' | 'error'
  fields: ComputerCommandField[]
  options?: ComputerCommandOption[]
}): ComputerCommandResult {
  return {
    kind: 'settings',
    title: params.title,
    status: params.status ?? 'success',
    message: params.message,
    fields: params.fields,
    options: params.options,
  }
}

function normalizeSendPolicyArg(value: string): 'allow' | 'deny' | null | undefined {
  const normalized = value.trim().toLowerCase()
  if (!normalized) return undefined
  if (normalized === 'inherit') return null
  if (normalized === 'on') return 'allow'
  if (normalized === 'off') return 'deny'
  return undefined
}

function buildExecPatch(args: string) {
  const next: Record<string, string | null> = {}
  for (const token of args.split(/\s+/).filter(Boolean)) {
    const [key, rawValue] = token.split('=')
    if (!key || !rawValue) continue
    const value = rawValue.trim()
    if (!value) continue
    if (key === 'host') next.execHost = value
    if (key === 'security') next.execSecurity = value
    if (key === 'ask') next.execAsk = value
    if (key === 'node') next.execNode = value
  }
  return next
}

function buildSessionExportHtml(params: {
  sessionTitle: string
  sessionKey: string
  computerName: string
  messages: Array<{ role?: string; content?: Array<{ type?: string; text?: string }> }>
}): string {
  const rows = params.messages
    .map((message) => {
      const text = message.content
        ?.filter((part) => part.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text || '')
        .join('\n')
        .trim()

      if (!text) {
        return ''
      }

      return `
        <section class="message ${message.role === 'user' ? 'user' : 'assistant'}">
          <header>${message.role === 'user' ? 'User' : 'Assistant'}</header>
          <pre>${escapeHtml(text)}</pre>
        </section>
      `
    })
    .join('\n')

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(params.sessionTitle)}</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #f7f7f7; color: #111; margin: 0; }
      main { max-width: 860px; margin: 0 auto; padding: 48px 24px; }
      h1 { margin: 0 0 8px; font-size: 28px; }
      .meta { color: #666; font-size: 14px; margin-bottom: 32px; }
      .message { background: white; border: 1px solid #e5e5e5; border-radius: 18px; padding: 18px 20px; margin-bottom: 16px; }
      .message.user { border-color: #111; }
      .message header { font-size: 11px; text-transform: uppercase; letter-spacing: 0.14em; color: #666; margin-bottom: 10px; }
      .message pre { margin: 0; white-space: pre-wrap; font: 14px/1.7 ui-monospace, SFMono-Regular, monospace; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(params.sessionTitle)}</h1>
      <div class="meta">
        Computer: ${escapeHtml(params.computerName)}<br />
        Session: ${escapeHtml(params.sessionKey)}
      </div>
      ${rows}
    </main>
  </body>
</html>`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

async function executeRawFallback(params: {
  computerId: string
  sessionKey: string
  commandText: string
  title: string
}): Promise<ComputerCommandResult> {
  const markdown = await runComputerGatewayCommand({
    computerId: params.computerId,
    sessionKey: params.sessionKey,
    message: params.commandText,
  })

  return {
    kind: 'raw',
    title: params.title,
    markdown: markdown || 'No output returned.',
  }
}

export async function POST(request: NextRequest) {
  try {
    const { computerId, sessionKey, commandText }: {
      computerId?: string
      sessionKey?: string
      commandText?: string
    } = await request.json()

    if (!computerId?.trim()) {
      return NextResponse.json({ error: 'Computer ID is required' }, { status: 400 })
    }
    if (!sessionKey?.trim()) {
      return NextResponse.json({ error: 'Session key is required' }, { status: 400 })
    }
    if (!commandText?.trim()) {
      return NextResponse.json({ error: 'Command text is required' }, { status: 400 })
    }

    const parsed = parseStandaloneComputerCommand(commandText)
    if (!parsed) {
      return NextResponse.json({ error: 'Unrecognized command' }, { status: 400 })
    }

    if (parsed.descriptor.executionMode === 'disabled') {
      return NextResponse.json({
        ok: true,
        command: parsed.descriptor.name,
        result: {
          kind: 'unavailable',
          title: `/${parsed.descriptor.name}`,
          message: parsed.descriptor.disabledReason || 'This command is unavailable here.',
        } satisfies ComputerCommandResult,
      })
    }

    const context = await getAuthenticatedComputerContext(computerId)
    const sessionsPayload = await callComputerGatewayMethod<GatewaySessionsListPayload>({
      computerId,
      method: 'sessions.list',
      params: {
        agentId: 'main',
        includeGlobal: false,
        includeUnknown: false,
        includeDerivedTitles: true,
        includeLastMessage: true,
        limit: 300,
      },
    }).catch(() => EMPTY_SESSIONS_LIST)
    const sessionRow = resolveCurrentSessionRow(sessionsPayload, sessionKey)
    const sessionLabel =
      sessionRow?.label?.trim() ||
      sessionRow?.displayName?.trim() ||
      sessionRow?.derivedTitle?.trim() ||
      'New Chat'

    let result: ComputerCommandResult

    switch (parsed.descriptor.name) {
      case 'status': {
        const [statusPayload, usagePayload, sessionUsagePayload, ttsPayload] = await Promise.all([
          callComputerGatewayMethod<GatewayStatusPayload>({ computerId, method: 'status' }).catch(() => EMPTY_STATUS_PAYLOAD),
          callComputerGatewayMethod<GatewayUsageStatusPayload>({ computerId, method: 'usage.status' }).catch(() => EMPTY_USAGE_STATUS_PAYLOAD),
          callComputerGatewayMethod<GatewaySessionUsagePayload>({
            computerId,
            method: 'sessions.usage',
            params: { key: sessionKey },
          }).catch(() => EMPTY_SESSION_USAGE_PAYLOAD),
          callComputerGatewayMethod<GatewayTtsStatusPayload>({ computerId, method: 'tts.status' }).catch(() => EMPTY_TTS_STATUS_PAYLOAD),
        ])

        const providerUsageEntry = usagePayload.providers?.find((entry: NonNullable<GatewayUsageStatusPayload['providers']>[number]) => {
          const providerId = entry.id?.trim().toLowerCase()
          const currentProvider = sessionRow?.modelProvider?.trim().toLowerCase()
          return providerId && currentProvider ? providerId === currentProvider : false
        })

        result = {
          kind: 'status',
          title: 'Session Status',
          summary: [
            { label: 'Version', value: statusPayload.runtimeVersion || 'Unknown' },
            { label: 'Computer', value: context.computerId },
            { label: 'Session', value: sessionKey },
            { label: 'Requested model', value: context.computer.chatRequestedModelRef?.trim() || context.computer.chatRequestedModelId?.trim() || 'Unknown' },
            { label: 'Effective model', value: [context.computer.chatEffectiveProvider, context.computer.chatEffectiveModel].filter(Boolean).join('/') || 'Unknown' },
            { label: 'Runtime', value: sessionRow?.status || 'idle' },
          ],
          details: [
            { label: 'Thinking', value: sessionRow?.thinkingLevel || 'off' },
            { label: 'Fast', value: formatBoolean(sessionRow?.fastMode, { true: 'on', false: 'off' }) },
            { label: 'Verbose', value: sessionRow?.verboseLevel || 'off' },
            { label: 'Reasoning', value: sessionRow?.reasoningLevel || 'off' },
            { label: 'Elevated', value: sessionRow?.elevatedLevel || 'off' },
            { label: 'Send', value: sessionRow?.sendPolicy || 'inherit' },
            { label: 'Usage footer', value: sessionRow?.responseUsage || 'off' },
            { label: 'Updated', value: formatTimestamp(sessionRow?.updatedAt) },
          ],
          usage: [
            { label: 'Total tokens', value: formatNumber(sessionRow?.totalTokens ?? sessionUsagePayload.sessions?.[0]?.usage?.totalTokens) },
            { label: 'Context tokens', value: formatNumber(sessionRow?.contextTokens ?? sessionsPayload.defaults?.contextTokens) },
            { label: 'Estimated cost', value: formatCurrency(sessionRow?.estimatedCostUsd ?? sessionUsagePayload.sessions?.[0]?.usage?.costUsd) },
            { label: 'Messages', value: formatNumber(sessionUsagePayload.sessions?.[0]?.usage?.messages ?? sessionUsagePayload.totals?.messages) },
            { label: 'Tool calls', value: formatNumber(sessionUsagePayload.sessions?.[0]?.usage?.toolCalls ?? sessionUsagePayload.totals?.toolCalls) },
            { label: 'TTS', value: `${ttsPayload.enabled ? 'enabled' : 'disabled'}${ttsPayload.provider ? ` · ${ttsPayload.provider}` : ''}` },
          ],
          providerUsage: providerUsageEntry
            ? providerUsageEntry.windows?.slice(0, 3).map((window: NonNullable<NonNullable<typeof providerUsageEntry.windows>>[number]) => ({
                label: window.label || providerUsageEntry.label || providerUsageEntry.id || 'Usage',
                value: `${window.remaining ?? 'Unknown'}${typeof window.resetAt === 'number' ? ` · resets ${formatTimestamp(window.resetAt)}` : ''}`,
              })) || []
            : undefined,
          session: [
            { label: 'Title', value: sessionLabel },
            { label: 'Model provider', value: sessionRow?.modelProvider || 'Unknown' },
            { label: 'Model name', value: sessionRow?.model || 'Unknown' },
            { label: 'Session id', value: sessionRow?.sessionId || 'Unknown' },
          ],
        }
        break
      }

      case 'whoami': {
        const browserSession = await getSession()
        result = {
          kind: 'identity',
          title: 'Browser Identity',
          fields: [
            { label: 'Surface', value: 'Overlay computer page' },
            { label: 'User id', value: browserSession?.user.id || context.userId },
            { label: 'Computer', value: context.computerId },
            { label: 'Agent', value: 'main' },
            { label: 'Session', value: sessionKey },
          ],
        }
        break
      }

      case 'model': {
        const normalizedArgs = parsed.args.trim().toLowerCase()
        result = {
          kind: 'model',
          title: normalizedArgs === 'status' ? 'Model Status' : 'Available Models',
          fields: [
            { label: 'Requested', value: context.computer.chatRequestedModelRef?.trim() || context.computer.chatRequestedModelId?.trim() || 'Unknown' },
            { label: 'Effective', value: [context.computer.chatEffectiveProvider, context.computer.chatEffectiveModel].filter(Boolean).join('/') || 'Unknown' },
            { label: 'Session', value: sessionKey },
          ],
          options: AVAILABLE_MODELS.map((model) => ({
            label: model.name,
            value: `${model.provider} · ${model.id}`,
            active: model.id === context.computer.chatRequestedModelId,
          })),
        }
        break
      }

      case 'usage': {
        const normalizedArgs = parsed.args.trim().toLowerCase()
        if (normalizedArgs === 'cost') {
          const sessionUsagePayload = await callComputerGatewayMethod<GatewaySessionUsagePayload>({
            computerId,
            method: 'sessions.usage',
            params: { key: sessionKey },
          }).catch(() => EMPTY_SESSION_USAGE_PAYLOAD)

          result = {
            kind: 'usage',
            title: 'Session Cost Summary',
            fields: [
              { label: 'Input tokens', value: formatNumber(sessionUsagePayload.sessions?.[0]?.usage?.inputTokens ?? sessionUsagePayload.totals?.inputTokens) },
              { label: 'Output tokens', value: formatNumber(sessionUsagePayload.sessions?.[0]?.usage?.outputTokens ?? sessionUsagePayload.totals?.outputTokens) },
              { label: 'Total tokens', value: formatNumber(sessionUsagePayload.sessions?.[0]?.usage?.totalTokens ?? sessionUsagePayload.totals?.totalTokens) },
              { label: 'Estimated cost', value: formatCurrency(sessionUsagePayload.sessions?.[0]?.usage?.costUsd ?? sessionUsagePayload.totals?.costUsd) },
            ],
          }
          break
        }

        const responseUsage =
          normalizedArgs === 'tokens' || normalizedArgs === 'full'
            ? normalizedArgs
            : normalizedArgs === 'off'
              ? null
              : undefined

        if (responseUsage !== undefined) {
          await callComputerGatewayMethod({
            computerId,
            method: 'sessions.patch',
            params: {
              key: sessionKey,
              responseUsage,
            },
          })
        }

        const nextValue =
          responseUsage === null ? 'off' : responseUsage || sessionRow?.responseUsage || 'off'

        result = buildSettingsResult({
          title: 'Usage Footer',
          message:
            responseUsage !== undefined
              ? `Usage footer set to ${nextValue}.`
              : 'Current per-response usage display.',
          fields: [
            { label: 'Current value', value: nextValue },
            { label: 'Session', value: sessionKey },
          ],
          options: [
            { label: 'Off', value: 'off', active: nextValue === 'off' },
            { label: 'Tokens', value: 'tokens', active: nextValue === 'tokens' },
            { label: 'Full', value: 'full', active: nextValue === 'full' },
            { label: 'Cost', value: 'cost' },
          ],
        })
        break
      }

      case 'think':
      case 'verbose':
      case 'reasoning':
      case 'elevated':
      case 'fast':
      case 'send':
      case 'activation':
      case 'exec': {
        const patch: Record<string, unknown> = { key: sessionKey }
        const options: ComputerCommandOption[] = []
        let fieldLabel: string = parsed.descriptor.name
        let currentValue = 'Unknown'
        let message = 'Current session setting.'

        if (parsed.descriptor.name === 'think') {
          fieldLabel = 'Thinking'
          currentValue = sessionRow?.thinkingLevel || 'off'
          options.push(
            ...['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].map((value) => ({
              label: value,
              value,
              active: value === currentValue,
            }))
          )
          if (parsed.args) {
            patch.thinkingLevel = parsed.args.trim()
            await callComputerGatewayMethod({ computerId, method: 'sessions.patch', params: patch })
            currentValue = parsed.args.trim()
            message = `Thinking level set to ${currentValue}.`
          }
        } else if (parsed.descriptor.name === 'verbose') {
          fieldLabel = 'Verbose'
          currentValue = sessionRow?.verboseLevel || 'off'
          options.push(
            ...['off', 'on', 'full'].map((value) => ({
              label: value,
              value,
              active: value === currentValue,
            }))
          )
          if (parsed.args) {
            patch.verboseLevel = parsed.args.trim()
            await callComputerGatewayMethod({ computerId, method: 'sessions.patch', params: patch })
            currentValue = parsed.args.trim()
            message = `Verbose mode set to ${currentValue}.`
          }
        } else if (parsed.descriptor.name === 'reasoning') {
          fieldLabel = 'Reasoning'
          currentValue = sessionRow?.reasoningLevel || 'off'
          options.push(
            ...['off', 'on', 'stream'].map((value) => ({
              label: value,
              value,
              active: value === currentValue,
            }))
          )
          if (parsed.args) {
            patch.reasoningLevel = parsed.args.trim()
            await callComputerGatewayMethod({ computerId, method: 'sessions.patch', params: patch })
            currentValue = parsed.args.trim()
            message = `Reasoning mode set to ${currentValue}.`
          }
        } else if (parsed.descriptor.name === 'elevated') {
          fieldLabel = 'Elevated'
          currentValue = sessionRow?.elevatedLevel || 'off'
          options.push(
            ...['off', 'on', 'ask', 'full'].map((value) => ({
              label: value,
              value,
              active: value === currentValue,
            }))
          )
          if (parsed.args) {
            patch.elevatedLevel = parsed.args.trim()
            await callComputerGatewayMethod({ computerId, method: 'sessions.patch', params: patch })
            currentValue = parsed.args.trim()
            message = `Elevated mode set to ${currentValue}.`
          }
        } else if (parsed.descriptor.name === 'fast') {
          fieldLabel = 'Fast mode'
          currentValue = sessionRow?.fastMode ? 'on' : 'off'
          options.push(
            ...['status', 'on', 'off'].map((value) => ({
              label: value,
              value,
              active: value === currentValue,
            }))
          )
          const nextArg = parsed.args.trim().toLowerCase()
          if (nextArg === 'on' || nextArg === 'off') {
            patch.fastMode = nextArg === 'on'
            await callComputerGatewayMethod({ computerId, method: 'sessions.patch', params: patch })
            currentValue = nextArg
            message = `Fast mode ${nextArg === 'on' ? 'enabled' : 'disabled'}.`
          }
        } else if (parsed.descriptor.name === 'send') {
          fieldLabel = 'Send policy'
          currentValue = sessionRow?.sendPolicy === 'allow' ? 'on' : sessionRow?.sendPolicy === 'deny' ? 'off' : 'inherit'
          options.push(
            ...['on', 'off', 'inherit'].map((value) => ({
              label: value,
              value,
              active: value === currentValue,
            }))
          )
          const nextValue = normalizeSendPolicyArg(parsed.args)
          if (nextValue !== undefined) {
            patch.sendPolicy = nextValue
            await callComputerGatewayMethod({ computerId, method: 'sessions.patch', params: patch })
            currentValue = parsed.args.trim().toLowerCase() || currentValue
            message = `Send policy set to ${currentValue}.`
          }
        } else if (parsed.descriptor.name === 'activation') {
          fieldLabel = 'Activation'
          currentValue = 'mention'
          options.push(
            ...['mention', 'always'].map((value) => ({
              label: value,
              value,
              active: value === currentValue,
            }))
          )
          if (parsed.args) {
            patch.groupActivation = parsed.args.trim().toLowerCase()
            await callComputerGatewayMethod({ computerId, method: 'sessions.patch', params: patch })
            currentValue = parsed.args.trim().toLowerCase()
            message = `Activation mode set to ${currentValue}.`
          }
        } else if (parsed.descriptor.name === 'exec') {
          fieldLabel = 'Exec policy'
          const execPatch = buildExecPatch(parsed.args)
          if (Object.keys(execPatch).length > 0) {
            await callComputerGatewayMethod({
              computerId,
              method: 'sessions.patch',
              params: {
                key: sessionKey,
                ...execPatch,
              },
            })
            message = 'Exec policy updated.'
          } else {
            message = 'Current exec policy.'
          }
        }

        result = buildSettingsResult({
          title: parsed.descriptor.description,
          message,
          fields: [
            { label: fieldLabel, value: currentValue },
            { label: 'Session', value: sessionKey },
          ],
          options,
        })
        break
      }

      case 'tts': {
        const normalizedArgs = parsed.args.trim().toLowerCase()

        if (normalizedArgs === 'off') {
          await callComputerGatewayMethod({ computerId, method: 'tts.disable' })
        } else if (normalizedArgs === 'always' || normalizedArgs === 'on') {
          await callComputerGatewayMethod({ computerId, method: 'tts.enable' })
        } else if (normalizedArgs.startsWith('provider ')) {
          const provider = normalizedArgs.replace(/^provider\s+/, '').trim()
          await callComputerGatewayMethod({
            computerId,
            method: 'tts.setProvider',
            params: { provider },
          })
        }

        const [ttsStatusPayload, ttsProvidersPayload] = await Promise.all([
          callComputerGatewayMethod<GatewayTtsStatusPayload>({ computerId, method: 'tts.status' }).catch(() => EMPTY_TTS_STATUS_PAYLOAD),
          callComputerGatewayMethod<GatewayTtsProvidersPayload>({ computerId, method: 'tts.providers' }).catch(() => EMPTY_TTS_PROVIDERS_PAYLOAD),
        ])

        result = buildSettingsResult({
          title: 'Text To Speech',
          message:
            normalizedArgs && normalizedArgs !== 'status'
              ? 'TTS settings updated.'
              : 'Current TTS settings.',
          fields: [
            { label: 'Enabled', value: ttsStatusPayload.enabled ? 'yes' : 'no' },
            { label: 'Auto mode', value: ttsStatusPayload.auto || 'off' },
            { label: 'Provider', value: ttsStatusPayload.provider || 'Unknown' },
            { label: 'Fallback', value: ttsStatusPayload.fallbackProvider || 'None' },
            { label: 'OpenAI key', value: ttsStatusPayload.hasOpenAIKey ? 'configured' : 'missing' },
            { label: 'ElevenLabs key', value: ttsStatusPayload.hasElevenLabsKey ? 'configured' : 'missing' },
          ],
          options:
            ttsProvidersPayload.providers?.map((provider: NonNullable<GatewayTtsProvidersPayload['providers']>[number]) => ({
              label: provider.name || provider.id || 'provider',
              value: provider.configured ? 'configured' : 'not configured',
              active: provider.id === ttsProvidersPayload.active,
            })) || [],
        })
        break
      }

      case 'agents': {
        const agentsPayload = await callComputerGatewayMethod<GatewayAgentsPayload>({
          computerId,
          method: 'agents.list',
        }).catch(() => EMPTY_AGENTS_PAYLOAD)

        result = {
          kind: 'admin-table',
          title: 'Agents',
          tables: [
            {
              columns: ['Agent', 'Label', 'Default'],
              rows:
                agentsPayload.agents?.map((agent) => [
                  agent.id || 'unknown',
                  agent.label || agent.description || 'Untitled',
                  agent.default ? 'yes' : 'no',
                ]) || [],
            },
          ],
        }
        break
      }

      case 'compact': {
        const compactPayload = await callComputerGatewayMethod<{ compacted?: boolean; kept?: number; archived?: string[] }>({
          computerId,
          method: 'sessions.compact',
          params: { key: sessionKey },
        })

        result = {
          kind: 'action',
          title: 'Session Compaction',
          status: 'success',
          message: compactPayload?.compacted ? 'Session compacted successfully.' : 'Session did not need compaction.',
          fields: [
            { label: 'Kept lines', value: formatNumber(compactPayload?.kept) },
            { label: 'Archived files', value: formatNumber(compactPayload?.archived?.length) },
          ],
        }
        break
      }

      case 'reset': {
        await callComputerGatewayMethod({
          computerId,
          method: 'sessions.reset',
          params: {
            key: sessionKey,
            reason: 'reset',
          },
        })

        result = {
          kind: 'action',
          title: 'Session Reset',
          status: 'success',
          message: 'The current session was reset.',
        }
        break
      }

      case 'stop': {
        const payload = await callComputerGatewayMethod<{ aborted?: boolean; runIds?: string[] }>({
          computerId,
          method: 'chat.abort',
          params: {
            sessionKey,
          },
        }).catch(() => ({ aborted: false, runIds: [] }))

        result = {
          kind: 'action',
          title: 'Stop Run',
          status: payload.aborted ? 'success' : 'info',
          message: payload.aborted ? 'The active run was aborted.' : 'There was no active run to abort.',
          fields: [
            { label: 'Runs affected', value: formatNumber(payload.runIds?.length) },
          ],
        }
        break
      }

      case 'export-session': {
        const transcript = await getComputerSessionMessages({ computerId, sessionKey })
        const html = buildSessionExportHtml({
          sessionTitle: sessionLabel,
          sessionKey,
          computerName: context.computerId,
          messages: transcript.messages,
        })

        result = {
          kind: 'export',
          title: 'Session Export',
          filename: `${sessionLabel.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'session'}.html`,
          mimeType: 'text/html',
          content: html,
          fields: [
            { label: 'Title', value: sessionLabel },
            { label: 'Messages', value: formatNumber(transcript.messages.length) },
            { label: 'Session', value: sessionKey },
          ],
        }
        break
      }

      case 'context': {
        const rawResult = await executeRawFallback({
          computerId,
          sessionKey,
          commandText,
          title: 'Context',
        })

        result = rawResult.kind === 'raw'
          ? {
              kind: 'context',
              title: rawResult.title,
              fields: [
                { label: 'Session', value: sessionKey },
                { label: 'Mode', value: parsed.args || 'default' },
              ],
              blocks: [{ label: 'OpenClaw output', content: rawResult.markdown }],
            }
          : rawResult
        break
      }

      case 'btw': {
        const answer = await runComputerGatewayCommand({
          computerId,
          sessionKey,
          message: commandText,
        })

        result = {
          kind: 'btw',
          title: 'Side Question',
          question: parsed.args.trim() || commandText,
          answer: answer || 'No answer returned.',
        }
        break
      }

      default: {
        result = await executeRawFallback({
          computerId,
          sessionKey,
          commandText,
          title: `/${parsed.descriptor.name}`,
        })
        break
      }
    }

    return NextResponse.json({
      ok: true,
      command: parsed.descriptor.name,
      result,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to execute computer command'
    const status = message === 'Unauthorized' ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
