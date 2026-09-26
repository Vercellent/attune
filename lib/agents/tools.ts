import 'server-only'
import { tool } from '@strands-agents/sdk'
import { z } from 'zod'
import { collections } from '../db'
import { searchMemory } from '../memory'
import { LAB_ID, TOPICS, type RetrievedMemory } from '../types'

/** Semantic tier: Atlas Automated Embedding search over studio findings. Retrievals are recorded for provenance. */
export function memoryTool(recorded: RetrievedMemory[] = [], k = 5) {
  return tool({
    name: 'search_research_memory',
    description:
      'Semantic search (MongoDB Atlas Automated Embedding) over research findings from all earlier rounds. Use before proposing or concluding anything.',
    inputSchema: z.object({
      query: z.string().describe('Natural-language question, e.g. "why do people hesitate at checkout?"'),
      topics: z.array(z.enum(TOPICS)).optional(),
    }),
    callback: async ({ query, topics }) => {
      const { results, mode } = await searchMemory(query, { topics, k })
      for (const r of results) if (!recorded.some((x) => x.findingId === r.findingId)) recorded.push(r)
      if (results.length === 0) return 'No findings yet — this is the first round of research.'
      return `(${mode} search)\n` + results.map((r) => `- [${r.topic}, ${r.confidence}] ${r.observation}`).join('\n')
    },
  })
}

/** Episodic tier: raw tester sessions, never compacted, recalled on demand. */
export function recallSessionsTool() {
  return tool({
    name: 'recall_sessions',
    description:
      'Recall raw tester sessions from any earlier round (summaries, quotes, scores). Use to verify a pattern against primary evidence.',
    inputSchema: z.object({
      generation: z.number().int().optional().describe('Round number; omit for the most recent sessions'),
      onlyFailures: z.boolean().optional(),
      limit: z.number().int().min(1).max(10).optional(),
    }),
    callback: async ({ generation, onlyFailures, limit }) => {
      const { sessions } = await collections()
      const filter: Record<string, unknown> = { labId: LAB_ID, status: 'done' }
      if (generation) filter.generation = generation
      if (onlyFailures) filter['metrics.completed'] = false
      const docs = await sessions
        .find(filter, { projection: { summary: 1, insights: 1, score: 1, generation: 1, variantKey: 1, 'metrics.completed': 1 } })
        .sort({ endedAt: -1 })
        .limit(limit ?? 5)
        .toArray()
      if (!docs.length) return 'No matching sessions.'
      return docs
        .map(
          (s) =>
            `R${s.generation}/${s.variantKey} score ${s.score} ${s.metrics?.completed ? 'completed' : 'abandoned'}: ${s.summary ?? ''}${s.insights
              .slice(0, 2)
              .map((i) => `\n  "${i.quote}"`)
              .join('')}`,
        )
        .join('\n')
    },
  })
}

/** Compacted tier: epoch digests that summarize everything before them. */
export function readDigestsTool() {
  return tool({
    name: 'read_digests',
    description: 'Read older compacted epoch digests beyond the ones already in your context.',
    inputSchema: z.object({ fromEpoch: z.number().int().min(0).optional() }),
    callback: async ({ fromEpoch }) => {
      const { digests } = await collections()
      const docs = await digests
        .find({ labId: LAB_ID, epoch: { $gte: fromEpoch ?? 0 } })
        .sort({ epoch: 1 })
        .limit(8)
        .toArray()
      return docs.length ? docs.map((d) => `[epoch ${d.epoch}] ${d.text}`).join('\n\n') : 'No digests yet.'
    },
  })
}
