'use client'

import useSWR from 'swr'
import { useState } from 'react'
import type { Overview } from '@/lib/lab'
import { OwnerChat } from './owner-chat'
import { SetupForm } from './setup-form'
import { StatusBar } from './status-bar'
import { Versions } from './versions'
import { Learnings } from './learnings'
import { Shell } from './shell'

export type OverviewData = Overview

const fetcher = async (url: string) => {
  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Request failed')
  return data
}

export async function labAction(body: object) {
  const res = await fetch('/api/lab', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Request failed')
  return data
}

export function StudioApp() {
  const { data, error, mutate, isLoading } = useSWR<OverviewData>('/api/lab', fetcher, { refreshInterval: 3000 })
  const [editing, setEditing] = useState(false)

  if (error && !data) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <p role="alert" className="max-w-sm text-center text-sm leading-relaxed text-destructive">
          {error.message}
        </p>
      </div>
    )
  }

  if (isLoading || !data) {
    return <div className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground">Loading…</div>
  }

  if (!data.lab || editing) {
    return (
      <SetupForm
        initial={data.lab?.brief}
        onCancel={data.lab ? () => setEditing(false) : undefined}
        onStarted={async () => {
          setEditing(false)
          await mutate()
        }}
      />
    )
  }

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh lg:flex-row">
      <main className="flex h-dvh shrink-0 flex-col lg:h-auto lg:min-h-0 lg:flex-1">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <StatusBar data={data} onChange={() => mutate()} onNew={() => setEditing(true)} />
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-5 py-8 md:px-8">
            <Versions data={data} />
            <Learnings data={data} />
          </div>
        </div>
        <Shell running={data.lab.status === 'working'} />
      </main>
      <aside className="flex h-[50dvh] shrink-0 flex-col border-t border-border bg-background lg:h-auto lg:w-[400px] lg:border-l lg:border-t-0">
        <OwnerChat />
      </aside>
    </div>
  )
}
