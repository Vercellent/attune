import { ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { OverviewData } from './studio-app'

export function Versions({ data }: { data: OverviewData }) {
  const lab = data.lab!
  const current = data.variants.filter((v) => v.generation === lab.generation)
  const best = Math.max(...current.map((v) => v.avgScore ?? -1))

  return (
    <section aria-labelledby="versions-title" className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h2 id="versions-title" className="text-sm font-medium">
          {lab.generation ? `Round ${lab.generation} versions` : 'Versions'}
        </h2>
        <a href="/shop" target="_blank" rel="noreferrer" className="text-xs text-muted-foreground hover:text-foreground">
          Open test shop
        </a>
      </div>

      {current.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          {lab.status === 'working' ? 'Agents are preparing the first versions.' : 'No versions yet.'}
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-3">
          {current.map((v) => {
            const leading = v.avgScore !== null && v.avgScore === best
            const progress = Math.min(1, v.sessionCount / lab.minSessions)
            return (
              <li
                key={v._id}
                className={cn(
                  'flex flex-col gap-4 rounded-xl border bg-card p-4',
                  leading ? 'border-primary ring-1 ring-primary/20' : 'border-border',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-xs font-medium text-muted-foreground">
                      {v.key}
                      {leading && <span className="text-primary"> · Leading</span>}
                    </span>
                    <h3 className="text-sm font-semibold leading-snug">{v.name}</h3>
                  </div>
                  <a
                    href={`/api/variants/${v._id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={`Preview version ${v.key}`}
                  >
                    <ExternalLink className="size-4" />
                  </a>
                </div>
                <p className="text-pretty text-xs leading-relaxed text-muted-foreground">{v.hypothesis}</p>

                <dl className="mt-auto grid grid-cols-2 gap-2">
                  <Metric label="Score" value={v.avgScore ?? '—'} />
                  <Metric
                    label="Completed"
                    value={v.completionRate === null ? '—' : `${Math.round(v.completionRate * 100)}%`}
                  />
                </dl>

                {v.quotes[0] && (
                  <blockquote className="border-l-2 border-accent pl-3 text-xs italic leading-relaxed text-foreground/80">
                    {`"${v.quotes[0].quote}"`}
                  </blockquote>
                )}

                <div className="flex flex-col gap-1.5">
                  <div className="h-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress * 100}%` }} />
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {v.sessionCount} of {lab.minSessions} interviews
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums">{value}</dd>
    </div>
  )
}
