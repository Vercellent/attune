import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const SESSION_COOKIE = 'lab_session'

/** SameSite=None so the participant flow still works inside the v0 preview iframe. */
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'none' as const,
  path: '/api/sessions',
  maxAge: 60 * 60 * 6,
}

export const newSessionToken = () => randomBytes(32).toString('base64url')

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

export const encodeSessionCookie = (sessionId: string, token: string) => `${sessionId}.${token}`

export function parseSessionCookie(value: string | null | undefined) {
  if (!value || value.length > 256) return null
  const dot = value.indexOf('.')
  if (dot <= 0 || dot === value.length - 1) return null
  return { sessionId: value.slice(0, dot), token: value.slice(dot + 1) }
}

export function tokenMatches(token: string | null | undefined, storedHash: string | null | undefined) {
  if (!token || !storedHash || !/^[0-9a-f]{64}$/.test(storedHash)) return false
  return timingSafeEqual(Buffer.from(hashToken(token), 'hex'), Buffer.from(storedHash, 'hex'))
}
