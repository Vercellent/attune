'use client'

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  ArrowLeft,
  BarChart3,
  Check,
  ChevronDown,
  Clapperboard,
  Cloud,
  Database,
  FileText,
  Headset,
  LayoutTemplate,
  Loader2,
  Mail,
  Megaphone,
  Route,
  Server,
  Smartphone,
  Tag,
  Upload,
  X,
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

const INTEGRATIONS: { id: string; name: string; description: string; icon: LucideIcon }[] = [
  {
    id: 'northstar-mcp',
    name: 'Northstar MCP server',
    description: 'mcp.northstar.io — your internal product and customer data',
    icon: Server,
  },
  { id: 'crm', name: 'Northstar CRM', description: 'Accounts, deals and buyer personas', icon: Cloud },
  { id: 'analytics', name: 'Product analytics', description: 'Funnels, events and session data', icon: BarChart3 },
  { id: 'warehouse', name: 'Data warehouse', description: 'Usage tables from Northstar’s warehouse', icon: Database },
  { id: 'support', name: 'Support desk', description: 'Tickets and customer feedback', icon: Headset },
]

const ACCEPTED_FILES = '.csv,.json,.xlsx,.pdf,.txt'

type Details = {
  url: string
  role: string
  companySize: string
  optimize: string
  target: number
}

const INITIAL_DETAILS: Details = { url: '/shop', role: '', companySize: '', optimize: '', target: 40 }

type Step = 'choose' | 'details' | 'data'

export function Intake({ onStarted }: { onStarted: () => void | Promise<void> }) {
  const [step, setStep] = useState<Step>('choose')
  const [objective, setObjective] = useState<Objective | null>(null)
  const [details, setDetails] = useState<Details>(INITIAL_DETAILS)

  return (
    <div className="mx-auto flex max-w-2xl flex-col px-6 py-20">
      {step === 'choose' || !objective ? (
        <ChooseStep
          key="choose"
          onChoose={(o) => {
            setObjective(o)
            setStep('details')
          }}
        />
      ) : step === 'details' ? (
        <DetailsStep
          key="details"
          objective={objective}
          details={details}
          onChange={setDetails}
          onBack={() => setStep('choose')}
          onNext={() => setStep('data')}
        />
      ) : (
        <DataStep
          key="data"
          objective={objective}
          details={details}
          onBack={() => setStep('details')}
          onStarted={onStarted}
        />
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

function StepHeader({
  objective,
  stepNumber,
  onBack,
  children,
}: {
  objective: Objective
  stepNumber: number
  onBack: () => void
  children: React.ReactNode
}) {
  const label = OBJECTIVES.find((o) => o.value === objective)?.label ?? ''
  const Icon = OBJECTIVE_ICONS[objective]
  return (
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
          <span aria-hidden="true">·</span>
          <span>Step {stepNumber} of 3</span>
        </span>
        <h1 className="text-balance font-serif text-4xl font-extralight leading-[1.1] tracking-tight md:text-5xl">
          {children}
        </h1>
      </div>
    </div>
  )
}

function DetailsStep({
  objective,
  details,
  onChange,
  onBack,
  onNext,
}: {
  objective: Objective
  details: Details
  onChange: (d: Details) => void
  onBack: () => void
  onNext: () => void
}) {
  const update = <K extends keyof Details>(key: K, value: Details[K]) => onChange({ ...details, [key]: value })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onNext()
      }}
      className="flex flex-col gap-8 animate-in fade-in slide-in-from-right-4 duration-300"
    >
      <StepHeader objective={objective} stepNumber={2} onBack={onBack}>
        Tell us more about your <span className="italic">product</span>
      </StepHeader>

      <div className="flex flex-col gap-2">
        <label htmlFor="url" className="text-sm font-medium">
          Product link
        </label>
        <input
          id="url"
          value={details.url}
          onChange={(e) => update('url', e.target.value)}
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
            value={details.role}
            onChange={(e) => update('role', e.target.value)}
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
                details.companySize === s ? 'border-foreground bg-foreground text-background' : 'hover:border-foreground',
              )}
            >
              <input
                type="radio"
                name="companySize"
                value={s}
                checked={details.companySize === s}
                onChange={() => update('companySize', s)}
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
          value={details.optimize}
          onChange={(e) => update('optimize', e.target.value)}
          required
          minLength={8}
          rows={4}
          placeholder="The flow of evaluating a procurement workspace, from solution discovery to supplier request and approval"
          className="rounded-lg border bg-background p-3 text-base leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="target" className="text-sm font-medium">
          Experiments to run <span className="font-normal text-muted-foreground">({details.target})</span>
        </label>
        <input
          id="target"
          type="range"
          min={10}
          max={60}
          step={5}
          value={details.target}
          onChange={(e) => update('target', Number(e.target.value))}
          className="accent-foreground"
        />
      </div>

      <Button type="submit" size="lg" className="h-12 text-base">
        Continue
      </Button>
    </form>
  )
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function DataStep({
  objective,
  details,
  onBack,
  onStarted,
}: {
  objective: Objective
  details: Details
  onBack: () => void
  onStarted: () => void | Promise<void>
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [dragging, setDragging] = useState(false)
  const [connected, setConnected] = useState<string[]>([])
  const [connecting, setConnecting] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function addFiles(list: FileList | null) {
    if (!list) return
    const incoming = Array.from(list)
    setFiles((prev) => [...prev, ...incoming.filter((f) => !prev.some((p) => p.name === f.name && p.size === f.size))])
  }

  function toggleIntegration(id: string) {
    if (connected.includes(id)) {
      setConnected((prev) => prev.filter((c) => c !== id))
      return
    }
    setConnecting(id)
    setTimeout(() => {
      setConnected((prev) => [...prev, id])
      setConnecting(null)
    }, 900)
  }

  const hasData = files.length > 0 || connected.length > 0

  async function start() {
    setPending(true)
    setError(null)
    const res = await fetch('/api/lab', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'start',
        objective,
        targetUrl: details.url,
        optimize: details.optimize,
        target: details.target,
        audience: { role: details.role, companySize: details.companySize },
        userData: {
          files: files.map((f) => ({ name: f.name, size: f.size, type: f.type })),
          integrations: connected,
        },
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
    <section className="flex flex-col gap-8 animate-in fade-in slide-in-from-right-4 duration-300">
      <div className="flex flex-col gap-3">
        <StepHeader objective={objective} stepNumber={3} onBack={onBack}>
          Upload your <span className="italic">user data</span>
        </StepHeader>
        <p className="text-pretty text-base leading-relaxed text-muted-foreground">
          Share what you already know about Northstar&apos;s users. Attune compares it with its own panel data to make
          sharper recommendations.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Upload files</h2>
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            addFiles(e.dataTransfer.files)
          }}
          className={cn(
            'flex flex-col items-center gap-3 rounded-xl border border-dashed bg-background px-6 py-10 text-center transition-colors',
            dragging ? 'border-foreground bg-muted' : 'border-border',
          )}
        >
          <span className="flex size-10 items-center justify-center rounded-full bg-muted">
            <Upload className="size-5" aria-hidden="true" />
          </span>
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">Drag and drop files here</p>
            <p className="text-xs text-muted-foreground">
              Surveys, interview notes, analytics exports — CSV, JSON, XLSX, PDF or TXT
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
            Browse files
          </Button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPTED_FILES}
            onChange={(e) => {
              addFiles(e.target.files)
              e.target.value = ''
            }}
            className="sr-only"
            aria-label="Upload user data files"
          />
        </div>

        {files.length > 0 && (
          <ul className="flex flex-col gap-2">
            {files.map((f) => (
              <li
                key={`${f.name}-${f.size}`}
                className="flex items-center gap-3 rounded-lg border bg-background px-3 py-2.5"
              >
                <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-sm">{f.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatSize(f.size)}</span>
                <button
                  type="button"
                  onClick={() => setFiles((prev) => prev.filter((p) => p !== f))}
                  className="rounded-md p-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Remove ${f.name}`}
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center gap-3 text-xs uppercase tracking-wider text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or connect a source
        <span className="h-px flex-1 bg-border" />
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Integrations</h2>
        <ul className="flex flex-col gap-2">
          {INTEGRATIONS.map((i) => {
            const isConnected = connected.includes(i.id)
            const isConnecting = connecting === i.id
            return (
              <li
                key={i.id}
                className={cn(
                  'flex items-center gap-4 rounded-xl border bg-background p-4 transition-colors',
                  isConnected && 'border-primary',
                )}
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <i.icon className="size-5" aria-hidden="true" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm font-medium">{i.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{i.description}</span>
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant={isConnected ? 'secondary' : 'outline'}
                  disabled={isConnecting}
                  onClick={() => toggleIntegration(i.id)}
                  aria-pressed={isConnected}
                  className="shrink-0"
                >
                  {isConnecting ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      Connecting
                    </>
                  ) : isConnected ? (
                    <>
                      <Check className="size-4" aria-hidden="true" />
                      Connected
                    </>
                  ) : (
                    'Connect'
                  )}
                </Button>
              </li>
            )
          })}
        </ul>
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-3">
        <Button type="button" size="lg" disabled={pending} onClick={start} className="h-12 text-base">
          {pending ? 'Starting…' : 'Ready to optimize'}
        </Button>
        {!hasData && (
          <p className="text-center text-xs text-muted-foreground">
            No data yet? You can continue — Attune will rely on its own panel data.
          </p>
        )}
      </div>
    </section>
  )
}
