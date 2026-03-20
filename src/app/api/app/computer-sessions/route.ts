import { NextRequest, NextResponse } from 'next/server'
import {
  createComputerSession,
  extractTranscriptMessageText,
  getComputerSessionMessages,
  listComputerSessions,
  updateComputerSession,
} from '@/lib/computer-openclaw'

function mapTranscriptMessages(
  messages: Awaited<ReturnType<typeof getComputerSessionMessages>>['messages']
) {
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message, index) => ({
      id: message.__openclaw?.id || `${message.role || 'message'}-${message.__openclaw?.seq || index}`,
      role: message.role,
      model: message.model,
      parts: [
        {
          type: 'text',
          text: extractTranscriptMessageText(message),
        },
      ],
    }))
    .filter((message) => message.parts[0]?.text)
}

export async function GET(request: NextRequest) {
  try {
    const computerId = request.nextUrl.searchParams.get('computerId')
    if (!computerId) {
      return NextResponse.json({ error: 'Computer ID is required' }, { status: 400 })
    }

    const sessionKey = request.nextUrl.searchParams.get('sessionKey')?.trim()
    const includeMessages = request.nextUrl.searchParams.get('messages') === 'true'

    if (sessionKey && includeMessages) {
      const transcript = await getComputerSessionMessages({ computerId, sessionKey })
      return NextResponse.json({
        sessionKey: transcript.sessionKey,
        messages: mapTranscriptMessages(transcript.messages),
      })
    }

    const result = await listComputerSessions(computerId)
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch computer sessions'
    const status = message === 'Unauthorized' ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}

export async function POST(request: NextRequest) {
  try {
    const { computerId, modelId }: { computerId?: string; modelId?: string } = await request.json()
    if (!computerId) {
      return NextResponse.json({ error: 'Computer ID is required' }, { status: 400 })
    }

    const result = await createComputerSession({ computerId, modelId })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create computer session'
    const status = message === 'Unauthorized' ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const {
      computerId,
      sessionKey,
      modelId,
      label,
    }: {
      computerId?: string
      sessionKey?: string
      modelId?: string
      label?: string
    } = await request.json()

    if (!computerId) {
      return NextResponse.json({ error: 'Computer ID is required' }, { status: 400 })
    }
    if (!sessionKey?.trim()) {
      return NextResponse.json({ error: 'Session key is required' }, { status: 400 })
    }

    const result = await updateComputerSession({
      computerId,
      sessionKey: sessionKey.trim(),
      modelId,
      label,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update computer session'
    const status = message === 'Unauthorized' ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
