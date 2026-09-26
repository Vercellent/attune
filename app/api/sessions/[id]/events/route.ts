import { NextResponse } from 'next/server'
import { z } from 'zod'
import { recordSession } from '@/lib/lab'

const bodySchema = z.object({
  events: z
    .array(
      z.object({
        t: z.number().nonnegative(),
        ts: z.number().nonnegative(),
        type: z.enum(['page_view', 'click', 'dead_click', 'rage_click', 'form_error', 'complete']),
        page: z.string().max(80),
        label: z.string().max(80).optional(),
      }),
    )
    .max(300)
    .optional(),
  gaze: z.array(z.object({ page: z.string().max(80), label: z.string().max(80), ms: z.number().nonnegative() })).max(300).optional(),
  rrweb: z.array(z.unknown()).max(5000).optional(),
  seq: z.number().optional(),
})

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid events' }, { status: 400 })
  try {
    await recordSession(id, parsed.data)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[events] record failed', error)
    return NextResponse.json({ error: 'Could not record events' }, { status: 500 })
  }
}
