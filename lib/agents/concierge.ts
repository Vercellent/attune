import 'server-only'
import { Agent, tool, type MessageData } from '@strands-agents/sdk'
import { z } from 'zod'
import { collections, newId } from '../db'
import { getOverview, setAutopilot } from '../lab'
import { LAB_ID } from '../types'
import { codex } from './model'
import { memoryTool } from './tools'

async function statusReport() {
  const o = await getOverview()
  if (!o.lab) return 'No experiment configured yet.'
  const current = o.variants.filter((v) => v.generation === o.lab!.generation)
  return [
    `Goal: ${o.lab.brief.goal}. Task: ${o.lab.brief.task}.`,
    `Status: ${o.lab.status}${o.lab.step ? ` (${o.lab.step})` : ''}. Round ${o.lab.generation}. Autopilot ${o.lab.autopilot ? 'on' : 'off'} (advances after ${o.lab.minSessions} interviews per version). Total interviews: ${o.sessions}.`,
    'Current versions:',
    ...current.map(
      (v) =>
        `- ${v.key} ${v.name}: ${v.hypothesis} | interviews ${v.sessionCount}, score ${v.avgScore ?? 'n/a'}, completion ${v.completionRate === null ? 'n/a' : Math.round(v.completionRate * 100) + '%'}`,
    ),
    'Past rounds:',
    ...o.generations
      .filter((g) => g.status === 'closed')
      .map((g) => `- Round ${g.number}: ${g.learned}`),
    o.lab.playbook ? `Playbook: ${JSON.stringify(o.lab.playbook)}` : '',
  ].join('\n')
}

export async function ownerTurn(text: string, onAdvance: () => Promise<string>) {
  const { ownerMessages } = await collections()
  const past = await ownerMessages.find({ labId: LAB_ID }).sort({ createdAt: -1 }).limit(20).toArray()
  const history: MessageData[] = []
  for (const m of past.reverse()) {
    const role = m.role === 'user' ? 'user' : 'assistant'
    const content = m.role === 'update' ? `[Lab update] ${m.text}` : m.text
    const last = history.at(-1)
    if (last?.role === role) (last.content as { text: string }[]).push({ text: content })
    else history.push({ role, content: [{ text: content }] })
  }
  if (history[0]?.role === 'assistant') history.unshift({ role: 'user', content: [{ text: '[Opened the lab]' }] })

  await ownerMessages.insertOne({ _id: newId(), labId: LAB_ID, role: 'user', text, createdAt: new Date() })

  const agent = new Agent({
    model: codex('conversational'),
    printer: false,
    messages: history,
    tools: [
      tool({
        name: 'get_lab_status',
        description: 'Live status of the experiment: versions, scores, interviews, past rounds, playbook.',
        inputSchema: z.object({}),
        callback: statusReport,
      }),
      memoryTool(),
      tool({
        name: 'start_next_round',
        description: 'Close the current round, pick a winner, and have Codex build the next round. Only when the owner asks.',
        inputSchema: z.object({}),
        callback: onAdvance,
      }),
      tool({
        name: 'set_autopilot',
        description: 'Turn automatic round advancement on or off.',
        inputSchema: z.object({ enabled: z.boolean() }),
        callback: async ({ enabled }) => {
          await setAutopilot(enabled)
          return `Autopilot ${enabled ? 'on' : 'off'}.`
        },
      }),
    ],
    systemPrompt:
      'You are the research lead reporting to a busy, non-technical business owner about their autonomous website experiment. Always check get_lab_status (and research memory for "why" questions) before answering. Be plain-spoken and brief: lead with the answer, then the evidence (a number and a participant quote when available), then a recommendation. No jargon, no markdown headings, at most ~80 words unless asked for more.',
  })
  const result = await agent.invoke(text)
  const reply = result.toString().trim()
  await ownerMessages.insertOne({ _id: newId(), labId: LAB_ID, role: 'assistant', text: reply, createdAt: new Date() })
  return reply
}
