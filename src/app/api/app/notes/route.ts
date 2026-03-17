import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/workos-auth'
import { convex } from '@/lib/convex'

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const projectId = request.nextUrl.searchParams.get('projectId')
    if (projectId !== null) {
      const notes = await convex.query('notes:listByProject', { projectId })
      return NextResponse.json(notes || [])
    }

    const notes = await convex.query('notes:list', { userId: session.user.id })
    return NextResponse.json(notes || [])
  } catch (error) {
    console.error('[Notes API] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch notes' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { title, content, tags, projectId } = await request.json()
    const noteId = await convex.mutation<string>('notes:create', {
      userId: session.user.id,
      title: title || 'Untitled',
      content: content || '',
      tags: tags || [],
      projectId: projectId ?? undefined,
    })
    return NextResponse.json({ id: noteId })
  } catch (error) {
    console.error('[Notes API] POST error:', error)
    return NextResponse.json({ error: 'Failed to create note' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { noteId, title, content, tags } = await request.json()
    if (!noteId) return NextResponse.json({ error: 'noteId required' }, { status: 400 })

    await convex.mutation('notes:update', { noteId, title, content, tags })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Notes API] PATCH error:', error)
    return NextResponse.json({ error: 'Failed to update note' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = request.nextUrl
    const noteId = searchParams.get('noteId')
    if (!noteId) return NextResponse.json({ error: 'noteId required' }, { status: 400 })

    await convex.mutation('notes:remove', { noteId })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Notes API] DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete note' }, { status: 500 })
  }
}
