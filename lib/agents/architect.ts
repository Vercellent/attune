import 'server-only'
import { tool } from '@strands-agents/sdk'
import { z } from 'zod'
import { tracedAgent } from './trace'
import { codex } from './model'
import { collections, newId } from '../db'
import { embed } from '../memory'
import { logActivity } from '../activity'
import {
  CORE_TOOLS,
  LIMITS,
  OPTIONAL_TOOLS,
  commitHarness,
  configOf,
  describeConfig,
  listHarness,
} from '../harness'
import { AGENT_ROLES, LAB_ID, type AgentRole, type HarnessChange, type HarnessDoc, type MetricSnapshot } from '../types'

const clamp = (key: keyof typeof LIMITS, v: number) => {
  const [lo, hi] = LIMITS[key]
  return Math.min(hi, Math.max(lo, Math.round(v)))
}

export type ArchitectInput = {
  current: HarnessDoc
  trajectory: { generation: number; harness: number; snapshot: MetricSnapshot }[]
  telemetry: string
  findings: string[]
  remaining: number
}

/**
 * Recursive harnessing: the Architect reads hard metric signals and rewrites the environment
 * the other agents run in. Every mutation is bounded, justified, diffed and versioned.
 */
export async function evolveHarness(input: ArchitectInput): Promise<HarnessDoc | null> {
  const draft = configOf(input.current)
  const changes: HarnessChange[] = []
  let rationale = ''
  let rollbackTo: HarnessDoc | null = null
  const history = await listHarness()
  const role = z.enum(AGENT_ROLES)
  const why = z.string().min(8).describe('The metric or evidence that justifies this change')
  const record = (path: string, before: unknown, after: unknown, reason: string) => {
    changes.push({ path, before: String(before ?? ''), after: String(after ?? ''), why: reason })
    return `OK ${path}: ${before} → ${after}`
  }

  const tools = [
    tool({
      name: 'add_rule',
      description: 'Add a procedural rule an agent must follow in every future run.',
      inputSchema: z.object({ agent: role, text: z.string().min(8).max(200), why }),
      callback: ({ agent, text, why: w }) => {
        if (draft.rules.filter((r) => r.agent === agent).length >= 6) return 'REJECTED: that agent already has 6 rules; remove one first.'
        draft.rules.push({ id: newId().slice(-6), agent, text, addedIn: input.current.version + 1 })
        return record(`rules.${agent}`, '', text, w)
      },
    }),
    tool({
      name: 'remove_rule',
      description: 'Remove a rule that is not paying off or conflicts with the evidence.',
      inputSchema: z.object({ id: z.string(), why }),
      callback: ({ id, why: w }) => {
        const r = draft.rules.find((x) => x.id === id)
        if (!r) return 'REJECTED: no rule with that id.'
        draft.rules = draft.rules.filter((x) => x.id !== id)
        return record(`rules.${r.agent}`, r.text, '', w)
      },
    }),
    tool({
      name: 'set_context_policy',
      description: 'Tune what agents see: memoryK (vector hits), digestCount (compacted epochs), traceDetail, maxContextChars.',
      inputSchema: z.object({
        field: z.enum(['memoryK', 'digestCount', 'traceDetail', 'maxContextChars']),
        value: z.union([z.number(), z.enum(['summary', 'full'])]),
        why,
      }),
      callback: ({ field, value, why: w }) => {
        const before = draft.context[field]
        if (field === 'traceDetail') {
          if (value !== 'summary' && value !== 'full') return 'REJECTED: traceDetail is "summary" or "full".'
          draft.context.traceDetail = value
        } else {
          if (typeof value !== 'number') return 'REJECTED: number required.'
          draft.context[field] = clamp(field, value)
        }
        return record(`context.${field}`, before, draft.context[field], w)
      },
    }),
    tool({
      name: 'set_guardrail',
      description: 'Adjust guardrails: builder edit budget, protected facts, forbidden patterns.',
      inputSchema: z.object({
        field: z.enum(['maxEdits', 'protectFact', 'forbid']),
        value: z.union([z.number(), z.string()]),
        why,
      }),
      callback: ({ field, value, why: w }) => {
        if (field === 'maxEdits') {
          if (typeof value !== 'number') return 'REJECTED: number required.'
          const before = draft.guardrails.maxEdits
          draft.guardrails.maxEdits = clamp('maxEdits', value)
          return record('guardrails.maxEdits', before, draft.guardrails.maxEdits, w)
        }
        const list = field === 'protectFact' ? draft.guardrails.protectedFacts : draft.guardrails.forbidden
        if (list.length >= 6) return 'REJECTED: list full.'
        list.push(String(value).slice(0, 120))
        return record(`guardrails.${field}`, '', value, w)
      },
    }),
    tool({
      name: 'set_tool_access',
      description: `Grant or revoke an optional tool. Optional tools: ${AGENT_ROLES.map((r) => `${r}=[${OPTIONAL_TOOLS[r].join(', ')}]`).join('; ')}. Core tools cannot be revoked.`,
      inputSchema: z.object({ agent: role, tool: z.string(), grant: z.boolean(), why }),
      callback: ({ agent, tool: name, grant, why: w }) => {
        const a = agent as AgentRole
        if (CORE_TOOLS[a].includes(name)) return 'REJECTED: core tool.'
        if (!OPTIONAL_TOOLS[a].includes(name)) return `REJECTED: ${name} is not available to ${a}.`
        const had = draft.tools[a].includes(name)
        if (grant === had) return `NOOP: already ${grant ? 'granted' : 'revoked'}.`
        draft.tools[a] = grant ? [...draft.tools[a], name] : draft.tools[a].filter((t) => t !== name)
        return record(`tools.${a}`, had ? name : '', grant ? name : '', w)
      },
    }),
    tool({
      name: 'set_interview_policy',
      description: 'Tune the interviewer: behavioralQuestions, journeyQuestions, replayMoments (video clips shown), maxTurns.',
      inputSchema: z.object({
        field: z.enum(['behavioralQuestions', 'journeyQuestions', 'replayMoments', 'maxTurns']),
        value: z.number(),
        why,
      }),
      callback: ({ field, value, why: w }) => {
        const before = draft.interview[field]
        draft.interview[field] = clamp(field, value)
        return record(`interview.${field}`, before, draft.interview[field], w)
      },
    }),
    tool({
      name: 'set_experiment_policy',
      description: 'Tune experiment shape: variantsPerGeneration (incl. control) and sessionsPerVariant before a round closes.',
      inputSchema: z.object({ field: z.enum(['variantsPerGeneration', 'sessionsPerVariant']), value: z.number(), why }),
      callback: ({ field, value, why: w }) => {
        const before = draft.experiment[field]
        draft.experiment[field] = clamp(field, value)
        return record(`experiment.${field}`, before, draft.experiment[field], w)
      },
    }),
    tool({
      name: 'rollback',
      description: 'Revert the whole harness to an earlier version whose scoreAfter beat what followed it.',
      inputSchema: z.object({ version: z.number().int(), why }),
      callback: ({ version, why: w }) => {
        const target = history.find((h) => h.version === version)
        if (!target || version >= input.current.version) return 'REJECTED: pick an earlier version.'
        rollbackTo = target
        Object.assign(draft, configOf(target))
        return record('harness', `v${input.current.version}`, `v${version}`, w)
      },
    }),
    tool({
      name: 'commit',
      description: 'Finish. Summarize the evolution in one sentence (or say why nothing should change).',
      inputSchema: z.object({ rationale: z.string().min(8).max(200) }),
      callback: ({ rationale: r }) => {
        rationale = r
        return 'Committed.'
      },
    }),
  ]

  const agent = tracedAgent('architect', {
    model: codex('conversational'),
    printer: false,
    tools,
    systemPrompt: `You are the Harness Architect of a self-improving experimentation system. Other agents (strategist, builder, interviewer, synthesizer) run inside a harness you control: rules, context policy, guardrails, tool access, interview policy and experiment shape.
After every round you read HARD metric signals and adapt the environment to this specific client, task and participant pool.
Principles:
- Change only what evidence supports; cite the metric in "why". 0-3 changes per round is typical; no change is valid.
- Credit assignment: compare each harness version's scoreAtAdoption vs scoreAfter. Keep what helped, roll back what hurt.
- If builds fail QA, tighten builder rules or edit budget. If interviews yield few insights, change interview policy or grant show_replay. If scores plateau, widen exploration (more variants, new strategist rule). If noisy, add sessionsPerVariant.
- As the mission nears its target, favor exploitation and tighter guardrails.
Always call commit last.`,
  })

  const historyText = history
    .map(
      (h) =>
        `v${h.version} (${h.author}) adopted@${h.scoreAtAdoption ?? '–'} → after ${h.scoreAfter ?? '–'}: ${h.rationale}${h.changes.length ? ` [${h.changes.map((c) => c.path).join(', ')}]` : ''}`,
    )
    .join('\n')
  const trajectoryText = input.trajectory
    .map(
      (t) =>
        `R${t.generation} (harness v${t.harness}): score ${t.snapshot.score ?? '–'}, completion ${t.snapshot.completion ?? '–'}%, time ${t.snapshot.timeSec ?? '–'}s, friction ${t.snapshot.friction ?? '–'}, n=${t.snapshot.n}`,
    )
    .join('\n')

  await agent.invoke(
    `METRIC TRAJECTORY\n${trajectoryText}\n\nHARNESS HISTORY\n${historyText}\n\nCURRENT HARNESS v${input.current.version}\n${describeConfig(draft)}\nRule ids: ${draft.rules.map((r) => `${r.id}=${r.agent}`).join(', ')}\n\nAGENT TELEMETRY\n${input.telemetry}\n\nNEW FINDINGS\n${input.findings.join('\n') || 'none'}\n\nExperiments remaining in mission: ${input.remaining}`,
  )

  if (!changes.length) {
    logActivity('architect', 'evolve', `harness v${input.current.version} kept · ${rationale || 'no change warranted'}`)
    return null
  }
  const last = input.trajectory.at(-1)?.snapshot.score ?? null
  return commitHarness({
    base: input.current,
    config: draft,
    changes,
    rationale: rationale || 'Adapted to latest evidence',
    author: rollbackTo ? 'rollback' : 'architect',
    scoreAtAdoption: last,
  })
}

const digestSchema = z.object({
  digest: z
    .string()
    .describe('Dense summary of everything learned so far: what won, what failed, open questions, harness lessons. Max 180 words.'),
})

/**
 * Long-horizon memory: fold the previous digest plus the latest round into a new epoch digest.
 * Raw sessions stay in Atlas (episodic tier); agents see the compacted digest instead of raw history.
 */
export async function compactEpoch(opts: { epoch: number; generation: number; roundSummary: string }) {
  const { digests } = await collections()
  const previous = await digests.find({ labId: LAB_ID }).sort({ epoch: -1 }).limit(1).next()
  const agent = tracedAgent('compactor', {
    model: codex('conversational'),
    printer: false,
    systemPrompt:
      'You compress a long-running research program into a lossless-as-possible digest. Preserve numbers, winning patterns, dead ends, and anything a future agent must not repeat.',
  })
  const result = await agent.invoke(
    `PREVIOUS DIGEST (epoch ${previous?.epoch ?? 0}):\n${previous?.text ?? 'none'}\n\nLATEST ROUND ${opts.generation}:\n${opts.roundSummary}`,
    { structuredOutputSchema: digestSchema },
  )
  const text = (result.structuredOutput as z.infer<typeof digestSchema>).digest
  await digests.insertOne({
    _id: newId(),
    labId: LAB_ID,
    epoch: opts.epoch,
    throughGeneration: opts.generation,
    text,
    embedding: (await embed([text], 'document'))?.[0] ?? null,
    createdAt: new Date(),
  })
  logActivity(
    'compactor',
    'memory',
    `epoch ${opts.epoch} digest · ${opts.roundSummary.length.toLocaleString()} → ${text.length.toLocaleString()} chars (raw sessions kept in Atlas)`,
    text,
  )
}
