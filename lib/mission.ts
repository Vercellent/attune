import 'server-only'
import { collections } from './db'
import { logActivity } from './activity'
import { searchDigests, searchMemory } from './memory'
import { rulesFor } from './harness-policy'
import { DEFAULT_TARGETS, describeGoals, goalGaps } from './goals'
import { LAB_ID, type AgentRole, type HarnessConfig, type MetricSnapshot, type MissionDoc, type RetrievedMemory } from './types'

export async function getMission() {
  const { missions } = await collections()
  return missions.findOne({ _id: LAB_ID })
}

export async function initMission(objective: string, target: number) {
  const { missions } = await collections()
  const doc: MissionDoc = {
    _id: LAB_ID,
    objective,
    target,
    targets: DEFAULT_TARGETS,
    experiments: 0,
    epoch: 0,
    baseline: null,
    best: null,
    tokens: { input: 0, output: 0, total: 0 },
    agentRuns: 0,
    milestones: [{ at: new Date(), text: 'Mission started' }],
    updatedAt: new Date(),
  }
  await missions.replaceOne({ _id: LAB_ID }, doc, { upsert: true })
  logActivity('mission', 'mission', `objective set · target ${target} experiments`, objective)
}

export async function milestone(text: string) {
  const { missions } = await collections()
  await missions.updateOne({ _id: LAB_ID }, { $push: { milestones: { at: new Date(), text } }, $set: { updatedAt: new Date() } })
  logActivity('mission', 'mission', text)
}

/** Every Strands invocation reports its token usage here so the mission tracks total work over its lifetime. */
export function recordUsage(usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined) {
  if (!usage) return
  void collections()
    .then(({ missions }) =>
      missions.updateOne(
        { _id: LAB_ID },
        {
          $inc: {
            'tokens.input': usage.inputTokens ?? 0,
            'tokens.output': usage.outputTokens ?? 0,
            'tokens.total': usage.totalTokens ?? 0,
            agentRuns: 1,
          },
        },
      ),
    )
    .catch(() => {})
}

export async function updateProgress(opts: { experiments: number; epoch: number; snapshot: MetricSnapshot }) {
  const { missions } = await collections()
  const mission = await getMission()
  if (!mission) return null
  const baseline = mission.baseline ?? opts.snapshot
  const improved = (opts.snapshot.score ?? -1) > (mission.best?.score ?? -1)
  const best = improved ? opts.snapshot : mission.best
  await missions.updateOne(
    { _id: LAB_ID },
    { $set: { experiments: opts.experiments, epoch: opts.epoch, baseline, best, updatedAt: new Date() } },
  )
  const targets = mission.targets ?? DEFAULT_TARGETS
  const before = new Set(goalGaps(mission.best, targets).filter((g) => g.gap === 0).map((g) => g.metric))
  for (const g of goalGaps(best, targets)) {
    if (g.gap === 0 && !before.has(g.metric)) await milestone(`goal reached · ${g.metric} ${g.current} ≥ ${g.target}`)
  }
  const tokens = mission.tokens.total
  logActivity(
    'mission',
    'mission',
    `epoch ${opts.epoch} · ${opts.experiments}/${mission.target} experiments · score ${baseline.score ?? '–'} → ${best?.score ?? '–'} · ${formatTokens(tokens)} tokens across ${mission.agentRuns} agent runs`,
  )
  return { ...mission, baseline, best, experiments: opts.experiments }
}

export const formatTokens = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n)

/**
 * Builds the bounded working context for one agent run from the memory tiers:
 * mission (always) → procedural rules (harness) → compacted digests → vector-retrieved findings.
 * Total history can grow without bound; what an agent sees stays within the harness budget.
 */
export async function contextPack(role: AgentRole, config: HarnessConfig, query?: string) {
  const { digests } = await collections()
  const mission = await getMission()
  const parts: string[] = []
  const memoryUsed: RetrievedMemory[] = []

  if (mission) {
    parts.push(
      `MISSION: ${mission.objective}\nProgress: ${mission.experiments}/${mission.target} experiments, epoch ${mission.epoch}. Baseline score ${mission.baseline?.score ?? 'n/a'}, best so far ${mission.best?.score ?? 'n/a'}.`,
      describeGoals(mission.best, mission.targets),
    )
  }
  const rules = rulesFor(config, role)
  if (rules) parts.push(rules.trim())

  const recent = await digests.find({ labId: LAB_ID }).sort({ epoch: -1 }).limit(config.context.digestCount).toArray()
  if (recent.length) {
    parts.push(`COMPACTED HISTORY (most recent first):\n${recent.map((d) => `[epoch ${d.epoch}] ${d.text}`).join('\n\n')}`)
  }
  const older = query && recent.length ? await searchDigests(query, 2, recent.map((d) => d.epoch)) : []
  if (older.length) {
    parts.push(`RELEVANT OLDER EPOCHS (semantic recall):\n${older.map((d) => `[epoch ${d.epoch}] ${d.text}`).join('\n\n')}`)
  }

  let mode = 'none'
  if (query) {
    const res = await searchMemory(query, { k: config.context.memoryK })
    mode = res.mode
    memoryUsed.push(...res.results)
    if (res.results.length) {
      parts.push(`RELEVANT FINDINGS (${res.mode}):\n${res.results.map((r) => `- [${r.topic}, ${r.confidence}] ${r.observation}`).join('\n')}`)
    }
  }

  let text = parts.join('\n\n')
  const budget = config.context.maxContextChars
  const clipped = text.length > budget
  if (clipped) text = text.slice(0, budget)
  logActivity(
    role,
    'context',
    `context pack · mission + goals + ${rules ? 'rules + ' : ''}${recent.length} digest(s) + ${older.length} recalled epoch(s) + ${memoryUsed.length} finding(s) [${mode}] · ${text.length.toLocaleString()}/${budget.toLocaleString()} chars${clipped ? ' (clipped)' : ''}`,
    text,
  )
  return { text, memoryUsed }
}
