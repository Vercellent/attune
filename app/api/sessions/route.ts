import { NextResponse } from 'next/server'
import { createSession } from '@/lib/lab'

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const resume = typeof body?.resume === 'string' && body.resume.length <= 64 ? body.resume : undefined
    const session = await createSession(resume)
    if (!session) return NextResponse.json({ error: 'No study is running right now. Please check back later.' }, { status: 409 })
    return NextResponse.json(session)
  } catch (error) {
    console.error('[sessions] create failed', error)
    return NextResponse.json({ error: 'Could not start a session' }, { status: 500 })
  }
}
