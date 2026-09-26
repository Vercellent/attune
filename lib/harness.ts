import 'server-only'
import { collections, newId } from './db'
import { logActivity } from './activity'
import { configOf, decidePromotion, describeConfig, detectRegression, seedConfig, validateCandidate, withGuardrailsOf } from './harness-policy'
import { LAB_ID, type HarnessChange, type HarnessConfig, type HarnessDoc, type HarnessEvaluation, type MetricSnapshot } from './types'

export * from './harness-policy'

async function latestWithStatus(status: HarnessDoc['status']) {
  const { harness } = await collections()
  return harness.find({ labId: LAB_ID, status }).sort({ version: -1 }).limit(1).next()
}

export async function getActiveHarness(): Promise<HarnessDoc> {
  return (await latestWithStatus('active')) ?? seedHarness()
}

/** The harness the next round runs under: a pending trial if one exists, otherwise the active version. */
export async function getHarness(): Promise<HarnessDoc> {
  return (await latestWithStatus('trial')) ?? getActiveHarness()
}

export async function getHarnessVersion(version: number) {
  const { harness } = await collections()
  return harness.findOne({ labId: LAB_ID, version })
}

export async function listHarness() {
  const { harness } = await collections()
  return harness.find({ labId: LAB_ID }).sort({ version: 1 }).toArray()
}

async function nextVersion() {
  const { harness } = await collections()
  const last = await harness.find({ labId: LAB_ID }).sort({ version: -1 }).limit(1).next()
  return (last?.version ?? 0) + 1
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
    status: 'active',
    rationale: 'Initial harness: conservative defaults before any evidence.',
    changes: [],
    validationErrors: [],
    evaluation: null,
    scoreAtAdoption: null,
    scoreAfter: null,
    createdAt: new Date(),
    ...config,
  }
  const res = await harness.updateOne({ labId: LAB_ID, version: 1 }, { $setOnInsert: doc }, { upsert: true })
  if (res.upsertedCount) logActivity('harness', 'evolve', 'v1 seeded · active', describeConfig(config))
  return (await harness.findOne({ labId: LAB_ID, version: 1 }))!
}

/**
 * The Architect never edits the live harness. A proposal is validated, then either
 * runs as a one-round trial (architect) or, for a rollback to proven settings, becomes active directly.
 */
export async function proposeHarness(opts: {
  base: HarnessDoc
  config: HarnessConfig
  changes: HarnessChange[]
  rationale: string
  author: 'architect' | 'rollback'
  scoreAtAdoption: number | null
}): Promise<HarnessDoc | null> {
  const { harness } = await collections()
  const validationErrors = validateCandidate(configOf(opts.base), opts.config)
  const status: HarnessDoc['status'] = validationErrors.length ? 'rejected' : opts.author === 'rollback' ? 'active' : 'trial'
  const doc: HarnessDoc = {
    _id: newId(),
    labId: LAB_ID,
    version: await nextVersion(),
    parent: opts.base.version,
    author: opts.author,
    status,
    rationale: opts.rationale,
    changes: opts.changes,
    validationErrors,
    evaluation: null,
    scoreAtAdoption: opts.scoreAtAdoption,
    scoreAfter: null,
    createdAt: new Date(),
    ...opts.config,
  }
  await harness.insertOne(doc)

  if (validationErrors.length) {
    logActivity('harness', 'error', `v${doc.version} rejected by validation · live harness stays v${opts.base.version}`, validationErrors.join('\n'))
    return null
  }
  if (status === 'active') await retireOthers(doc.version)
  logActivity(
    'harness',
    'evolve',
    `v${opts.base.version} → v${doc.version} (${status === 'trial' ? 'trial for one round' : 'rollback, active'}) · ${opts.rationale}`,
    describeConfig(opts.config),
  )
  for (const c of opts.changes) logActivity('harness', 'evolve', `${c.path}: ${c.before || '∅'} → ${c.after || '∅'}`, c.why)
  return doc
}

async function retireOthers(activeVersion: number) {
  const { harness } = await collections()
  await harness.updateMany({ labId: LAB_ID, status: 'active', version: { $ne: activeVersion } }, { $set: { status: 'retired' } })
  await harness.updateMany({ labId: LAB_ID, status: 'trial' }, { $set: { status: 'rejected' } })
}

export async function creditHarness(version: number, score: number | null) {
  const { harness } = await collections()
  await harness.updateOne({ labId: LAB_ID, version }, { $set: { scoreAfter: score } })
}

async function recordEvaluation(version: number, status: HarnessDoc['status'], evaluation: HarnessEvaluation) {
  const { harness } = await collections()
  await harness.updateOne({ labId: LAB_ID, version }, { $set: { status, evaluation } })
}

/**
 * Runs after every round with the harness that round used and the round's measured outcome.
 * Trial → promote or reject. Active → roll back automatically if the score regressed.
 * Returns the version that is active afterwards.
 */
export async function settleHarness(used: HarnessDoc, outcome: MetricSnapshot): Promise<HarnessDoc> {
  const at = new Date()
  if (used.status === 'trial') {
    const decision = decidePromotion({ baseline: used.scoreAtAdoption, observed: outcome.score, n: outcome.n })
    const evaluation = { ...decision, baseline: used.scoreAtAdoption, observed: outcome.score, n: outcome.n, at }
    if (decision.verdict === 'promote') {
      await recordEvaluation(used.version, 'active', evaluation)
      await retireOthers(used.version)
      logActivity('harness', 'evolve', `v${used.version} promoted to active · ${decision.reason}`)
    } else {
      await recordEvaluation(used.version, 'rejected', evaluation)
      logActivity('harness', 'evolve', `v${used.version} trial rejected, reverting to v${used.parent} · ${decision.reason}`)
    }
    return getActiveHarness()
  }

  if (used.status === 'active' && used.parent !== null && detectRegression({ adoptedAt: used.scoreAtAdoption, latest: outcome.score })) {
    const parent = await getHarnessVersion(used.parent)
    if (parent) {
      const reason = `Score fell to ${outcome.score} from ${used.scoreAtAdoption} at adoption (more than the regression limit).`
      await recordEvaluation(used.version, 'retired', { verdict: 'rollback', reason, baseline: used.scoreAtAdoption, observed: outcome.score, n: outcome.n, at })
      const { harness } = await collections()
      const restored: HarnessDoc = {
        ...withGuardrailsOf(configOf(parent), configOf(used)),
        _id: newId(),
        labId: LAB_ID,
        version: await nextVersion(),
        parent: used.version,
        author: 'auto-rollback',
        status: 'active',
        rationale: `Automatic rollback to v${parent.version} settings. ${reason}`,
        changes: [{ path: 'harness', before: `v${used.version}`, after: `v${parent.version}`, why: reason }],
        validationErrors: [],
        evaluation: null,
        scoreAtAdoption: outcome.score,
        scoreAfter: null,
        createdAt: at,
      }
      await harness.insertOne(restored)
      await retireOthers(restored.version)
      logActivity('harness', 'evolve', `v${used.version} → v${restored.version} automatic rollback to v${parent.version} settings · ${reason}`)
      return restored
    }
  }
  return getActiveHarness()
}
