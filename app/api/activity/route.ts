import { NextResponse } from 'next/server'
import { listActivity } from '@/lib/activity'
import { resetDbIfUnreachable } from '@/lib/db'

export async function GET(req: Request) {
  const after = Number(new URL(req.url).searchParams.get('after')) || 0
  try {
    return NextResponse.json({ events: await listActivity(after) })
  } catch (error) {
    await resetDbIfUnreachable(error)
    return NextResponse.json({ error: 'Cannot reach MongoDB Atlas' }, { status: 503 })
  }
}
