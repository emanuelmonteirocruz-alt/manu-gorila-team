/**
 * Sincronização entre aparelhos contra um "Supabase" em memória.
 * Cada aparelho = um IndexedDB próprio (troca-se o conteúdo do Dexie entre um e outro).
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------- servidor falso (PostgREST mínimo: upsert/insert/delete/select com gt/order/range) ----------
type Row = Record<string, unknown>
const server: Record<string, Row[]> = {}
let clock = 0
const serverNow = () => new Date(Date.UTC(2030, 0, 1) + ++clock * 1000).toISOString()
const KEYS: Record<string, string> = { exercise_cache: 'key', exercise_links: 'exercise_key,provider' }
let signedIn = true
let netDown = false
const USER = { id: '11111111-1111-1111-1111-111111111111', email: 'manu@x.com' }

function table(name: string) {
  server[name] ??= []
  const rows = server[name]
  const keyOf = (r: Row, k: string) => k.split(',').map((c) => String(r[c])).join('|')
  const filters: ((r: Row) => boolean)[] = []
  let range: [number, number] | null = null
  let select = '*'
  let op: 'select' | 'delete' = 'select'
  const run = async () => {
    if (op === 'delete') {
      for (let i = rows.length - 1; i >= 0; i--) if (filters.every((f) => f(rows[i]))) rows.splice(i, 1)
      return { data: null, error: null }
    }
    let out = rows.filter((r) => filters.every((f) => f(r))).sort((a, b) => String(a.synced_at).localeCompare(String(b.synced_at)))
    if (range) out = out.slice(range[0], range[1] + 1)
    if (select.includes('session_exercises')) out = out.map((r) => ({ ...r, session_exercises: (server.session_exercises ?? []).filter((e) => e.session_id === r.id) }))
    return { data: structuredClone(out), error: null }
  }
  const q = {
    select(s = '*') { select = s; return q },
    gt(c: string, v: string) { filters.push((r) => String(r[c]) > v); return q },
    eq(c: string, v: unknown) { filters.push((r) => r[c] === v); return q },
    in(c: string, v: unknown[]) { filters.push((r) => v.includes(r[c])); return q },
    order() { return q },
    range(a: number, b: number) { range = [a, b]; return q },
    delete() { op = 'delete'; return q },
    upsert(input: Row[] | Row, opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
      if (netDown) return Promise.reject(new TypeError('Failed to fetch'))
      const k = opts?.onConflict ?? KEYS[name] ?? 'id'
      for (const r of Array.isArray(input) ? input : [input]) {
        const i = rows.findIndex((x) => keyOf(x, k) === keyOf(r, k))
        if (i >= 0 && opts?.ignoreDuplicates) continue
        const row = { ...structuredClone(r), synced_at: serverNow() } // trigger touch_synced_at
        if (i >= 0) rows[i] = { ...rows[i], ...row }
        else rows.push(row)
      }
      return Promise.resolve({ data: null, error: null })
    },
    insert(input: Row[]) {
      if (name === 'session_exercises') for (const r of input) if (!r.session_id) return Promise.resolve({ data: null, error: { message: 'null session_id' } })
      rows.push(...structuredClone(input))
      return Promise.resolve({ data: null, error: null })
    },
    then(res: (v: unknown) => void, rej: (e: unknown) => void) { return run().then(res, rej) },
  }
  return q
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: table,
    auth: {
      getSession: async () => ({ data: { session: signedIn ? { user: USER } : null } }),
      signOut: async () => { signedIn = false },
    },
  }),
}))

vi.stubGlobal('navigator', { onLine: true })
vi.stubEnv('VITE_SUPABASE_URL', 'https://fake.supabase.co')
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'sb_publishable_fake')

const { db, save, softDelete, uid } = await import('../data/db')
const { syncNow, configProblem, resetSupabaseClient } = await import('../data/sync')
const { setKV } = await import('../data/db')
const { SEED_PROFILES } = await import('../engine/exerciseSeed')
import type { Session, Student } from '../domain/types'

// ---------- aparelhos ----------
type Snapshot = Record<string, unknown[]>
const devices: Record<string, Snapshot | null> = { celular: null, pc: null }
let current = ''
async function use(device: string) {
  if (current) devices[current] = Object.fromEntries(await Promise.all(db.tables.map(async (t) => [t.name, await t.toArray()])))
  await db.delete()
  await db.open() // aparelho novo = catálogo embutido
  const snap = devices[device]
  if (snap) for (const t of db.tables) { await t.clear(); await t.bulkPut(snap[t.name] as never[]) }
  current = device
}

const student = (): Student => ({
  id: uid(), trainer_id: 'local-trainer', full_name: 'Marina Costa', sex: 'F', modality: 'online',
  hourly_rate_manual: false, payment_status: 'em_dia', archived: false, created_at: new Date().toISOString(), updated_at: '',
})
const session = (studentId: string, label: string): Session => ({
  id: uid(), student_id: studentId, date: '2026-11-23', label, source: 'whatsapp', muscle_groups: [], created_at: new Date().toISOString(), updated_at: '',
  exercises: [{ id: uid(), position: 0, exercise_key: SEED_PROFILES[0].key, display_name: SEED_PROFILES[0].name, valid_sets: 4, warmup_sets: 0, heavy_sets: 1, reps: [{ min: 8, max: 12 }], drop_set: false }],
})

describe('sincronização entre aparelhos', () => {
  beforeEach(() => {
    for (const k of Object.keys(server)) delete server[k]
    devices.celular = devices.pc = null
    current = ''
    signedIn = true
    netDown = false
  })

  it('queda de rede momentânea não vira erro vermelho e a próxima tentativa envia tudo', async () => {
    await use('celular')
    await save(db.students, student())
    netDown = true
    const r = await syncNow()
    expect(r.state).toBe('offline')
    expect(r.error).toMatch(/tentando de novo/)
    expect(await db.students.where('_dirty').equals(1).count()).toBe(1) // continua guardado no aparelho
    netDown = false
    const r2 = await syncNow()
    expect(r2.state).toBe('ok')
    expect(server.students).toHaveLength(1)
  })

  it('sem login no aparelho: não envia nada e avisa para entrar', async () => {
    await use('celular')
    signedIn = false
    const r = await syncNow()
    expect(r.state).toBe('login')
    expect(server.students ?? []).toHaveLength(0)
  })

  it('o que o celular salva aparece no PC (aluno, treino e exercícios do catálogo)', async () => {
    await use('celular')
    const st = await save(db.students, student())
    await save(db.sessions, session(st.id, 'Treino A'))
    const up = await syncNow()
    expect(up.state).toBe('ok')
    expect(server.students[0].trainer_id).toBe(USER.id) // id provisório trocado pelo treinador
    expect(server.exercise_cache.map((c) => c.key)).toContain(SEED_PROFILES[0].key)

    await use('pc')
    expect(await db.students.count()).toBe(0)
    const down = await syncNow()
    expect(down.state).toBe('ok')
    expect((await db.students.toArray()).map((s) => s.full_name)).toEqual(['Marina Costa'])
    const [s] = await db.sessions.toArray()
    expect(s.label).toBe('Treino A')
    expect(s.exercises).toHaveLength(1)
    expect(s._dirty).toBe(0)
  })

  it('treino salvo offline com relógio atrasado ainda chega ao outro aparelho', async () => {
    await use('celular')
    const st = await save(db.students, student())
    await syncNow()
    await use('pc')
    await syncNow() // PC já sincronizou uma vez
    await use('celular')
    // salvo "ontem" (relógio do celular / offline) e enviado só agora
    await db.sessions.put({ ...session(st.id, 'Treino B'), updated_at: '2020-01-01T00:00:00.000Z', _dirty: 1 })
    await syncNow()
    await use('pc')
    await syncNow()
    expect((await db.sessions.toArray()).map((s) => s.label)).toEqual(['Treino B'])
  })

  it('exclusão num aparelho apaga nos outros', async () => {
    await use('celular')
    const st = await save(db.students, student())
    const se = await save(db.sessions, session(st.id, 'Treino A'))
    await syncNow()
    await use('pc')
    await syncNow()
    expect(await db.sessions.count()).toBe(1)
    await softDelete(db.sessions, se.id)
    await syncNow()
    expect(await db.sessions.count()).toBe(0)
    await use('celular')
    await syncNow()
    expect(await db.sessions.count()).toBe(0)
    expect(await db.students.count()).toBe(1)
  })

  it('alteração local ainda não enviada não é sobrescrita pela nuvem', async () => {
    await use('celular')
    const st = await save(db.students, student())
    await syncNow()
    await use('pc')
    await syncNow()
    await save(db.students, { ...(await db.students.get(st.id))!, full_name: 'Marina Costa Silva' })
    await use('celular')
    await save(db.students, { ...(await db.students.get(st.id))!, phone: '11999990000' })
    await syncNow()
    await use('pc')
    await syncNow() // envia a do PC (última gravação vence) e não perde a edição local
    expect((await db.students.get(st.id))!.full_name).toBe('Marina Costa Silva')
    expect(server.students[0].full_name).toBe('Marina Costa Silva')
  })

  it('configuração errada na Vercel vira mensagem clara (nunca fica em "verificando")', async () => {
    await use('celular')
    await setKV('supabase_url', 'sb_publishable_trocada')
    resetSupabaseClient()
    const r = await syncNow()
    expect(r.state).toBe('error')
    expect(r.error).toMatch(/trocadas/)
    await setKV('supabase_url', '')
    resetSupabaseClient()
  })
})

describe('validação da URL/chave do Supabase', () => {
  it('aceita as formas certas e explica as erradas', () => {
    expect(configProblem('https://abcd.supabase.co', 'sb_publishable_x1')).toBeNull()
    expect(configProblem('https://abcd.supabase.co', 'eyJhbGciOi')).toBeNull()
    expect(configProblem('abcd.supabase.co', 'eyJ')).toMatch(/inválida/)
    expect(configProblem('https://abcd.supabase.co', 'sb_secret_x')).toMatch(/SECRETA/)
    expect(configProblem('https://abcd.supabase.co', 'https://abcd.supabase.co')).toMatch(/URL/)
  })

  it('aceita a URL colada como link de chat [url](url)', async () => {
    const { cloudConfig } = await import('../data/sync')
    await setKV('supabase_url', '[https://abcd.supabase.co](https://abcd.supabase.co)')
    expect((await cloudConfig()).url).toBe('https://abcd.supabase.co')
    await setKV('supabase_url', '')
  })
})
