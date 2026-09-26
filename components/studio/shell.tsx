'use client'

import useSWR from 'swr'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ActivityEvent, ActivityKind } from '@/lib/types'
import { cn } from '@/lib/utils'

const MAX_EVENTS = 1500

const GLYPH: Record<ActivityKind, string> = {
  system: '#',
  start: '+',
  prompt: '›',
  thinking: '~',
  text: '»',
  tool: '→',
  result: '←',
  error: '!',
  done: '■',
  evolve: 'Δ',
  mission: '◆',
  memory: '◇',
  context: '▤',
  metric: '∿',
}

const TONE: Record<ActivityKind, string> = {
  system: 'text-sky-300',
  start: 'text-neutral-500',
  prompt: 'text-neutral-400',
  thinking: 'text-neutral-500 italic',
  text: 'text-neutral-100',
  tool: 'text-emerald-400',
  result: 'text-emerald-400/70',
  error: 'text-rose-400',
  done: 'text-neutral-500',
  evolve: 'text-fuchsia-300 font-semibold',
  mission: 'text-amber-300',
  memory: 'text-sky-400',
  context: 'text-cyan-300/80',
  metric: 'text-lime-300',
}

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })

function useActivity(enabled: boolean) {
  const store = useRef<{ cursor: number; ids: Set<string>; events: ActivityEvent[] }>({
    cursor: 0,
    ids: new Set(),
    events: [],
  })

  return useSWR(
    enabled ? 'strands-activity' : null,
    async () => {
      const res = await fetch(`/api/activity?after=${store.current.cursor}`)
      if (!res.ok) throw new Error('Activity unavailable')
      const { events } = (await res.json()) as { events: ActivityEvent[] }
      const fresh = events.filter((e) => !store.current.ids.has(e.id))
      if (fresh.length === 0) return store.current.events
      fresh.forEach((e) => store.current.ids.add(e.id))
      const merged = [...store.current.events, ...fresh].sort((a, b) => a.seq - b.seq).slice(-MAX_EVENTS)
      store.current = { cursor: merged.at(-1)!.seq, ids: store.current.ids, events: merged }
      return merged
    },
    { refreshInterval: 1500, keepPreviousData: true },
  )
}

function Line({ event }: { event: ActivityEvent }) {
  const head = (
    <>
      <span className="shrink-0 text-neutral-600 tabular-nums">{time(event.at)}</span>
      <span className="w-40 shrink-0 truncate text-neutral-500" title={event.agent}>
        {event.agent}
      </span>
      <span className={cn('flex min-w-0 gap-2', TONE[event.kind])}>
        <span aria-hidden="true" className="shrink-0">
          {GLYPH[event.kind]}
        </span>
        <span className="sr-only">{event.kind}</span>
        <span className={cn('min-w-0', event.kind === 'text' || event.kind === 'prompt' ? 'whitespace-pre-wrap break-words' : 'truncate')}>
          {event.text}
        </span>
      </span>
    </>
  )

  if (!event.detail) return <div className="flex gap-3 px-4 py-0.5">{head}</div>

  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none gap-3 px-4 py-0.5 hover:bg-white/5 [&::-webkit-details-marker]:hidden">
        {head}
        <span className="ml-auto shrink-0 text-neutral-600 group-open:hidden">{'…'}</span>
      </summary>
      <pre className="mx-4 mb-1 ml-[15.5rem] max-h-72 overflow-auto whitespace-pre-wrap break-words rounded border border-white/10 bg-white/[0.03] p-2 text-neutral-400">
        {event.detail}
      </pre>
    </details>
  )
}

export function Shell({ running }: { running: boolean }) {
  const [open, setOpen] = useState(true)
  const [agent, setAgent] = useState('all')
  const [clearedAt, setClearedAt] = useState(0)
  const { data = [], error } = useActivity(open)
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)

  const agents = useMemo(() => [...new Set(data.map((e) => e.agent))].sort(), [data])
  const visible = useMemo(
    () => data.filter((e) => e.seq > clearedAt && (agent === 'all' || e.agent === agent)),
    [data, agent, clearedAt],
  )

  useEffect(() => {
    const el = scroller.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [visible.length, open])

  return (
    <section
      aria-label="Strands activity"
      className="flex shrink-0 flex-col border-t border-neutral-800 bg-neutral-950 font-mono text-xs text-neutral-300"
    >
      <header className="flex h-9 items-center gap-3 px-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex items-center gap-2 text-neutral-200 hover:text-white"
        >
          <span aria-hidden="true" className={cn('inline-block transition-transform', open ? 'rotate-90' : '')}>
            {'›'}
          </span>
          Strands activity
        </button>
        <span className="flex items-center gap-1.5 text-neutral-500">
          <span
            aria-hidden="true"
            className={cn('size-1.5 rounded-full', running ? 'animate-pulse bg-emerald-400' : 'bg-neutral-600')}
          />
          {running ? 'live' : 'idle'}
        </span>
        {open && (
          <div className="ml-auto flex items-center gap-3">
            <label className="sr-only" htmlFor="shell-agent">
              Filter by agent
            </label>
            <select
              id="shell-agent"
              value={agent}
              onChange={(e) => setAgent(e.target.value)}
              className="h-6 rounded border border-neutral-800 bg-neutral-900 px-1.5 text-neutral-300 outline-none focus-visible:border-neutral-600"
            >
              <option value="all">all agents</option>
              {agents.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setClearedAt(data.at(-1)?.seq ?? 0)}
              className="text-neutral-500 hover:text-neutral-200"
            >
              clear
            </button>
          </div>
        )}
      </header>

      {open && (
        <div
          ref={scroller}
          role="log"
          onScroll={(e) => {
            const el = e.currentTarget
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
          }}
          className="h-[38dvh] overflow-y-auto border-t border-neutral-900 py-2 leading-5"
        >
          {visible.length === 0 ? (
            <p className="px-4 text-neutral-600">
              {error ? 'Could not load activity.' : '$ waiting for agents… start or advance a round to see Strands events.'}
            </p>
          ) : (
            visible.map((event) => <Line key={event.id} event={event} />)
          )}
        </div>
      )}
    </section>
  )
}
