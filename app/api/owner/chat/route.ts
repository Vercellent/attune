import { after, NextResponse } from 'next/server'
import { z } from 'zod'
import { collections } from '@/lib/db'
import { advanceLab, claimLab } from '@/lib/lab'
import { ownerTurn } from '@/lib/agents/concierge'
import { LAB_ID } from '@/lib/types'

export const maxDuration = 800

export async function GET() {
  const { ownerMessages } = await collections()
  const messages = await ownerMessages.find({ labId: LAB_ID }).sort({ createdAt: 1 }).limit(200).toArray()
  return NextResponse.json({ messages })
}

export async function POST(req: Request) {
  const parsed = z
    .object({ text: z.string().trim().min(1).max(2000) })
    .safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Message is required' }, { status: 400 })
  try {
    const reply = await ownerTurn(parsed.data.text, async () => {
      if (!(await claimLab('Closing the round'))) return 'The lab is busy; try again once the current step finishes.'
      after(advanceLab)
      return 'Started: closing the round and building the next one.'
    })
    return NextResponse.json({ reply })
  } catch (error) {
    console.error('[owner] chat failed', error)
    return NextResponse.json({ error: 'The assistant is unavailable right now' }, { status: 500 })
  }
}
