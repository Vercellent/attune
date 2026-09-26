import { NextResponse } from 'next/server'
import { createSession } from '@/lib/lab'
import { readSessionCookie, setSessionCookie } from '@/lib/session-auth'

export async function POST() {
  try {
    const session = await createSession(await readSessionCookie())
    if (!session) return NextResponse.json({ error: 'No study is running right now. Please check back later.' }, { status: 409 })
    const { token, ...publicSession } = session
    if (token) await setSessionCookie(publicSession.sessionId, token)
    return NextResponse.json(publicSession)
  } catch (error) {
    console.error('[sessions] create failed', error)
    return NextResponse.json({ error: 'Could not start a session' }, { status: 500 })
  }
}
