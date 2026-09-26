import { NextResponse } from 'next/server'
import { getReplayEvents } from '@/lib/lab'
import { authorizeSession, unauthorizedSession } from '@/lib/session-auth'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!(await authorizeSession(id))) return unauthorizedSession()
  const end = Number(new URL(req.url).searchParams.get('end'))
  if (!Number.isFinite(end)) return NextResponse.json({ error: 'end is required' }, { status: 400 })
  try {
    return NextResponse.json({ events: await getReplayEvents(id, end) })
  } catch (error) {
    console.error('[replay] failed', error)
    return NextResponse.json({ events: [] })
  }
}
