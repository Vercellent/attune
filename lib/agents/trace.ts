import 'server-only'
import {
  AfterToolCallEvent,
  Agent,
  AgentResultEvent,
  BeforeInvocationEvent,
  BeforeToolCallEvent,
  MessageAddedEvent,
  ModelMessageEvent,
} from '@strands-agents/sdk'
import { logActivity } from '../activity'
import { recordUsage } from '../mission'
import { usageMeter } from './model'

type AgentConfig = NonNullable<ConstructorParameters<typeof Agent>[0]>
type LooseBlock = { type: string; text?: string; json?: unknown; name?: string }

function stringify(value: unknown) {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function blockText(blocks: readonly unknown[], type: string) {
  return (blocks as LooseBlock[])
    .filter((b) => b.type === type)
    .map((b) => b.text ?? '')
    .join('\n')
    .trim()
}

function resultText(blocks: readonly unknown[]) {
  return (blocks as LooseBlock[]).map((b) => b.text ?? stringify(b.json ?? b)).join('\n')
}

/** A Strands agent whose full lifecycle is streamed to the studio shell. */
export function tracedAgent(label: string, config: AgentConfig) {
  const agent = new Agent({ printer: false, ...config })

  const meter = usageMeter(config.model)
  let baseline = { inputTokens: 0, outputTokens: 0 }

  agent.addHook(BeforeInvocationEvent, () => {
    if (meter) baseline = { inputTokens: meter.inputTokens, outputTokens: meter.outputTokens }
    logActivity(label, 'start', 'invocation started')
  })

  agent.addHook(MessageAddedEvent, (event) => {
    if (event.message.role !== 'user') return
    const text = blockText(event.message.content, 'textBlock')
    if (text) logActivity(label, 'prompt', text)
  })

  agent.addHook(ModelMessageEvent, (event) => {
    const reasoning = blockText(event.message.content, 'reasoningBlock')
    if (reasoning) logActivity(label, 'thinking', reasoning)
    const text = blockText(event.message.content, 'textBlock')
    if (text) logActivity(label, 'text', text)
  })

  agent.addHook(BeforeToolCallEvent, (event) => {
    logActivity(label, 'tool', event.toolUse.name, stringify(event.toolUse.input))
  })

  agent.addHook(AfterToolCallEvent, (event) => {
    const output = resultText(event.result.content)
    if (event.error || event.result.status === 'error') {
      logActivity(label, 'error', `${event.toolUse.name} failed`, event.error?.message ?? output)
    } else {
      logActivity(label, 'result', event.toolUse.name, output)
    }
  })

  agent.addHook(AgentResultEvent, async (event) => {
    let usage = event.result.metrics?.accumulatedUsage
    if (meter && !usage?.inputTokens) {
      await Promise.all(meter.pending)
      usage = {
        ...usage,
        inputTokens: meter.inputTokens - baseline.inputTokens,
        outputTokens: meter.outputTokens - baseline.outputTokens,
        totalTokens: meter.inputTokens - baseline.inputTokens + meter.outputTokens - baseline.outputTokens,
      } as typeof usage
    }
    recordUsage(usage)
    const tokens = usage ? ` · ${usage.inputTokens.toLocaleString()} in / ${usage.outputTokens.toLocaleString()} out tokens` : ''
    logActivity(label, 'done', `finished (${event.result.stopReason})${tokens}`)
  })

  return agent
}
