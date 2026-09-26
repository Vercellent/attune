export const LAB_ID = 'default'

export const OBJECTIVES = [
  { value: 'website_flow', label: 'Website flow', available: true },
  { value: 'digital_ads', label: 'Digital ads', available: false },
  { value: 'product_videos', label: 'Product videos', available: false },
  { value: 'landing_pages', label: 'Landing pages', available: false },
  { value: 'email_campaigns', label: 'Email campaigns', available: false },
  { value: 'app_onboarding', label: 'App onboarding', available: false },
  { value: 'pricing_page', label: 'Pricing page', available: false },
] as const
export type Objective = (typeof OBJECTIVES)[number]['value']

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

export type ActivityKind =
  | 'system'
  | 'start'
  | 'prompt'
  | 'thinking'
  | 'text'
  | 'tool'
  | 'result'
  | 'error'
  | 'done'
  | 'evolve'
  | 'mission'
  | 'memory'
  | 'context'
  | 'metric'

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
  objective: Objective
  targetUrl: string
  optimize: string
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

export type LabPhase = 'capturing' | 'ready' | 'running' | 'complete'

export type LabDoc = {
  _id: string
  brief: Brief
  phase: LabPhase
  journeySummary: string | null
  confirmation: string | null
  flow: string[]
  spec: SiteSpec | null
  baselineHtml: string | null
  generation: number
  status: 'idle' | 'working' | 'error'
  step: string | null
  error: string | null
  targetExperiments: number
  playbook: Playbook | null
  championVariantId: string | null
  autopilot: boolean
  createdAt: Date
  updatedAt: Date
}

export type Rect = { x: number; y: number; w: number; h: number }

export type CaptureDoc = {
  _id: string
  labId: string
  index: number
  screen: string
  title: string
  note: string
  friction: string[]
  action: string
  target: Rect | null
  screenshot: string | null
  createdAt: Date
}

/* ---------------- Recursive harness ---------------- */

export const AGENT_ROLES = ['strategist', 'builder', 'interviewer', 'synthesizer'] as const
export type AgentRole = (typeof AGENT_ROLES)[number]

export type HarnessRule = { id: string; agent: AgentRole; text: string; addedIn: number }

export type HarnessChange = {
  path: string
  before: string
  after: string
  why: string
}

export type HarnessConfig = {
  rules: HarnessRule[]
  context: {
    memoryK: number
    digestCount: number
    traceDetail: 'summary' | 'full'
    maxContextChars: number
  }
  guardrails: {
    maxEdits: number
    protectedFacts: string[]
    forbidden: string[]
  }
  tools: Record<AgentRole, string[]>
  interview: {
    behavioralQuestions: number
    journeyQuestions: number
    replayMoments: number
    maxTurns: number
  }
  experiment: {
    variantsPerGeneration: number
    sessionsPerVariant: number
  }
}

/**
 * active: the proven version new rounds fall back to.
 * trial: a proposal running for exactly one round; promoted or rejected on that round's score.
 * retired: superseded by a later active version. rejected: failed validation or its trial.
 */
export type HarnessStatus = 'active' | 'trial' | 'retired' | 'rejected'

export type HarnessEvaluation = {
  verdict: 'promote' | 'reject' | 'rollback'
  reason: string
  baseline: number | null
  observed: number | null
  n: number
  at: Date
}

export type HarnessDoc = HarnessConfig & {
  _id: string
  labId: string
  version: number
  parent: number | null
  author: 'seed' | 'architect' | 'rollback' | 'auto-rollback'
  status: HarnessStatus
  rationale: string
  changes: HarnessChange[]
  validationErrors: string[]
  evaluation: HarnessEvaluation | null
  scoreAtAdoption: number | null
  scoreAfter: number | null
  createdAt: Date
}

/** The interviewer's entire world, frozen when the participant joins. Studio changes never reach it. */
export type InterviewSnapshot = {
  harnessVersion: number
  task: string
  rules: string[]
  policy: HarnessConfig['interview']
  tools: string[]
  traceDetail: HarnessConfig['context']['traceDetail']
  topics: Topic[]
}

export type SessionLogDoc = {
  _id: string
  labId: string
  sessionId: string
  seq: number
  at: Date
  kind: ActivityKind
  text: string
  detail?: string
}

/* ---------------- Long-horizon mission ---------------- */

export type MetricSnapshot = {
  score: number | null
  completion: number | null
  timeSec: number | null
  friction: number | null
  n: number
}

export type MetricTargets = { score: number; completion: number }

export type MissionDoc = {
  _id: string
  objective: string
  target: number
  targets?: MetricTargets
  experiments: number
  epoch: number
  baseline: MetricSnapshot | null
  best: MetricSnapshot | null
  tokens: { input: number; output: number; total: number }
  agentRuns: number
  milestones: { at: Date; text: string }[]
  updatedAt: Date
}

export type DigestDoc = {
  _id: string
  labId: string
  epoch: number
  throughGeneration: number
  /** Embedded by Atlas Automated Embedding. */
  text: string
  createdAt: Date
}

export type RetrievedMemory = {
  findingId: string
  topic: Topic
  observation: string
  confidence: Confidence
  score: number | null
}

export type GenerationTelemetry = {
  buildsAttempted: number
  buildsFailed: number
  qaRetries: number
}

export type GenerationDoc = {
  _id: string
  labId: string
  number: number
  status: 'building' | 'collecting' | 'closed'
  harnessVersion: number
  memoryUsed: RetrievedMemory[]
  winnerVariantId: string | null
  learned: string | null
  score: number | null
  metrics: MetricSnapshot | null
  telemetry: GenerationTelemetry
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

/* ---------------- Tester sessions ---------------- */

export type TrackEventType = 'page_view' | 'click' | 'dead_click' | 'rage_click' | 'form_error' | 'complete'

export type TrackEvent = {
  t: number
  ts: number
  type: TrackEventType
  page: string
  label?: string
}

export type GazeDwell = { page: string; label: string; ms: number }

export type MomentKind = 'dead_click' | 'rage_click' | 'form_error' | 'backtrack' | 'hesitation' | 'abandon'

export type Moment = {
  id: string
  kind: MomentKind
  t: number
  ts: number
  page: string
  label: string
  description: string
}

export type SessionMetrics = {
  durationMs: number
  timeToCompleteMs: number | null
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

export type Replay = { momentId: string; startTs: number; endTs: number; label: string }

export type ChatMessage = {
  role: 'user' | 'assistant' | 'system'
  text: string
  at: Date
  replay?: Replay
}

export type Insight = { topic: Topic; quote: string; note: string }

export type SessionDoc = {
  _id: string
  labId: string
  generation: number
  variantId: string
  variantKey: string
  /** sha256 of the participant's HttpOnly cookie token; the raw token is never stored. */
  tokenHash: string
  snapshot: InterviewSnapshot | null
  status: 'briefing' | 'task' | 'interview' | 'done'
  camera: boolean
  events: TrackEvent[]
  gaze: GazeDwell[]
  metrics: SessionMetrics | null
  moments: Moment[]
  messages: ChatMessage[]
  insights: Insight[]
  priceConfidence: number | null
  summary: string | null
  score: number | null
  createdAt: Date
  taskStartedAt: Date | null
  taskEndedAt: Date | null
  endedAt: Date | null
}

export type RecordingChunkDoc = {
  _id: string
  sessionId: string
  seq: number
  events: unknown[]
  createdAt: Date
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
  /** Embedded by Atlas Automated Embedding. */
  text: string
  createdAt: Date
}

export type OwnerMessageDoc = {
  _id: string
  labId: string
  role: 'user' | 'assistant' | 'update'
  text: string
  createdAt: Date
}
