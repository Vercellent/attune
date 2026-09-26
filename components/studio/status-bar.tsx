'use client'

import { useState } from 'react'
import { Check, Copy, Loader2, SkipForward } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { labAction, type OverviewData } from './studio-app'

export function StatusBar({ data, onChange, onNew }: { data: OverviewData; onChange: () => void; onNew: () => void }) {
  const lab = data.lab!
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const working = lab.status === 'working'

  async function run(body: object) {
    setBusy(true)
    try {
      await labAction(body)
    } catch (err) {
      window.alert((err as Error).message)
    } finally {
      setBusy(false)
      onChange()
    }
  }

  async function copyLink() {
    await navigator.clipboard.writeText(`${window.location.origin}/interview`)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-5 py-4 md:flex-row md:items-center md:justify-between md:px-8">
        <div className="flex min-w-0 flex-col gap-1">
          <button onClick={onNew} className="w-fit text-left text-xs text-muted-foreground hover:text-foreground">
            New experiment
          </button>
          <h1 className="truncate text-lg font-semibold tracking-tight">{lab.brief.goal}</h1>
          <p
            className={cn(
              'flex items-center gap-2 text-sm',
              lab.status === 'error' ? 'text-destructive' : 'text-muted-foreground',
            )}
            aria-live="polite"
          >
            {working ? (
              <Loader2 className="size-3.5 animate-spin text-primary" />
            ) : (
              <span
                className={cn('size-2 rounded-full', lab.status === 'error' ? 'bg-destructive' : 'bg-primary')}
                aria-hidden
              />
            )}
            {working
              ? `${lab.step}…`
              : lab.status === 'error'
                ? lab.error
                : `Round ${lab.generation} · collecting interviews · ${data.sessions} total`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => run({ action: 'autopilot', enabled: !lab.autopilot })}
            disabled={busy}
            aria-pressed={lab.autopilot}
            title={`Automatically move to the next round after ${lab.minSessions} interviews per version`}
          >
            Autopilot {lab.autopilot ? 'on' : 'off'}
          </Button>
          {lab.status === 'error' && lab.generation === 0 ? (
            <Button size="sm" onClick={() => run({ action: 'start', brief: lab.brief })} disabled={busy}>
              Retry
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => run({ action: 'advance' })}
              disabled={busy || working || lab.generation === 0}
            >
              <SkipForward />
              Next round
            </Button>
          )}
          <Button size="sm" onClick={copyLink} disabled={lab.generation === 0}>
            {copied ? <Check /> : <Copy />}
            {copied ? 'Copied' : 'Interview link'}
          </Button>
        </div>
      </div>
    </header>
  )
}
