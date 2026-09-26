'use client'

import { useEffect, useRef, useState } from 'react'
import 'rrweb-player/dist/style.css'
import type { Replay } from '@/lib/types'

type PlayerCtor = new (opts: { target: HTMLElement; props: Record<string, unknown> }) => {
  goto: (ms: number, play?: boolean) => void
  $destroy?: () => void
}

export function ReplayClip({ sessionId, replay }: { sessionId: string; replay: Replay }) {
  const ref = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'empty'>('loading')

  useEffect(() => {
    let player: InstanceType<PlayerCtor> | null = null
    let cancelled = false
    ;(async () => {
      const res = await fetch(`/api/sessions/${sessionId}/replay?end=${replay.endTs}`)
      const { events } = (await res.json()) as { events: { timestamp: number }[] }
      if (cancelled || !ref.current) return
      if (!events?.length || events.length < 2) return setState('empty')
      const Player = (await import('rrweb-player')).default as unknown as PlayerCtor
      const width = ref.current.clientWidth
      player = new Player({
        target: ref.current,
        props: { events, width, height: Math.round(width * 0.62), autoPlay: false, showController: true, skipInactive: true },
      })
      player.goto(Math.max(0, replay.startTs - events[0].timestamp), true)
      setState('ready')
    })().catch(() => setState('empty'))
    return () => {
      cancelled = true
      player?.$destroy?.()
    }
  }, [sessionId, replay.endTs, replay.startTs])

  return (
    <figure className="flex flex-col gap-1.5">
      <div ref={ref} className="overflow-hidden rounded-lg border bg-muted [&_.rr-player]:!shadow-none" />
      <figcaption className="text-xs text-muted-foreground">
        {state === 'loading' ? 'Loading replay…' : state === 'empty' ? 'Replay unavailable for this moment.' : `Replay: ${replay.label}`}
      </figcaption>
    </figure>
  )
}
