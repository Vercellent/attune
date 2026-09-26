import 'server-only'
import { collections, newId } from './db'
import { logActivity } from './activity'
import {
  AGENT_ROLES,
  LAB_ID,
  type AgentRole,
  type HarnessChange,
  type HarnessConfig,
  type HarnessDoc,
} from './types'

/** Tools every role always keeps; the Architect can only grant/revoke the optional ones. */
export const CORE_TOOLS: Record<AgentRole, string[]> = {
  strategist: [],
  builder: ['read_site', 'edit_site', 'run_qa', 'finish'],
  interviewer: ['get_behavior_trace', 'save_insight', 'end_interview'],
  synthesizer: [],
}

export const OPTIONAL_TOOLS: Record<AgentRole, string[]> = {
  strategist: ['search_research_memory', 'recall_sessions', 'read_digests'],
  builder: ['search_research_memory'],
  interviewer: ['get_attention', 'show_replay', 'search_research_memory'],
  synthesizer: ['search_research_memory', 'recall_sessions'],
}

export const LIMITS = {
  memoryK: [2, 12],
  digestCount: [1, 5],
  maxContextChars: [4000, 24000],
  maxEdits: [8, 40],
  behavioralQuestions: [0, 3],
  journeyQuestions: [1, 4],
  replayMoments: [0, 3],
  maxTurns: [4, 12],
  variantsPerGeneration: [2, 4],
  sessionsPerVariant: [1, 4],
} as const

export function seedConfig(): HarnessConfig {
  return {
    rules: [
      { id: 'r1', agent: 'strategist', text: 'Test one idea per variant so outcomes stay attributable.', addedIn: 1 },
      { id: 'r2', agent: 'builder', text: 'Match the existing design tokens; never introduce new fonts or colors.', addedIn: 1 },
      { id: 'r3', agent: 'interviewer', text: 'Never lead the participant; ask open questions about expectations.', addedIn: 1 },
      { id: 'r4', agent: 'synthesizer', text: 'Mark confidence low when a variant has fewer than 3 sessions.', addedIn: 1 },
    ],
    context: { memoryK: 5, digestCount: 2, traceDetail: 'summary', maxContextChars: 12000 },
    guardrails: {
      maxEdits: 24,
      protectedFacts: ['Product prices', 'Shipping cost amount'],
      forbidden: ['Removing the checkout flow', 'Fake urgency or countdown timers'],
    },
    tools: {
      strategist: ['search_research_memory'],
      builder: [...CORE_TOOLS.builder],
      interviewer: [...CORE_TOOLS.interviewer, 'get_attention', 'show_replay'],
      synthesizer: ['search_research_memory'],
    },
    interview: { behavioralQuestions: 2, journeyQuestions: 2, replayMoments: 1, maxTurns: 8 },
    experiment: { variantsPerGeneration: 3, sessionsPerVariant: 2 },
  }
}

export function configOf(doc: HarnessDoc): HarnessConfig {
  const { rules, context, guardrails, tools, interview, experiment } = doc
  return structuredClone({ rules, context, guardrails, tools, interview, experiment })
}

export async function getHarness(): Promise<HarnessDoc> {
  const { harness } = await collections()
  const current = await harness.find({ labId: LAB_ID }).sort({ version: -1 }).limit(1).next()
  if (current) return current
  return seedHarness()
}

export async function listHarness() {
  const { harness } = await collections()
  return harness.find({ labId: LAB_ID }).sort({ version: 1 }).toArray()
}

export async function seedHarness(): Promise<HarnessDoc> {
  const { harness } = await collections()
  const config = seedConfig()
  const doc: HarnessDoc = {
    _id: newId(),
    labId: LAB_ID,
    version: 1,
    parent: null,
    author: 'seed',
    rationale: 'Initial harness: conservative defaults before any evidence.',
    changes: [],
    scoreAtAdoption: null,
    scoreAfter: null,
    createdAt: new Date(),
    ...config,
  }
  await harness.updateOne({ labId: LAB_ID, version: 1 }, { $setOnInsert: doc }, { upsert: true })
  const seeded = (await harness.findOne({ labId: LAB_ID, version: 1 }))!
  logActivity('harness', 'evolve', 'v1 seeded', describeConfig(config))
  return seeded
}

export function describeConfig(c: HarnessConfig) {
  return [
    ...c.rules.map((r) => `rule[${r.agent}] ${r.text}`),
    `context  memoryK=${c.context.memoryK} digests=${c.context.digestCount} trace=${c.context.traceDetail} budget=${c.context.maxContextChars}ch`,
    `guard    maxEdits=${c.guardrails.maxEdits} protect=[${c.guardrails.protectedFacts.join(', ')}] forbid=[${c.guardrails.forbidden.join(', ')}]`,
    ...AGENT_ROLES.map((r) => `tools[${r}] ${c.tools[r].join(', ') || '—'}`),
    `interview behavioral=${c.interview.behavioralQuestions} journey=${c.interview.journeyQuestions} replays=${c.interview.replayMoments} maxTurns=${c.interview.maxTurns}`,
    `experiment variants/gen=${c.experiment.variantsPerGeneration} sessions/variant=${c.experiment.sessionsPerVariant}`,
  ].join('\n')
}

export async function commitHarness(opts: {
  base: HarnessDoc
  config: HarnessConfig
  changes: HarnessChange[]
  rationale: string
  author: HarnessDoc['author']
  scoreAtAdoption: number | null
}): Promise<HarnessDoc> {
  const { harness } = await collections()
  const doc: HarnessDoc = {
    _id: newId(),
    labId: LAB_ID,
    version: opts.base.version + 1,
    parent: opts.base.version,
    author: opts.author,
    rationale: opts.rationale,
    changes: opts.changes,
    scoreAtAdoption: opts.scoreAtAdoption,
    scoreAfter: null,
    createdAt: new Date(),
    ...opts.config,
  }
  await harness.insertOne(doc)
  logActivity('harness', 'evolve', `v${opts.base.version} → v${doc.version} · ${opts.rationale}`, describeConfig(opts.config))
  for (const c of opts.changes) {
    logActivity('harness', 'evolve', `${c.path}: ${c.before || '∅'} → ${c.after || '∅'}`, c.why)
  }
  return doc
}

export async function creditHarness(version: number, score: number | null) {
  const { harness } = await collections()
  await harness.updateOne({ labId: LAB_ID, version }, { $set: { scoreAfter: score } })
}

export function rulesFor(config: HarnessConfig, role: AgentRole) {
  const rules = config.rules.filter((r) => r.agent === role)
  if (!rules.length) return ''
  return `\nHarness rules (learned from earlier rounds — follow them):\n${rules.map((r) => `- ${r.text}`).join('\n')}`
}

export function guardrailText(config: HarnessConfig) {
  return `\nGuardrails (hard limits):\n- Never change: ${config.guardrails.protectedFacts.join('; ')}\n- Never do: ${config.guardrails.forbidden.join('; ')}`
}

export function allowTools<T extends { name: string }>(config: HarnessConfig, role: AgentRole, tools: T[]): T[] {
  const allowed = new Set([...CORE_TOOLS[role], ...config.tools[role]])
  return tools.filter((t) => allowed.has(t.name))
}
