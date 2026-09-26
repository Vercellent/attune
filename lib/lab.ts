import 'server-only'
import { collections, newId } from './db'
import { embed, ensureVectorIndex, findingText } from './memory'
import { computeMetrics, summarizeTrace } from './scoring'
import { SHOP_HTML } from './shop'
import { buildVariant, cloneSite, reconSite } from './agents/builder'
import { planGeneration, synthesizeGeneration } from './agents/strategist'
import {
  LAB_ID,
  type Brief,
  type FindingDoc,
  type LabDoc,
  type SessionDoc,
  type VariantDoc,
} from './types'

const VARIANTS_PER_GENERATION = 3
const KEYS = ['A', 'B', 'C', 'D']

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
  await labs.updateOne({ _id: LAB_ID }, { $set: { ...set, updatedAt: new Date() } })
}

/** Atomically take the lab's work lock so only one pipeline step runs at a time. */
export async function claimLab(step: string) {
  const { labs } = await collections()
  const res = await labs.findOneAndUpdate(
    { _id: LAB_ID, status: { $ne: 'working' } },
    { $set: { status: 'working', step, error: null, updatedAt: new Date() } },
  )
  return Boolean(res)
}

async function fail(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  console.error('[lab] pipeline failed', error)
  await patchLab({ status: 'error', step: null, error: message })
  await postOwnerUpdate(`Something went wrong: ${message}. You can retry from the dashboard.`)
}

async function loadTarget(url: string) {
  if (!url || url.startsWith('/shop')) return SHOP_HTML
  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; ExperimentationLab/1.0)' },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`Could not load ${url} (HTTP ${res.status})`)
  const html = await res.text()
  const base = `<base href="${new URL(url).origin}/">`
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + base) : base + html
}

export async function createLab(brief: Brief) {
  const c = await collections()
  const current = await c.labs.findOne({ _id: LAB_ID })
  const stale = current && Date.now() - current.updatedAt.getTime() > 15 * 60_000
  if (current?.status === 'working' && !stale) throw new Error('The lab is busy. Try again in a moment.')
  await Promise.all([
    c.generations.deleteMany({ labId: LAB_ID }),
    c.variants.deleteMany({ labId: LAB_ID }),
    c.sessions.deleteMany({ labId: LAB_ID }),
    c.findings.deleteMany({ labId: LAB_ID }),
    c.ownerMessages.deleteMany({ labId: LAB_ID }),
  ])
  const now = new Date()
  await c.labs.replaceOne(
    { _id: LAB_ID },
    {
      brief,
      spec: null,
      baselineHtml: null,
      generation: 0,
      status: 'working',
      step: 'Studying your site',
      error: null,
      autopilot: true,
      minSessions: 2,
      playbook: null,
      createdAt: now,
      updatedAt: now,
    },
    { upsert: true },
  )
}

/** Runs after createLab (lock already held): recon → clone → first generation. */
export async function bootstrapLab() {
  try {
    const lab = await getLab()
    if (!lab) throw new Error('No lab configured')
    const html = await loadTarget(lab.brief.targetUrl)
    const spec = await reconSite(html, lab.brief)
    await patchLab({ spec, step: 'Preparing the baseline' })
    const baselineHtml = html.includes('__lab.view') ? html : await cloneSite(html, spec, lab.brief)
    await patchLab({ baselineHtml })
    await ensureVectorIndex()
    await postOwnerUpdate(
      `I studied your site. ${spec.summary}\n\nWhat most likely hurts "${lab.brief.goal}":\n${spec.frictionPoints
        .slice(0, 3)
        .map((f) => `• ${f}`)
        .join('\n')}\n\nBuilding the first versions to test now.`,
    )
    await buildGeneration({ ...lab, spec, baselineHtml }, 1, baselineHtml, [], 'Original')
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
  championName: string,
) {
  const c = await collections()
  await patchLab({ step: `Planning round ${number}` })
  const plan = await planGeneration({
    brief: lab.brief,
    spec: lab.spec!,
    playbook: lab.playbook,
    generation: number,
    count: VARIANTS_PER_GENERATION - 1,
    championChanges,
  })

  const generationId = newId()
  await c.generations.insertOne({
    _id: generationId,
    labId: LAB_ID,
    number,
    status: 'building',
    memoryUsed: plan.memoryUsed,
    winnerVariantId: null,
    learned: null,
    score: null,
    createdAt: new Date(),
    closedAt: null,
  })

  await patchLab({ step: `Codex is building ${plan.variants.length} new versions` })
  const builds = await Promise.allSettled(
    plan.variants.map((v) =>
      buildVariant({ baseHtml: championHtml, brief: lab.brief, spec: lab.spec!, ...v }),
    ),
  )

  const docs: VariantDoc[] = [
    {
      _id: newId(),
      labId: LAB_ID,
      generation: number,
      key: 'A',
      name: number === 1 ? 'Original' : `Champion: ${championName}`,
      hypothesis: number === 1 ? 'Baseline — the site as it is today.' : 'Current best version, kept as the control.',
      changes: championChanges,
      isControl: true,
      html: championHtml,
      createdAt: new Date(),
    },
  ]
  builds.forEach((b, i) => {
    if (b.status === 'rejected') {
      console.error('[lab] variant build failed', b.reason)
      return
    }
    docs.push({
      _id: newId(),
      labId: LAB_ID,
      generation: number,
      key: KEYS[docs.length],
      name: plan.variants[i].name,
      hypothesis: plan.variants[i].hypothesis,
      changes: b.value.changes,
      isControl: false,
      html: b.value.html,
      createdAt: new Date(),
    })
  })
  await c.variants.insertMany(docs)
  await c.generations.updateOne({ _id: generationId }, { $set: { status: 'collecting' } })
  await patchLab({ generation: number })

  const challengers = docs.filter((d) => !d.isControl)
  await postOwnerUpdate(
    challengers.length
      ? `Round ${number} is live with ${docs.length} versions:\n${challengers
          .map((d) => `• ${d.key} — ${d.name}: ${d.hypothesis}`)
          .join('\n')}\n\nShare the interview link. I'll pick a winner after ${lab.minSessions} interviews per version.`
      : `Round ${number} is live, but the builders couldn't produce new versions this time, so only the current version is being tested.`,
  )
}

type VariantStats = {
  variant: VariantDoc
  sessions: SessionDoc[]
  avgScore: number | null
  completionRate: number | null
}

function statsFor(variants: VariantDoc[], sessions: SessionDoc[]): VariantStats[] {
  return variants.map((variant) => {
    const own = sessions.filter((s) => s.variantId === variant._id && s.status === 'done')
    const scores = own.map((s) => s.score ?? 0)
    return {
      variant,
      sessions: own,
      avgScore: own.length ? Math.round(scores.reduce((a, b) => a + b, 0) / own.length) : null,
      completionRate: own.length ? own.filter((s) => s.metrics?.completed).length / own.length : null,
    }
  })
}

/** Closes the current round: synthesize → store findings in Atlas → build the next round from the winner. Lock must be held. */
export async function advanceLab() {
  try {
    const c = await collections()
    const lab = await getLab()
    if (!lab) throw new Error('No lab configured')
    const gen = await c.generations.findOne({ labId: LAB_ID, number: lab.generation })
    if (!gen || gen.status !== 'collecting') throw new Error('No round is collecting interviews right now')
    const variants = await c.variants.find({ labId: LAB_ID, generation: gen.number }).sort({ key: 1 }).toArray()
    const sessions = await c.sessions.find({ labId: LAB_ID, generation: gen.number, status: 'done' }).toArray()
    if (sessions.length === 0) throw new Error('Run at least one interview before moving to the next round')

    await patchLab({ step: `Analyzing round ${gen.number}` })
    const stats = statsFor(variants, sessions)
    const evidence = stats
      .map(({ variant, sessions: own, avgScore, completionRate }) => {
        const header = `## ${variant.key} — ${variant.name}${variant.isControl ? ' (control)' : ''}\nHypothesis: ${variant.hypothesis}\nSessions: ${own.length}, avg score: ${avgScore ?? 'n/a'}, completion: ${completionRate === null ? 'n/a' : Math.round(completionRate * 100) + '%'}`
        const detail = own
          .map((s, i) => {
            const m = s.metrics ?? computeMetrics(s.events)
            const quotes = s.insights.map((q) => `  "${q.quote}" (${q.topic}: ${q.note})`).join('\n')
            return `Session ${i + 1} (score ${s.score}, price confidence ${s.priceConfidence ?? 'n/a'}/5)\n${summarizeTrace(s.events, m)}\nSummary: ${s.summary ?? ''}\n${quotes}`
          })
          .join('\n\n')
        return `${header}\n${detail || 'No sessions.'}`
      })
      .join('\n\n')

    const synthesis = await synthesizeGeneration({
      brief: lab.brief,
      generation: gen.number,
      playbook: lab.playbook,
      evidence,
    })

    const ranked = stats.filter((s) => s.avgScore !== null).sort((a, b) => b.avgScore! - a.avgScore!)
    const winner =
      stats.find((s) => s.variant.key === synthesis.winnerKey && s.avgScore !== null) ?? ranked[0] ?? stats[0]

    const vectors = await embed(synthesis.findings.map(findingText), 'document')
    const findingDocs: FindingDoc[] = synthesis.findings.map((f, i) => ({
      _id: newId(),
      labId: LAB_ID,
      generation: gen.number,
      ...f,
      embedding: vectors?.[i] ?? null,
      createdAt: new Date(),
    }))
    if (findingDocs.length) await c.findings.insertMany(findingDocs)

    await c.generations.updateOne(
      { _id: gen._id },
      {
        $set: {
          status: 'closed',
          winnerVariantId: winner.variant._id,
          learned: synthesis.ownerUpdate,
          score: winner.avgScore,
          closedAt: new Date(),
        },
      },
    )
    await patchLab({ playbook: synthesis.playbook })
    await postOwnerUpdate(synthesis.ownerUpdate)

    const control = variants.find((v) => v.isControl)!
    const championChanges = winner.variant.isControl
      ? control.changes
      : [...control.changes, ...winner.variant.changes]
    const championName = winner.variant.isControl
      ? control.name.replace(/^Champion: /, '')
      : winner.variant.name
    await buildGeneration(
      { ...lab, playbook: synthesis.playbook },
      gen.number + 1,
      winner.variant.html,
      championChanges,
      championName,
    )
    await patchLab({ status: 'idle', step: null })
  } catch (error) {
    await fail(error)
  }
}

export async function setAutopilot(value: boolean) {
  await patchLab({ autopilot: value })
}

/* ---------------- Sessions ---------------- */

export async function createSession() {
  const c = await collections()
  const lab = await getLab()
  if (!lab || lab.generation === 0) return null
  const gen = await c.generations.findOne({ labId: LAB_ID, number: lab.generation, status: 'collecting' })
  if (!gen) return null
  const variants = await c.variants
    .find({ labId: LAB_ID, generation: gen.number }, { projection: { html: 0 } })
    .toArray()
  const counts = await c.sessions
    .aggregate<{ _id: string; n: number }>([
      { $match: { labId: LAB_ID, generation: gen.number, 'events.0': { $exists: true } } },
      { $group: { _id: '$variantId', n: { $sum: 1 } } },
    ])
    .toArray()
  const load = (id: string) => counts.find((x) => x._id === id)?.n ?? 0
  const min = Math.min(...variants.map((v) => load(v._id)))
  const pool = variants.filter((v) => load(v._id) === min)
  const variant = pool[Math.floor(Math.random() * pool.length)]

  const greeting = `Hi, thanks for helping! Your task: ${lab.brief.task}\n\nUse the site as you normally would and think out loud here anytime. Press "I'm done" when you finish or give up.`
  const session: SessionDoc = {
    _id: newId(),
    labId: LAB_ID,
    generation: gen.number,
    variantId: variant._id,
    variantKey: variant.key,
    status: 'task',
    events: [],
    metrics: null,
    messages: [{ role: 'assistant', text: greeting, at: new Date() }],
    insights: [],
    priceConfidence: null,
    summary: null,
    score: null,
    startedAt: new Date(),
    endedAt: null,
  }
  await c.sessions.insertOne(session)
  return { sessionId: session._id, variantId: variant._id, task: lab.brief.task, greeting }
}

/** True when every version in the current round has enough finished interviews to move on. */
export async function readyToAdvance() {
  const c = await collections()
  const lab = await getLab()
  if (!lab || !lab.autopilot || lab.status === 'working') return false
  const variants = await c.variants
    .find({ labId: LAB_ID, generation: lab.generation }, { projection: { _id: 1 } })
    .toArray()
  if (!variants.length) return false
  const sessions = await c.sessions
    .find({ labId: LAB_ID, generation: lab.generation, status: 'done' }, { projection: { variantId: 1 } })
    .toArray()
  return variants.every((v) => sessions.filter((s) => s.variantId === v._id).length >= lab.minSessions)
}

/* ---------------- Overview (for the owner dashboard) ---------------- */

export async function getOverview() {
  const c = await collections()
  const lab = await c.labs.findOne({ _id: LAB_ID }, { projection: { baselineHtml: 0 } })
  if (!lab) return { lab: null, generations: [], variants: [], findings: [], sessions: 0 }
  const [generations, variants, sessions, findings] = await Promise.all([
    c.generations.find({ labId: LAB_ID }).sort({ number: -1 }).toArray(),
    c.variants.find({ labId: LAB_ID }, { projection: { html: 0 } }).sort({ generation: -1, key: 1 }).toArray(),
    c.sessions
      .find({ labId: LAB_ID, status: 'done' }, { projection: { events: 0, messages: 0 } })
      .toArray(),
    c.findings.find({ labId: LAB_ID }, { projection: { embedding: 0 } }).sort({ createdAt: -1 }).toArray(),
  ])
  const variantStats = statsFor(variants as VariantDoc[], sessions as SessionDoc[]).map((s) => ({
    ...s.variant,
    sessionCount: s.sessions.length,
    avgScore: s.avgScore,
    completionRate: s.completionRate,
    quotes: s.sessions.flatMap((x) => x.insights).slice(0, 3),
  }))
  return { lab, generations, variants: variantStats, findings, sessions: sessions.length }
}

export type Overview = Awaited<ReturnType<typeof getOverview>>
