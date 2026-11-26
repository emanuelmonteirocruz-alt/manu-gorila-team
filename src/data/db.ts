/**
 * Banco local (IndexedDB via Dexie) — offline-first.
 * Toda escrita marca `_dirty=1`; o serviço de sync envia ao Supabase quando houver rede.
 */
import Dexie, { type Table } from 'dexie'
import type {
  DailyCheckin, ExerciseLink, ExerciseProfile, Session, SessionRating, Student, WeekContext,
} from '../domain/types'
import { SEED_PROFILES } from '../engine/exerciseSeed'

export interface KV {
  key: string
  value: unknown
}

class TreinoDB extends Dexie {
  students!: Table<Student, string>
  weekContexts!: Table<WeekContext, string>
  sessions!: Table<Session, string>
  ratings!: Table<SessionRating, string>
  checkins!: Table<DailyCheckin, string>
  exerciseCache!: Table<ExerciseProfile, string>
  links!: Table<ExerciseLink, string>
  kv!: Table<KV, string>

  constructor() {
    super('em-treino')
    this.version(1).stores({
      students: 'id, modality, full_name, _dirty',
      weekContexts: 'id, [student_id+week_start], student_id, _dirty',
      sessions: 'id, student_id, date, [student_id+date], _dirty',
      ratings: 'id, session_id, _dirty',
      checkins: 'id, [student_id+date], student_id, _dirty',
      exerciseCache: 'key, *aliases, _dirty',
      links: 'id, exercise_key, _dirty',
      kv: 'key',
    })
    this.on('populate', (tx) => {
      tx.table('exerciseCache').bulkAdd(SEED_PROFILES)
    })
  }
}

export const db = new TreinoDB()

export const uid = () => crypto.randomUUID()
export const nowISO = () => new Date().toISOString()

/** Upsert marcando para sincronização. */
export async function save<T extends { id: string }>(table: Table<T, string>, row: T): Promise<T> {
  const r = { ...row, updated_at: nowISO(), _dirty: 1 as const }
  await table.put(r)
  return r
}

export async function softDelete<T extends { id: string }>(table: Table<T, string>, id: string) {
  await table.update(id, { _deleted: 1, _dirty: 1, updated_at: nowISO() } as never)
}

export async function getKV<T>(key: string, fallback: T): Promise<T> {
  const r = await db.kv.get(key)
  return (r?.value as T) ?? fallback
}
export async function setKV(key: string, value: unknown) {
  await db.kv.put({ key, value })
}

/** Id fixo do treinador local enquanto não há login (Fase 1 offline). */
export const LOCAL_TRAINER_ID = '00000000-0000-0000-0000-000000000001'
