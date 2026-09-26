import 'server-only'
import { Agent, tool } from '@strands-agents/sdk'
import { z } from 'zod'
import type { Brief, SiteSpec } from '../types'
import { codex } from './model'

const MAX_EDITS = 30

const CONVENTIONS = `Site conventions (must be preserved):
- Single self-contained HTML document with inline <style> and <script>. No external JS or CSS frameworks.
- Every screen is a <section data-screen="name">; a global show(name) function switches screens and calls window.__lab&&window.__lab.view(name).
- The moment the user finishes the core task, the page calls window.__lab&&window.__lab.complete().
- Images keep their existing src paths.`

const reconSchema = z.object({
  summary: z.string().describe('One or two sentences on what the site is and who it serves'),
  designTokens: z.array(z.string()).describe('Colors, fonts, spacing and component style, e.g. "cream background #f6f1ea"'),
  sections: z.array(z.string()).describe('Screens/sections in order'),
  flow: z.array(z.string()).describe('Steps a user takes to complete the goal'),
  frictionPoints: z.array(z.string()).describe('Concrete UX problems likely to hurt the goal, most severe first'),
})

/** Reconnaissance: extract a design + UX spec from the page, like the cloner template's recon phase. */
export async function reconSite(html: string, brief: Brief): Promise<SiteSpec> {
  const agent = new Agent({
    model: codex('conversational'),
    printer: false,
    systemPrompt:
      'You are a senior UX researcher and front-end engineer doing reconnaissance on a website before a conversion experiment. Be concrete and specific; reference real copy and elements.',
  })
  const result = await agent.invoke(
    `Business goal: ${brief.goal}\nParticipant task: ${brief.task}\n\nSite HTML:\n${html.slice(0, 60000)}`,
    { structuredOutputSchema: reconSchema },
  )
  return result.structuredOutput as SiteSpec
}

/** Foundation: rebuild an external page as a single-file, instrumented replica. */
export async function cloneSite(html: string, spec: SiteSpec, brief: Brief): Promise<string> {
  const agent = new Agent({
    model: codex('builder', 32000),
    printer: false,
    systemPrompt: `You are an expert front-end engineer who produces pixel-faithful clones of websites as a single HTML file.\n${CONVENTIONS}`,
  })
  const result = await agent.invoke(
    `Rebuild this page faithfully so we can run a usability experiment on it. Keep copy, layout, and visual style; turn the goal flow into working screens (${spec.flow.join(' → ')}). Keep existing friction — do not fix anything yet.\nTask: ${brief.task}\nDesign tokens: ${spec.designTokens.join('; ')}\n\nSource HTML:\n${html.slice(0, 60000)}\n\nReply with only the complete HTML document in a single \`\`\`html code block.`,
  )
  const text = result.toString()
  const match = text.match(/```html\s*([\s\S]*?)```/i)
  const out = (match?.[1] ?? text).trim()
  const issues = qaSite(out, [])
  if (issues.length) throw new Error(`Clone failed QA: ${issues.join('; ')}`)
  return out
}

export function qaSite(html: string, requiredScreens: string[]): string[] {
  const issues: string[] = []
  if (!/<\/html>/i.test(html)) issues.push('document is truncated (missing </html>)')
  if (!html.includes('__lab.view')) issues.push('screen changes no longer call window.__lab.view(name)')
  if (!html.includes('__lab.complete')) issues.push('task success no longer calls window.__lab.complete()')
  for (const s of requiredScreens) {
    if (!html.includes(`data-screen="${s}"`)) issues.push(`screen "${s}" was removed`)
  }
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1])
  for (const code of scripts) {
    try {
      new Function(code)
    } catch (error) {
      issues.push(`JavaScript syntax error: ${(error as Error).message}`)
    }
  }
  return issues
}

export function screensOf(html: string) {
  return [...html.matchAll(/data-screen="([^"]+)"/g)].map((m) => m[1])
}

const numbered = (html: string, from = 1, to = Number.POSITIVE_INFINITY) =>
  html
    .split('\n')
    .map((line, i) => [i + 1, line] as const)
    .filter(([n]) => n >= from && n <= to)
    .map(([n, line]) => `${n}| ${line}`)
    .join('\n')

export type VariantBuild = { html: string; changes: string[] }

/** Builder: a Codex agent that applies one hypothesis to the champion page through surgical edit tools. */
export async function buildVariant(opts: {
  baseHtml: string
  brief: Brief
  spec: SiteSpec
  name: string
  hypothesis: string
  instructions: string
}): Promise<VariantBuild> {
  let html = opts.baseHtml
  let edits = 0
  let changes: string[] = []
  const requiredScreens = screensOf(opts.baseHtml)

  const readSite = tool({
    name: 'read_site',
    description: 'Read the current HTML with line numbers, optionally limited to a line range.',
    inputSchema: z.object({ from: z.number().int().optional(), to: z.number().int().optional() }),
    callback: ({ from, to }) => numbered(html, from, to),
  })
  const editSite = tool({
    name: 'edit_site',
    description:
      'Replace one exact, unique snippet of the current HTML (no line-number prefixes) with new content. Prefer several small surgical edits over rewriting large blocks.',
    inputSchema: z.object({ find: z.string().min(1), replace: z.string() }),
    callback: ({ find, replace }) => {
      if (edits >= MAX_EDITS) return 'STOP: edit budget exhausted. Call finish now.'
      const at = html.indexOf(find)
      if (at < 0) return 'ERROR: snippet not found. Use read_site and copy the text exactly.'
      if (html.indexOf(find, at + 1) >= 0) return 'ERROR: snippet is not unique. Include more surrounding context.'
      html = html.slice(0, at) + replace + html.slice(at + find.length)
      edits++
      return `OK (${edits}/${MAX_EDITS} edits used)`
    },
  })
  const runQa = tool({
    name: 'run_qa',
    description: 'Run automated QA: JS syntax, required screens, and instrumentation hooks.',
    inputSchema: z.object({}),
    callback: () => {
      const issues = qaSite(html, requiredScreens)
      return issues.length ? `FAILED:\n- ${issues.join('\n- ')}` : 'PASSED'
    },
  })
  const finish = tool({
    name: 'finish',
    description: 'Call once QA passes. List the user-visible changes you made in plain language.',
    inputSchema: z.object({ changes: z.array(z.string()).min(1).max(6) }),
    callback: ({ changes: c }) => {
      changes = c
      return 'Recorded.'
    },
  })

  const agent = new Agent({
    model: codex('builder'),
    printer: false,
    tools: [readSite, editSite, runQa, finish],
    systemPrompt: `You are a Codex front-end engineer on a conversion-optimization team. You receive the current champion page and ONE hypothesis, and you implement exactly that hypothesis with minimal, high-quality edits that match the existing design system.\n${CONVENTIONS}\nWorkflow: plan briefly → edit_site (small, exact snippets) → run_qa → fix until PASSED → finish.`,
  })

  await agent.invoke(
    `Variant: ${opts.name}\nHypothesis: ${opts.hypothesis}\nImplementation brief: ${opts.instructions}\n\nBusiness goal: ${opts.brief.goal}\nDesign tokens: ${opts.spec.designTokens.join('; ')}\n\nCurrent page:\n${numbered(html)}`,
  )

  let issues = qaSite(html, requiredScreens)
  if (issues.length) {
    await agent.invoke(`Automated QA still fails:\n- ${issues.join('\n- ')}\nFix these with edit_site, run_qa, then finish.`)
    issues = qaSite(html, requiredScreens)
  }
  if (issues.length) throw new Error(`Variant "${opts.name}" failed QA: ${issues.join('; ')}`)
  if (html === opts.baseHtml) throw new Error(`Variant "${opts.name}" made no changes`)
  return { html, changes: changes.length ? changes : [opts.hypothesis] }
}
