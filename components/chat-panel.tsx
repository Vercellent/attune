'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type PanelMessage = { id: string; role: 'user' | 'assistant' | 'update'; text: string }

export function ChatPanel({
  messages,
  pending,
  onSend,
  placeholder = 'Type a message…',
  disabled,
  emptyState,
  footer,
}: {
  messages: PanelMessage[]
  pending?: boolean
  onSend: (text: string) => void
  placeholder?: string
  disabled?: boolean
  emptyState?: React.ReactNode
  footer?: React.ReactNode
}) {
  const [draft, setDraft] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length, pending])

  function submit() {
    const text = draft.trim()
    if (!text || pending || disabled) return
    setDraft('')
    onSend(text)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5" aria-live="polite">
        {messages.length === 0 && emptyState}
        <ul className="flex flex-col gap-3">
          {messages.map((m) => (
            <li
              key={m.id}
              className={cn(
                'max-w-[88%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed',
                m.role === 'user' && 'ml-auto bg-primary text-primary-foreground',
                m.role === 'assistant' && 'bg-muted text-foreground',
                m.role === 'update' && 'max-w-full border border-border bg-card text-foreground',
              )}
            >
              {m.role === 'update' && (
                <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-primary">Lab update</span>
              )}
              {m.text}
            </li>
          ))}
          {pending && (
            <li className="flex w-fit items-center gap-1 rounded-2xl bg-muted px-3.5 py-3" aria-label="Assistant is typing">
              {[0, 150, 300].map((d) => (
                <span
                  key={d}
                  className="size-1.5 animate-bounce rounded-full bg-muted-foreground"
                  style={{ animationDelay: `${d}ms` }}
                />
              ))}
            </li>
          )}
        </ul>
        <div ref={endRef} />
      </div>
      {footer}
      <form
        className="border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div className="flex items-end gap-2 rounded-xl border border-input bg-card p-1.5 focus-within:ring-2 focus-within:ring-ring/30">
          <label htmlFor="chat-input" className="sr-only">
            Message
          </label>
          <textarea
            id="chat-input"
            rows={1}
            value={draft}
            disabled={disabled}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return
                e.preventDefault()
                submit()
              }
            }}
            placeholder={placeholder}
            className="max-h-32 min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
          />
          <Button type="submit" size="icon" disabled={!draft.trim() || pending || disabled} aria-label="Send">
            <ArrowUp />
          </Button>
        </div>
      </form>
    </div>
  )
}
