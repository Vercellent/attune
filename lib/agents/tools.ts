import 'server-only'
import { tool } from '@strands-agents/sdk'
import { z } from 'zod'
import { searchMemory } from '../memory'
import { TOPICS, type RetrievedMemory } from '../types'

/** Atlas Vector Search over prior findings. Every retrieval is recorded so the UI can show provenance. */
export function memoryTool(recorded: RetrievedMemory[] = []) {
  return tool({
    name: 'search_research_memory',
    description:
      'Semantic search (MongoDB Atlas Vector Search) over research findings from earlier generations and interviews. Use it before proposing hypotheses or asking questions so you build on what is already known.',
    inputSchema: z.object({
      query: z.string().describe('Natural-language question, e.g. "why do people hesitate at checkout?"'),
      topics: z.array(z.enum(TOPICS)).optional(),
    }),
    callback: async ({ query, topics }) => {
      const { results, mode } = await searchMemory(query, { topics, k: 5 })
      for (const r of results) if (!recorded.some((x) => x.findingId === r.findingId)) recorded.push(r)
      if (results.length === 0) return 'No findings yet — this is the first round of research.'
      return `(${mode} search)\n` + results.map((r) => `- [${r.topic}, ${r.confidence}] ${r.observation}`).join('\n')
    },
  })
}
