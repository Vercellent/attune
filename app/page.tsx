import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

const LINKS = [
  { href: '/studio', title: 'Studio', body: 'For the business owner. Set a goal, watch rounds evolve, chat with the research lead.' },
  { href: '/interview', title: 'Interview', body: 'For participants. Try the site the agents built, then a short chat.' },
  { href: '/shop', title: 'Test shop', body: 'Northstar — a fictional procurement platform with a real enterprise request flow to optimize.' },
]

export default function Home() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="flex w-full max-w-md flex-col gap-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-balance text-2xl font-semibold tracking-tight">Experimentation Lab</h1>
          <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
            Agents study a site, build better versions, interview real visitors, and learn from every round.
          </p>
        </div>
        <nav className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="group flex items-center gap-4 p-4 hover:bg-muted/50">
              <div className="flex flex-1 flex-col gap-0.5">
                <span className="text-sm font-medium">{l.title}</span>
                <span className="text-xs leading-relaxed text-muted-foreground">{l.body}</span>
              </div>
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </Link>
          ))}
        </nav>
      </div>
    </main>
  )
}
