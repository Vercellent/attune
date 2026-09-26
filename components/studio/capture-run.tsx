'use client'

import { useEffect, useRef, useState } from 'react'
import { domToJpeg } from 'modern-screenshot'
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
  const [cursor, setCursor] = useState<Rect | null>(null)
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
          setCursor(r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null)
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
          setCursor(null)
        }
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

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">
      <div className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">{overview.lab.brief.optimize}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{ready ? 'Journey captured' : 'Walking through your flow'}</h1>
      </div>

      {ready && overview.lab.confirmation && (
        <div className="flex flex-col gap-4 rounded-xl border bg-card p-6 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col gap-1">
            <p className="text-pretty leading-relaxed">{overview.lab.confirmation}</p>
            <p className="text-sm text-muted-foreground">{overview.lab.flow.join(' → ')}</p>
          </div>
          <Button size="lg" onClick={launch} disabled={launching || overview.lab.status === 'working'} className="h-12 shrink-0 px-6 text-base">
            {launching || overview.lab.status === 'working' ? 'Starting…' : 'Start experiments'}
          </Button>
        </div>
      )}

      <div className={cn('grid gap-6', ready ? 'grid-cols-1' : 'lg:grid-cols-[1fr_360px]')}>
        {!ready && (
          <div className="flex flex-col gap-2">
            <div className="relative aspect-[4/3] overflow-hidden rounded-xl border bg-muted">
              <iframe ref={frameRef} src={overview.lab.brief.targetUrl.startsWith('/') ? overview.lab.brief.targetUrl : '/shop'} title="Computer use view" className="size-full" />
              {cursor && (
                <div
                  className="pointer-events-none absolute rounded-md ring-2 ring-rose-500 ring-offset-2 transition-all"
                  style={{ left: cursor.x, top: cursor.y, width: cursor.w, height: cursor.h }}
                  aria-hidden="true"
                />
              )}
            </div>
            <p className="font-mono text-xs text-muted-foreground" aria-live="polite">
              {error ? <span className="text-destructive">{error}</span> : status}
            </p>
          </div>
        )}

        <ol className={cn('flex flex-col gap-4', ready && 'md:grid md:grid-cols-2 lg:grid-cols-3')}>
          {steps.map((s, i) => (
            <li key={i} className="flex flex-col gap-2 rounded-xl border bg-card p-3">
              {s.screenshot && (
                <div className="relative overflow-hidden rounded-md border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.screenshot} alt={`Screenshot of ${s.title}`} className="block w-full" />
                  {s.target && s.target.x <= 1 && s.target.w <= 1 && (
                    <div
                      className="absolute rounded ring-2 ring-rose-500 ring-offset-1"
                      style={{
                        left: `${s.target.x * 100}%`,
                        top: `${s.target.y * 100}%`,
                        width: `${s.target.w * 100}%`,
                        height: `${s.target.h * 100}%`,
                      }}
                      aria-hidden="true"
                    />
                  )}
                </div>
              )}
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-xs text-muted-foreground">{i + 1}</span>
                <h2 className="text-sm font-medium">{s.title}</h2>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">{s.note}</p>
              {s.friction.map((f) => (
                <p key={f} className="rounded-md bg-rose-50 px-2 py-1 text-xs text-rose-700">
                  {f}
                </p>
              ))}
              <p className="text-xs text-foreground/80">→ {s.action}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
