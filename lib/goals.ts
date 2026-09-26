import type { MetricSnapshot, MetricTargets } from './types'

export const DEFAULT_TARGETS: MetricTargets = { score: 85, completion: 90 }

export type GoalGap = { metric: keyof MetricTargets; current: number | null; target: number; gap: number | null }

/** Distance from each long-term target, largest gap first, so the strategist knows what to push on next. */
export function goalGaps(best: MetricSnapshot | null, targets: MetricTargets = DEFAULT_TARGETS): GoalGap[] {
  return (Object.keys(targets) as (keyof MetricTargets)[])
    .map((metric) => {
      const current = best?.[metric] ?? null
      return { metric, current, target: targets[metric], gap: current === null ? null : Math.max(0, targets[metric] - current) }
    })
    .sort((a, b) => (b.gap ?? Infinity) - (a.gap ?? Infinity))
}

export function describeGoals(best: MetricSnapshot | null, targets?: MetricTargets) {
  const gaps = goalGaps(best, targets)
  const lines = gaps.map((g) =>
    g.current === null
      ? `- ${g.metric}: no data yet → target ${g.target}`
      : `- ${g.metric}: ${g.current} → target ${g.target}${g.gap ? ` (gap ${g.gap})` : ' (met)'}`,
  )
  const open = gaps.filter((g) => g.gap !== 0)
  const focus = open[0] ? `Prioritize ${open[0].metric}: it is furthest from its target.` : 'All targets met — consolidate and avoid regressions.'
  return `LONG-TERM GOALS\n${lines.join('\n')}\n${focus}`
}
