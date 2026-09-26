'use client'

import { useEffect, useRef, useState } from 'react'
import type { Replay } from '@/lib/types'
import { cn } from '@/lib/utils'
import { ReplayClip } from './replay-clip'

export type Msg = { role: 'user' | 'assistant'; text: string; replay?: Replay }

function clock(ms: number) {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function InterviewChat({
  className,
  sessionId,
  messages,
  phase,
  elapsed,
  camera,
  ready,
  onCameraChange,
  onStart,
  onStop,
  onSend,
}: {
  className?: string
  sessionId: string
  messages: Msg[]
  phase: 'brief' | 'task' | 'thinking' | 'interview' | 'done'
  elapsed: number
  camera: boolean
  ready: boolean
  onCameraChange: (v: boolean) => void
  onStart: () => void
  onStop: () => void
  onSend: (text: string) => void
}) {
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length, phase])

  function submit() {
    const t = text.trim()
    if (!t || phase !== 'interview') return
    setText('')
    onSend(t)
  }

  return (
    <aside aria-label="Study chat" className={cn('flex min-h-0 flex-col bg-card', className)}>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <ul className="flex flex-col gap-3">
          {messages.map((m, i) => (
            <li key={i} className={cn('flex flex-col gap-2', m.role === 'user' ? 'items-end' : 'items-start')}>
              <p
                className={cn(
                  'max-w-[90%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                  m.role === 'user' ? 'bg-foreground text-background' : 'bg-muted',
                )}
              >
                {m.text}
              </p>
              {m.replay && (
                <div className="w-full">
                  <ReplayClip sessionId={sessionId} replay={m.replay} />
                </div>
              )}
            </li>
          ))}
          {phase === 'thinking' && (
            <li className="text-sm text-muted-foreground" aria-live="polite">
              Thinking…
            </li>
          )}
        </ul>
        <div ref={endRef} />
      </div>

      <div className="border-t p-4">
        {phase === 'brief' && (
          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={camera} onChange={(e) => onCameraChange(e.target.checked)} className="size-4 accent-foreground" />
              Use my webcam to track where I look
            </label>
            <button
              type="button"
              onClick={async () => {
                setPending(true)
                await onStart()
                setPending(false)
              }}
              disabled={!ready || pending}
              className="h-20 w-full rounded-2xl bg-emerald-600 text-2xl font-semibold text-white shadow-sm transition hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-300 disabled:opacity-60"
            >
              {pending ? 'Starting…' : 'Start'}
            </button>
          </div>
        )}

        {phase === 'task' && (
          <div className="flex flex-col gap-3">
            <p className="text-center font-mono text-3xl tabular-nums" aria-live="off">
              {clock(elapsed)}
            </p>
            <button
              type="button"
              onClick={onStop}
              className="h-20 w-full rounded-2xl bg-rose-600 text-2xl font-semibold text-white shadow-sm transition hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-rose-300"
            >
              Stop
            </button>
          </div>
        )}

        {(phase === 'interview' || phase === 'thinking') && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
            className="flex items-end gap-2"
          >
            <label htmlFor="answer" className="sr-only">
              Your answer
            </label>
            <textarea
              id="answer"
              rows={2}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  if (e.nativeEvent.isComposing || e.keyCode === 229) return
                  e.preventDefault()
                  submit()
                }
              }}
              placeholder="Type your answer…"
              disabled={phase !== 'interview'}
              className="min-h-12 flex-1 resize-none rounded-xl border bg-background px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <button
              type="submit"
              disabled={phase !== 'interview' || !text.trim()}
              className="h-12 rounded-xl bg-foreground px-4 text-sm font-medium text-background disabled:opacity-40"
            >
              Send
            </button>
          </form>
        )}
      </div>
    </aside>
  )
}
