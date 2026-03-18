import { NextRequest, NextResponse } from 'next/server'

type ConvexRequestType = 'query' | 'mutation' | 'action'

function resolveConvexUrl(): string | undefined {
  if (process.env.NODE_ENV === 'development' && process.env.DEV_NEXT_PUBLIC_CONVEX_URL) {
    return process.env.DEV_NEXT_PUBLIC_CONVEX_URL
  }

  return process.env.NEXT_PUBLIC_CONVEX_URL
}

function isConvexRequestType(value: string): value is ConvexRequestType {
  return value === 'query' || value === 'mutation' || value === 'action'
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ type: string }> }
) {
  const { type } = await context.params

  if (!isConvexRequestType(type)) {
    return NextResponse.json({ error: 'Invalid Convex request type' }, { status: 404 })
  }

  const convexUrl = resolveConvexUrl()
  if (!convexUrl) {
    return NextResponse.json({ error: 'Convex URL is not configured' }, { status: 500 })
  }

  const bodyText = await request.text()
  const response = await fetch(`${convexUrl}/api/${type}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: bodyText,
    cache: 'no-store',
  })

  return new NextResponse(response.body, {
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('Content-Type') || 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}
