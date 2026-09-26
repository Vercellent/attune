import 'server-only'
import { collections, newId } from './db'
import { LAB_ID, type ActivityEvent, type ActivityKind } from './types'

const MAX_TEXT = 4000
/** Inserts are fire-and-forget, so late writes can land behind the client's cursor; re-read this window and dedupe client-side. */
const REREAD_WINDOW_US = 5_000_000

let lastSeq = 0
let indexed = false

const clip = (value: string) =>
  value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)} … (+${value.length - MAX_TEXT} chars)` : value

export function logActivity(agent: string, kind: ActivityKind, text: string, detail?: string) {
  lastSeq = Math.max(Date.now() * 1000, lastSeq + 1)
  const doc = {
    _id: newId(),
    labId: LAB_ID,
    seq: lastSeq,
    at: new Date(),
    agent,
    kind,
    text: clip(text.trim()),
    ...(detail ? { detail: clip(detail) } : {}),
  }
  void collections()
    .then(async ({ activity }) => {
      if (!indexed) {
        indexed = true
        await activity.createIndex({ labId: 1, seq: 1 })
      }
      await activity.insertOne(doc)
    })
    .catch((error) => console.error('[activity] write failed:', (error as Error).message))
}

export async function listActivity(after: number): Promise<ActivityEvent[]> {
  const { activity } = await collections()
  const docs =
    after > 0
      ? await activity
          .find({ labId: LAB_ID, seq: { $gt: after - REREAD_WINDOW_US } })
          .sort({ seq: 1 })
          .limit(500)
          .toArray()
      : (await activity.find({ labId: LAB_ID }).sort({ seq: -1 }).limit(300).toArray()).reverse()
  return docs.map(({ _id, at, labId: _lab, ...rest }) => ({ id: _id, at: at.toISOString(), ...rest }))
}
