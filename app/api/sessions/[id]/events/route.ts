import { NextResponse } from 'next/server'
import { z } from 'zod'
import { collections } from '@/lib/db'
import { LAB_ID } from '@/lib/types'

const eventsSchema = z.object({
  events: z
    .array(
      z.object({
        t: z.number().nonnegative(),
        type: z.enum(['page_view', 'click', 'dead_click', 'rage_click', 'form_error', 'complete']),
        page: z.string().max(80),
        label: z.string().max(80).optional(),
      }),
    )
    .max(200),
})

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const parsed = eventsSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid events' }, { status: 400 })
  if (parsed.data.events.length) {
    const { sessions } = await collections()
    await sessions.updateOne(
      { _id: id, labId: LAB_ID, status: { $ne: 'done' } },
      { $push: { events: { $each: parsed.data.events } } },
    )
  }
  return NextResponse.json({ ok: true })
}
