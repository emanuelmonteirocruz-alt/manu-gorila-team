/**
 * Sincronização Dexie ⇄ Supabase (last-write-wins por updated_at).
 * - push: envia linhas _dirty; _deleted vira DELETE remoto.
 * - pull: baixa linhas com updated_at > último sync.
 * Sessões são normalizadas no servidor (sessions + session_exercises).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { db, getKV, nowISO, setKV } from './db'
import type { Session, SessionExercise } from '../domain/types'

let client: SupabaseClient | null = null

export async function getSupabase(): Promise<SupabaseClient | null> {
  if (client) return client
  const url = (await getKV<string>('supabase_url', '')) || import.meta.env.VITE_SUPABASE_URL
  const key = (await getKV<string>('supabase_key', '')) || import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) return null
  client = createClient(url, key, { auth: { persistSession: true } })
  return client
}

export function resetSupabaseClient() {
  client = null
}

const strip = <T extends object>(row: T) => {
  const { _dirty, _deleted, ...rest } = row as Record<string, unknown>
  void _dirty; void _deleted
  return rest
}

type Simple = 'students' | 'weekContexts' | 'ratings' | 'checkins'
/** Chaves naturais únicas: evita conflito quando duas telas criam o mesmo registro offline. */
const CONFLICT: Partial<Record<Simple, string>> = { weekContexts: 'student_id,week_start', checkins: 'student_id,date,reported_by' }

const REMOTE: Record<Simple, string> = {
  students: 'students', weekContexts: 'week_context', ratings: 'session_ratings', checkins: 'daily_checkins',
}

export interface SyncResult {
  pushed: number
  pulled: number
  error?: string
}

export async function syncNow(): Promise<SyncResult> {
  const sb = await getSupabase()
  if (!sb) return { pushed: 0, pulled: 0, error: 'Supabase não configurado (modo 100% local).' }
  if (!navigator.onLine) return { pushed: 0, pulled: 0, error: 'Offline — dados salvos localmente.' }
  const { data: auth } = await sb.auth.getUser()
  if (!auth.user) return { pushed: 0, pulled: 0, error: 'Faça login do treinador em Configurações.' }

  let pushed = 0, pulled = 0
  try {
    // Cache de exercícios primeiro (FK de session_exercises)
    const dirtyCache = await db.exerciseCache.where('_dirty').equals(1).toArray()
    if (dirtyCache.length) {
      const { error } = await sb.from('exercise_cache').upsert(dirtyCache.map(({ _dirty, updated_at, ...r }) => (void _dirty, void updated_at, r)))
      if (error) throw error
      await db.exerciseCache.bulkPut(dirtyCache.map((r) => ({ ...r, _dirty: 0 as const })))
      pushed += dirtyCache.length
    }
    // Alunos criados offline levam o id local provisório do treinador: troca pelo usuário autenticado (RLS exige)
    const orphan = await db.students.filter((st) => st.trainer_id !== auth.user!.id).toArray()
    if (orphan.length) await db.students.bulkPut(orphan.map((st) => ({ ...st, trainer_id: auth.user!.id, _dirty: 1 as const })))
    // students antes de sessions (FK)
    for (const t of ['students', 'weekContexts'] as Simple[]) pushed += await pushSimple(sb, t)
    pushed += await pushSessions(sb)
    for (const t of ['ratings', 'checkins'] as Simple[]) pushed += await pushSimple(sb, t)
    const dirtyLinks = await db.links.where('_dirty').equals(1).toArray()
    if (dirtyLinks.length) {
      const { error } = await sb.from('exercise_links').upsert(dirtyLinks.map(({ id, _dirty, ...r }) => (void id, void _dirty, r)))
      if (error) throw error
      await db.links.bulkPut(dirtyLinks.map((r) => ({ ...r, _dirty: 0 as const })))
    }

    const since = await getKV<string>('last_sync', '1970-01-01T00:00:00Z')
    const startedAt = nowISO()
    pulled += await pullAll(sb, since)
    await setKV('last_sync', startedAt)
  } catch (e) {
    return { pushed, pulled, error: (e as Error).message }
  }
  return { pushed, pulled }
}

async function pushSimple(sb: SupabaseClient, t: Simple): Promise<number> {
  const table = db[t]
  const rows = (await table.where('_dirty').equals(1).toArray()) as Array<{ id: string; _deleted?: 0 | 1 }>
  if (!rows.length) return 0
  const del = rows.filter((r) => r._deleted).map((r) => r.id)
  const up = rows.filter((r) => !r._deleted).map(strip)
  if (up.length) {
    const { error } = await sb.from(REMOTE[t]).upsert(up, CONFLICT[t] ? { onConflict: CONFLICT[t] } : undefined)
    if (error) throw error
  }
  if (del.length) {
    const { error } = await sb.from(REMOTE[t]).delete().in('id', del)
    if (error) throw error
    await table.bulkDelete(del)
  }
  await Promise.all(rows.filter((r) => !r._deleted).map((r) => table.update(r.id, { _dirty: 0 } as never)))
  return rows.length
}

async function pushSessions(sb: SupabaseClient): Promise<number> {
  const rows = await db.sessions.where('_dirty').equals(1).toArray()
  for (const s of rows) {
    if (s._deleted) {
      const { error } = await sb.from('sessions').delete().eq('id', s.id)
      if (error) throw error
      await db.sessions.delete(s.id)
      continue
    }
    const { exercises, _dirty, _deleted, ...head } = s
    void _dirty; void _deleted
    let { error } = await sb.from('sessions').upsert(head)
    if (error) throw error
    ;({ error } = await sb.from('session_exercises').delete().eq('session_id', s.id))
    if (error) throw error
    if (exercises.length) {
      ;({ error } = await sb.from('session_exercises').insert(exercises.map((e) => ({ ...e, session_id: s.id }))))
      if (error) throw error
    }
    await db.sessions.update(s.id, { _dirty: 0 })
  }
  return rows.length
}

async function pullAll(sb: SupabaseClient, since: string): Promise<number> {
  let n = 0
  for (const t of ['students', 'weekContexts'] as Simple[]) {
    const { data, error } = await sb.from(REMOTE[t]).select('*').gt('updated_at', since)
    if (error) throw error
    for (const r of data ?? []) {
      const local = (await db[t].get(r.id)) as { _dirty?: number } | undefined
      if (local?._dirty) continue // alteração local pendente vence até ser enviada
      await db[t].put({ ...r, _dirty: 0 } as never)
      n++
    }
  }
  const { data: sess, error } = await sb.from('sessions').select('*, session_exercises(*)').gt('updated_at', since)
  if (error) throw error
  for (const r of sess ?? []) {
    const local = await db.sessions.get(r.id)
    if (local?._dirty) continue
    const { session_exercises, ...head } = r as Session & { session_exercises: (SessionExercise & { session_id: string })[] }
    await db.sessions.put({
      ...head,
      exercises: (session_exercises ?? []).map(({ session_id, ...e }) => (void session_id, e)).sort((a, b) => a.position - b.position),
      _dirty: 0,
    })
    n++
  }
  for (const [t, remote] of [['ratings', 'session_ratings'], ['checkins', 'daily_checkins']] as const) {
    const { data, error: e2 } = await sb.from(remote).select('*').gt('updated_at', since)
    if (e2) throw e2
    for (const r of data ?? []) {
      const local = (await db[t].get(r.id)) as { _dirty?: number } | undefined
      if (local?._dirty) continue
      await db[t].put({ ...r, _dirty: 0 } as never)
    }
  }
  const { data: cache } = await sb.from('exercise_cache').select('*')
  if (cache?.length) await db.exerciseCache.bulkPut(cache.map((c) => ({ ...c, _dirty: 0 as const })))
  return n
}

/** Sincroniza automaticamente quando a rede volta. */
export function installAutoSync(onResult?: (r: SyncResult) => void) {
  const run = () => syncNow().then((r) => onResult?.(r))
  window.addEventListener('online', run)
  const iv = window.setInterval(run, 5 * 60_000)
  run()
  return () => {
    window.removeEventListener('online', run)
    window.clearInterval(iv)
  }
}
