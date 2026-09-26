import { after, NextResponse } from 'next/server'
import { z } from 'zod'
import { advanceLab, bootstrapLab, claimLab, getOverview, setAutopilot, startCapture } from '@/lib/lab'
import { resetDbIfUnreachable } from '@/lib/db'
import { OBJECTIVES } from '@/lib/types'

export const maxDuration = 800

async function guard<T>(fn: () => Promise<T>) {
  try {
    return await fn()
  } catch (error) {
    await resetDbIfUnreachable(error)
    const message = error instanceof Error ? error.message : 'Unexpected error'
    console.error('[lab] request failed', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function GET() {
  return guard(async () => NextResponse.json({ overview: await getOverview() }))
}

const actionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('start'),
    objective: z.enum(OBJECTIVES.map((o) => o.value) as [string, ...string[]]),
    targetUrl: z.string().trim().min(1).max(500),
    optimize: z.string().trim().min(8).max(1000),
    target: z.number().int().min(4).max(200).optional(),
  }),
  z.object({ action: z.literal('launch') }),
  z.object({ action: z.literal('advance') }),
  z.object({ action: z.literal('autopilot'), enabled: z.boolean() }),
])

export async function POST(req: Request) {
  const parsed = actionSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const body = parsed.data
  return guard(async () => {
    if (body.action === 'start') {
      await startCapture(
        { objective: body.objective as never, targetUrl: body.targetUrl, optimize: body.optimize },
        body.target,
      )
      return NextResponse.json({ ok: true })
    }
    if (body.action === 'launch') {
      if (!(await claimLab('Studying the captured journey'))) return NextResponse.json({ error: 'The lab is busy' }, { status: 409 })
      after(bootstrapLab)
      return NextResponse.json({ ok: true })
    }
    if (body.action === 'advance') {
      if (!(await claimLab('Closing the round'))) return NextResponse.json({ error: 'The lab is busy' }, { status: 409 })
      after(advanceLab)
      return NextResponse.json({ ok: true })
    }
    await setAutopilot(body.enabled)
    return NextResponse.json({ ok: true })
  })
}
