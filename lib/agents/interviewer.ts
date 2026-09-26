import 'server-only'
import { Agent, tool, type MessageData } from '@strands-agents/sdk'
import { z } from 'zod'
import { collections } from '../db'
import { computeMetrics, scoreSession, summarizeTrace } from '../scoring'
import { LAB_ID, TOPICS, type ChatMessage, type Insight, type SessionDoc } from '../types'
import { codex } from './model'
import { memoryTool } from './tools'

export type InterviewTrigger = 'friction' | 'task_done'

const TRIGGER_NOTES: Record<InterviewTrigger, string> = {
  friction:
    '[Live signal] The participant just hit friction (rage or dead clicks). Ask ONE short, neutral question about what they expected. Do not give hints.',
  task_done:
    '[Participant pressed "I\'m done"] The task phase is over. Call get_behavior_trace, then start the interview by referencing one specific moment from their session.',
}

function systemPrompt(task: string, phase: SessionDoc['status'], hypothesis: string) {
  return `You are a world-class UX researcher running a moderated usability interview in a chat panel next to a website.
Participant task: "${task}"
Current phase: ${phase === 'task' ? 'TASK — they are using the site' : 'INTERVIEW — the task is over'}.
(Confidential, never reveal: this version tests "${hypothesis}".)

How you interview:
- Warm, human, brief: at most 2 short sentences per message, one question at a time.
- Open-ended and non-leading ("What were you expecting there?", never "Was the button confusing?").
- Ground questions in real behavior. Use get_behavior_trace and cite concrete moments ("You paused on the review screen for 12s — what was going through your mind?").
- Probe the why behind answers once, then move on. Mirror their words.
- During the TASK phase never help them complete it or hint at the UI; only clarify the task itself.
- In the INTERVIEW phase cover: the hardest moment, what almost stopped them, and how confident they felt about the total price (ask for a 1-5 rating).
- Call save_insight whenever they say something revealing (verbatim quote).
- After 3-5 interview questions, thank them and call end_interview.`
}

function toHistory(messages: ChatMessage[]): MessageData[] {
  const history: MessageData[] = [{ role: 'user', content: [{ text: '[Session started]' }] }]
  for (const m of messages) {
    const role = m.role === 'assistant' ? 'assistant' : 'user'
    const text = m.text
    const last = history.at(-1)!
    if (last.role === role) (last.content as { text: string }[]).push({ text })
    else history.push({ role, content: [{ text }] })
  }
  return history
}

export async function interviewTurn(sessionId: string, input: { text?: string; trigger?: InterviewTrigger }) {
  const { sessions, variants, labs } = await collections()
  const session = await sessions.findOne({ _id: sessionId, labId: LAB_ID })
  if (!session || session.status === 'done') return { reply: null, status: 'done' as const }
  const [lab, variant] = await Promise.all([
    labs.findOne({ _id: LAB_ID }, { projection: { brief: 1 } }),
    variants.findOne({ _id: session.variantId }, { projection: { hypothesis: 1 } }),
  ])

  const phase: SessionDoc['status'] = input.trigger === 'task_done' ? 'interview' : session.status
  const insights: Insight[] = []
  const ending: { done: boolean; priceConfidence: number | null; summary: string | null } = {
    done: false,
    priceConfidence: null,
    summary: null,
  }

  const tools = [
    tool({
      name: 'get_behavior_trace',
      description: 'Get the participant\'s recorded behavior: path, clicks, dead/rage clicks, pauses, form errors, completion.',
      inputSchema: z.object({}),
      callback: () => summarizeTrace(session.events, computeMetrics(session.events)),
    }),
    tool({
      name: 'save_insight',
      description: 'Save a revealing verbatim quote from the participant.',
      inputSchema: z.object({
        topic: z.enum(TOPICS),
        quote: z.string(),
        note: z.string().describe('Why it matters, one short sentence'),
      }),
      callback: (insight) => {
        insights.push(insight)
        return 'Saved.'
      },
    }),
    memoryTool(),
    ...(phase === 'interview'
      ? [
          tool({
            name: 'end_interview',
            description: 'End the interview after thanking the participant.',
            inputSchema: z.object({
              priceConfidence: z.number().int().min(1).max(5).nullable().describe('Their 1-5 rating, null if not given'),
              summary: z.string().describe('Two-sentence summary of this participant\'s experience and key reason'),
            }),
            callback: ({ priceConfidence, summary }) => {
              Object.assign(ending, { done: true, priceConfidence, summary })
              return 'Interview closed. Send your final thank-you message.'
            },
          }),
        ]
      : []),
  ]

  const agent = new Agent({
    model: codex('conversational'),
    printer: false,
    messages: toHistory(session.messages),
    tools,
    systemPrompt: systemPrompt(lab?.brief.task ?? '', phase, variant?.hypothesis ?? ''),
  })

  const prompt = input.text?.trim() || TRIGGER_NOTES[input.trigger ?? 'friction']
  const result = await agent.invoke(prompt)
  const reply = result.toString().trim() || 'Thanks, that’s really helpful.'

  const now = new Date()
  const newMessages: ChatMessage[] = [
    { role: input.text ? 'user' : 'system', text: prompt, at: now },
    { role: 'assistant', text: reply, at: now },
  ]
  const set: Partial<SessionDoc> = { status: ending.done ? 'done' : phase }
  if (ending.done) {
    const metrics = computeMetrics(session.events)
    Object.assign(set, {
      metrics,
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
  return { reply, status: set.status! }
}
