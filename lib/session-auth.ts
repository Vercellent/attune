import 'server-only'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { collections } from './db'
import { encodeSessionCookie, parseSessionCookie, SESSION_COOKIE, SESSION_COOKIE_OPTIONS, tokenMatches } from './session-token'
import { LAB_ID } from './types'

export async function readSessionCookie() {
  return parseSessionCookie((await cookies()).get(SESSION_COOKIE)?.value)
}

export async function setSessionCookie(sessionId: string, token: string) {
  ;(await cookies()).set(SESSION_COOKIE, encodeSessionCookie(sessionId, token), SESSION_COOKIE_OPTIONS)
}

/** The URL's session id must match the HttpOnly cookie, and the cookie's token must hash to the stored one. */
export async function authorizeSession(sessionId: string) {
  const cookie = await readSessionCookie()
  if (!cookie || cookie.sessionId !== sessionId) return false
  const { sessions } = await collections()
  const session = await sessions.findOne({ _id: sessionId, labId: LAB_ID }, { projection: { tokenHash: 1 } })
  return tokenMatches(cookie.token, session?.tokenHash)
}

export const unauthorizedSession = () =>
  NextResponse.json({ error: 'This session is no longer valid. Please reload the page to start again.' }, { status: 401 })
