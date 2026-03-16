import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/workos-auth'
import { listFiles, getFile, createFile, updateFile, deleteFile } from '@/lib/app-store'

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { searchParams } = request.nextUrl
    const fileId = searchParams.get('fileId')
    if (fileId) {
      const file = getFile(fileId)
      if (!file || file.userId !== session.user.id) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      return NextResponse.json(file)
    }
    const projectId = searchParams.get('projectId')
    return NextResponse.json(listFiles(session.user.id, projectId !== null ? projectId : undefined))
  } catch {
    return NextResponse.json({ error: 'Failed to fetch files' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { name, type, parentId, content, projectId } = await request.json()
    if (!name || !type) return NextResponse.json({ error: 'name and type required' }, { status: 400 })
    const id = createFile(session.user.id, name, type, parentId ?? null, projectId)
    if (content) updateFile(id, { content })
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
    updateFile(fileId, { name, content })
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
    deleteFile(fileId)
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Failed to delete file' }, { status: 500 })
  }
}
