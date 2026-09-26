import { NextResponse } from 'next/server'
import { z } from 'zod'
import { startTask, stopTask } from '@/lib/lab'
import { interviewTurn } from '@/lib/agents/interviewer'
import { authorizeSession, unauthorizedSession } from '@/lib/session-auth'

export const maxDuration = 300

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start'), camera: z.boolean() }),
  z.object({ action: z.literal('stop') }),
])

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!(await authorizeSession(id))) return unauthorizedSession()
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  try {
    if (parsed.data.action === 'start') {
      await startTask(id, parsed.data.camera)
      return NextResponse.json({ ok: true })
    }
    await stopTask(id)
    return NextResponse.json(await interviewTurn(id, { start: true }))
  } catch (error) {
    console.error('[task] failed', error)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
