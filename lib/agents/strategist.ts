import 'server-only'
import { z } from 'zod'
import { tracedAgent } from './trace'
import { codex } from './model'
import { memoryTool, readDigestsTool, recallSessionsTool } from './tools'
import { allowTools, guardrailText } from '../harness'
import { contextPack } from '../mission'
import { TOPICS, type Brief, type HarnessConfig, type Playbook, type RetrievedMemory, type SiteSpec } from '../types'

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
  harness: HarnessConfig
}) {
  const memoryUsed: RetrievedMemory[] = []
  const pack = await contextPack('strategist', opts.harness, `${opts.brief.optimize} ${opts.spec.frictionPoints.slice(0, 2).join(' ')}`)
  memoryUsed.push(...pack.memoryUsed)

  const agent = tracedAgent('strategist', {
    model: codex('conversational'),
    printer: false,
    tools: allowTools(opts.harness, 'strategist', [
      memoryTool(memoryUsed, opts.harness.context.memoryK),
      recallSessionsTool(),
      readDigestsTool(),
    ]),
    systemPrompt: `You are the lead experimentation strategist in a long-running autonomous CRO lab. Each round you propose challenger variants to beat the current champion. Ground every hypothesis in evidence from your context and tools. Avoid repeating ideas the playbook marks as converged.${guardrailText(opts.harness)}\n\n${pack.text}`,
  })
  const result = await agent.invoke(
    `Round ${opts.generation}. Propose exactly ${opts.count} challenger variant(s).\nOptimizing: ${opts.brief.optimize}\nParticipant task: ${opts.brief.task}\nSite: ${opts.spec.summary}\nFlow: ${opts.spec.flow.join(' → ')}\nKnown friction: ${opts.spec.frictionPoints.join('; ')}\nChampion already includes: ${opts.championChanges.join('; ') || 'nothing (original site)'}\nPlaybook: ${opts.playbook ? JSON.stringify(opts.playbook) : 'none yet'}`,
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
        implicitEvidence: z.string().describe('What behavior or gaze showed (numbers, clicks, pauses, dwell)'),
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
    .describe('Plain-language update for the non-technical business owner: what won, why, what happens next. Max 70 words.'),
})
export type Synthesis = z.infer<typeof synthesisSchema>

export async function synthesizeGeneration(opts: {
  brief: Brief
  generation: number
  playbook: Playbook | null
  evidence: string
  harness: HarnessConfig
}) {
  const pack = await contextPack('synthesizer', opts.harness)
  const agent = tracedAgent('synthesizer', {
    model: codex('conversational'),
    printer: false,
    tools: allowTools(opts.harness, 'synthesizer', [memoryTool([], opts.harness.context.memoryK), recallSessionsTool()]),
    systemPrompt: `You are the research synthesizer. Pick the winning variant using the Experiment Score (completion, friction, stated confidence), then explain WHY by triangulating behavior, gaze and interview quotes. Only record findings supported by evidence; mark confidence honestly.\n\n${pack.text}`,
  })
  const result = await agent.invoke(
    `Round ${opts.generation} is closing.\nOptimizing: ${opts.brief.optimize}\nPrevious playbook: ${opts.playbook ? JSON.stringify(opts.playbook) : 'none'}\n\nEvidence by variant:\n${opts.evidence}`,
    { structuredOutputSchema: synthesisSchema },
  )
  return result.structuredOutput as Synthesis
}
