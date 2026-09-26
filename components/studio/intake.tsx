'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { OBJECTIVES } from '@/lib/types'

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
    <form onSubmit={submit} className="mx-auto flex max-w-xl flex-col gap-8 px-6 py-20">
      <div className="flex flex-col gap-4">
        <h1 className="text-balance font-serif text-5xl font-extralight leading-[1.05] tracking-tight md:text-6xl">
          Welcome to Attune, <span className="italic">Sarah</span>
        </h1>
        <p className="text-lg text-muted-foreground">What do you want to optimize?</p>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="objective" className="text-sm font-medium">
          Optimize
        </label>
        <select
          id="objective"
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          required
          className="h-12 rounded-lg border bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="" disabled>
            Choose one
          </option>
          {OBJECTIVES.map((o) => (
            <option key={o.value} value={o.value} disabled={!o.available}>
              {o.label}
              {o.available ? '' : ' (coming soon)'}
            </option>
          ))}
        </select>
      </div>

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
