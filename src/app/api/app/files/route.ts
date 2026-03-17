import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/workos-auth'
import { convex } from '@/lib/convex'

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { searchParams } = request.nextUrl
    const fileId = searchParams.get('fileId')
    if (fileId) {
      const file = await convex.query('files:get', { fileId })
      if (!file || (file as { userId: string }).userId !== session.user.id) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
      return NextResponse.json(file)
    }
    const projectId = searchParams.get('projectId')
    const args: Record<string, unknown> = { userId: session.user.id }
    if (projectId !== null) args.projectId = projectId
    const files = await convex.query('files:list', args)
    return NextResponse.json(files ?? [])
  } catch {
    return NextResponse.json({ error: 'Failed to fetch files' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { name, type, parentId, content, storageId, projectId } = await request.json()
    if (!name || !type) return NextResponse.json({ error: 'name and type required' }, { status: 400 })

    const args: Record<string, unknown> = {
      userId: session.user.id,
      name,
      type,
    }
    if (parentId) args.parentId = parentId
    if (projectId) args.projectId = projectId

    let id: unknown
    if (storageId) {
      // Binary file uploaded directly to Convex storage (type is always 'file')
      const { type: _type, ...storageArgs } = args
      void _type
      id = await convex.mutation('files:createWithStorage', { ...storageArgs, storageId })
    } else {
      if (content) args.content = content
      id = await convex.mutation('files:create', args)
    }

    return NextResponse.json({ id })
  } catch {
    return NextResponse.json({ error: 'Failed to create file' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { fileId, name, content } = await request.json()
    if (!fileId) return NextResponse.json({ error: 'fileId required' }, { status: 400 })
    const args: Record<string, unknown> = { fileId }
    if (name !== undefined) args.name = name
    if (content !== undefined) args.content = content
    await convex.mutation('files:update', args)
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Failed to update file' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const fileId = request.nextUrl.searchParams.get('fileId')
    if (!fileId) return NextResponse.json({ error: 'fileId required' }, { status: 400 })
    await convex.mutation('files:remove', { fileId })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Failed to delete file' }, { status: 500 })
  }
}
