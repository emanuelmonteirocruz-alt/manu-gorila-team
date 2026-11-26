/**
 * Banco local (IndexedDB via Dexie) — offline-first.
 * Toda escrita marca `_dirty=1`; o serviço de sync envia ao Supabase quando houver rede.
 */
import Dexie, { type Table } from 'dexie'
import type {
  DailyCheckin, ExerciseLink, ExerciseProfile, Session, SessionRating, Student, WeekContext,
} from '../domain/types'
import { SEED_PROFILES, SEED_VERSION } from '../engine/exerciseSeed'

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

// depois de gravar, pede uma sincronização (agrupa várias gravações seguidas numa só)
let syncTimer: ReturnType<typeof setTimeout> | undefined
function scheduleSync() {
  if (typeof window === 'undefined') return
  clearTimeout(syncTimer)
  syncTimer = setTimeout(() => window.dispatchEvent(new Event('sync-now')), 1500)
}

/** Upsert marcando para sincronização. */
export async function save<T extends { id: string }>(table: Table<T, string>, row: T): Promise<T> {
  const r = { ...row, updated_at: nowISO(), _dirty: 1 as const }
  await table.put(r)
  scheduleSync()
  return r
}

export async function softDelete<T extends { id: string }>(table: Table<T, string>, id: string) {
  await table.update(id, { _deleted: 1, _dirty: 1, updated_at: nowISO() } as never)
  scheduleSync()
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

/**
 * Banco de exercícios atualizado em aparelhos que já tinham o app: acrescenta só o que falta
 * (correções do treinador, IA e o que veio da nuvem nunca são sobrescritos).
 */
export async function ensureExerciseLibrary(): Promise<number> {
  if ((await getKV<number>('seed_version', 1)) >= SEED_VERSION) return 0
  const have = new Set((await db.exerciseCache.toCollection().primaryKeys()) as string[])
  const missing = SEED_PROFILES.filter((p) => !have.has(p.key))
  if (missing.length) await db.exerciseCache.bulkAdd(missing)
  await setKV('seed_version', SEED_VERSION)
  return missing.length
}
