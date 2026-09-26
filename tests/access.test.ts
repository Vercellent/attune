import { describe, expect, it } from 'vitest'
import { ScopeError, sessionFilter, studioFilter, type InterviewScope, type StudioScope } from '@/lib/scope'
import { encodeSessionCookie, hashToken, newSessionToken, parseSessionCookie, tokenMatches } from '@/lib/session-token'

describe('scope enforcement', () => {
  it('a query with no scope fails', () => {
    expect(() => studioFilter({ kind: 'studio' } as StudioScope)).toThrow(ScopeError)
    expect(() => sessionFilter({ kind: 'interview', labId: 'default' } as InterviewScope)).toThrow(ScopeError)
    expect(() => sessionFilter(null as unknown as InterviewScope)).toThrow(ScopeError)
  })

  it('an interview scope cannot be passed where a studio one is required', () => {
    const interview: InterviewScope = { kind: 'interview', labId: 'default', sessionId: 's1' }
    expect(() => studioFilter(interview as unknown as StudioScope)).toThrow(ScopeError)
  })

  it('caller-supplied keys cannot widen a session filter', () => {
    const scope: InterviewScope = { kind: 'interview', labId: 'default', sessionId: 's1' }
    expect(sessionFilter(scope, { _id: { $exists: true }, labId: { $ne: null } })).toEqual({ _id: 's1', labId: 'default' })
  })
})

describe('session tokens', () => {
  const sessionId = 'a1b2c3d4-0000-4000-8000-000000000000'

  it('accepts the matching token', () => {
    const token = newSessionToken()
    const parsed = parseSessionCookie(encodeSessionCookie(sessionId, token))
    expect(parsed).toEqual({ sessionId, token })
    expect(tokenMatches(parsed!.token, hashToken(token))).toBe(true)
  })

  it('rejects a wrong or missing token', () => {
    const stored = hashToken(newSessionToken())
    expect(tokenMatches(newSessionToken(), stored)).toBe(false)
    expect(tokenMatches('', stored)).toBe(false)
    expect(tokenMatches(newSessionToken(), undefined)).toBe(false)
    expect(tokenMatches(newSessionToken(), 'not-a-hash')).toBe(false)
  })

  it('rejects malformed cookies', () => {
    for (const bad of [undefined, '', 'noseparator', '.tokenonly', `${sessionId}.`, 'x'.repeat(300)]) {
      expect(parseSessionCookie(bad)).toBeNull()
    }
  })
})
