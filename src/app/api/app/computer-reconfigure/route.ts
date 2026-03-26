import { NextRequest, NextResponse } from 'next/server'
import { reconfigureComputerGatewayAccess } from '@/lib/computer-openclaw'

export async function POST(request: NextRequest) {
  try {
    const { computerId }: { computerId?: string } = await request.json()

    if (!computerId) {
      return NextResponse.json({ error: 'Computer ID is required' }, { status: 400 })
    }

    const result = await reconfigureComputerGatewayAccess(computerId)
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to reconfigure computer gateway'
    const status = message === 'Unauthorized' ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
