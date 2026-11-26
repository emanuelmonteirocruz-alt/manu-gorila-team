/**
 * Sincronização Dexie ⇄ Supabase (last-write-wins por updated_at).
 * - push: envia linhas _dirty; exclusões viram lápide (deleted = true) para os outros aparelhos.
 * - pull: baixa o que mudou no SERVIDOR desde a última vez (synced_at, relógio do servidor),
 *   então um treino salvo offline e enviado horas depois chega a todos os aparelhos.
 * Sessões são normalizadas no servidor (sessions + session_exercises).
 *
 * Acesso (Fase 1): o treinador entra UMA vez em cada aparelho (Config.); a sessão fica salva
 * e se renova sozinha, então o app continua abrindo direto no painel.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { db, getKV, nowISO, setKV } from './db'
import { CLOUD_KEY, CLOUD_URL } from './cloudProject'
import type { ExerciseProfile, Session, SessionExercise } from '../domain/types'

let client: SupabaseClient | null = null

export async function getSupabase(): Promise<SupabaseClient | null> {
  if (client) return client
  const { url, key } = await cloudConfig()
  if (!url || !key) return null
  const problem = configProblem(url, key)
  if (problem) throw new Error(problem)
  client = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } })
  return client
}

/** URL e chave em uso (Config. deste aparelho > variáveis da Vercel), sem espaços/aspas coladas por engano. */
export async function cloudConfig(): Promise<{ url: string; key: string }> {
  const clean = (v: unknown) => {
    let t = String(v ?? '').trim().replace(/^["'<]|["'>]$/g, '').trim()
    // colado como link de chat: [https://x.supabase.co](https://x.supabase.co)
    const md = t.match(/^\[[^\]]*\]\(([^)]+)\)$/)
    if (md) t = md[1].trim()
    return t
  }
  const url = clean((await getKV<string>('supabase_url', '')) || CLOUD_URL || import.meta.env.VITE_SUPABASE_URL).replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '')
  const key = clean((await getKV<string>('supabase_key', '')) || CLOUD_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY)
  return { url, key }
}

/** Erros comuns de configuração, explicados (em vez de travar em "verificando"). */
export function configProblem(url: string, key: string): string | null {
  if (/^(sb_|eyJ)/.test(url)) return 'A URL e a chave do Supabase estão trocadas na Vercel: VITE_SUPABASE_URL deve ser https://xxxx.supabase.co.'
  if (!/^https:\/\/[^\s/]+$/.test(url)) return `VITE_SUPABASE_URL inválida ("${url.slice(0, 40)}"). Use só https://xxxx.supabase.co, sem /rest/v1 nem espaços.`
  if (/^\[?https?:/.test(key)) return 'A chave do Supabase está com uma URL: VITE_SUPABASE_ANON_KEY deve ser a chave anon (eyJ…) ou publishable (sb_publishable_…).'
  if (/^sb_secret_/.test(key)) return 'Você usou a chave SECRETA do Supabase. Troque na Vercel pela chave publishable (sb_publishable_…) ou anon — a secreta nunca pode ir no app.'
  if (!/^(eyJ|sb_publishable_)/.test(key) || /\s/.test(key)) return 'VITE_SUPABASE_ANON_KEY não parece uma chave do Supabase (deve começar com eyJ ou sb_publishable_).'
  return null
}

/** Nenhuma etapa da sincronização pode ficar pendurada para sempre. */
function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((res, rej) => {
    const t = setTimeout(() => rej(new Error(`timeout:${what}`)), ms)
    p.then((v) => { clearTimeout(t); res(v) }, (e) => { clearTimeout(t); rej(e) })
  })
}

export function resetSupabaseClient() {
  client = null
}

/** A nuvem veio configurada no deploy (Vercel)? Então os campos de URL/chave ficam escondidos. */
export const envConfigured = !!(CLOUD_URL && CLOUD_KEY) || !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)

/** E-mail do treinador conectado neste aparelho (sessão salva), ou null. */
export async function currentTrainer(): Promise<string | null> {
  try {
    const sb = await getSupabase()
    if (!sb) return null
    const { data } = await withTimeout(sb.auth.getSession(), 8000, 'sessão')
    return data.session?.user.email ?? null
  } catch {
    return null
  }
}

export async function signOut() {
  const sb = await getSupabase()
  await sb?.auth.signOut()
  await setKV('last_pull', '')
}

/** Linha local → linha remota: tira os campos do Dexie e transforma a exclusão em lápide. */
const toRemote = <T extends object>(row: T) => {
  const { _dirty, _deleted, ...rest } = row as Record<string, unknown>
  void _dirty
  return { ...rest, deleted: !!_deleted }
}
/** Linha remota → linha local. */
const fromRemote = <T extends object>(row: T) => {
  const { synced_at, deleted, ...rest } = row as Record<string, unknown>
  void synced_at; void deleted
  return { ...rest, _dirty: 0 as const }
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
  /** 'local' = sem nuvem configurada · 'login' = falta entrar neste aparelho · 'offline' · 'error' · 'ok' */
  state: 'local' | 'login' | 'offline' | 'error' | 'ok'
  at?: string
}

/** Mensagens do Supabase/RLS traduzidas para o que o treinador precisa fazer. */
function explain(e: unknown): string {
  const m = (e as { message?: string })?.message ?? String(e)
  if (/row-level security|permission denied|42501/i.test(m)) return 'O Supabase recusou os dados (RLS). Rode o SQL 0006_sync_fase1.sql no SQL Editor e entre de novo.'
  if (/column .*(synced_at|deleted)|schema cache/i.test(m)) return 'Banco desatualizado: rode o SQL 0006_sync_fase1.sql no SQL Editor do Supabase.'
  if (/^timeout:sessão/.test(m)) return 'O login salvo neste navegador travou. Feche as outras abas do app e recarregue a página.'
  if (/^timeout/.test(m)) return 'O Supabase não respondeu em 40 s. Veja em supabase.com se o projeto está pausado (botão Restore) e se a URL na Vercel está certa.'
  if (/Failed to fetch|NetworkError|Load failed|ERR_NAME_NOT_RESOLVED/i.test(m)) return 'Não consegui falar com o Supabase. Confira a URL na Vercel (https://xxxx.supabase.co) e se o projeto não está pausado em supabase.com.'
  if (/Invalid API key|No API key|apikey/i.test(m)) return 'Chave do Supabase recusada: confira VITE_SUPABASE_ANON_KEY na Vercel (Project Settings → API Keys → publishable) e faça o redeploy.'
  if (/relation .* does not exist|Could not find the table/i.test(m)) return 'As tabelas não existem no Supabase: rode o setup_completo.sql no SQL Editor.'
  if (/stack depth|infinite recursion/i.test(m)) return 'Banco com a regra antiga de permissão: rode o setup_completo.sql no SQL Editor.'
  if (/JWT|token|refresh/i.test(m)) return 'Sessão expirada: entre de novo em Config.'
  return m
}

let running: Promise<SyncResult> | null = null

/** Uma sincronização por vez (o intervalo, a volta da rede e o botão podem disparar juntos). */
export function syncNow(): Promise<SyncResult> {
  running ??= withTimeout(doSync(), 40_000, 'sync')
    .catch((e): SyncResult => {
      console.error('[sync]', e)
      return { pushed: 0, pulled: 0, state: 'error', error: explain(e) }
    })
    .finally(() => { running = null })
  return running
}

async function doSync(): Promise<SyncResult> {
  const sb = await getSupabase()
  if (!sb) return { pushed: 0, pulled: 0, state: 'local', error: 'Nuvem não configurada (dados só neste aparelho).' }
  if (!navigator.onLine) return { pushed: 0, pulled: 0, state: 'offline', error: 'Offline — dados salvos neste aparelho.' }
  const { data: sess } = await withTimeout(sb.auth.getSession(), 8000, 'sessão')
  const user = sess.session?.user
  if (!user) return { pushed: 0, pulled: 0, state: 'login', error: 'Nuvem desconectada: entre como treinador em Config. (uma vez por aparelho).' }

  let pushed = 0, pulled = 0
  try {
    // Alunos criados offline levam o id local provisório do treinador: troca pelo usuário autenticado (RLS exige)
    const orphan = await db.students.filter((st) => st.trainer_id !== user.id).toArray()
    if (orphan.length) await db.students.bulkPut(orphan.map((st) => ({ ...st, trainer_id: user.id, _dirty: 1 as const })))

    pushed += await pushExerciseCache(sb)
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
    pulled += await pullAll(sb)
  } catch (e) {
    return { pushed, pulled, state: 'error', error: explain(e) }
  }
  const at = nowISO()
  await setKV('last_sync_ok', at)
  return { pushed, pulled, state: 'ok', at }
}

/**
 * Catálogo de exercícios: envia os editados/novos e também os do catálogo embutido que
 * aparecem nos treinos a enviar (sem isso o outro aparelho recebe treinos sem classificação).
 */
async function pushExerciseCache(sb: SupabaseClient): Promise<number> {
  const strip = ({ _dirty, updated_at, ...r }: ExerciseProfile) => (void _dirty, void updated_at, r)
  const dirty = await db.exerciseCache.where('_dirty').equals(1).toArray()
  if (dirty.length) {
    const { error } = await sb.from('exercise_cache').upsert(dirty.map(strip))
    if (error) throw error
    await db.exerciseCache.bulkPut(dirty.map((r) => ({ ...r, _dirty: 0 as const })))
  }
  const keys = new Set<string>()
  for (const s of await db.sessions.where('_dirty').equals(1).toArray()) for (const e of s.exercises) keys.add(e.exercise_key)
  const seeds = (await db.exerciseCache.bulkGet([...keys])).filter((p): p is ExerciseProfile => !!p && !p._dirty)
  if (seeds.length) {
    // ignoreDuplicates: nunca sobrescreve uma classificação que você corrigiu em outro aparelho
    const { error } = await sb.from('exercise_cache').upsert(seeds.map(strip), { onConflict: 'key', ignoreDuplicates: true })
    if (error) throw error
  }
  return dirty.length
}

async function pushSimple(sb: SupabaseClient, t: Simple): Promise<number> {
  const table = db[t]
  const rows = (await table.where('_dirty').equals(1).toArray()) as Array<{ id: string; _deleted?: 0 | 1 }>
  if (!rows.length) return 0
  const { error } = await sb.from(REMOTE[t]).upsert(rows.map(toRemote), CONFLICT[t] ? { onConflict: CONFLICT[t] } : undefined)
  if (error) throw error
  const gone = rows.filter((r) => r._deleted).map((r) => r.id)
  if (gone.length) await table.bulkDelete(gone)
  await Promise.all(rows.filter((r) => !r._deleted).map((r) => table.update(r.id, { _dirty: 0 } as never)))
  return rows.length
}

async function pushSessions(sb: SupabaseClient): Promise<number> {
  const rows = await db.sessions.where('_dirty').equals(1).toArray()
  for (const s of rows) {
    const { exercises, ...rest } = s
    const head = toRemote(rest)
    let { error } = await sb.from('sessions').upsert(head)
    if (error) throw error
    ;({ error } = await sb.from('session_exercises').delete().eq('session_id', s.id))
    if (error) throw error
    if (s._deleted) {
      await db.sessions.delete(s.id)
      continue
    }
    if (exercises.length) {
      ;({ error } = await sb.from('session_exercises').insert(exercises.map((e) => ({ ...e, session_id: s.id }))))
      if (error) throw error
    }
    await db.sessions.update(s.id, { _dirty: 0 })
  }
  return rows.length
}

/** Busca tudo que mudou no servidor depois de `since`, em páginas (o Supabase limita 1000 por vez). */
async function fetchChanged<T extends { synced_at: string }>(sb: SupabaseClient, table: string, since: string, select = '*'): Promise<T[]> {
  const out: T[] = []
  const PAGE = 500
  for (let from = 0; ; from += PAGE) {
    let q = sb.from(table).select(select).order('synced_at').range(from, from + PAGE - 1)
    if (since) q = q.gt('synced_at', since)
    const { data, error } = await q
    if (error) throw error
    out.push(...((data ?? []) as unknown as T[]))
    if (!data || data.length < PAGE) return out
  }
}

async function pullAll(sb: SupabaseClient): Promise<number> {
  // marca d'água por tabela, sempre no relógio do servidor
  const marks = await getKV<Record<string, string>>('pull_marks', {})
  const reset = !(await getKV<string>('last_pull', ''))
  if (reset) for (const k of Object.keys(marks)) delete marks[k]
  let n = 0
  const mark = (table: string, rows: { synced_at: string }[]) => {
    if (rows.length) marks[table] = rows[rows.length - 1].synced_at
  }

  for (const t of ['students', 'weekContexts'] as Simple[]) {
    const rows = await fetchChanged<{ id: string; synced_at: string; deleted?: boolean }>(sb, REMOTE[t], marks[REMOTE[t]] ?? '')
    for (const r of rows) {
      const local = (await db[t].get(r.id)) as { _dirty?: number } | undefined
      if (local?._dirty) continue // alteração local pendente vence até ser enviada
      if (r.deleted) await db[t].delete(r.id)
      else await db[t].put(fromRemote(r) as never)
      n++
    }
    mark(REMOTE[t], rows)
  }

  const sess = await fetchChanged<Session & { synced_at: string; deleted?: boolean; session_exercises: (SessionExercise & { session_id: string })[] }>(sb, 'sessions', marks.sessions ?? '', '*, session_exercises(*)')
  for (const r of sess) {
    const local = await db.sessions.get(r.id)
    if (local?._dirty) continue
    if (r.deleted) {
      await db.sessions.delete(r.id)
      n++
      continue
    }
    const { session_exercises, ...head } = r
    await db.sessions.put({
      ...(fromRemote(head) as unknown as Session),
      exercises: (session_exercises ?? []).map(({ session_id, ...e }) => (void session_id, e)).sort((a, b) => a.position - b.position),
    })
    n++
  }
  mark('sessions', sess)

  for (const [t, remote] of [['ratings', 'session_ratings'], ['checkins', 'daily_checkins']] as const) {
    const rows = await fetchChanged<{ id: string; synced_at: string; deleted?: boolean }>(sb, remote, marks[remote] ?? '')
    for (const r of rows) {
      const local = (await db[t].get(r.id)) as { _dirty?: number } | undefined
      if (local?._dirty) continue
      if (r.deleted) await db[t].delete(r.id)
      else await db[t].put(fromRemote(r) as never)
      n++
    }
    mark(remote, rows)
  }

  const cache = await fetchChanged<ExerciseProfile & { synced_at: string }>(sb, 'exercise_cache', marks.exercise_cache ?? '')
  for (const c of cache) {
    const local = await db.exerciseCache.get(c.key)
    if (local?._dirty) continue
    await db.exerciseCache.put(fromRemote(c) as unknown as ExerciseProfile)
  }
  mark('exercise_cache', cache)

  await setKV('pull_marks', marks)
  await setKV('last_pull', nowISO())
  return n
}

/** Sincroniza ao abrir, quando a rede volta, ao voltar para o app e a cada 2 minutos. */
export function installAutoSync(onResult?: (r: SyncResult) => void) {
  const run = () => syncNow().then((r) => onResult?.(r))
  const onVisible = () => document.visibilityState === 'visible' && run()
  window.addEventListener('online', run)
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('sync-now', run)
  const iv = window.setInterval(run, 2 * 60_000)
  run()
  return () => {
    window.removeEventListener('online', run)
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('sync-now', run)
    window.clearInterval(iv)
  }
}

/** Pede uma sincronização logo após salvar algo (o App escuta e atualiza o status). */
export function requestSync() {
  window.dispatchEvent(new Event('sync-now'))
}
