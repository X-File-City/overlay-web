import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/workos-auth'
import { convex } from '@/lib/convex'

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = request.nextUrl
    const agentId = searchParams.get('agentId')
    const includeMessages = searchParams.get('messages') === 'true'
    const projectId = searchParams.get('projectId')

    if (agentId && includeMessages) {
      const messages = await convex.query<Array<{
        _id: string
        role: 'user' | 'assistant'
        content: string
      }>>('agents:getMessages', { agentId })

      console.log(`[Agents GET] agentId=${agentId} messages=${messages ? messages.length : 'null (convex error)'}`)

      if (messages === null) {
        console.error('[Agents GET] Convex query failed for agents:getMessages')
        return NextResponse.json({ messages: [] })
      }

      return NextResponse.json({
        messages: messages.map((message) => ({
          id: message._id,
          role: message.role,
          parts: [{ type: 'text' as const, text: message.content }],
        })),
      })
    }

    if (projectId !== null && !agentId) {
      const agents = await convex.query<Array<{
        _id: string
        title: string
        lastModified: number
      }>>('agents:listByProject', { projectId })
      return NextResponse.json(agents || [])
    }

    const agents = await convex.query<Array<{
      _id: string
      title: string
      lastModified: number
    }>>('agents:list', { userId: session.user.id })

    return NextResponse.json(agents || [])
  } catch {
    return NextResponse.json({ error: 'Failed to fetch agents' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { title, projectId } = await request.json()
    const agentId = await convex.mutation<string>('agents:create', {
      userId: session.user.id,
      title: title || 'New Agent',
      projectId: projectId ?? undefined,
    })
    return NextResponse.json({ id: agentId })
  } catch {
    return NextResponse.json({ error: 'Failed to create agent' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { agentId, title } = await request.json()
    if (!agentId) return NextResponse.json({ error: 'agentId required' }, { status: 400 })

    await convex.mutation('agents:update', { agentId, title })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Failed to update agent' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const agentId = request.nextUrl.searchParams.get('agentId')
    if (!agentId) return NextResponse.json({ error: 'agentId required' }, { status: 400 })

    await convex.mutation('agents:remove', { agentId })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Failed to delete agent' }, { status: 500 })
  }
}
