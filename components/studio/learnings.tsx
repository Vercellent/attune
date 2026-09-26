import type { OverviewData } from './studio-app'

export function Learnings({ data }: { data: OverviewData }) {
  const closed = data.generations.filter((g) => g.status === 'closed')
  const variantName = (id: string | null) => data.variants.find((v) => v._id === id)?.name ?? '—'

  return (
    <section aria-labelledby="learnings-title" className="flex flex-col gap-4">
      <h2 id="learnings-title" className="text-sm font-medium">
        What we&apos;ve learned
      </h2>

      {closed.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Findings appear here after the first round closes. They are stored in MongoDB Atlas and reused by every agent.
        </p>
      ) : (
        <ol className="flex flex-col gap-6">
          {closed.map((g) => (
            <li key={g._id} className="flex flex-col gap-3 border-l border-border pl-4">
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-medium text-muted-foreground">Round {g.number}</span>
                <span className="text-sm font-semibold">Winner: {variantName(g.winnerVariantId)}</span>
                {g.score !== null && <span className="text-xs tabular-nums text-muted-foreground">score {g.score}</span>}
              </div>
              {g.learned && <p className="text-pretty text-sm leading-relaxed">{g.learned}</p>}
              <ul className="flex flex-col gap-1.5">
                {data.findings
                  .filter((f) => f.generation === g.number)
                  .map((f) => (
                    <li key={f._id} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-medium text-foreground">{f.topic}</span>
                      <span>{f.observation}</span>
                    </li>
                  ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
