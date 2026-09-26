'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { Brief } from '@/lib/types'
import { labAction } from './studio-app'

const DEFAULTS: Brief = {
  targetUrl: '/shop',
  goal: 'Get more visitors to complete checkout',
  task: 'Buy the Aura pour-over kit and complete checkout.',
}

export function SetupForm({
  initial,
  onStarted,
  onCancel,
}: {
  initial?: Brief
  onStarted: () => void
  onCancel?: () => void
}) {
  const [brief, setBrief] = useState<Brief>(initial ?? DEFAULTS)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof Brief) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setBrief((b) => ({ ...b, [k]: e.target.value }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (onCancel && !window.confirm('Start over? Current results will be cleared.')) return
    setBusy(true)
    setError(null)
    try {
      await labAction({ action: 'start', brief })
      onStarted()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <form onSubmit={submit} className="flex w-full max-w-md flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">New experiment</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Tell the lab what to improve. Agents will study the site, build versions, interview visitors, and report back.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="url">Website</Label>
          <Input id="url" value={brief.targetUrl} onChange={set('targetUrl')} placeholder="https://yourstore.com" />
          <p className="text-xs text-muted-foreground">
            Use <code className="font-mono">/shop</code> for the built-in test store.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="goal">Business goal</Label>
          <Input id="goal" value={brief.goal} onChange={set('goal')} required minLength={3} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="task">Task for visitors</Label>
          <Textarea id="task" value={brief.task} onChange={set('task')} required minLength={3} rows={2} />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
          )}
          <Button type="submit" className="flex-1" disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            Start experiment
          </Button>
        </div>
      </form>
    </main>
  )
}
