import 'server-only'
import { collections, newId } from './db'
import { assertInterviewScope, sessionFilter, type InterviewScope } from './scope'
import { LAB_ID, type ActivityKind, type ChatMessage, type Insight, type SessionDoc } from './types'

export function interviewScope(sessionId: string): InterviewScope {
  const scope: InterviewScope = { kind: 'interview', labId: LAB_ID, sessionId }
  assertInterviewScope(scope)
  return scope
}

const MAX_LOG = 4000
let seq = 0

/**
 * The interviewer's only door to the database: one session document and that session's own log.
 * It has no way to reach studio collections (findings, digests, harness, other sessions).
 */
export async function openInterviewStore(scope: InterviewScope) {
  assertInterviewScope(scope)
  const { sessions, sessionLogs } = await collections()
  const key = sessionFilter(scope)

  return {
    load: () => sessions.findOne(key, { projection: { tokenHash: 0 } }) as Promise<Omit<SessionDoc, 'tokenHash'> | null>,

    commitTurn: (set: Partial<SessionDoc>, messages: ChatMessage[], insights: Insight[]) =>
      sessions.updateOne(sessionFilter(scope, { status: 'interview' }), {
        $set: set,
        $push: { messages: { $each: messages }, insights: { $each: insights } },
      }),

    log: (kind: ActivityKind, text: string, detail?: string) => {
      seq = Math.max(Date.now() * 1000, seq + 1)
      void sessionLogs
        .insertOne({
          _id: newId(),
          labId: scope.labId,
          sessionId: scope.sessionId,
          seq,
          at: new Date(),
          kind,
          text: text.trim().slice(0, MAX_LOG),
          ...(detail ? { detail: detail.slice(0, MAX_LOG) } : {}),
        })
        .catch((error) => console.error('[interview-log] write failed:', (error as Error).message))
    },
  }
}
