import 'server-only'
import { collections, newId } from './db'
import { embed, ensureVectorIndex, findingText } from './memory'
import { computeMetrics, findMoments, snapshotOf, summarizeGaze, summarizeTrace } from './scoring'
import { SHOP_HTML } from './shop'
import { buildVariant, reconSite } from './agents/builder'
import { planGeneration, synthesizeGeneration } from './agents/strategist'
import { compactEpoch, evolveHarness } from './agents/architect'
import { navigatorConfirm, navigatorStep, type PageElement } from './agents/navigator'
import { logActivity } from './activity'
import { configOf, creditHarness, getHarness, listHarness, seedHarness } from './harness'
import { getMission, initMission, milestone, updateProgress } from './mission'
import {
  LAB_ID,
  type Brief,
  type CaptureDoc,
  type FindingDoc,
  type GazeDwell,
  type HarnessConfig,
  type LabDoc,
  type MetricSnapshot,
  type RetrievedMemory,
  type SessionDoc,
  type TrackEvent,
  type VariantDoc,
} from './types'

const KEYS = ['A', 'B', 'C', 'D', 'E']
export const DEFAULT_TARGET = 40

export async function getLab() {
  const { labs } = await collections()
  return labs.findOne({ _id: LAB_ID })
}

export async function postOwnerUpdate(text: string) {
  const { ownerMessages } = await collections()
  await ownerMessages.insertOne({ _id: newId(), labId: LAB_ID, role: 'update', text, createdAt: new Date() })
}

async function patchLab(set: Partial<LabDoc>) {
  const { labs } = await collections()
  if (set.step) logActivity('orchestrator', 'system', set.step)
  await labs.updateOne({ _id: LAB_ID }, { $set: { ...set, updatedAt: new Date() } })
}

/** Atomically take the lab's work lock so only one pipeline step runs at a time. */
export async function claimLab(step: string) {
  const { labs } = await collections()
  const stale = new Date(Date.now() - 20 * 60_000)
  const res = await labs.findOneAndUpdate(
    { _id: LAB_ID, $or: [{ status: { $ne: 'working' } }, { updatedAt: { $lt: stale } }] },
    { $set: { status: 'working', step, error: null, updatedAt: new Date() } },
  )
  if (res) logActivity('orchestrator', 'system', step)
  return Boolean(res)
}

async function fail(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  console.error('[lab] pipeline failed', error)
  logActivity('orchestrator', 'error', message)
  await patchLab({ status: 'error', step: null, error: message })
}

export async function setAutopilot(enabled: boolean) {
  await patchLab({ autopilot: enabled })
}

/* ---------------- 1. Client intake + computer-use capture ---------------- */

export async function startCapture(input: Pick<Brief, 'objective' | 'targetUrl' | 'optimize'>, target = DEFAULT_TARGET) {
  const c = await collections()
  await Promise.all([
    c.generations.deleteMany({ labId: LAB_ID }),
    c.activity.deleteMany({ labId: LAB_ID }),
    c.variants.deleteMany({ labId: LAB_ID }),
    c.sessions.deleteMany({ labId: LAB_ID }),
    c.findings.deleteMany({ labId: LAB_ID }),
    c.ownerMessages.deleteMany({ labId: LAB_ID }),
    c.captures.deleteMany({ labId: LAB_ID }),
    c.harness.deleteMany({ labId: LAB_ID }),
    c.digests.deleteMany({ labId: LAB_ID }),
    c.recordings.deleteMany({}),
  ])
  const now = new Date()
  const lab: LabDoc = {
    _id: LAB_ID,
    brief: { ...input, task: '' },
    phase: 'capturing',
    journeySummary: null,
    confirmation: null,
    flow: [],
    spec: null,
    baselineHtml: null,
    generation: 0,
    status: 'idle',
    step: null,
    error: null,
    targetExperiments: target,
    playbook: null,
    championVariantId: null,
    autopilot: true,
    createdAt: now,
    updatedAt: now,
  }
  await c.labs.replaceOne({ _id: LAB_ID }, lab, { upsert: true })
  logActivity('orchestrator', 'start', `new client · ${input.objective}`, `${input.targetUrl}\n${input.optimize}`)
  await initMission(`Optimize "${input.optimize}" on ${input.targetUrl}`, target)
  await seedHarness()
}

export async function captureStep(opts: {
  step: number
  screen: string
  visibleText: string
  elements: PageElement[]
  history: string[]
}) {
  const lab = await getLab()
  if (!lab || lab.phase !== 'capturing') throw new Error('No capture in progress')
  const next = await navigatorStep({ brief: lab.brief, ...opts })
  logActivity('computer-use', 'tool', `step ${opts.step} · ${opts.screen} · ${next.actionSummary}`, next.note)
  return next
}

export async function saveCapture(doc: Omit<CaptureDoc, '_id' | 'labId' | 'createdAt'>) {
  const { captures } = await collections()
  await captures.insertOne({ ...doc, _id: newId(), labId: LAB_ID, createdAt: new Date() })
}

/** Called when the computer-use walkthrough ends: confirm scope, then bootstrap the experiment. */
export async function finishCapture() {
  const { captures } = await collections()
  const lab = await getLab()
  if (!lab) throw new Error('No lab configured')
  const steps = await captures.find({ labId: LAB_ID }).sort({ index: 1 }).toArray()
  const journey = steps
    .map((s) => `${s.index + 1}. ${s.title} — ${s.note}${s.friction.length ? ` Friction: ${s.friction.join('; ')}` : ''} → ${s.action}`)
    .join('\n')
  const confirm = await navigatorConfirm(lab.brief, journey)
  await patchLab({
    phase: 'ready',
    flow: confirm.flow,
    journeySummary: confirm.summary,
    confirmation: confirm.confirmation,
    brief: { ...lab.brief, task: confirm.task },
  })
  await milestone(`journey captured · ${confirm.flow.join(' → ')}`)
  return confirm
}

/** Runs with the lock held: recon → baseline → round 1. */
export async function bootstrapLab() {
  try {
    const lab = await getLab()
    if (!lab) throw new Error('No lab configured')
    const html = SHOP_HTML
    const spec = await reconSite(html, lab.brief, lab.journeySummary ?? '')
    await patchLab({ spec, baselineHtml: html, phase: 'running', step: 'Planning round 1' })
    await ensureVectorIndex()
    await postOwnerUpdate(
      `I studied your ${lab.flow.join(' → ')} flow. Biggest risks: ${spec.frictionPoints.slice(0, 3).join('; ')}. Round 1 is live — share the invite link with testers.`,
    )
    const harness = await getHarness()
    await buildGeneration({ ...lab, spec, baselineHtml: html }, 1, html, [], configOf(harness), harness.version)
    await patchLab({ status: 'idle', step: null })
  } catch (error) {
    await fail(error)
  }
}

async function buildGeneration(
  lab: LabDoc,
  number: number,
  championHtml: string,
  championChanges: string[],
  harness: HarnessConfig,
  harnessVersion: number,
) {
  const c = await collections()
  await patchLab({ step: `Planning round ${number}` })
  const count = harness.experiment.variantsPerGeneration - 1
  const { memoryUsed, ...plan } = await planGeneration({
    brief: lab.brief,
    spec: lab.spec!,
    playbook: lab.playbook,
    generation: number,
    count,
    championChanges,
    harness,
  })

  const generationId = newId()
  await c.generations.insertOne({
    _id: generationId,
    labId: LAB_ID,
    number,
    status: 'building',
    harnessVersion,
    memoryUsed: memoryUsed as RetrievedMemory[],
    winnerVariantId: null,
    learned: null,
    score: null,
    metrics: null,
    telemetry: { buildsAttempted: 0, buildsFailed: 0, qaRetries: 0 },
    createdAt: new Date(),
    closedAt: null,
  })

  const control: VariantDoc = {
    _id: newId(),
    labId: LAB_ID,
    generation: number,
    key: 'A',
    name: number === 1 ? 'Original' : 'Current champion',
    hypothesis: 'Control — the current best version',
    changes: championChanges,
    isControl: true,
    html: championHtml,
    createdAt: new Date(),
  }

  await patchLab({ step: `Codex building ${plan.variants.length} variant(s) for round ${number}` })
  const results = await Promise.allSettled(
    plan.variants.slice(0, count).map((v) =>
      buildVariant({
        baseHtml: championHtml,
        brief: lab.brief,
        spec: lab.spec!,
        name: v.name,
        hypothesis: v.hypothesis,
        instructions: v.instructions,
        harness,
      }).then((build) => ({ v, build })),
    ),
  )

  const variants: VariantDoc[] = [control]
  let failed = 0
  let qaRetries = 0
  for (const r of results) {
    if (r.status === 'rejected') {
      failed++
      logActivity('orchestrator', 'error', `build failed: ${r.reason instanceof Error ? r.reason.message : r.reason}`)
      continue
    }
    qaRetries += r.value.build.qaRetries
    variants.push({
      _id: newId(),
      labId: LAB_ID,
      generation: number,
      key: KEYS[variants.length],
      name: r.value.v.name,
      hypothesis: r.value.v.hypothesis,
      changes: r.value.build.changes,
      isControl: false,
      html: r.value.build.html,
      createdAt: new Date(),
    })
  }
  if (variants.length < 2) throw new Error('No variants could be built this round')
  await c.variants.insertMany(variants)
  await c.generations.updateOne(
    { _id: generationId },
    {
      $set: {
        status: 'collecting',
        telemetry: { buildsAttempted: results.length, buildsFailed: failed, qaRetries },
      },
    },
  )
  await patchLab({ generation: number })
  logActivity(
    'orchestrator',
    'done',
    `round ${number} live · ${variants.map((v) => `${v.key}:${v.name}`).join(' | ')} · needs ${harness.experiment.sessionsPerVariant} tester(s) each`,
  )
}

/* ---------------- 2. Tester sessions ---------------- */

export async function createSession(resumeId?: string) {
  const c = await collections()
  const lab = await getLab()
  if (!lab || lab.phase === 'capturing' || lab.phase === 'ready' || !lab.generation) return null
  if (resumeId) {
    const existing = await c.sessions.findOne(
      { _id: resumeId, labId: LAB_ID, generation: lab.generation, status: 'briefing' },
      { projection: { variantId: 1 } },
    )
    if (existing) return { sessionId: existing._id, variantId: existing.variantId, task: lab.brief.task }
  }
  const pool = await c.variants.find({ labId: LAB_ID, generation: lab.generation }, { projection: { html: 0 } }).toArray()
  if (!pool.length) return null
  const counts = await c.sessions
    .aggregate<{ _id: string; n: number }>([
      { $match: { labId: LAB_ID, generation: lab.generation, status: { $ne: 'briefing' } } },
      { $group: { _id: '$variantId', n: { $sum: 1 } } },
    ])
    .toArray()
  const n = (id: string) => counts.find((x) => x._id === id)?.n ?? 0
  const variant = [...pool].sort((a, b) => n(a._id) - n(b._id) || Math.random() - 0.5)[0]
  const session: SessionDoc = {
    _id: newId(),
    labId: LAB_ID,
    generation: lab.generation,
    variantId: variant._id,
    variantKey: variant.key,
    status: 'briefing',
    camera: false,
    events: [],
    gaze: [],
    metrics: null,
    moments: [],
    messages: [],
    insights: [],
    priceConfidence: null,
    summary: null,
    score: null,
    createdAt: new Date(),
    taskStartedAt: null,
    taskEndedAt: null,
    endedAt: null,
  }
  await c.sessions.insertOne(session)
  logActivity('orchestrator', 'system', `tester joined · round ${lab.generation} · assigned variant ${variant.key}`)
  return { sessionId: session._id, variantId: variant._id, task: lab.brief.task }
}

export async function startTask(sessionId: string, camera: boolean) {
  const { sessions } = await collections()
  await sessions.updateOne(
    { _id: sessionId, labId: LAB_ID, status: 'briefing' },
    { $set: { status: 'task', camera, taskStartedAt: new Date() } },
  )
  logActivity('orchestrator', 'metric', `session ${sessionId.slice(0, 6)} · task started${camera ? ' · webcam gaze on' : ''}`)
}

export async function recordSession(
  sessionId: string,
  data: { events?: TrackEvent[]; gaze?: GazeDwell[]; rrweb?: unknown[]; seq?: number },
) {
  const { sessions, recordings } = await collections()
  const ops: Promise<unknown>[] = []
  if (data.events?.length || data.gaze?.length) {
    ops.push(
      sessions.updateOne(
        { _id: sessionId, labId: LAB_ID, status: 'task' },
        { $push: { events: { $each: data.events ?? [] }, gaze: { $each: data.gaze ?? [] } } },
      ),
    )
  }
  if (data.rrweb?.length) {
    ops.push(recordings.insertOne({ _id: newId(), sessionId, seq: data.seq ?? Date.now(), events: data.rrweb, createdAt: new Date() }))
  }
  await Promise.all(ops)
}

/** Stop pressed: freeze behavior, compute metrics and the moments worth replaying in the interview. */
export async function stopTask(sessionId: string) {
  const { sessions } = await collections()
  const session = await sessions.findOne({ _id: sessionId, labId: LAB_ID })
  if (!session || session.status !== 'task') return session
  const ended = new Date()
  const duration = ended.getTime() - (session.taskStartedAt?.getTime() ?? ended.getTime())
  const metrics = computeMetrics(session.events, duration)
  const moments = findMoments(session.events, metrics)
  await sessions.updateOne(
    { _id: sessionId },
    { $set: { status: 'interview', metrics, moments, taskEndedAt: ended } },
  )
  logActivity(
    'orchestrator',
    'metric',
    `session ${sessionId.slice(0, 6)} · ${metrics.completed ? 'completed' : 'did not complete'} in ${Math.round(duration / 1000)}s · ${metrics.clicks} clicks · ${metrics.deadClicks} dead · ${metrics.rageClicks} rage · ${moments.length} replay moment(s)`,
    summarizeTrace(session.events, metrics, 'full'),
  )
  return { ...session, metrics, moments, status: 'interview' as const }
}

export async function getReplayEvents(sessionId: string, endTs: number) {
  const { recordings } = await collections()
  const chunks = await recordings.find({ sessionId }).sort({ seq: 1 }).toArray()
  return chunks
    .flatMap((c) => c.events as { timestamp: number }[])
    .filter((e) => e.timestamp <= endTs + 1500)
    .sort((a, b) => a.timestamp - b.timestamp)
}

/* ---------------- 3. Closing rounds: synthesize → evolve harness → next round ---------------- */

export async function readyToAdvance() {
  const c = await collections()
  const lab = await getLab()
  if (!lab || lab.phase !== 'running' || !lab.autopilot) return false
  const harness = configOf(await getHarness())
  const pool = await c.variants.find({ labId: LAB_ID, generation: lab.generation }, { projection: { _id: 1 } }).toArray()
  const done = await c.sessions
    .aggregate<{ _id: string; n: number }>([
      { $match: { labId: LAB_ID, generation: lab.generation, status: 'done' } },
      { $group: { _id: '$variantId', n: { $sum: 1 } } },
    ])
    .toArray()
  return pool.length > 0 && pool.every((v) => (done.find((d) => d._id === v._id)?.n ?? 0) >= harness.experiment.sessionsPerVariant)
}

export async function advanceLab() {
  try {
    const c = await collections()
    const lab = await getLab()
    if (!lab?.spec) throw new Error('Lab is not running')
    const number = lab.generation
    const harnessDoc = await getHarness()
    const harness = configOf(harnessDoc)
    const [pool, sessions] = await Promise.all([
      c.variants.find({ labId: LAB_ID, generation: number }).toArray(),
      c.sessions.find({ labId: LAB_ID, generation: number, status: 'done' }).toArray(),
    ])
    const byVariant = pool.map((v) => {
      const s = sessions.filter((x) => x.variantId === v._id)
      return { v, s, snap: snapshotOf(s) }
    })
    const evidence = byVariant
      .map(
        ({ v, s, snap }) =>
          `### ${v.key} "${v.name}"${v.isControl ? ' (control)' : ''}\nHypothesis: ${v.hypothesis}\nScore ${snap.score ?? 'n/a'} · completion ${snap.completion ?? 'n/a'} · avg time ${snap.timeSec ?? 'n/a'}s · friction ${snap.friction ?? 'n/a'} · n=${snap.n}\n${s
            .map(
              (x) =>
                `- ${x.summary ?? ''} | ${summarizeTrace(x.events, x.metrics!, harness.context.traceDetail)} | gaze: ${summarizeGaze(x.gaze)} | quotes: ${x.insights.map((i) => `"${i.quote}"`).join(' ')}`,
            )
            .join('\n')}`,
      )
      .join('\n\n')

    await patchLab({ step: `Synthesizing round ${number}` })
    const synthesis = await synthesizeGeneration({ brief: lab.brief, generation: number, playbook: lab.playbook, evidence, harness })

    const ranked = [...byVariant].sort((a, b) => (b.snap.score ?? -1) - (a.snap.score ?? -1))
    const winner = ranked[0]
    const control = byVariant.find((x) => x.v.isControl)!

    const findings: FindingDoc[] = synthesis.findings.map((f) => ({
      _id: newId(),
      labId: LAB_ID,
      generation: number,
      ...f,
      embedding: null,
      createdAt: new Date(),
    }))
    if (findings.length) {
      const vectors = await embed(findings.map(findingText), 'document')
      vectors?.forEach((vec, i) => (findings[i].embedding = vec))
      await c.findings.insertMany(findings)
      logActivity('synthesizer', 'memory', `${findings.length} finding(s) written to Atlas${vectors ? ' with Voyage embeddings' : ''}`, findings.map((f) => `[${f.topic}] ${f.observation}`).join('\n'))
    }

    await c.generations.updateOne(
      { labId: LAB_ID, number },
      {
        $set: {
          status: 'closed',
          winnerVariantId: winner.v._id,
          learned: synthesis.ownerUpdate,
          score: winner.snap.score,
          metrics: winner.snap,
          closedAt: new Date(),
        },
      },
    )
    await creditHarness(harnessDoc.version, winner.snap.score)

    const experiments = await c.sessions.countDocuments({ labId: LAB_ID, status: 'done' })
    const epoch = number
    if (number === 1) {
      const { missions } = await collections()
      await missions.updateOne({ _id: LAB_ID }, { $set: { baseline: control.snap } })
    }
    const mission = await updateProgress({ experiments, epoch, snapshot: winner.snap })
    await patchLab({ playbook: synthesis.playbook, championVariantId: winner.v._id })
    await postOwnerUpdate(synthesis.ownerUpdate)

    await patchLab({ step: `Compacting memory · epoch ${epoch}` })
    await compactEpoch({
      epoch,
      generation: number,
      roundSummary: `Winner ${winner.v.key} "${winner.v.name}" (score ${winner.snap.score}). ${synthesis.ownerUpdate}\nFindings: ${synthesis.findings.map((f) => f.observation).join(' | ')}`,
    })

    const target = lab.targetExperiments
    if (experiments >= target) {
      await patchLab({ phase: 'complete', status: 'idle', step: null })
      await milestone(`mission complete · ${experiments} experiments · score ${mission?.baseline?.score ?? '–'} → ${mission?.best?.score ?? '–'}`)
      await postOwnerUpdate(`All ${experiments} experiments are done. Your results dashboard is ready.`)
      return
    }

    await patchLab({ step: `Architect evolving the harness after round ${number}` })
    const history = await c.generations.find({ labId: LAB_ID, status: 'closed' }).sort({ number: 1 }).toArray()
    const trajectory = history.map((g) => ({ generation: g.number, harness: g.harnessVersion, snapshot: g.metrics as MetricSnapshot }))
    const gen = history.at(-1)!
    const evolved = await evolveHarness({
      current: harnessDoc,
      trajectory,
      telemetry: `builds ${gen.telemetry.buildsAttempted} attempted / ${gen.telemetry.buildsFailed} failed · QA retries ${gen.telemetry.qaRetries} · sessions this round ${sessions.length} · avg interview turns ${
        sessions.length ? (sessions.reduce((a, s) => a + s.messages.filter((m) => m.role === 'assistant').length, 0) / sessions.length).toFixed(1) : 0
      } · replay moments/session ${sessions.length ? (sessions.reduce((a, s) => a + s.moments.length, 0) / sessions.length).toFixed(1) : 0}`,
      findings: synthesis.findings.map((f) => `[${f.topic}, ${f.confidence}] ${f.observation}`),
      remaining: target - experiments,
    })
    const next = evolved ?? harnessDoc
    if (!evolved) logActivity('architect', 'evolve', `harness v${harnessDoc.version} kept · no change justified by the metrics`)

    await buildGeneration(
      { ...lab, playbook: synthesis.playbook },
      number + 1,
      winner.v.html,
      winner.v.changes,
      configOf(next),
      next.version,
    )
    await patchLab({ status: 'idle', step: null })
  } catch (error) {
    await fail(error)
  }
}

/* ---------------- Overview for the studio ---------------- */

export async function getOverview() {
  const c = await collections()
  const lab = await getLab()
  if (!lab) return null
  const [mission, harness, generations, variants, captures, sessionStats, findings] = await Promise.all([
    getMission(),
    listHarness(),
    c.generations.find({ labId: LAB_ID }, { projection: { memoryUsed: 0 } }).sort({ number: 1 }).toArray(),
    c.variants.find({ labId: LAB_ID }, { projection: { html: 0 } }).sort({ generation: 1, key: 1 }).toArray(),
    c.captures.find({ labId: LAB_ID }).sort({ index: 1 }).toArray(),
    c.sessions
      .aggregate<{ _id: string; n: number }>([{ $match: { labId: LAB_ID } }, { $group: { _id: '$status', n: { $sum: 1 } } }])
      .toArray(),
    c.findings.find({ labId: LAB_ID }, { projection: { embedding: 0 } }).sort({ createdAt: -1 }).limit(20).toArray(),
  ])
  const stat = (s: string) => sessionStats.find((x) => x._id === s)?.n ?? 0
  const firstVariant = variants.find((v) => v.generation === 1 && v.isControl) ?? null
  return {
    lab: { ...lab, baselineHtml: null },
    mission,
    harness: harness.map((h) => ({
      version: h.version,
      author: h.author,
      rationale: h.rationale,
      changes: h.changes,
      scoreAtAdoption: h.scoreAtAdoption,
      scoreAfter: h.scoreAfter,
      rules: h.rules.length,
      createdAt: h.createdAt,
    })),
    generations,
    variants,
    captures,
    findings,
    sessions: { done: stat('done'), active: stat('task') + stat('interview'), waiting: stat('briefing') },
    baselineVariantId: firstVariant?._id ?? null,
  }
}
export type Overview = NonNullable<Awaited<ReturnType<typeof getOverview>>>
