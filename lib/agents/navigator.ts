import 'server-only'
import { z } from 'zod'
import { tracedAgent } from './trace'
import { codex } from './model'
import type { Brief } from '../types'

export type PageElement = { id: string; role: string; label: string }

const stepSchema = z.object({
  title: z.string().describe('Short name for this step of the journey, e.g. "Product listing"'),
  note: z.string().describe('One-sentence annotation of what a shopper sees and must do here'),
  friction: z.array(z.string()).max(3).describe('Concrete UX problems visible on this screen (empty if none)'),
  actions: z
    .array(
      z.object({
        type: z.enum(['click', 'fill', 'select']),
        elementId: z.string(),
        value: z.string().optional().describe('Text for fill, option text for select'),
      }),
    )
    .max(8)
    .describe('Actions to advance the journey, in order. Fill all required fields, then click the continue control.'),
  actionSummary: z.string().describe('What you are doing next, e.g. "Clicked Add to cart on the grinder"'),
  done: z.boolean().describe('True when the client journey is fully complete (e.g. order confirmed)'),
})
export type NavigatorStep = z.infer<typeof stepSchema>

const confirmSchema = z.object({
  flow: z.array(z.string()).describe('The journey as ordered step names'),
  summary: z.string().describe('Two sentences: the journey and its biggest friction points'),
  task: z.string().describe('Neutral task for test participants in second person, e.g. "Buy a coffee grinder and complete checkout."'),
  confirmation: z.string().describe('Friendly confirmation to the client, first person, max 45 words, naming the flow and what will be optimized'),
})
export type NavigatorConfirmation = z.infer<typeof confirmSchema>

export async function navigatorStep(opts: {
  brief: Pick<Brief, 'optimize' | 'targetUrl'>
  step: number
  screen: string
  visibleText: string
  elements: PageElement[]
  history: string[]
}): Promise<NavigatorStep> {
  const agent = tracedAgent('computer-use', {
    model: codex('conversational'),
    printer: false,
    systemPrompt:
      'You are a computer-use agent operating a real browser. You walk through a website to capture the exact user journey a client wants optimized, annotating each screen like a senior UX researcher. Use only element ids from the list. Use realistic test data for forms (name Alex Rivera, 12 Market St, Portland, 97201, alex@example.com).',
  })
  const result = await agent.invoke(
    `Client wants to optimize: "${opts.brief.optimize}"\nSite: ${opts.brief.targetUrl}\nStep ${opts.step}, current screen: ${opts.screen}\nJourney so far:\n${opts.history.join('\n') || '(start)'}\n\nVisible text:\n${opts.visibleText.slice(0, 2500)}\n\nInteractive elements:\n${opts.elements.map((e) => `${e.id} [${e.role}] ${e.label}`).join('\n')}`,
    { structuredOutputSchema: stepSchema },
  )
  return result.structuredOutput as NavigatorStep
}

export async function navigatorConfirm(brief: Pick<Brief, 'optimize'>, journey: string): Promise<NavigatorConfirmation> {
  const agent = tracedAgent('computer-use', {
    model: codex('conversational'),
    printer: false,
    systemPrompt: 'You summarize a captured website journey and confirm the optimization scope to a non-technical client.',
  })
  const result = await agent.invoke(`Client wants to optimize: "${brief.optimize}"\n\nCaptured journey:\n${journey}`, {
    structuredOutputSchema: confirmSchema,
  })
  return result.structuredOutput as NavigatorConfirmation
}
