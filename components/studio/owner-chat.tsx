'use client'

import useSWR from 'swr'
import { useState } from 'react'
import { ChatPanel, type PanelMessage } from '@/components/chat-panel'

type OwnerMessage = { _id: string; role: 'user' | 'assistant' | 'update'; text: string }

const fetcher = (url: string) => fetch(url).then((r) => r.json())
const SUGGESTIONS = ['What have we learned so far?', 'Why is the leader winning?', 'Start the next round']

export function OwnerChat() {
  const { data, mutate } = useSWR<{ messages: OwnerMessage[] }>('/api/owner/chat', fetcher, { refreshInterval: 4000 })
  const [optimistic, setOptimistic] = useState<PanelMessage | null>(null)
  const [pending, setPending] = useState(false)

  const messages: PanelMessage[] = (data?.messages ?? []).map((m) => ({ id: m._id, role: m.role, text: m.text }))
  if (optimistic) messages.push(optimistic)

  async function send(text: string) {
    setOptimistic({ id: 'pending', role: 'user', text })
    setPending(true)
    try {
      const res = await fetch('/api/owner/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
    } catch (err) {
      window.alert((err as Error).message)
    } finally {
      await mutate()
      setOptimistic(null)
      setPending(false)
    }
  }

  return (
    <>
      <div className="flex h-14 shrink-0 items-center border-b border-border px-4">
        <h2 className="text-sm font-medium">Research lead</h2>
      </div>
      <ChatPanel
        messages={messages}
        pending={pending}
        onSend={send}
        placeholder="Ask about results…"
        emptyState={<p className="text-sm text-muted-foreground">Updates from the lab will appear here.</p>}
        footer={
          messages.length > 0 && !pending ? (
            <div className="flex gap-2 overflow-x-auto px-3 pb-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="shrink-0 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          ) : null
        }
      />
    </>
  )
}
