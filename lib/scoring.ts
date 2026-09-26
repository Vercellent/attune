import type { GazeDwell, MetricSnapshot, Moment, SessionDoc, SessionMetrics, TrackEvent } from './types'

const HESITATION_MS = 8000

const sortEvents = (events: TrackEvent[]) => [...events].sort((a, b) => a.t - b.t)

export function computeMetrics(events: TrackEvent[], taskDurationMs?: number): SessionMetrics {
  const sorted = sortEvents(events)
  let hesitations = 0
  for (let i = 1; i < sorted.length; i++) if (sorted[i].t - sorted[i - 1].t > HESITATION_MS) hesitations++

  const pages: string[] = []
  const seen = new Set<string>()
  let backtracks = 0
  for (const e of sorted) {
    if (e.type !== 'page_view' || pages.at(-1) === e.page) continue
    if (seen.has(e.page)) backtracks++
    seen.add(e.page)
    pages.push(e.page)
  }
  const count = (type: TrackEvent['type']) => sorted.filter((e) => e.type === type).length
  const complete = sorted.find((e) => e.type === 'complete')
  return {
    durationMs: taskDurationMs ?? sorted.at(-1)?.t ?? 0,
    timeToCompleteMs: complete ? complete.t : null,
    clicks: count('click') + count('dead_click'),
    deadClicks: count('dead_click'),
    rageClicks: count('rage_click'),
    backtracks,
    formErrors: count('form_error'),
    hesitations,
    pages,
    completed: Boolean(complete),
    exitPage: sorted.at(-1)?.page ?? 'start',
  }
}

export const frictionOf = (m: SessionMetrics) =>
  m.deadClicks + m.rageClicks * 2 + m.backtracks + m.formErrors + m.hesitations

/** Experiment Score (0-100): completion 60 + friction budget 20 + stated price confidence 20. */
export function scoreSession(m: SessionMetrics, priceConfidence: number | null): number {
  const completion = m.completed ? 60 : 0
  const friction = Math.max(
    0,
    20 - m.deadClicks * 3 - m.rageClicks * 5 - m.backtracks * 3 - m.formErrors * 2 - m.hesitations * 2,
  )
  const confidence = ((priceConfidence ?? 3) / 5) * 20
  return Math.round(completion + friction + confidence)
}

/** Mistakes worth replaying to the participant, in the order they happened. */
export function findMoments(events: TrackEvent[], m: SessionMetrics): Moment[] {
  const sorted = sortEvents(events)
  const moments: Moment[] = []
  const push = (kind: Moment['kind'], e: TrackEvent, description: string) =>
    moments.push({ id: `m${moments.length + 1}`, kind, t: e.t, ts: e.ts, page: e.page, label: e.label ?? '', description })

  const seen = new Set<string>()
  let last: string | null = null
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i]
    if (e.type === 'dead_click') push('dead_click', e, `Clicked "${e.label}" on ${e.page}, which did nothing`)
    if (e.type === 'rage_click') push('rage_click', e, `Clicked "${e.label}" repeatedly on ${e.page}`)
    if (e.type === 'form_error') push('form_error', e, `Form error on field "${e.label}" (${e.page})`)
    if (e.type === 'page_view' && e.page !== last) {
      if (seen.has(e.page)) push('backtrack', e, `Went back to ${e.page} from ${last}`)
      seen.add(e.page)
      last = e.page
    }
    const prev = sorted[i - 1]
    if (prev && e.t - prev.t > HESITATION_MS) {
      push('hesitation', prev, `Paused ${Math.round((e.t - prev.t) / 1000)}s on ${prev.page} before "${e.label || e.type}"`)
    }
  }
  const tail = sorted.at(-1)
  if (!m.completed && tail) push('abandon', tail, `Stopped on ${tail.page} without finishing`)
  return moments.slice(0, 12)
}

export function summarizeTrace(events: TrackEvent[], m: SessionMetrics, detail: 'summary' | 'full' = 'summary'): string {
  const lines = [
    `Outcome: ${m.completed ? `completed the task in ${Math.round((m.timeToCompleteMs ?? 0) / 1000)}s` : `did not complete (last screen: ${m.exitPage})`}. Session length ${Math.round(m.durationMs / 1000)}s.`,
    `Path: ${m.pages.join(' → ') || 'none'}.`,
    `Clicks ${m.clicks}, dead clicks ${m.deadClicks}, rage clicks ${m.rageClicks}, backtracks ${m.backtracks}, form errors ${m.formErrors}, long pauses ${m.hesitations}.`,
  ]
  if (detail === 'full') {
    for (const e of sortEvents(events).slice(0, 60)) {
      lines.push(`- ${(e.t / 1000).toFixed(1)}s ${e.type} on ${e.page}${e.label ? ` "${e.label}"` : ''}`)
    }
  }
  return lines.join('\n')
}

export function summarizeGaze(gaze: GazeDwell[]): string {
  if (!gaze.length) return 'No eye-tracking data (camera was off).'
  const byPage = new Map<string, GazeDwell[]>()
  for (const g of gaze) byPage.set(g.page, [...(byPage.get(g.page) ?? []), g])
  return [...byPage.entries()]
    .map(([page, items]) => {
      const top = items.sort((a, b) => b.ms - a.ms).slice(0, 4)
      return `${page}: ${top.map((g) => `"${g.label}" ${(g.ms / 1000).toFixed(1)}s`).join(', ')}`
    })
    .join('\n')
}

export function snapshotOf(sessions: Pick<SessionDoc, 'metrics' | 'score'>[]): MetricSnapshot {
  const done = sessions.filter((s) => s.metrics)
  const n = done.length
  if (!n) return { score: null, completion: null, timeSec: null, friction: null, n: 0 }
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
  const times = done.map((s) => s.metrics!.timeToCompleteMs).filter((x): x is number => x !== null)
  const round = (x: number | null, d = 0) => (x === null ? null : Math.round(x * 10 ** d) / 10 ** d)
  return {
    score: round(avg(done.map((s) => s.score ?? 0))),
    completion: round(avg(done.map((s) => (s.metrics!.completed ? 100 : 0)))),
    timeSec: round(avg(times) === null ? null : avg(times)! / 1000, 1),
    friction: round(avg(done.map((s) => frictionOf(s.metrics!))), 1),
    n,
  }
}
