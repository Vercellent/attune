'use client'

import { useEffect, useRef, useState } from 'react'
import { domToJpeg } from 'modern-screenshot'
import { Check, Loader2, Minus } from 'lucide-react'
import { AttuneLogo } from '@/components/attune-logo'
import { Button } from '@/components/ui/button'
import type { Overview } from '@/lib/lab'
import type { Rect } from '@/lib/types'
import { cn } from '@/lib/utils'

type Step = { title: string; note: string; friction: string[]; action: string; target: Rect | null; screenshot: string | null }
type NavStep = {
  title: string
  note: string
  friction: string[]
  actions: { type: 'click' | 'fill' | 'select'; elementId: string; value?: string }[]
  actionSummary: string
  done: boolean
}

const MAX_STEPS = 14
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function post<T>(body: unknown): Promise<T> {
  const res = await fetch('/api/capture', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Capture failed')
  return data
}

function readPage(doc: Document) {
  const nodes = Array.from(
    doc.querySelectorAll<HTMLElement>('a,button,input,select,textarea,[role=button],[onclick],[data-action]'),
  ).filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden')
  const elements = nodes.slice(0, 120).map((el, i) => {
    const id = `e${i}`
    el.setAttribute('data-cu', id)
    const input = el as HTMLInputElement
    const label = (
      el.getAttribute('aria-label') ||
      input.placeholder ||
      el.innerText ||
      input.name ||
      input.value ||
      el.tagName
    )
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 110)
    const role = el.tagName.toLowerCase() + (input.type ? `:${input.type}` : '')
    return { id, role, label }
  })
  return { visibleText: (doc.body?.innerText ?? '').slice(0, 7000), elements }
}

function act(doc: Document, a: NavStep['actions'][number]) {
  const el = doc.querySelector<HTMLElement>(`[data-cu="${a.elementId}"]`)
  if (!el) return
  if (a.type === 'fill') {
    const input = el as HTMLInputElement
    input.focus()
    input.value = a.value ?? ''
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  } else if (a.type === 'select') {
    const select = el as HTMLSelectElement
    const opt = Array.from(select.options).find((o) => o.text.toLowerCase().includes((a.value ?? '').toLowerCase()))
    if (opt) select.value = opt.value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  } else {
    el.click()
  }
}

export function CaptureRun({ overview, onChange }: { overview: Overview; onChange: () => void }) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const started = useRef(false)
  const [steps, setSteps] = useState<Step[]>(() =>
    overview.captures.map((c) => ({ title: c.title, note: c.note, friction: c.friction, action: c.action, target: c.target, screenshot: c.screenshot })),
  )
  const [status, setStatus] = useState<string>('Opening the site…')
  const [comparing, setComparing] = useState(overview.captures.length > 0)
  const [error, setError] = useState<string | null>(null)
  const [launching, setLaunching] = useState(false)
  const ready = overview.lab.phase === 'ready'

  useEffect(() => {
    if (ready || started.current || overview.captures.length) return
    const frame = frameRef.current
    if (!frame) return
    started.current = true
    let view = 'home'
    const onLoad = async () => {
      const win = frame.contentWindow as (Window & { __lab?: unknown }) | null
      const doc = frame.contentDocument
      if (!win || !doc) return
      win.__lab = { view: (n: string) => (view = n || view), complete: () => undefined }
      const history: string[] = []
      const seen = new Map<string, number>()
      try {
        for (let i = 0; i < MAX_STEPS; i++) {
          await sleep(700)
          setStatus(`Reading screen ${i + 1}…`)
          const page = readPage(doc)
          const signature = page.visibleText.slice(0, 1500)
          const visits = (seen.get(signature) ?? 0) + 1
          seen.set(signature, visits)
          if (visits > 2) break
          const next = await post<{ step: NavStep }>({ kind: 'step', step: i, screen: view, ...page, history }).then((r) => r.step)
          const first = next.actions[0] ? doc.querySelector<HTMLElement>(`[data-cu="${next.actions[0].elementId}"]`) : null
          first?.scrollIntoView({ block: 'center' })
          await sleep(250)
          const r = first?.getBoundingClientRect()
          const pageW = doc.body.scrollWidth || 1
          const pageH = Math.min(doc.body.scrollHeight, 2400) || 1
          const top = r ? r.top + win.scrollY : 0
          const target = r && top < pageH ? { x: r.left / pageW, y: top / pageH, w: r.width / pageW, h: r.height / pageH } : null
          let screenshot: string | null = null
          try {
            screenshot = await domToJpeg(doc.body, { scale: 0.5, quality: 0.6, height: pageH })
            if (screenshot.length > 880_000) screenshot = null
          } catch {
            screenshot = null
          }
          const step: Step = { title: next.title, note: next.note, friction: next.friction, action: next.actionSummary, target, screenshot }
          await post({ kind: 'save', index: i, screen: view, ...step })
          setSteps((s) => [...s, step])
          history.push(`${view}: ${next.actionSummary}`)
          if (next.done) break
          setStatus(next.actionSummary)
          for (const a of next.actions) {
            act(doc, a)
            await sleep(180)
          }
        }
        setComparing(true)
        setStatus('Summarizing the journey…')
        await post({ kind: 'finish' })
        onChange()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Capture failed')
      }
    }
    frame.addEventListener('load', onLoad, { once: true })
  }, [ready, overview.captures.length, onChange])

  async function launch() {
    setLaunching(true)
    await fetch('/api/lab', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'launch' }) })
    onChange()
  }


  type StageState = 'pending' | 'active' | 'done' | 'skipped'
  const analyzeState: StageState = ready || comparing ? 'done' : 'active'
  const compareState: StageState = ready ? 'done' : comparing ? 'active' : 'pending'
  const stages: { title: string; detail: string; state: StageState }[] = [
    {
      title: 'Analyzing your website',
      detail:
        analyzeState === 'active'
          ? steps.length
            ? `Reviewed ${steps.length} ${steps.length === 1 ? 'screen' : 'screens'} · ${status}`
            : status
          : `Walked through ${steps.length} ${steps.length === 1 ? 'screen' : 'screens'} of your flow`,
      state: analyzeState,
    },
    {
      title: 'Comparing with Attune user research',
      detail: 'Matching your flow against behavior patterns from thousands of tested users',
      state: compareState,
    },
    {
      title: 'Analyzing your user data',
      detail: 'No user data connected yet — this step will use the data you share with Attune',
      state: ready ? 'skipped' : 'pending',
    },
  ]

  return (
    <main className="mx-auto flex min-h-[calc(100svh-4rem)] w-full max-w-xl flex-col justify-center gap-10 px-6 py-16">
      <AttuneLogo className={cn('h-12 text-foreground', !ready && 'animate-pulse')} />

      <section aria-labelledby="reasoning-heading" className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1 id="reasoning-heading" className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
            Reasoning
          </h1>
          <p className="text-pretty text-2xl leading-snug">
            {ready ? 'Your flow is ready to optimize.' : 'Attune is studying your flow…'}
          </p>
        </div>

        <ol className="flex flex-col gap-5" aria-live="polite">
          {stages.map((stage) => (
            <li key={stage.title} className="flex gap-4">
              <span
                className={cn(
                  'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border',
                  stage.state === 'done' && 'border-primary bg-primary text-primary-foreground',
                  stage.state === 'active' && 'border-foreground text-foreground',
                  (stage.state === 'pending' || stage.state === 'skipped') && 'border-border text-muted-foreground',
                )}
                aria-hidden="true"
              >
                {stage.state === 'done' && <Check className="size-3.5" />}
                {stage.state === 'active' && <Loader2 className="size-3.5 animate-spin" />}
                {stage.state === 'skipped' && <Minus className="size-3.5" />}
              </span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className={cn('font-medium', (stage.state === 'pending' || stage.state === 'skipped') && 'text-muted-foreground')}>
                  {stage.title}
                  <span className="sr-only"> — {stage.state}</span>
                </p>
                <p className={cn('text-sm text-muted-foreground', stage.state === 'active' ? 'truncate' : 'text-pretty')}>{stage.detail}</p>
              </div>
            </li>
          ))}
        </ol>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </section>

      {ready && (
        <div className="flex flex-col gap-4 border-t pt-8">
          {overview.lab.confirmation && <p className="text-pretty leading-relaxed">{overview.lab.confirmation}</p>}
          <Button size="lg" onClick={launch} disabled={launching || overview.lab.status === 'working'} className="h-12 text-base">
            {launching || overview.lab.status === 'working' ? 'Starting…' : 'Start experiments'}
          </Button>
        </div>
      )}

      {!ready && (
        <iframe
          ref={frameRef}
          src={overview.lab.brief.targetUrl.startsWith('/') ? overview.lab.brief.targetUrl : '/shop'}
          title="Website being analyzed"
          aria-hidden="true"
          tabIndex={-1}
          className="pointer-events-none fixed -left-[10000px] top-0 h-[900px] w-[1280px]"
        />
      )}
    </main>
  )
}
