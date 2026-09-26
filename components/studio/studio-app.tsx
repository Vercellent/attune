'use client'

import useSWR from 'swr'
import { useState } from 'react'
import type { Overview } from '@/lib/lab'
import { cn } from '@/lib/utils'
import { Intake } from './intake'
import { CaptureRun } from './capture-run'
import { Dashboard } from './dashboard'
import { Shell } from './shell'

type LabResponse = { overview: Overview | null; error?: string }

const fetcher = async (url: string): Promise<LabResponse> => {
  const res = await fetch(url, { cache: 'no-store' })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Could not reach the lab')
  return data
}

export function StudioApp() {
  const { data, error, isLoading, mutate } = useSWR('/api/lab', fetcher, { refreshInterval: 3000 })
  const [shellOpen, setShellOpen] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const overview = data?.overview ?? null
  const phase = restarting ? null : (overview?.lab.phase ?? null)

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-foreground" aria-hidden="true" />
          <span className="text-sm font-medium tracking-tight">Experimentation Lab</span>
        </div>
        {overview && phase && (
          <button
            type="button"
            onClick={() => setRestarting(true)}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            New optimization
          </button>
        )}
      </header>

      <main className={cn('flex-1', shellOpen ? 'pb-[46vh]' : 'pb-12')}>
        {error && !data ? (
          <p className="mx-auto max-w-md px-6 py-24 text-center text-sm text-muted-foreground" role="alert">
            {error.message}
          </p>
        ) : isLoading ? (
          <p className="py-24 text-center text-sm text-muted-foreground">Loading…</p>
        ) : !phase ? (
          <Intake
            onStarted={async () => {
              await mutate()
              setRestarting(false)
            }}
          />
        ) : phase === 'capturing' || phase === 'ready' ? (
          <CaptureRun overview={overview!} onChange={() => mutate()} />
        ) : (
          <Dashboard overview={overview!} onChange={() => mutate()} />
        )}
      </main>

      <section
        aria-label="Agent shell"
        className={cn(
          'fixed inset-x-0 bottom-0 z-20 flex flex-col border-t border-neutral-800 bg-neutral-950 text-neutral-100 transition-[height]',
          shellOpen ? 'h-[46vh]' : 'h-10',
        )}
      >
        <button
          type="button"
          onClick={() => setShellOpen((o) => !o)}
          aria-expanded={shellOpen}
          className="flex h-10 shrink-0 items-center justify-between px-4 font-mono text-xs text-neutral-400 hover:text-neutral-100"
        >
          <span className="flex items-center gap-2">
            <span
              className={cn('size-1.5 rounded-full', overview?.lab.status === 'working' ? 'animate-pulse bg-emerald-400' : 'bg-neutral-600')}
              aria-hidden="true"
            />
            strands://harness
            {overview?.lab.step ? <span className="text-neutral-500">· {overview.lab.step}</span> : null}
          </span>
          <span>{shellOpen ? 'hide' : 'show shell'}</span>
        </button>
        {shellOpen && (
          <div className="min-h-0 flex-1">
            <Shell running={overview?.lab.status === 'working'} />
          </div>
        )}
      </section>
    </div>
  )
}
