export const LAB_ID = 'default'

export const TOPICS = [
  'pricing',
  'shipping',
  'trust',
  'hierarchy',
  'cta',
  'copy',
  'navigation',
  'form',
  'attention',
] as const
export type Topic = (typeof TOPICS)[number]

export type Confidence = 'low' | 'medium' | 'high'

export type ActivityKind = 'system' | 'start' | 'prompt' | 'thinking' | 'text' | 'tool' | 'result' | 'error' | 'done'

export type ActivityDoc = {
  _id: string
  labId: string
  seq: number
  at: Date
  agent: string
  kind: ActivityKind
  text: string
  detail?: string
}

export type ActivityEvent = Omit<ActivityDoc, '_id' | 'labId' | 'at'> & { id: string; at: string }

export type Brief = {
  targetUrl: string
  goal: string
  task: string
}

export type SiteSpec = {
  summary: string
  designTokens: string[]
  sections: string[]
  flow: string[]
  frictionPoints: string[]
}

export type Playbook = {
  focus: string[]
  converged: string[]
  nextHypotheses: string[]
}

export type LabDoc = {
  _id: string
  brief: Brief
  spec: SiteSpec | null
  baselineHtml: string | null
  generation: number
  status: 'idle' | 'working' | 'error'
  step: string | null
  error: string | null
  autopilot: boolean
  minSessions: number
  playbook: Playbook | null
  createdAt: Date
  updatedAt: Date
}

export type RetrievedMemory = {
  findingId: string
  topic: Topic
  observation: string
  confidence: Confidence
  score: number | null
}

export type GenerationDoc = {
  _id: string
  labId: string
  number: number
  status: 'building' | 'collecting' | 'closed'
  memoryUsed: RetrievedMemory[]
  winnerVariantId: string | null
  learned: string | null
  score: number | null
  createdAt: Date
  closedAt: Date | null
}

export type VariantDoc = {
  _id: string
  labId: string
  generation: number
  key: string
  name: string
  hypothesis: string
  changes: string[]
  isControl: boolean
  html: string
  createdAt: Date
}

export type TrackEventType = 'page_view' | 'click' | 'dead_click' | 'rage_click' | 'form_error' | 'complete'

export type TrackEvent = {
  t: number
  type: TrackEventType
  page: string
  label?: string
}

export type SessionMetrics = {
  durationMs: number
  clicks: number
  deadClicks: number
  rageClicks: number
  backtracks: number
  formErrors: number
  hesitations: number
  pages: string[]
  completed: boolean
  exitPage: string
}

export type ChatMessage = {
  role: 'user' | 'assistant' | 'system'
  text: string
  at: Date
}

export type Insight = { topic: Topic; quote: string; note: string }

export type SessionDoc = {
  _id: string
  labId: string
  generation: number
  variantId: string
  variantKey: string
  status: 'task' | 'interview' | 'done'
  events: TrackEvent[]
  metrics: SessionMetrics | null
  messages: ChatMessage[]
  insights: Insight[]
  priceConfidence: number | null
  summary: string | null
  score: number | null
  startedAt: Date
  endedAt: Date | null
}

export type FindingDoc = {
  _id: string
  labId: string
  generation: number
  topic: Topic
  observation: string
  implicitEvidence: string
  explicitEvidence: string
  confidence: Confidence
  embedding: number[] | null
  createdAt: Date
}

export type OwnerMessageDoc = {
  _id: string
  labId: string
  role: 'user' | 'assistant' | 'update'
  text: string
  createdAt: Date
}
