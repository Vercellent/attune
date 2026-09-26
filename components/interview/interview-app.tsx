'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ChatPanel, type PanelMessage } from '@/components/chat-panel'
import type { TrackEvent } from '@/lib/types'
import { cn } from '@/lib/utils'

type Phase = 'intro' | 'starting' | 'task' | 'interview' | 'done' | 'unavailable'
type Session = { sessionId: string; variantId: string; task: string; greeting: string }

const uid = () => Math.random().toString(36).slice(2)

export function InterviewApp() {
  const [phase, setPhase] = useState<Phase>('intro')
  const [session, setSession] = useState<Session | null>(null)
  const [messages, setMessages] = useState<PanelMessage[]>([])
  const [pending, setPending] = useState(false)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const buffer = useRef<TrackEvent[]>([])
  const friction = useRef({ asked: false, dead: 0 })
  const phaseRef = useRef<Phase>(phase)
  phaseRef.current = phase

  const flush = useCallback(async () => {
    if (!session || buffer.current.length === 0) return
    const events = buffer.current.splice(0, buffer.current.length)
    await fetch(`/api/sessions/${session.sessionId}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events }),
      keepalive: true,
    }).catch(() => buffer.current.unshift(...events))
  }, [session])

  const talk = useCallback(
    async (input: { text?: string; trigger?: 'friction' | 'task_done' }) => {
      if (!session) return
      if (input.text) setMessages((m) => [...m, { id: uid(), role: 'user', text: input.text! }])
      if (input.trigger === 'task_done') setPhase('interview')
      setPending(true)
      await flush()
      try {
        const res = await fetch(`/api/sessions/${session.sessionId}/chat`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error)
        if (data.reply) setMessages((m) => [...m, { id: uid(), role: 'assistant', text: data.reply }])
        if (data.status === 'done') setPhase('done')
      } catch {
        setMessages((m) => [
          ...m,
          { id: uid(), role: 'assistant', text: 'Sorry, I lost connection for a second. Could you say that again?' },
        ])
      } finally {
        setPending(false)
      }
    },
    [session, flush],
  )

  useEffect(() => {
    if (!session) return
    function onMessage(e: MessageEvent) {
      if (e.source !== frameRef.current?.contentWindow || !e.data?.__lab) return
      const { type, page, label, t } = e.data as TrackEvent & { __lab: 1 }
      buffer.current.push({ type, page: String(page).slice(0, 80), label: String(label ?? '').slice(0, 80), t })
      if (phaseRef.current !== 'task') return
      if (type === 'complete') {
        void talk({ trigger: 'task_done' })
        return
      }
      if (type === 'dead_click') friction.current.dead++
      if (!friction.current.asked && (type === 'rage_click' || friction.current.dead >= 3)) {
        friction.current.asked = true
        void talk({ trigger: 'friction' })
      }
    }
    window.addEventListener('message', onMessage)
    const timer = setInterval(flush, 3000)
    return () => {
      window.removeEventListener('message', onMessage)
      clearInterval(timer)
    }
  }, [session, flush, talk])

  async function start() {
    setPhase('starting')
    const res = await fetch('/api/sessions', { method: 'POST' })
    if (!res.ok) {
      setPhase('unavailable')
      return
    }
    const data: Session = await res.json()
    setSession(data)
    setMessages([{ id: uid(), role: 'assistant', text: data.greeting }])
    setPhase('task')
  }

  if (phase === 'intro' || phase === 'starting' || phase === 'unavailable') {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <div className="flex w-full max-w-sm flex-col items-center gap-6 text-center">
          <div className="flex flex-col gap-2">
            <h1 className="text-balance text-2xl font-semibold tracking-tight">Help us improve a website</h1>
            <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
              {phase === 'unavailable'
                ? 'There is no study running right now. Please check back soon.'
                : 'Try one small task on a website, then answer a few quick questions. It takes about 3 minutes.'}
            </p>
          </div>
          {phase !== 'unavailable' && (
            <Button size="lg" className="w-full" onClick={start} disabled={phase === 'starting'}>
              {phase === 'starting' && <Loader2 className="animate-spin" />}
              Start
            </Button>
          )}
        </div>
      </main>
    )
  }

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border px-4">
        <ol className="flex items-center gap-3 text-sm" aria-label="Progress">
          <Step n={1} label="Try the site" active={phase === 'task'} done={phase !== 'task'} />
          <span className="h-px w-6 bg-border" aria-hidden />
          <Step n={2} label="Quick chat" active={phase === 'interview'} done={phase === 'done'} />
        </ol>
        {phase === 'task' && (
          <Button size="sm" onClick={() => talk({ trigger: 'task_done' })} disabled={pending}>
            {"I'm done"}
          </Button>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <section className="relative min-h-0 flex-1 bg-muted" aria-label="Website">
          {session && (
            <iframe
              ref={frameRef}
              src={`/api/variants/${session.variantId}`}
              title="Website being tested"
              sandbox="allow-scripts allow-forms"
              className={cn('size-full border-0 bg-card', phase !== 'task' && 'pointer-events-none opacity-60')}
            />
          )}
        </section>

        <aside className="flex h-[42dvh] shrink-0 flex-col border-t border-border bg-background md:h-auto md:w-96 md:border-l md:border-t-0">
          {phase === 'done' ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
              <span className="flex size-10 items-center justify-center rounded-full bg-accent text-accent-foreground">
                <Check className="size-5" />
              </span>
              <h2 className="text-lg font-semibold">Thank you!</h2>
              <p className="text-sm text-muted-foreground">Your feedback helps make this site better. You can close this tab.</p>
            </div>
          ) : (
            <ChatPanel
              messages={messages}
              pending={pending}
              onSend={(text) => talk({ text })}
              placeholder={phase === 'task' ? 'Think out loud…' : 'Your answer…'}
            />
          )}
        </aside>
      </div>
    </div>
  )
}

function Step({ n, label, active, done }: { n: number; label: string; active: boolean; done: boolean }) {
  return (
    <li className={cn('flex items-center gap-2', !active && !done && 'text-muted-foreground')} aria-current={active ? 'step' : undefined}>
      <span
        className={cn(
          'flex size-5 items-center justify-center rounded-full text-xs font-medium',
          active ? 'bg-primary text-primary-foreground' : done ? 'bg-accent text-accent-foreground' : 'bg-muted',
        )}
      >
        {done && !active ? <Check className="size-3" /> : n}
      </span>
      <span className="hidden sm:inline">{label}</span>
    </li>
  )
}
