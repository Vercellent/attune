/**
 * Two isolated sides share one database. The scope always comes from server state
 * (the lab constant or a verified session cookie), never from prompt text or request bodies.
 */
export type StudioScope = { kind: 'studio'; labId: string }
export type InterviewScope = { kind: 'interview'; labId: string; sessionId: string }

export class ScopeError extends Error {
  name = 'ScopeError'
}

export function assertStudioScope(scope: Partial<StudioScope> | null | undefined): asserts scope is StudioScope {
  if (!scope || scope.kind !== 'studio' || !scope.labId) throw new ScopeError('Studio query without a lab scope')
}

export function assertInterviewScope(scope: Partial<InterviewScope> | null | undefined): asserts scope is InterviewScope {
  if (!scope || scope.kind !== 'interview' || !scope.labId || !scope.sessionId) {
    throw new ScopeError('Interview query without a session scope')
  }
}

/** Mongo filter for studio data; throws instead of silently matching every lab. */
export function studioFilter(scope: StudioScope, extra: Record<string, unknown> = {}) {
  assertStudioScope(scope)
  return { ...extra, labId: scope.labId }
}

/** Mongo filter for exactly one session document; caller-supplied keys cannot widen it. */
export function sessionFilter(scope: InterviewScope, extra: Record<string, unknown> = {}) {
  assertInterviewScope(scope)
  return { ...extra, _id: scope.sessionId, labId: scope.labId }
}
