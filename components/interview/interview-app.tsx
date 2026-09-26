'use client'

import useSWRImmutable from 'swr/immutable'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { GazeDwell, Replay, TrackEvent } from '@/lib/types'
import { cn } from '@/lib/utils'
import { InterviewChat, type Msg } from './interview-chat'

type Session = { sessionId: string; variantId: string; task: string }
type Phase = 'brief' | 'task' | 'thinking' | 'interview' | 'done'
type TurnResult = { reply: string | null; replay: Replay | null; status: string; error?: string }

const GAZE_INTERVAL = 200

async function createSession(): Promise<Session> {
  const res = await fetch('/api/sessions', { method: 'POST' })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Could not start')
  return data
}

type WebGazer = {
  setGazeListener: (cb: (d: { x: number; y: number } | null) => void) => WebGazer
  showVideoPreview: (v: boolean) => WebGazer
  showPredictionPoints: (v: boolean) => WebGazer
  begin: () => Promise<unknown>
  end: () => void
  params: { faceMeshSolutionPath: string }
}

// WebGazer's MediaPipe deps can't be bundled by Turbopack, so load the prebuilt UMD build from /public.
function loadWebGazer(): Promise<WebGazer> {
  const w = window as Window & { webgazer?: WebGazer }
  if (w.webgazer) return Promise.resolve(w.webgazer)
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = '/vendor/webgazer.js'
    s.async = true
    s.onload = () => {
      if (!w.webgazer) return reject(new Error('WebGazer unavailable'))
      w.webgazer.params.faceMeshSolutionPath = '/vendor/mediapipe/face_mesh'
      resolve(w.webgazer)
    }
    s.onerror = () => reject(new Error('WebGazer failed to load'))
    document.head.appendChild(s)
  })
}

export function InterviewApp() {
  const { data: session, error } = useSWRImmutable('interview-session', createSession, { shouldRetryOnError: false })
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [phase, setPhase] = useState<Phase>('brief')
  const [messages, setMessages] = useState<Msg[]>([])
  const [camera, setCamera] = useState(true)
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef(0)
  const buffers = useRef<{ events: TrackEvent[]; gaze: Map<string, GazeDwell>; rrweb: unknown[] }>({ events: [], gaze: new Map(), rrweb: [] })
  const gazer = useRef<WebGazer | null>(null)
  const lastGaze = useRef(0)
  const [showGaze, setShowGaze] = useState(false)
  const [gazeLive, setGazeLive] = useState(false)
  const showGazeRef = useRef(false)
  const gazeDot = useRef<HTMLDivElement>(null)

  const toggleGaze = useCallback(() => {
    const next = !showGazeRef.current
    showGazeRef.current = next
    setShowGaze(next)
    gazer.current?.showVideoPreview(next)
    if (!next && gazeDot.current) gazeDot.current.style.opacity = '0'
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Option changes e.key on macOS (e.g. "Ç"), so match the physical key.
      if (e.shiftKey && e.altKey && e.code === 'KeyC') {
        e.preventDefault()
        toggleGaze()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleGaze])

  useEffect(() => {
    if (session) setMessages([{ role: 'assistant', text: `Thanks for helping! Your task:\n\n${session.task}\n\nRead it, then press Start. Press Stop when you're finished or stuck.` }])
  }, [session])

  const flush = useCallback(async () => {
    if (!session) return
    const b = buffers.current
    if (!b.events.length && !b.gaze.size && !b.rrweb.length) return
    const body = { events: b.events, gaze: [...b.gaze.values()], rrweb: b.rrweb, seq: Date.now() }
    buffers.current = { events: [], gaze: new Map(), rrweb: [] }
    await fetch(`/api/sessions/${session.sessionId}/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), keepalive: true }).catch(() => undefined)
  }, [session])

  useEffect(() => {
  if (phase === 'brief' || phase === 'done') return
  const warn = (e: BeforeUnloadEvent) => e.preventDefault()
  window.addEventListener('beforeunload', warn)
  return () => window.removeEventListener('beforeunload', warn)
  }, [phase])

  useEffect(() => {
  const onMessage = (e: MessageEvent) => {
      if (e.source !== frameRef.current?.contentWindow || !e.data?.__lab) return
      const d = e.data as { kind: string; type?: TrackEvent['type']; page?: string; label?: string; events?: unknown[] }
      const now = Date.now()
      if (d.kind === 'hotkey') {
        toggleGaze()
      } else if (d.kind === 'track' && d.type) {
        buffers.current.events.push({ t: now - startRef.current, ts: now, type: d.type, page: d.page ?? '', label: d.label?.slice(0, 80) })
      } else if (d.kind === 'rrweb' && d.events) {
        buffers.current.rrweb.push(...d.events)
      } else if (d.kind === 'gaze') {
        const key = `${d.page}|${d.label}`
        const g = buffers.current.gaze.get(key) ?? { page: (d.page ?? '').slice(0, 80), label: (d.label ?? '').slice(0, 80), ms: 0 }
        g.ms += GAZE_INTERVAL
        buffers.current.gaze.set(key, g)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [toggleGaze])

  useEffect(() => {
    if (phase !== 'task') return
    const tick = setInterval(() => setElapsed(Date.now() - startRef.current), 250)
    const pump = setInterval(flush, 2000)
    return () => {
      clearInterval(tick)
      clearInterval(pump)
    }
  }, [phase, flush])

  useEffect(() => () => gazer.current?.end(), [])

  async function startGaze() {
    try {
      const wg = await loadWebGazer()
      gazer.current = wg
      await wg
        .setGazeListener((p) => {
          const frame = frameRef.current
          if (!p || !frame) return
          const dot = gazeDot.current
          if (dot && showGazeRef.current) {
            dot.style.opacity = '1'
            dot.style.transform = `translate(${p.x}px, ${p.y}px)`
          }
          const now = Date.now()
          if (now - lastGaze.current < GAZE_INTERVAL) return
          lastGaze.current = now
          const r = frame.getBoundingClientRect()
          const x = p.x - r.left
          const y = p.y - r.top
          if (x < 0 || y < 0 || x > r.width || y > r.height) return
          frame.contentWindow?.postMessage({ __labcmd: 'gaze', x, y }, '*')
        })
        .showVideoPreview(showGazeRef.current)
        .showPredictionPoints(false)
        .begin()
      setGazeLive(true)
      return true
    } catch {
      gazer.current = null
      setGazeLive(false)
      return false
    }
  }

  async function start() {
    if (!session) return
    const gazeOn = camera ? await startGaze() : false
    await fetch(`/api/sessions/${session.sessionId}/task`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'start', camera: gazeOn }) })
    startRef.current = Date.now()
    setElapsed(0)
    frameRef.current?.contentWindow?.postMessage({ __labcmd: 'start' }, '*')
    setPhase('task')
  }

  async function stop() {
    if (!session) return
    frameRef.current?.contentWindow?.postMessage({ __labcmd: 'stop' }, '*')
    gazer.current?.end()
    gazer.current = null
    setGazeLive(false)
    if (gazeDot.current) gazeDot.current.style.opacity = '0'
    setPhase('thinking')
    await new Promise((r) => setTimeout(r, 900))
    await flush()
    const res = await fetch(`/api/sessions/${session.sessionId}/task`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'stop' }) })
    const turn: TurnResult = await res.json()
    applyTurn(turn)
  }

  function applyTurn(turn: TurnResult) {
    if (turn.reply) setMessages((m) => [...m, { role: 'assistant', text: turn.reply!, replay: turn.replay ?? undefined }])
    else if (turn.error) setMessages((m) => [...m, { role: 'assistant', text: turn.error! }])
    setPhase(turn.status === 'done' ? 'done' : 'interview')
  }

  async function send(text: string) {
    if (!session) return
    setMessages((m) => [...m, { role: 'user', text }])
    setPhase('thinking')
    const res = await fetch(`/api/sessions/${session.sessionId}/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) })
    applyTurn(await res.json())
  }

  if (error) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <p className="max-w-sm text-center text-muted-foreground">{error.message}</p>
      </main>
    )
  }

  const blurred = phase !== 'task'

  return (
    <main className="relative flex h-dvh flex-col bg-background md:flex-row">
      <section aria-label="Website" className="relative min-h-0 flex-1 border-b md:border-b-0 md:border-r">
        {session && (
          <iframe
            ref={frameRef}
            src={`/api/variants/${session.variantId}`}
            title="Website to test"
            sandbox="allow-scripts allow-forms"
            className={cn('size-full bg-white transition-[filter] duration-500', blurred && 'pointer-events-none blur-xl')}
            tabIndex={blurred ? -1 : 0}
            aria-hidden={blurred}
          />
        )}
        {blurred && phase !== 'done' && <div className="absolute inset-0" aria-hidden="true" />}
      </section>

      <InterviewChat
        className="h-[45dvh] w-full md:h-auto md:w-[400px]"
        sessionId={session?.sessionId ?? ''}
        messages={messages}
        phase={phase}
        elapsed={elapsed}
        camera={camera}
        onCameraChange={setCamera}
        onStart={start}
        onStop={stop}
        onSend={send}
        ready={!!session}
      />

      <div
        ref={gazeDot}
        aria-hidden="true"
        className="pointer-events-none fixed left-0 top-0 z-50 -ml-4 -mt-4 size-8 rounded-full border-2 border-primary bg-primary/25 opacity-0 shadow-lg transition-transform duration-100 ease-out"
      />

      {showGaze && (
        <div role="status" className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-full border bg-background/95 px-3 py-1.5 text-xs font-medium shadow-md backdrop-blur">
          <span className={cn('size-2 rounded-full', gazeLive ? 'animate-pulse bg-primary' : 'bg-muted-foreground')} aria-hidden="true" />
          {gazeLive ? 'Live gaze tracker' : camera ? 'Gaze tracker starts when the task begins' : 'Camera is off'}
          <kbd className="ml-1 rounded border bg-muted px-1 font-mono text-[10px] text-muted-foreground">Shift+Opt+C</kbd>
        </div>
      )}

      {phase === 'done' && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/70 p-6 backdrop-blur-xl">
          <div className="flex max-w-sm flex-col gap-3 text-center">
            <h1 className="text-3xl font-semibold tracking-tight">Thank you!</h1>
            <p className="leading-relaxed text-muted-foreground">Your feedback has been recorded. You can close this browser tab now.</p>
          </div>
        </div>
      )}
    </main>
  )
}
