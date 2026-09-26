import 'server-only'
import { MongoClient, type Db } from 'mongodb'
import type {
  ActivityDoc,
  FindingDoc,
  GenerationDoc,
  LabDoc,
  OwnerMessageDoc,
  SessionDoc,
  VariantDoc,
} from './types'

const globalForMongo = globalThis as unknown as { _mongoClient?: Promise<MongoClient> }

export async function getDb(): Promise<Db> {
  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error('MONGODB_URI is not set')
  globalForMongo._mongoClient ??= new MongoClient(uri, {
    appName: 'autonomous-experimentation-lab',
    serverSelectionTimeoutMS: 10000,
  })
    .connect()
    .catch((error) => {
      globalForMongo._mongoClient = undefined
      throw error
    })
  const client = await globalForMongo._mongoClient
  return client.db(process.env.MONGODB_DB || 'experimentation_lab')
}

export async function resetDbIfUnreachable(error: unknown) {
  const name = error instanceof Error ? error.name : ''
  if (!/MongoServerSelectionError|MongoNetwork|MongoTopologyClosed/.test(name)) return
  const cached = globalForMongo._mongoClient
  globalForMongo._mongoClient = undefined
  await cached?.then((client) => client.close(true)).catch(() => {})
}

export async function collections() {
  const db = await getDb()
  return {
    labs: db.collection<LabDoc>('labs'),
    generations: db.collection<GenerationDoc>('generations'),
    variants: db.collection<VariantDoc>('variants'),
    sessions: db.collection<SessionDoc>('sessions'),
    findings: db.collection<FindingDoc>('findings'),
    ownerMessages: db.collection<OwnerMessageDoc>('owner_messages'),
    activity: db.collection<ActivityDoc>('activity'),
  }
}

export const newId = () => crypto.randomUUID()
