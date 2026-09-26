import 'server-only'
import { tool, type MessageData } from '@strands-agents/sdk'
import { z } from 'zod'
import { tracedAgent } from './trace'
import { codex } from './model'
import { interviewSystemPrompt, PARTICIPANT_MAX_CHARS, wrapParticipant } from './interview-prompt'
import { interviewScope, openInterviewStore } from '../interview-store'
import { logActivity } from '../activity'
import { scoreSession, summarizeGaze, summarizeTrace } from '../scoring'
import { TOPICS, type ChatMessage, type Insight, type Replay, type SessionDoc } from '../types'

const START_NOTE =
  '[Participant pressed STOP — the task is over and the site is hidden] Call get_behavior_trace first, then open the interview with a short thank-you and your first question.'

function toHistory(messages: ChatMessage[]): MessageData[] {
  const history: MessageData[] = [{ role: 'user', content: [{ text: '[Session started]' }] }]
  for (const m of messages) {
    const role = m.role === 'assistant' ? 'assistant' : 'user'
    const text = m.role === 'user' ? wrapParticipant(m.text) : m.text
    const last = history.at(-1)!
    if (last.role === role) (last.content as { text: string }[]).push({ text })
    else history.push({ role, content: [{ text }] })
  }
  return history
}

export async function interviewTurn(sessionId: string, input: { text?: string; start?: boolean }) {
  const scope = interviewScope(sessionId)
  const store = await openInterviewStore(scope)
  const session = await store.load()
  if (!session || session.status !== 'interview' || !session.snapshot) {
    return { reply: null, replay: null, status: session?.status ?? 'done' }
  }
  const snap = session.snapshot
  const metrics = session.metrics!
  const insights: Insight[] = []
  let replay: Replay | null = null
  const ending = { done: false, priceConfidence: null as number | null, summary: null as string | null }
  const asked = session.messages.filter((m) => m.role === 'assistant').length
  const participantText = input.text?.trim().slice(0, PARTICIPANT_MAX_CHARS) ?? ''

  const allTools = [
    tool({
      name: 'get_behavior_trace',
      description: "The participant's recorded journey: path, timings, clicks, dead/rage clicks, pauses, form errors, completion, and replayable mistake moments.",
      inputSchema: z.object({}),
      callback: () =>
        `${summarizeTrace(session.events, metrics, snap.traceDetail)}\n\nReplayable moments:\n${
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
        if (session.messages.filter((x) => x.replay).length >= snap.policy.replayMoments) return 'Replay budget used up.'
        replay = { momentId, startTs: m.ts - 3000, endTs: m.ts + 3000, label: m.description }
        return `Clip attached: ${m.description}. Now ask about it.`
      },
    }),
    tool({
      name: 'save_insight',
      description: 'Save a revealing verbatim quote from the participant.',
      inputSchema: z.object({ topic: z.enum(TOPICS), quote: z.string().max(500), note: z.string().max(300).describe('Why it matters') }),
      callback: (insight) => {
        insights.push(insight)
        return 'Saved.'
      },
    }),
    tool({
      name: 'end_interview',
      description: 'End the interview after thanking the participant.',
      inputSchema: z.object({
        priceConfidence: z.number().int().min(1).max(5).nullable().describe('Their 1-5 rating, null if not given'),
        summary: z.string().max(600).describe("Two-sentence summary of this participant's experience and key reason"),
      }),
      callback: ({ priceConfidence, summary }) => {
        Object.assign(ending, { done: true, priceConfidence, summary })
        return 'Interview closed. Send a one-line thank-you.'
      },
    }),
  ]

  const agent = tracedAgent(
    `interviewer · ${sessionId.slice(0, 6)}`,
    {
      model: codex('conversational'),
      printer: false,
      messages: toHistory(session.messages),
      tools: allTools.filter((t) => snap.tools.includes(t.name)),
      systemPrompt: interviewSystemPrompt(snap, session.moments.length),
    },
    store.log,
  )

  const overLimit = asked >= snap.policy.maxTurns
  const prompt = input.start
    ? START_NOTE
    : `${wrapParticipant(participantText)}${overLimit ? '\n\n[System: question limit reached — thank them and call end_interview now.]' : ''}`
  const result = await agent.invoke(prompt)
  let reply = result.toString().trim() || 'Thanks, that’s really helpful.'
  if (overLimit && !ending.done) {
    Object.assign(ending, { done: true, summary: ending.summary ?? 'Interview closed at the question limit.' })
    replay = null
    reply = 'That’s everything — thank you so much for your time and honesty.'
  }

  const now = new Date()
  const newMessages: ChatMessage[] = [
    { role: input.start ? 'system' : 'user', text: input.start ? '[Task stopped]' : participantText, at: now },
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
  await store.commitTurn(set, newMessages, insights)

  logActivity(
    'interviewer',
    'metric',
    `session ${sessionId.slice(0, 6)} · harness v${snap.harnessVersion} (frozen) · turn ${asked + 1}${insights.length ? ` · ${insights.length} insight(s): ${insights.map((i) => i.topic).join(', ')}` : ''}${replay ? ' · replay shown' : ''}${ending.done ? ` · done, score ${set.score}` : ''}`,
  )
  return { reply, replay, status: (set.status ?? 'interview') as SessionDoc['status'] }
}
