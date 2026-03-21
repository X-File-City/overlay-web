import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/workos-auth'
import { convex } from '@/lib/convex'
import { addMessage } from '@/lib/app-store'

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { chatId, role, content, parts, model } = await request.json() as {
      chatId?: string
      role?: 'user' | 'assistant'
      content?: string
      parts?: Array<{ type: string; text?: string; url?: string; mediaType?: string }>
      model?: string
    }

    const normalizedParts = parts?.filter((part) => part.type === 'text' || part.type === 'file')
    const normalizedContent = content?.trim() ||
      (normalizedParts?.some((part) => part.type === 'file') ? '[Image attachment]' : '')

    if (!chatId || !role || !normalizedContent) {
      return NextResponse.json({ error: 'chatId, role, and content or attachment are required' }, { status: 400 })
    }

    const payload = {
      chatId,
      userId: session.user.id,
      role,
      content: normalizedContent,
      parts: normalizedParts,
      model,
    }

    const saved = await convex.mutation('chats:addMessage', payload)
    if (!saved) addMessage(payload)

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Failed to save message' }, { status: 500 })
  }
}
