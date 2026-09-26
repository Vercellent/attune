import { NextResponse } from 'next/server'
import { createSession } from '@/lib/lab'

export async function POST() {
  const session = await createSession()
  if (!session) return NextResponse.json({ error: 'No experiment is live right now' }, { status: 409 })
  return NextResponse.json(session)
}
