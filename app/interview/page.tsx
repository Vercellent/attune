import type { Metadata } from 'next'
import { InterviewApp } from '@/components/interview/interview-app'

export const metadata: Metadata = { title: 'Quick website study' }

export default function InterviewPage() {
  return <InterviewApp />
}
