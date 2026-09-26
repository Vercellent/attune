import 'server-only'
import { collections } from './db'
import { LAB_ID, type FindingDoc, type RetrievedMemory, type Topic } from './types'

const EMBED_MODEL = process.env.VOYAGE_EMBED_MODEL || 'voyage-3.5'
const EMBED_DIMS = Number(process.env.VOYAGE_EMBED_DIMS || 1024)
const INDEX_NAME = 'findings_vector_index'

export async function embed(texts: string[], inputType: 'document' | 'query'): Promise<number[][] | null> {
  if (!process.env.VOYAGE_API_KEY || texts.length === 0) return null
  try {
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
      },
      body: JSON.stringify({
        input: texts,
        model: EMBED_MODEL,
        input_type: inputType,
        output_dimension: EMBED_DIMS,
      }),
    })
    if (!res.ok) {
      console.error('[memory] Voyage embed failed', res.status, await res.text())
      return null
    }
    const json = (await res.json()) as { data: { embedding: number[]; index: number }[] }
    return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding)
  } catch (error) {
    console.error('[memory] Voyage embed error', error)
    return null
  }
}

export async function ensureVectorIndex() {
  const { findings } = await collections()
  try {
    await findings.db.createCollection('findings').catch(() => {})
    const existing = await findings.listSearchIndexes(INDEX_NAME).toArray()
    if (existing.length > 0) return
    await findings.createSearchIndex({
      name: INDEX_NAME,
      type: 'vectorSearch',
      definition: {
        fields: [
          { type: 'vector', path: 'embedding', numDimensions: EMBED_DIMS, similarity: 'cosine' },
          { type: 'filter', path: 'labId' },
          { type: 'filter', path: 'topic' },
        ],
      },
    })
  } catch (error) {
    console.error('[memory] could not ensure vector index', error)
  }
}

export function findingText(f: Pick<FindingDoc, 'topic' | 'observation' | 'implicitEvidence' | 'explicitEvidence'>) {
  return `[${f.topic}] ${f.observation}\nBehavior: ${f.implicitEvidence}\nInterview: ${f.explicitEvidence}`
}

export async function searchMemory(
  query: string,
  opts: { topics?: Topic[]; k?: number } = {},
): Promise<{ results: RetrievedMemory[]; mode: 'vector' | 'recency' | 'none' }> {
  const { findings } = await collections()
  const k = opts.k ?? 6
  const total = await findings.countDocuments({ labId: LAB_ID })
  if (total === 0) return { results: [], mode: 'none' }

  const [vector] = (await embed([query], 'query')) ?? []
  if (vector) {
    try {
      const filter: Record<string, unknown> = { labId: LAB_ID }
      if (opts.topics?.length) filter.topic = { $in: opts.topics }
      const docs = await findings
        .aggregate<FindingDoc & { score: number }>([
          {
            $vectorSearch: {
              index: INDEX_NAME,
              path: 'embedding',
              queryVector: vector,
              numCandidates: Math.max(100, k * 15),
              limit: k,
              filter,
            },
          },
          { $project: { embedding: 0, score: { $meta: 'vectorSearchScore' } } },
        ])
        .toArray()
      if (docs.length > 0) {
        return {
          mode: 'vector',
          results: docs.map((d) => ({
            findingId: d._id,
            topic: d.topic,
            observation: d.observation,
            confidence: d.confidence,
            score: Math.round(d.score * 1000) / 1000,
          })),
        }
      }
    } catch (error) {
      console.error('[memory] vector search failed, falling back to recency', error)
    }
  }

  const filter: Record<string, unknown> = { labId: LAB_ID }
  if (opts.topics?.length) filter.topic = { $in: opts.topics }
  const docs = await findings
    .find(filter, { projection: { embedding: 0 } })
    .sort({ createdAt: -1 })
    .limit(k)
    .toArray()
  return {
    mode: 'recency',
    results: docs.map((d) => ({
      findingId: d._id,
      topic: d.topic,
      observation: d.observation,
      confidence: d.confidence,
      score: null,
    })),
  }
}
