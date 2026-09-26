import {
  AGENT_ROLES,
  TOPICS,
  type AgentRole,
  type HarnessConfig,
  type HarnessDoc,
  type HarnessEvaluation,
  type InterviewSnapshot,
} from './types'

/** Tools every role always keeps; the Architect can only grant/revoke the optional ones. */
export const CORE_TOOLS: Record<AgentRole, string[]> = {
  strategist: [],
  builder: ['read_site', 'edit_site', 'run_qa', 'finish'],
  interviewer: ['get_behavior_trace', 'save_insight', 'end_interview'],
  synthesizer: [],
}

/** The interviewer never gets studio memory: it only sees its own participant's session. */
export const OPTIONAL_TOOLS: Record<AgentRole, string[]> = {
  strategist: ['search_research_memory', 'recall_sessions', 'read_digests'],
  builder: ['search_research_memory'],
  interviewer: ['get_attention', 'show_replay'],
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

export const MAX_RULES_PER_AGENT = 6
export const RULE_LENGTH = [8, 200] as const
/** A trial may score up to this many points (0-100 scale) below its baseline and still be promoted, to absorb participant noise. */
export const PROMOTION_TOLERANCE = 3
/** An active version whose round score falls this far below its adoption score is rolled back automatically. */
export const REGRESSION_DROP = 8

const INJECTION =
  /\b(ignore|disregard|forget|bypass|override)\b.{0,40}\b(rules?|instructions?|guardrails?|prompt|previous|above|constraints?)\b|system prompt|reveal (the|your)|jailbreak|you are now/i

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

export function configOf(doc: HarnessConfig): HarnessConfig {
  const { rules, context, guardrails, tools, interview, experiment } = doc
  return structuredClone({ rules, context, guardrails, tools, interview, experiment })
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

export function rulesFor(config: HarnessConfig, role: AgentRole) {
  const rules = config.rules.filter((r) => r.agent === role)
  if (!rules.length) return ''
  return `\nHarness rules (learned from earlier rounds — follow them):\n${rules.map((r) => `- ${r.text}`).join('\n')}`
}

export function guardrailText(config: HarnessConfig) {
  return `\nGuardrails (hard limits):\n- Never change: ${config.guardrails.protectedFacts.join('; ')}\n- Never do: ${config.guardrails.forbidden.join('; ')}`
}

export function allowTools<T extends { name: string }>(config: HarnessConfig, role: AgentRole, tools: T[]): T[] {
  const allowed = new Set([...CORE_TOOLS[role], ...config.tools[role].filter((t) => OPTIONAL_TOOLS[role].includes(t))])
  return tools.filter((t) => allowed.has(t.name))
}

/** Guardrails only ever accumulate: a rollback restores old rules and policies but keeps every protection added since. */
export function withGuardrailsOf(config: HarnessConfig, from: HarnessConfig): HarnessConfig {
  const next = configOf(config)
  next.guardrails.protectedFacts = [...new Set([...next.guardrails.protectedFacts, ...from.guardrails.protectedFacts])]
  next.guardrails.forbidden = [...new Set([...next.guardrails.forbidden, ...from.guardrails.forbidden])]
  return next
}

/** Structural gate every proposal must pass before it can even run as a trial. */
export function validateCandidate(base: HarnessConfig, next: HarnessConfig): string[] {
  const errors: string[] = []
  for (const role of AGENT_ROLES) {
    const rules = next.rules.filter((r) => r.agent === role)
    if (rules.length > MAX_RULES_PER_AGENT) errors.push(`${role} has ${rules.length} rules (max ${MAX_RULES_PER_AGENT})`)
    for (const t of CORE_TOOLS[role]) if (!next.tools[role].includes(t)) errors.push(`${role} lost core tool ${t}`)
    for (const t of next.tools[role]) {
      if (!CORE_TOOLS[role].includes(t) && !OPTIONAL_TOOLS[role].includes(t)) errors.push(`${role} cannot use tool ${t}`)
    }
  }
  for (const r of next.rules) {
    if (r.text.length < RULE_LENGTH[0] || r.text.length > RULE_LENGTH[1]) errors.push(`rule ${r.id} length ${r.text.length} out of bounds`)
    if (INJECTION.test(r.text)) errors.push(`rule ${r.id} tries to override other instructions`)
  }
  for (const text of [...next.guardrails.protectedFacts, ...next.guardrails.forbidden]) {
    if (INJECTION.test(text)) errors.push(`guardrail "${text.slice(0, 40)}" tries to override other instructions`)
  }
  for (const f of base.guardrails.protectedFacts) if (!next.guardrails.protectedFacts.includes(f)) errors.push(`protected fact removed: ${f}`)
  for (const f of base.guardrails.forbidden) if (!next.guardrails.forbidden.includes(f)) errors.push(`forbidden pattern removed: ${f}`)

  const numeric: [keyof typeof LIMITS, number][] = [
    ['memoryK', next.context.memoryK],
    ['digestCount', next.context.digestCount],
    ['maxContextChars', next.context.maxContextChars],
    ['maxEdits', next.guardrails.maxEdits],
    ['behavioralQuestions', next.interview.behavioralQuestions],
    ['journeyQuestions', next.interview.journeyQuestions],
    ['replayMoments', next.interview.replayMoments],
    ['maxTurns', next.interview.maxTurns],
    ['variantsPerGeneration', next.experiment.variantsPerGeneration],
    ['sessionsPerVariant', next.experiment.sessionsPerVariant],
  ]
  for (const [key, value] of numeric) {
    const [lo, hi] = LIMITS[key]
    if (!Number.isInteger(value) || value < lo || value > hi) errors.push(`${key}=${value} outside ${lo}-${hi}`)
  }
  return errors
}

type Verdict = Pick<HarnessEvaluation, 'verdict' | 'reason'>

/** A trial replaces the active version only if its round held up against the score it was proposed at. */
export function decidePromotion(input: { baseline: number | null; observed: number | null; n: number }): Verdict {
  const { baseline, observed, n } = input
  if (observed === null || n === 0) return { verdict: 'reject', reason: 'No completed sessions ran under this trial, so there is no evidence it helps.' }
  if (baseline === null) return { verdict: 'promote', reason: `First measured version (score ${observed}); nothing earlier to compare against.` }
  if (observed >= baseline - PROMOTION_TOLERANCE) {
    return { verdict: 'promote', reason: `Scored ${observed} vs ${baseline} before (within ${PROMOTION_TOLERANCE} points or better, n=${n}).` }
  }
  return { verdict: 'reject', reason: `Scored ${observed}, more than ${PROMOTION_TOLERANCE} points below the ${baseline} it was proposed at (n=${n}).` }
}

export function detectRegression(input: { adoptedAt: number | null; latest: number | null }) {
  const { adoptedAt, latest } = input
  return adoptedAt !== null && latest !== null && latest < adoptedAt - REGRESSION_DROP
}

/** Everything the interviewer may know, copied out of one harness version. No studio rules, memory or hypotheses. */
export function buildInterviewSnapshot(doc: Pick<HarnessDoc, 'version'> & HarnessConfig, task: string): InterviewSnapshot {
  return {
    harnessVersion: doc.version,
    task,
    rules: doc.rules.filter((r) => r.agent === 'interviewer').map((r) => r.text),
    policy: { ...doc.interview },
    tools: [...new Set([...CORE_TOOLS.interviewer, ...doc.tools.interviewer.filter((t) => OPTIONAL_TOOLS.interviewer.includes(t))])],
    traceDetail: doc.context.traceDetail,
    topics: [...TOPICS],
  }
}
