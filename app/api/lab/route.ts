import { after, NextResponse } from 'next/server'
import { z } from 'zod'
import { advanceLab, bootstrapLab, claimLab, createLab, getOverview, setAutopilot } from '@/lib/lab'

export const maxDuration = 800

export async function GET() {
  try {
    return NextResponse.json(await getOverview())
  } catch (error) {
    console.error('[lab] overview failed:', error)
    return NextResponse.json(
      { error: 'Cannot reach MongoDB Atlas. In Atlas → Network Access, allow 0.0.0.0/0, then reload.' },
      { status: 503 },
    )
  }
}

const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('start'),
    brief: z.object({
      targetUrl: z.string().trim().max(500),
      goal: z.string().trim().min(3).max(300),
      task: z.string().trim().min(3).max(400),
    }),
  }),
  z.object({ action: z.literal('advance') }),
  z.object({ action: z.literal('autopilot'), enabled: z.boolean() }),
])

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const body = parsed.data

  try {
    if (body.action === 'start') {
      const url = body.brief.targetUrl
      if (url && !url.startsWith('/shop') && !/^https?:\/\//.test(url)) {
        return NextResponse.json({ error: 'Use a full URL starting with https://' }, { status: 400 })
      }
      await createLab({ ...body.brief, targetUrl: url || '/shop' })
      after(bootstrapLab)
    } else if (body.action === 'advance') {
      if (!(await claimLab('Closing the round'))) {
        return NextResponse.json({ error: 'The lab is busy right now' }, { status: 409 })
      }
      after(advanceLab)
    } else {
      await setAutopilot(body.enabled)
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 })
  }
}
