import { NextResponse } from 'next/server'
import { z } from 'zod'
import { captureStep, finishCapture, saveCapture } from '@/lib/lab'

export const maxDuration = 300

const rect = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).nullable()

const bodySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('step'),
    step: z.number().int().min(0).max(40),
    screen: z.string().max(80),
    visibleText: z.string().max(8000),
    elements: z.array(z.object({ id: z.string(), role: z.string(), label: z.string().max(120) })).max(120),
    history: z.array(z.string().max(300)).max(40),
  }),
  z.object({
    kind: z.literal('save'),
    index: z.number().int().min(0).max(40),
    screen: z.string().max(80),
    title: z.string().max(120),
    note: z.string().max(600),
    friction: z.array(z.string().max(300)).max(5),
    action: z.string().max(300),
    target: rect,
    screenshot: z.string().max(900_000).nullable(),
  }),
  z.object({ kind: z.literal('finish') }),
])

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const body = parsed.data
  try {
    if (body.kind === 'step') {
      const { kind: _kind, ...opts } = body
      return NextResponse.json({ step: await captureStep(opts) })
    }
    if (body.kind === 'save') {
      const { kind: _kind, ...doc } = body
      await saveCapture(doc)
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ confirmation: await finishCapture() })
  } catch (error) {
    console.error('[capture] failed', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Capture failed' }, { status: 500 })
  }
}
