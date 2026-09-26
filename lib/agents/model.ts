import 'server-only'
import { OpenAIModel } from '@strands-agents/sdk/models/openai'

export const MODELS = {
  builder: process.env.BUILDER_MODEL || 'openai/gpt-5.3-codex',
  conversational: process.env.CONVERSATION_MODEL || 'openai/gpt-5.1-codex-mini',
}

export type UsageMeter = { inputTokens: number; outputTokens: number; pending: Set<Promise<void>> }

const meters = new WeakMap<object, UsageMeter>()

export function usageMeter(model: unknown) {
  return model && typeof model === 'object' ? meters.get(model) : undefined
}

function absorb(meter: UsageMeter, line: string) {
  const payload = line.startsWith('data:') ? line.slice(5).trim() : line.trim()
  if (!payload.includes('"usage"')) return
  try {
    const usage = JSON.parse(payload).usage
    if (!usage) return
    meter.inputTokens += usage.prompt_tokens ?? 0
    meter.outputTokens += usage.completion_tokens ?? 0
  } catch {}
}

async function consume(stream: ReadableStream<Uint8Array>, meter: UsageMeter) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) absorb(meter, line)
  }
  if (buffer) absorb(meter, buffer)
}

/** Strands' chat adapter requests usage but drops it, so read it straight off OpenRouter's response. */
function meteredFetch(meter: UsageMeter): typeof fetch {
  return async (input, init) => {
    const res = await fetch(input, init)
    if (!res.body || !res.ok) return res
    const [forAgent, forMeter] = res.body.tee()
    const task = consume(forMeter, meter).catch(() => undefined)
    meter.pending.add(task)
    void task.finally(() => meter.pending.delete(task))
    return new Response(forAgent, { status: res.status, statusText: res.statusText, headers: res.headers })
  }
}

export function codex(kind: keyof typeof MODELS, maxTokens?: number) {
  const meter: UsageMeter = { inputTokens: 0, outputTokens: 0, pending: new Set() }
  const model = new OpenAIModel({
    api: 'chat',
    modelId: MODELS[kind],
    apiKey: process.env.OPENROUTER_API_KEY,
    maxTokens,
    clientConfig: {
      baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
      defaultHeaders: { 'X-Title': 'Autonomous Experimentation Lab' },
      fetch: meteredFetch(meter),
    },
  })
  meters.set(model, meter)
  return model
}
