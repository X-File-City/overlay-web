import { NextRequest, NextResponse } from 'next/server'
import {
  getComputerWorkspaceFile,
  listComputerWorkspaceFiles,
  setComputerWorkspaceFile,
} from '@/lib/computer-openclaw'

const DEFAULT_WORKSPACE_PATH = '~/.openclaw/workspace'
const DEFAULT_WORKSPACE_FILES = [
  'AGENTS.md',
  'SOUL.md',
  'TOOLS.md',
  'IDENTITY.md',
  'USER.md',
  'HEARTBEAT.md',
  'BOOTSTRAP.md',
  'MEMORY.md',
]

export async function GET(request: NextRequest) {
  try {
    const computerId = request.nextUrl.searchParams.get('computerId')
    if (!computerId) {
      return NextResponse.json({ error: 'Computer ID is required' }, { status: 400 })
    }

    const name = request.nextUrl.searchParams.get('name')?.trim()
    if (name) {
      const result = await getComputerWorkspaceFile({ computerId, name })
      return NextResponse.json(result)
    }

    const result = await listComputerWorkspaceFiles(computerId)
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch computer workspace'
    if (message === 'Unauthorized') {
      return NextResponse.json({ error: message }, { status: 401 })
    }

    const name = request.nextUrl.searchParams.get('name')?.trim()
    if (message === 'Computer is not ready') {
      if (name) {
        return NextResponse.json({
          workspace: DEFAULT_WORKSPACE_PATH,
          file: {
            name,
            path: `${DEFAULT_WORKSPACE_PATH}/${name}`,
            missing: true,
            content: '',
          },
          unavailableReason:
            'This computer is still starting up. Workspace files will appear once the OpenClaw gateway is ready.',
        })
      }

      return NextResponse.json({
        workspace: DEFAULT_WORKSPACE_PATH,
        files: DEFAULT_WORKSPACE_FILES.map((fileName) => ({
          name: fileName,
          path: `${DEFAULT_WORKSPACE_PATH}/${fileName}`,
          missing: false,
        })),
        unavailableReason:
          'This computer is still starting up. Workspace files will appear once the OpenClaw gateway is ready.',
      })
    }

    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const {
      computerId,
      name,
      content,
    }: {
      computerId?: string
      name?: string
      content?: string
    } = await request.json()

    if (!computerId) {
      return NextResponse.json({ error: 'Computer ID is required' }, { status: 400 })
    }
    if (!name?.trim()) {
      return NextResponse.json({ error: 'Workspace file name is required' }, { status: 400 })
    }

    const result = await setComputerWorkspaceFile({
      computerId,
      name: name.trim(),
      content: content ?? '',
    })

    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save computer workspace file'
    const status = message === 'Unauthorized' ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
