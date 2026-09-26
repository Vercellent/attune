import type { SessionMetrics, TrackEvent } from './types'

const HESITATION_MS = 8000

export function computeMetrics(events: TrackEvent[]): SessionMetrics {
  const sorted = [...events].sort((a, b) => a.t - b.t)
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
  return {
    durationMs: sorted.at(-1)?.t ?? 0,
    clicks: count('click') + count('dead_click'),
    deadClicks: count('dead_click'),
    rageClicks: count('rage_click'),
    backtracks,
    formErrors: count('form_error'),
    hesitations,
    pages,
    completed: count('complete') > 0,
    exitPage: sorted.at(-1)?.page ?? 'start',
  }
}

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

export function summarizeTrace(events: TrackEvent[], m: SessionMetrics): string {
  const sorted = [...events].sort((a, b) => a.t - b.t)
  const lines = [
    `Outcome: ${m.completed ? 'completed the task' : `did not complete (last screen: ${m.exitPage})`} in ${Math.round(m.durationMs / 1000)}s.`,
    `Path: ${m.pages.join(' → ') || 'none'}.`,
    `Clicks ${m.clicks}, dead clicks ${m.deadClicks}, rage clicks ${m.rageClicks}, backtracks ${m.backtracks}, form errors ${m.formErrors}, long pauses ${m.hesitations}.`,
  ]
  const notable = sorted.filter((e) => e.type === 'dead_click' || e.type === 'rage_click' || e.type === 'form_error')
  for (const e of notable.slice(0, 8)) {
    lines.push(`- ${Math.round(e.t / 1000)}s on "${e.page}": ${e.type.replace('_', ' ')} on "${e.label ?? ''}"`)
  }
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].t - sorted[i - 1].t
    if (gap > HESITATION_MS) {
      lines.push(`- paused ${Math.round(gap / 1000)}s on "${sorted[i - 1].page}" before clicking "${sorted[i].label ?? sorted[i].type}"`)
    }
  }
  return lines.join('\n')
}
