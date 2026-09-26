'use client'

import { useState } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button } from '@/components/ui/button'
import type { Overview } from '@/lib/lab'
import type { MetricSnapshot } from '@/lib/types'
import { cn } from '@/lib/utils'

const METRICS: { key: keyof Omit<MetricSnapshot, 'n'>; label: string; better: 'up' | 'down'; fmt: (v: number) => string }[] = [
  { key: 'score', label: 'Experience score', better: 'up', fmt: (v) => v.toFixed(0) },
  { key: 'completion', label: 'Task completion', better: 'up', fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'timeSec', label: 'Time to complete', better: 'down', fmt: (v) => `${Math.round(v)}s` },
  { key: 'friction', label: 'Friction per session', better: 'down', fmt: (v) => v.toFixed(1) },
]

function delta(before: number | null | undefined, after: number | null | undefined, better: 'up' | 'down') {
  if (before == null || after == null || before === 0) return null
  const pct = ((after - before) / Math.abs(before)) * 100
  return better === 'up' ? pct : -pct
}

export function Dashboard({ overview, onChange }: { overview: Overview; onChange: () => void }) {
  const { lab, mission, generations, variants, harness, sessions } = overview
  const [view, setView] = useState<'after' | 'before'>('after')
  const [copied, setCopied] = useState(false)
  const complete = lab.phase === 'complete'
  const done = sessions.done
  const target = lab.targetExperiments
  const closed = generations.filter((g) => g.status === 'closed')
  const current = generations.find((g) => g.number === lab.generation)
  const champion = lab.championVariantId ?? closed.at(-1)?.winnerVariantId ?? overview.baselineVariantId
  const shown = view === 'after' ? champion : overview.baselineVariantId

  const chart = closed.map((g) => ({
    round: `R${g.number}`,
    score: g.metrics?.score ?? g.score ?? null,
    completion: g.metrics?.completion != null ? Math.round(g.metrics.completion * 100) : null,
    harness: g.harnessVersion,
  }))
  const harnessBumps = closed.filter((g, i) => i > 0 && g.harnessVersion !== closed[i - 1].harnessVersion)

  async function copyLink() {
    await navigator.clipboard.writeText(`${window.location.origin}/interview`)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  async function advance() {
    await fetch('/api/lab', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'advance' }) })
    onChange()
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-sm text-muted-foreground">{lab.flow.join(' → ')}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{complete ? 'Optimization complete' : 'Experiments running'}</h1>
          {lab.status === 'error' && lab.error && (
            <p className="text-sm text-destructive" role="alert">
              {lab.error}
            </p>
          )}
        </div>
        {!complete && (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={advance} disabled={lab.status === 'working'}>
              Close round now
            </Button>
            <Button onClick={copyLink}>{copied ? 'Copied' : 'Copy tester link'}</Button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between text-sm">
          <span>
            <span className="text-2xl font-semibold tabular-nums">{done}</span>
            <span className="text-muted-foreground"> / {target} experiments</span>
          </span>
          <span className="text-muted-foreground">
            Round {lab.generation} · harness v{harness.at(-1)?.version ?? 1}
            {sessions.active ? ` · ${sessions.active} testing now` : ''}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={target}>
          <div className="h-full rounded-full bg-foreground transition-all" style={{ width: `${Math.min(100, (done / target) * 100)}%` }} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {METRICS.map((m) => {
          const before = mission?.baseline?.[m.key]
          const after = mission?.best?.[m.key]
          const d = delta(before, after, m.better)
          return (
            <div key={m.key} className="flex flex-col gap-1 rounded-xl border bg-card p-4">
              <span className="text-xs text-muted-foreground">{m.label}</span>
              <span className="text-2xl font-semibold tabular-nums">{after != null ? m.fmt(after) : '—'}</span>
              <span className="text-xs text-muted-foreground">
                was {before != null ? m.fmt(before) : '—'}
                {d != null && (
                  <span className={cn('ml-1.5 font-medium', d >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                    {d >= 0 ? '+' : ''}
                    {d.toFixed(0)}%
                  </span>
                )}
              </span>
            </div>
          )
        })}
      </div>

      <section className="flex flex-col gap-4" aria-labelledby="timeline">
        <h2 id="timeline" className="text-sm font-medium">
          Timeline
        </h2>
        {chart.length > 0 ? (
          <div className="h-56 rounded-xl border bg-card p-4">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="round" tick={{ fontSize: 12 }} stroke="var(--muted-foreground)" />
                <YAxis tick={{ fontSize: 12 }} stroke="var(--muted-foreground)" domain={[0, 100]} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                {harnessBumps.map((g) => (
                  <ReferenceLine key={g.number} x={`R${g.number}`} stroke="var(--chart-2)" strokeDasharray="4 4" label={{ value: `v${g.harnessVersion}`, fontSize: 10, position: 'top' }} />
                ))}
                <Line type="monotone" dataKey="score" name="Score" stroke="var(--foreground)" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="completion" name="Completion %" stroke="var(--chart-1)" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
            The chart fills in as each round of experiments closes.
          </p>
        )}

        <ol className="flex gap-3 overflow-x-auto pb-2">
          {generations.map((g) => {
            const winner = variants.find((v) => v._id === g.winnerVariantId)
            const evolved = harness.find((h) => h.version === g.harnessVersion && h.author !== 'seed')
            return (
              <li key={g._id} className="flex w-64 shrink-0 flex-col gap-2 rounded-xl border bg-card p-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">Round {g.number}</span>
                  <span className="text-muted-foreground">{g.status === 'closed' ? (g.score != null ? `score ${g.score.toFixed(0)}` : 'closed') : g.status}</span>
                </div>
                {winner && <p className="text-sm font-medium">Winner: {winner.name}</p>}
                <p className="line-clamp-4 text-sm leading-relaxed text-muted-foreground">
                  {g.learned ?? `${variants.filter((v) => v.generation === g.number).length} versions live`}
                </p>
                {evolved && <p className="rounded-md bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground">harness v{evolved.version}: {evolved.changes.length} change(s)</p>}
              </li>
            )
          })}
          {current?.status !== 'closed' && lab.status === 'working' && (
            <li className="flex w-64 shrink-0 items-center justify-center rounded-xl border border-dashed p-4 text-sm text-muted-foreground">{lab.step}</li>
          )}
        </ol>
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="final-site">
        <div className="flex items-center justify-between">
          <h2 id="final-site" className="text-sm font-medium">
            {complete ? 'Final website' : 'Current best website'}
          </h2>
          <div className="flex rounded-lg border p-0.5 text-sm" role="tablist">
            {(['before', 'after'] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={cn('rounded-md px-3 py-1 capitalize', view === v ? 'bg-foreground text-background' : 'text-muted-foreground')}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
        {shown ? (
          <iframe key={shown} src={`/api/variants/${shown}`} title={`${view} website`} sandbox="allow-scripts allow-forms" className="h-[80vh] w-full rounded-xl border bg-white" />
        ) : (
          <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">The first versions are being built.</p>
        )}
      </section>
    </div>
  )
}
