'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Clapperboard,
  LayoutTemplate,
  Mail,
  Megaphone,
  Route,
  Smartphone,
  Tag,
  type LucideIcon,
} from 'lucide-react'
import { AttuneLogo } from '@/components/attune-logo'
import { OBJECTIVES, type Objective } from '@/lib/types'
import { cn } from '@/lib/utils'

const OBJECTIVE_ICONS: Record<Objective, LucideIcon> = {
  website_flow: Route,
  digital_ads: Megaphone,
  product_videos: Clapperboard,
  landing_pages: LayoutTemplate,
  email_campaigns: Mail,
  app_onboarding: Smartphone,
  pricing_page: Tag,
}

export function Intake({ onStarted }: { onStarted: () => void | Promise<void> }) {
  const [objective, setObjective] = useState('')
  const [url, setUrl] = useState('/shop')
  const [optimize, setOptimize] = useState('')
  const [target, setTarget] = useState(40)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selected = OBJECTIVES.find((o) => o.value === objective)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const res = await fetch('/api/lab', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'start', objective, targetUrl: url, optimize, target }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data.error ?? 'Could not start')
      setPending(false)
      return
    }
    await onStarted()
  }

  return (
    <form onSubmit={submit} className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-20">
      <div className="flex flex-col gap-4">
        <AttuneLogo className="mb-2 h-10 self-start text-foreground" />
        <h1 className="text-balance font-serif text-5xl font-extralight leading-[1.05] tracking-tight md:text-6xl">
          Welcome to Attune, <span className="italic">Sarah</span>
        </h1>
        <p className="text-lg text-muted-foreground">What do you want to optimize?</p>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="sr-only">Optimize</legend>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {OBJECTIVES.map((o) => {
            const Icon = OBJECTIVE_ICONS[o.value]
            const checked = objective === o.value
            return (
              <label
                key={o.value}
                className={cn(
                  'relative flex min-h-28 flex-col justify-between gap-4 rounded-xl border bg-background p-4 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                  o.available ? 'cursor-pointer hover:border-foreground/40' : 'cursor-not-allowed opacity-50',
                  checked && 'border-foreground bg-foreground text-background hover:border-foreground',
                )}
              >
                <input
                  type="radio"
                  name="objective"
                  value={o.value}
                  checked={checked}
                  disabled={!o.available}
                  onChange={() => setObjective(o.value)}
                  required
                  className="sr-only"
                />
                <Icon className="size-5" aria-hidden="true" />
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{o.label}</span>
                  {!o.available && <span className="text-xs text-muted-foreground">Coming soon</span>}
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>

      {selected?.value === 'website_flow' && (
        <>
          <div className="flex flex-col gap-2">
            <label htmlFor="url" className="text-sm font-medium">
              Website link
            </label>
            <input
              id="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
              placeholder="https://yourstore.com"
              className="h-12 rounded-lg border bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <p className="text-xs text-muted-foreground">For this demo the agent walks through the Brewline demo store at /shop.</p>
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="optimize" className="text-sm font-medium">
              I want to optimize
            </label>
            <textarea
              id="optimize"
              value={optimize}
              onChange={(e) => setOptimize(e.target.value)}
              required
              minLength={8}
              rows={4}
              placeholder="The flow of buying a coffee machine, going from home to product listing page to checkout"
              className="rounded-lg border bg-background p-3 text-base leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="target" className="text-sm font-medium">
              Experiments to run <span className="font-normal text-muted-foreground">({target})</span>
            </label>
            <input
              id="target"
              type="range"
              min={10}
              max={60}
              step={5}
              value={target}
              onChange={(e) => setTarget(Number(e.target.value))}
              className="accent-foreground"
            />
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <Button type="submit" size="lg" disabled={pending} className="h-12 text-base">
            {pending ? 'Starting…' : 'Walk through my flow'}
          </Button>
        </>
      )}
    </form>
  )
}
