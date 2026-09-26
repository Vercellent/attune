import { after, NextResponse } from 'next/server'
import { z } from 'zod'
import { interviewTurn } from '@/lib/agents/interviewer'
import { advanceLab, claimLab, readyToAdvance } from '@/lib/lab'

export const maxDuration = 800

const bodySchema = z.object({ text: z.string().trim().min(1).max(2000) })

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid message' }, { status: 400 })
  try {
    const result = await interviewTurn(id, { text: parsed.data.text })
    if (result.status === 'done') {
      after(async () => {
        if ((await readyToAdvance()) && (await claimLab('Closing the round'))) await advanceLab()
      })
    }
    return NextResponse.json(result)
  } catch (error) {
    console.error('[interview] turn failed', error)
    return NextResponse.json({ error: 'The interviewer is unavailable right now' }, { status: 500 })
  }
}
