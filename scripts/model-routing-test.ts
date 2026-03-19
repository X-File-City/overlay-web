/**
 * model-routing-test.ts
 *
 * Verifies that the model selected in the Overlay computer chat dropdown is
 * actually the model OpenClaw uses — not a fallback.
 *
 * Mirrors the approach in computer-chat/route.ts:
 *   1. Call session_status tool with the desired model ref to set the override.
 *   2. Send a simple chat message.
 *   3. Call session_status without a model to read back the actual model used.
 *   4. Compare expected vs actual.
 *
 * Usage:
 *   GATEWAY_IP=1.2.3.4 GATEWAY_TOKEN=abc node --experimental-strip-types scripts/model-routing-test.ts
 *   node --experimental-strip-types scripts/model-routing-test.ts --ip 1.2.3.4 --token abc
 *   node --experimental-strip-types scripts/model-routing-test.ts --ip 1.2.3.4 --token abc --models vercel-ai-gateway/anthropic/claude-sonnet-4-6,openrouter/free
 *
 * (Node 22+: --experimental-strip-types; older: npx ts-node scripts/model-routing-test.ts)
 */

// All models mirroring overlay-landing/src/lib/models.ts + resolveOpenClawModelRef logic.
// Format: name → expected model ref sent to session_status.
const ALL_MODELS: Array<{ name: string; ref: string }> = [
  // Vercel AI Gateway — Google
  { name: 'Gemini 3.1 Pro',       ref: 'vercel-ai-gateway/google/gemini-3.1-pro-preview' },
  { name: 'Gemini 3 Flash',       ref: 'vercel-ai-gateway/google/gemini-3-flash-preview' },
  { name: 'Gemini 2.5 Flash',     ref: 'vercel-ai-gateway/google/gemini-2.5-flash' },
  { name: 'Gemini 2.5 Flash Lite',ref: 'vercel-ai-gateway/google/gemini-2.5-flash-lite' },
  // Vercel AI Gateway — OpenAI
  { name: 'GPT-5.2 Pro',          ref: 'vercel-ai-gateway/openai/gpt-5.2-pro-2025-12-11' },
  { name: 'GPT-5.2',              ref: 'vercel-ai-gateway/openai/gpt-5.2-2025-12-11' },
  { name: 'GPT-5 Mini',           ref: 'vercel-ai-gateway/openai/gpt-5-mini-2025-08-07' },
  { name: 'GPT-5 Nano',           ref: 'vercel-ai-gateway/openai/gpt-5-nano-2025-08-07' },
  { name: 'GPT-4.1',              ref: 'vercel-ai-gateway/openai/gpt-4.1-2025-04-14' },
  // Vercel AI Gateway — Anthropic
  { name: 'Claude Opus 4.6',      ref: 'vercel-ai-gateway/anthropic/claude-opus-4-6' },
  { name: 'Claude Sonnet 4.6',    ref: 'vercel-ai-gateway/anthropic/claude-sonnet-4-6' },
  { name: 'Claude Haiku 4.5',     ref: 'vercel-ai-gateway/anthropic/claude-haiku-4-5' },
  // Vercel AI Gateway — xAI
  { name: 'Grok 4.1 Fast',        ref: 'vercel-ai-gateway/xai/grok-4-1-fast-reasoning' },
  // Vercel AI Gateway — Groq
  { name: 'Llama 3.3 70B',        ref: 'vercel-ai-gateway/groq/llama-3.3-70b-versatile' },
  { name: 'Kimi K2',              ref: 'vercel-ai-gateway/groq/moonshotai/kimi-k2-instruct-0905' },
  { name: 'GPT OSS 120B',         ref: 'vercel-ai-gateway/groq/openai/gpt-oss-120b' },
  { name: 'GPT OSS 20B',          ref: 'vercel-ai-gateway/groq/openai/gpt-oss-20b' },
  // OpenRouter
  { name: 'Free Router',          ref: 'openrouter/free' },
  { name: 'Hunter Alpha',         ref: 'openrouter/hunter-alpha' },
  { name: 'Healer Alpha',         ref: 'openrouter/healer-alpha' },
  { name: 'Trinity Large (Free)', ref: 'openrouter/arcee-ai/trinity-large-preview:free' },
]

// ---------- types ----------

type ToolInvokeResponse = {
  ok?: boolean
  result?: {
    details?: { statusText?: string }
    content?: Array<{ type?: string; text?: string }>
  }
  error?: { message?: string }
}

type SessionState = { provider?: string; model?: string }

// ---------- gateway helpers ----------

async function setSessionModel(
  ip: string,
  token: string,
  sessionKey: string,
  modelRef: string,
): Promise<boolean> {
  const res = await fetch(`http://${ip}:18789/tools/invoke`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tool: 'session_status',
      sessionKey,
      args: { sessionKey, model: modelRef },
    }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) return false
  const body = (await res.json()) as ToolInvokeResponse
  return body.ok === true
}

async function readSessionModel(
  ip: string,
  token: string,
  sessionKey: string,
): Promise<SessionState | null> {
  const res = await fetch(`http://${ip}:18789/tools/invoke`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tool: 'session_status',
      sessionKey,
      args: { sessionKey },
    }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) return null
  const body = (await res.json()) as ToolInvokeResponse
  if (body.ok !== true) return null

  const statusText =
    body.result?.details?.statusText ||
    (body.result?.content ?? [])
      .filter((p) => p.type === 'text')
      .map((p) => p.text ?? '')
      .join('\n') ||
    ''

  // Parse the "🧠 Model: <provider>/<model> · ..." line
  const modelLine = statusText.split('\n').find((l) => l.trim().startsWith('🧠 Model:'))
  if (!modelLine) return null
  const rawLabel = modelLine.replace(/^🧠 Model:\s*/, '').split(' · ')[0]?.trim()
  if (!rawLabel) return null
  const slash = rawLabel.indexOf('/')
  if (slash === -1) return { model: rawLabel }
  return {
    provider: rawLabel.slice(0, slash).trim() || undefined,
    model: rawLabel.slice(slash + 1).trim() || undefined,
  }
}

async function sendTestChat(
  ip: string,
  token: string,
  sessionKey: string,
): Promise<string> {
  const res = await fetch(`http://${ip}:18789/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-openclaw-agent-id': 'default',
      'x-openclaw-session-key': sessionKey,
    },
    body: JSON.stringify({
      model: 'openclaw:default',
      user: sessionKey,
      stream: false,
      messages: [
        { role: 'system', content: 'You are a helpful assistant. Reply only to what the user asks.' },
        { role: 'user', content: 'Reply with exactly: OK' },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`)
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  return data.choices?.[0]?.message?.content?.trim() ?? ''
}

function normalizeActual(state: SessionState | null): string {
  if (!state) return '(unknown)'
  const parts = [state.provider, state.model].filter(Boolean)
  return parts.join('/')
}

// ---------- main ----------

async function main() {
  const argv = process.argv.slice(2)

  const ip = getArg(argv, '--ip') ?? process.env.GATEWAY_IP ?? ''
  const token = getArg(argv, '--token') ?? process.env.GATEWAY_TOKEN ?? ''
  const modelsArg = getArg(argv, '--models')

  if (!ip || !token) {
    process.stderr.write(
      'Error: GATEWAY_IP and GATEWAY_TOKEN are required.\n' +
        'Usage: GATEWAY_IP=1.2.3.4 GATEWAY_TOKEN=abc node --experimental-strip-types scripts/model-routing-test.ts\n',
    )
    process.exit(1)
  }

  // Filter to requested models if --models is provided
  const modelsToTest = modelsArg
    ? ALL_MODELS.filter((m) => modelsArg.split(',').includes(m.ref))
    : ALL_MODELS

  log(`[model-routing-test] gateway: http://${ip}:18789`)
  log(`[model-routing-test] testing ${modelsToTest.length} model(s)\n`)

  let passed = 0
  let failed = 0
  let skipped = 0

  for (const m of modelsToTest) {
    const sessionKey = `model-routing-test-${m.ref.replace(/[^a-z0-9]/gi, '-').slice(0, 40)}`
    log(`── ${m.name}`)
    log(`   ref:     ${m.ref}`)

    // 1. Set model via session_status
    const overrideOk = await setSessionModel(ip, token, sessionKey, m.ref).catch(() => false)
    if (!overrideOk) {
      log(`   SKIP — gateway rejected model ref (not in catalog)`)
      skipped++
      continue
    }
    log(`   override: accepted`)

    // 2. Send test message
    let chatReply = ''
    try {
      chatReply = await sendTestChat(ip, token, sessionKey)
      log(`   chat:     ${JSON.stringify(chatReply)}`)
    } catch (err) {
      log(`   FAIL — chat error: ${err instanceof Error ? err.message : String(err)}`)
      failed++
      continue
    }

    // 3. Read back actual session model
    const actual = await readSessionModel(ip, token, sessionKey).catch(() => null)
    const actualRef = normalizeActual(actual)
    log(`   actual:   ${actualRef}`)

    // 4. Compare
    if (actualRef === m.ref) {
      log(`   PASS`)
      passed++
    } else {
      log(`   FAIL — expected ${m.ref}`)
      failed++
    }
    log('')
  }

  log(`── Results: ${passed} passed, ${failed} failed, ${skipped} skipped`)
  if (failed > 0) process.exit(1)
}

function getArg(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name)
  return idx !== -1 && idx + 1 < argv.length ? argv[idx + 1] : undefined
}

function log(msg: string) {
  process.stdout.write(msg + '\n')
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`)
  process.exit(1)
})
