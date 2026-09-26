import 'server-only'
import { tracedAgent } from './trace'
import { z } from 'zod'
import { TOPICS, type Brief, type Playbook, type RetrievedMemory, type SiteSpec } from '../types'
import { codex } from './model'
import { memoryTool } from './tools'

const planSchema = z.object({
  variants: z
    .array(
      z.object({
        name: z.string().describe('2-4 word name, e.g. "Upfront shipping"'),
        hypothesis: z.string().describe('"If we X, then Y, because Z" in one sentence'),
        instructions: z.string().describe('Concrete implementation brief for the builder: which elements, what copy, what styling'),
      }),
    )
    .min(1)
    .max(3),
})
export type Plan = z.infer<typeof planSchema>

export async function planGeneration(opts: {
  brief: Brief
  spec: SiteSpec
  playbook: Playbook | null
  generation: number
  count: number
  championChanges: string[]
}) {
  const memoryUsed: RetrievedMemory[] = []
  const agent = tracedAgent('strategist', {
    model: codex('conversational'),
    printer: false,
    tools: [memoryTool(memoryUsed)],
    systemPrompt:
      'You are the lead experimentation strategist in an autonomous CRO lab. Each generation you propose challenger variants to beat the current champion. Ground every hypothesis in evidence: search research memory first, then combine it with the site spec. Each variant tests ONE distinct idea so results are attributable. Avoid repeating ideas the playbook marks as converged.',
  })
  const result = await agent.invoke(
    `Generation ${opts.generation}. Propose exactly ${opts.count} challenger variant(s).\nGoal: ${opts.brief.goal}\nParticipant task: ${opts.brief.task}\nSite: ${opts.spec.summary}\nFlow: ${opts.spec.flow.join(' → ')}\nKnown friction: ${opts.spec.frictionPoints.join('; ')}\nChampion already includes: ${opts.championChanges.join('; ') || 'nothing (original site)'}\nPlaybook: ${opts.playbook ? JSON.stringify(opts.playbook) : 'none yet'}`,
    { structuredOutputSchema: planSchema },
  )
  const plan = result.structuredOutput as Plan
  return { variants: plan.variants.slice(0, opts.count), memoryUsed }
}

const synthesisSchema = z.object({
  winnerKey: z.string().describe('Key of the winning variant, e.g. "B"'),
  findings: z
    .array(
      z.object({
        topic: z.enum(TOPICS),
        observation: z.string().describe('The generalizable learning, one sentence'),
        implicitEvidence: z.string().describe('What behavior showed (numbers, clicks, pauses)'),
        explicitEvidence: z.string().describe('What participants said, quote if possible'),
        confidence: z.enum(['low', 'medium', 'high']),
      }),
    )
    .max(5),
  playbook: z.object({
    focus: z.array(z.string()).describe('What to explore next'),
    converged: z.array(z.string()).describe('Learnings that are settled and should be kept'),
    nextHypotheses: z.array(z.string()),
  }),
  ownerUpdate: z
    .string()
    .describe('Plain-language update for the non-technical business owner: what won, why (behavior + quotes), and what happens next. Max 90 words.'),
})
export type Synthesis = z.infer<typeof synthesisSchema>

export async function synthesizeGeneration(opts: {
  brief: Brief
  generation: number
  playbook: Playbook | null
  evidence: string
}) {
  const agent = tracedAgent('synthesizer', {
    model: codex('conversational'),
    printer: false,
    tools: [memoryTool()],
    systemPrompt:
      'You are the research synthesizer. You pick the winning variant using the Experiment Score (completion, friction, stated confidence), then explain WHY by triangulating implicit behavior with explicit interview quotes. Only record findings supported by evidence; mark confidence honestly given small samples. Check research memory to connect patterns across generations.',
  })
  const result = await agent.invoke(
    `Generation ${opts.generation} is closing.\nGoal: ${opts.brief.goal}\nPrevious playbook: ${opts.playbook ? JSON.stringify(opts.playbook) : 'none'}\n\nEvidence by variant:\n${opts.evidence}`,
    { structuredOutputSchema: synthesisSchema },
  )
  return result.structuredOutput as Synthesis
}
