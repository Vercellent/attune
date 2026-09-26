'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  ArrowLeft,
  ChevronDown,
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

const USER_ROLES = [
  'Procurement & sourcing teams',
  'Finance & AP teams',
  'IT & security buyers',
  'Operations managers',
  'Legal & compliance',
  'Executives & budget owners',
]

const COMPANY_SIZES = ['50–200', '200–1,000', '1,000–5,000', '5,000+']

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
  const [objective, setObjective] = useState<Objective | null>(null)

  return (
    <div className="mx-auto flex max-w-2xl flex-col px-6 py-20">
      {objective ? (
        <DetailsStep
          key="details"
          objective={objective}
          onBack={() => setObjective(null)}
          onStarted={onStarted}
        />
      ) : (
        <ChooseStep key="choose" onChoose={setObjective} />
      )}
    </div>
  )
}

function ChooseStep({ onChoose }: { onChoose: (o: Objective) => void }) {
  return (
    <section className="flex flex-col gap-8 animate-in fade-in slide-in-from-left-4 duration-300">
      <div className="flex flex-col gap-4">
        <AttuneLogo className="mb-2 h-10 self-start text-foreground" />
        <h1 className="text-balance font-serif text-5xl font-extralight leading-[1.05] tracking-tight md:text-6xl">
          Welcome to Attune, <span className="italic">Sarah</span>
        </h1>
        <p className="text-lg text-muted-foreground">What do you want to optimize?</p>
      </div>

      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {OBJECTIVES.map((o) => {
          const Icon = OBJECTIVE_ICONS[o.value]
          return (
            <li key={o.value}>
              <button
                type="button"
                disabled={!o.available}
                onClick={() => onChoose(o.value)}
                className={cn(
                  'group flex min-h-28 w-full flex-col justify-between gap-4 rounded-xl border bg-background p-4 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                  o.available
                    ? 'cursor-pointer hover:border-foreground hover:bg-foreground hover:text-background'
                    : 'cursor-not-allowed opacity-50',
                )}
              >
                <Icon className="size-5" aria-hidden="true" />
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{o.label}</span>
                  {!o.available && <span className="text-xs text-muted-foreground">Coming soon</span>}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function DetailsStep({
  objective,
  onBack,
  onStarted,
}: {
  objective: Objective
  onBack: () => void
  onStarted: () => void | Promise<void>
}) {
  const [url, setUrl] = useState('/shop')
  const [role, setRole] = useState('')
  const [companySize, setCompanySize] = useState('')
  const [optimize, setOptimize] = useState('')
  const [target, setTarget] = useState(40)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const label = OBJECTIVES.find((o) => o.value === objective)?.label ?? ''
  const Icon = OBJECTIVE_ICONS[objective]

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const res = await fetch('/api/lab', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'start',
        objective,
        targetUrl: url,
        optimize,
        target,
        audience: { role, companySize },
      }),
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
    <form
      onSubmit={submit}
      className="flex flex-col gap-8 animate-in fade-in slide-in-from-right-4 duration-300"
    >
      <div className="flex flex-col gap-6">
        <button
          type="button"
          onClick={onBack}
          className="-ml-2 flex items-center gap-1.5 self-start rounded-md px-2 py-1 text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back
        </button>
        <div className="flex flex-col gap-3">
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon className="size-4" aria-hidden="true" />
            {label}
          </span>
          <h1 className="text-balance font-serif text-4xl font-extralight leading-[1.1] tracking-tight md:text-5xl">
            Tell us more about your <span className="italic">product</span>
          </h1>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="url" className="text-sm font-medium">
          Product link
        </label>
        <input
          id="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
          placeholder="https://yourproduct.com"
          className="h-12 rounded-lg border bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <p className="text-xs text-muted-foreground">For this demo the agent evaluates the Northstar procurement platform at /shop.</p>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="role" className="text-sm font-medium">
          Tell us more about your users
        </label>
        <div className="relative">
          <select
            id="role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            required
            className="h-12 w-full appearance-none rounded-lg border bg-background px-3 pr-10 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="" disabled>
              Who are they?
            </option>
            {USER_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Company size</legend>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {COMPANY_SIZES.map((s) => (
            <label
              key={s}
              className={cn(
                'flex h-12 cursor-pointer items-center justify-center rounded-lg border bg-background text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                companySize === s ? 'border-foreground bg-foreground text-background' : 'hover:border-foreground',
              )}
            >
              <input
                type="radio"
                name="companySize"
                value={s}
                checked={companySize === s}
                onChange={() => setCompanySize(s)}
                required
                className="sr-only"
              />
              {s}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Employees at your customers&apos; companies.</p>
      </fieldset>

      <div className="flex flex-col gap-2">
        <label htmlFor="optimize" className="text-sm font-medium">
          Describe how you want your website optimized
        </label>
        <textarea
          id="optimize"
          value={optimize}
          onChange={(e) => setOptimize(e.target.value)}
          required
          minLength={8}
          rows={4}
          autoFocus
          placeholder="The flow of evaluating a procurement workspace, from solution discovery to supplier request and approval"
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
        {pending ? 'Starting…' : 'Ready to optimize'}
      </Button>
    </form>
  )
}
