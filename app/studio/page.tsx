import type { Metadata } from 'next'
import { StudioApp } from '@/components/studio/studio-app'

export const metadata: Metadata = { title: 'Studio · Experimentation Lab' }

export default function StudioPage() {
  return <StudioApp />
}
