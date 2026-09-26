import 'server-only'
import type { Collection, Document } from 'mongodb'
import { collections } from './db'
import { logActivity } from './activity'
import { studioFilter, type StudioScope } from './scope'
import { LAB_ID, type DigestDoc, type FindingDoc, type RetrievedMemory, type Topic } from './types'

/** Atlas Automated Embedding generates and stores vectors itself; the app only writes and queries plain text. */
export const EMBED_MODEL = process.env.ATLAS_EMBED_MODEL || 'voyage-4'
const FINDINGS_INDEX = 'studio_findings_semantic'
const DIGESTS_INDEX = 'digests_semantic'
/** Query text beyond this is truncated; the model's 32k-token window is far larger, this just bounds cost. */
const MAX_QUERY_CHARS = 4000

const STUDIO: StudioScope = { kind: 'studio', labId: LAB_ID }

async function ensureAutoEmbedIndex(col: Collection<Document>, name: string, filters: string[]) {
  try {
    await col.db.createCollection(col.collectionName).catch(() => {})
    if ((await col.listSearchIndexes(name).toArray()).length) return
    await col.createSearchIndex({
      name,
      type: 'vectorSearch',
      definition: {
        fields: [
          { type: 'autoEmbed', modality: 'text', path: 'text', model: EMBED_MODEL },
          ...filters.map((path) => ({ type: 'filter', path })),
        ],
      },
    })
    logActivity('memory', 'memory', `Atlas autoEmbed index "${name}" requested on ${col.collectionName}.text (${EMBED_MODEL})`)
  } catch (error) {
    console.error(`[memory] could not ensure ${name}`, error)
  }
}

export async function ensureMemoryIndexes() {
  const { findings, digests } = await collections()
  await Promise.all([
    ensureAutoEmbedIndex(findings as unknown as Collection<Document>, FINDINGS_INDEX, ['labId', 'topic', 'generation']),
    ensureAutoEmbedIndex(digests as unknown as Collection<Document>, DIGESTS_INDEX, ['labId', 'epoch']),
  ])
}

export function findingText(f: Pick<FindingDoc, 'topic' | 'observation' | 'implicitEvidence' | 'explicitEvidence'>) {
  return `[${f.topic}] ${f.observation}\nBehavior: ${f.implicitEvidence}\nInterview: ${f.explicitEvidence}`
}

/** Null means semantic search is unavailable right now (index still building, rate limited), so callers fall back. */
async function semanticSearch<T extends Document>(
  col: Collection<T>,
  index: string,
  query: string,
  filter: Document,
  k: number,
): Promise<(T & { score: number })[] | null> {
  try {
    const docs = await col
      .aggregate<T & { score: number }>([
        {
          $vectorSearch: {
            index,
            path: 'text',
            query: query.slice(0, MAX_QUERY_CHARS),
            filter,
            numCandidates: Math.max(100, k * 20),
            limit: k,
          },
        },
        { $addFields: { score: { $meta: 'vectorSearchScore' } } },
      ])
      .toArray()
    return docs.length ? docs : null
  } catch (error) {
    console.error(`[memory] semantic search on ${index} unavailable:`, (error as Error).message)
    return null
  }
}

const toMemory = (d: FindingDoc, score: number | null): RetrievedMemory => ({
  findingId: d._id,
  topic: d.topic,
  observation: d.observation,
  confidence: d.confidence,
  score: score === null ? null : Math.round(score * 1000) / 1000,
})

export async function searchMemory(
  query: string,
  opts: { topics?: Topic[]; k?: number } = {},
): Promise<{ results: RetrievedMemory[]; mode: 'semantic' | 'recency' | 'none' }> {
  const { findings } = await collections()
  const k = opts.k ?? 6
  const filter = studioFilter(STUDIO, opts.topics?.length ? { topic: { $in: opts.topics } } : {})
  if ((await findings.countDocuments({ labId: STUDIO.labId })) === 0) return { results: [], mode: 'none' }

  const hits = await semanticSearch(findings, FINDINGS_INDEX, query, filter, k)
  if (hits) return { mode: 'semantic', results: hits.map((d) => toMemory(d, d.score)) }

  const recent = await findings.find(filter).sort({ createdAt: -1 }).limit(k).toArray()
  return { mode: 'recency', results: recent.map((d) => toMemory(d, null)) }
}

/** Older epoch digests most relevant to the query, so weeks-old lessons resurface without growing the prompt. */
export async function searchDigests(query: string, k: number, excludeEpochs: number[]): Promise<DigestDoc[]> {
  const { digests } = await collections()
  const filter = studioFilter(STUDIO, excludeEpochs.length ? { epoch: { $nin: excludeEpochs } } : {})
  return (await semanticSearch(digests, DIGESTS_INDEX, query, filter, k)) ?? []
}
