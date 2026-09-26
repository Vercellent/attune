import 'server-only'
import { tool, type MessageData } from '@strands-agents/sdk'
import { z } from 'zod'
import { tracedAgent } from './trace'
import { codex } from './model'
import { memoryTool } from './tools'
import { collections } from '../db'
import { allowTools, getHarness, rulesFor, configOf } from '../harness'
import { scoreSession, summarizeGaze, summarizeTrace } from '../scoring'
import { LAB_ID, TOPICS, type ChatMessage, type HarnessConfig, type Insight, type Replay, type SessionDoc } from '../types'

const START_NOTE =
  '[Participant pressed STOP — the task is over and the site is hidden] Call get_behavior_trace first, then open the interview with a short thank-you and your first question.'

function systemPrompt(task: string, hypothesis: string, h: HarnessConfig, momentCount: number) {
  const p = h.interview
  const replays = Math.min(p.replayMoments, momentCount)
  return `You are a world-class UX researcher running a post-task usability interview in a chat panel. The website is hidden now.
Participant task was: "${task}"
(Confidential, never reveal: this version tests "${hypothesis}".)

Interview plan — follow it in order, ONE question per message, at most 2 short sentences:
1. ${p.behavioralQuestions} behavioral question(s) about their habits (e.g. how they usually shop for this kind of product online).
2. ${p.journeyQuestions} question(s) about the journey they just took, citing concrete behavior from get_behavior_trace${h.tools.interviewer.includes('get_attention') ? ' and get_attention (where their eyes lingered)' : ''} — e.g. "You clicked the product image before 'Add to cart' — what were you hoping to see?"
3. ${replays} replay question(s)${replays ? ': call show_replay with a moment id, which plays a short video clip of that moment to the participant, and ask why they did that and what they expected' : ''}.
4. Ask how confident they felt about the total price, as a 1-5 rating.
5. Thank them and call end_interview.
Never lead ("Was it confusing?"). Mirror their words, probe the why once, then move on. Call save_insight when they say something revealing (verbatim quote). Hard limit: ${p.maxTurns} questions.${rulesFor(h, 'interviewer')}`
}

function toHistory(messages: ChatMessage[]): MessageData[] {
  const history: MessageData[] = [{ role: 'user', content: [{ text: '[Session started]' }] }]
  for (const m of messages) {
    const role = m.role === 'assistant' ? 'assistant' : 'user'
    const last = history.at(-1)!
    if (last.role === role) (last.content as { text: string }[]).push({ text: m.text })
    else history.push({ role, content: [{ text: m.text }] })
  }
  return history
}

export async function interviewTurn(sessionId: string, input: { text?: string; start?: boolean }) {
  const { sessions, variants, labs } = await collections()
  const session = await sessions.findOne({ _id: sessionId, labId: LAB_ID })
  if (!session || session.status !== 'interview') return { reply: null, replay: null, status: session?.status ?? 'done' }
  const [lab, variant, harnessDoc] = await Promise.all([
    labs.findOne({ _id: LAB_ID }, { projection: { brief: 1 } }),
    variants.findOne({ _id: session.variantId }, { projection: { hypothesis: 1 } }),
    getHarness(),
  ])
  const harness = configOf(harnessDoc)
  const metrics = session.metrics!
  const insights: Insight[] = []
  let replay: Replay | null = null
  const ending = { done: false, priceConfidence: null as number | null, summary: null as string | null }
  const asked = session.messages.filter((m) => m.role === 'assistant').length

  const tools = allowTools(harness, 'interviewer', [
    tool({
      name: 'get_behavior_trace',
      description: "The participant's recorded journey: path, timings, clicks, dead/rage clicks, pauses, form errors, completion, and replayable mistake moments.",
      inputSchema: z.object({}),
      callback: () =>
        `${summarizeTrace(session.events, metrics, harness.context.traceDetail)}\n\nReplayable moments:\n${
          session.moments.map((m) => `- ${m.id} at ${(m.t / 1000).toFixed(1)}s: ${m.description}`).join('\n') || 'none'
        }`,
    }),
    tool({
      name: 'get_attention',
      description: 'Webcam eye-tracking: where the participant looked longest on each screen.',
      inputSchema: z.object({}),
      callback: () => summarizeGaze(session.gaze),
    }),
    tool({
      name: 'show_replay',
      description: 'Play a short video clip of one moment to the participant alongside your next question. One per message.',
      inputSchema: z.object({ momentId: z.string() }),
      callback: ({ momentId }) => {
        const m = session.moments.find((x) => x.id === momentId)
        if (!m) return 'No such moment.'
        if (session.messages.some((x) => x.replay?.momentId === momentId)) return 'Already shown and discussed. Move on to a different topic.'
        if (session.messages.filter((x) => x.replay).length >= harness.interview.replayMoments) return 'Replay budget used up.'
        replay = { momentId, startTs: m.ts - 3000, endTs: m.ts + 3000, label: m.description }
        return `Clip attached: ${m.description}. Now ask about it.`
      },
    }),
    tool({
      name: 'save_insight',
      description: 'Save a revealing verbatim quote from the participant.',
      inputSchema: z.object({ topic: z.enum(TOPICS), quote: z.string(), note: z.string().describe('Why it matters') }),
      callback: (insight) => {
        insights.push(insight)
        return 'Saved.'
      },
    }),
    memoryTool([], harness.context.memoryK),
    tool({
      name: 'end_interview',
      description: 'End the interview after thanking the participant.',
      inputSchema: z.object({
        priceConfidence: z.number().int().min(1).max(5).nullable().describe('Their 1-5 rating, null if not given'),
        summary: z.string().describe("Two-sentence summary of this participant's experience and key reason"),
      }),
      callback: ({ priceConfidence, summary }) => {
        Object.assign(ending, { done: true, priceConfidence, summary })
        return 'Interview closed. Send a one-line thank-you.'
      },
    }),
  ])

  const agent = tracedAgent(`interviewer · ${sessionId.slice(0, 6)}`, {
    model: codex('conversational'),
    printer: false,
    messages: toHistory(session.messages),
    tools,
    systemPrompt: systemPrompt(lab?.brief.task ?? '', variant?.hypothesis ?? '', harness, session.moments.length),
  })

  const overLimit = asked >= harness.interview.maxTurns
  const prompt = input.start
    ? START_NOTE
    : `${input.text?.trim() ?? ''}${overLimit ? '\n\n[System: question limit reached — thank them and call end_interview now.]' : ''}`
  const result = await agent.invoke(prompt)
  let reply = result.toString().trim() || 'Thanks, that’s really helpful.'
  if (overLimit && !ending.done) {
    Object.assign(ending, { done: true, summary: ending.summary ?? 'Interview closed at the question limit.' })
    replay = null
    reply = 'That’s everything — thank you so much for your time and honesty.'
  }

  const now = new Date()
  const newMessages: ChatMessage[] = [
    { role: input.start ? 'system' : 'user', text: input.start ? '[Task stopped]' : input.text!.trim(), at: now },
    { role: 'assistant', text: reply, at: now, ...(replay ? { replay } : {}) },
  ]
  const set: Partial<SessionDoc> = {}
  if (ending.done) {
    Object.assign(set, {
      status: 'done',
      priceConfidence: ending.priceConfidence,
      summary: ending.summary,
      score: scoreSession(metrics, ending.priceConfidence),
      endedAt: now,
    })
  }
  await sessions.updateOne(
    { _id: sessionId },
    { $set: set, $push: { messages: { $each: newMessages }, insights: { $each: insights } } },
  )
  return { reply, replay, status: (set.status ?? 'interview') as SessionDoc['status'] }
}
