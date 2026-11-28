/**
 * Dados dos relatórios (preparo único para a tela de Relatórios e para o gráfico pós-importação).
 */
import { db } from './db'
import { profileLookup, studentSessions } from './repo'
import type { Session, Student } from '../domain/types'
import { addDays, aggregateSessions, toISODate, weekStart, type Aggregate } from '../engine/metrics'
import type { MonthSide, PerTraining, WeekSession } from '../pdf/templates'

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

export function monthRange(ym: string): { from: string; to: string; label: string } {
  const [y, m] = ym.split('-').map(Number)
  return { from: `${ym}-01`, to: toISODate(new Date(y, m, 0)), label: `${MONTHS[m - 1]}/${String(y).slice(2)}` }
}

export function prevMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const peakOf = (e: Session['exercises'][number]) => Math.max(e.load_kg ?? 0, ...(e.loads ?? []).map((k) => k ?? 0))

/** Mês 1 (anterior) × Mês 2 (escolhido): agregados + maior carga de cada exercício em cada mês. */
export async function buildBeforeAfter(student: Student, ymAfter: string, executed: { before?: number | null; after?: number | null } = {}): Promise<{ before: MonthSide; after: MonthSide }> {
  const lookup = await profileLookup()
  const ratings = (await db.ratings.toArray()).filter((r) => !r._deleted)
  const side = async (ym: string, n?: number | null): Promise<MonthSide> => {
    const r = monthRange(ym)
    const raw = await studentSessions(student, r.from, r.to)
    // consultoria: cada semana completa com o treino repetido (ABCDA)
    const days = await consultDays(student)
    const byWeek = new Map<string, Session[]>()
    for (const x of raw) byWeek.set(weekStart(x.date), [...(byWeek.get(weekStart(x.date)) ?? []), x])
    const list = adjustToExecuted([...byWeek.values()].flatMap((w) => expandWeek(w, days)), n)
    const lifts: MonthSide['lifts'] = {}
    for (const s of list) for (const e of s.exercises) {
      const kg = peakOf(e)
      if (kg > (lifts[e.exercise_key]?.kg ?? 0)) lifts[e.exercise_key] = { name: e.display_name, kg, perSide: !!e.per_side }
    }
    return { label: r.label, agg: aggregateSessions(list, lookup, ratings), lifts, weeks: byWeek.size }
  }
  return { before: await side(prevMonth(ymAfter), executed.before), after: await side(ymAfter, executed.after) }
}

/**
 * Semana: cada treino na ordem real + a vez anterior do MESMO treino (Treino A × Treino A anterior),
 * para mostrar a evolução treino a treino. Também o total da semana e o da semana anterior.
 */
export async function buildWeek(student: Student, anyDay: string, executed?: number | null): Promise<{ wk: string; items: WeekSession[]; cur: Aggregate; prev?: Aggregate }> {
  const lookup = await profileLookup()
  const ratings = (await db.ratings.toArray()).filter((r) => !r._deleted)
  const wk = weekStart(anyDay)
  const all = (await studentSessions(student)).sort((x, z) => (x.date + x.created_at).localeCompare(z.date + z.created_at))
  const days = await consultDays(student)
  const list = adjustToExecuted(expandWeek(all.filter((s) => s.date >= wk && s.date <= addDays(wk, 6)), days), executed)
  const pseOf = (id: string) => {
    const rs = ratings.filter((r) => r.session_id === id)
    return (rs.find((r) => r.reported_by === 'student') ?? rs[0])?.pse ?? null
  }
  const items: WeekSession[] = list.map((session) => {
    // vez anterior do mesmo treino (mesma letra), antes desta sessão
    const before = all.filter((s) => s.label === session.label && (s.date + s.created_at) < (session.date + session.created_at))
    const prevSame = before[before.length - 1]
    return {
      session,
      agg: aggregateSessions([session], lookup, ratings),
      pse: pseOf(session.id),
      prevSame: prevSame ? aggregateSessions([prevSame], lookup, ratings) : undefined,
    }
  })
  const prevList = expandWeek(all.filter((s) => s.date >= addDays(wk, -7) && s.date < wk), days)
  return {
    wk,
    items,
    cur: aggregateSessions(list, lookup, ratings),
    prev: prevList.length ? aggregateSessions(prevList, lookup, ratings) : undefined,
  }
}

export interface SavedWeek {
  wk: string // segunda-feira
  count: number
  labels: string[] // ["A", "B", "C", "D"]
}

/** Semanas que têm treinos salvos para o aluno (mais recente primeiro). */
export async function listWeeks(student: Student): Promise<SavedWeek[]> {
  const map = new Map<string, Session[]>()
  for (const s of await studentSessions(student)) {
    const wk = weekStart(s.date)
    map.set(wk, [...(map.get(wk) ?? []), s])
  }
  return [...map.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([wk, list]) => ({ wk, count: list.length, labels: list.map((s) => s.label.replace('Treino ', '')) }))
}

export function weekLabel(w: SavedWeek): string {
  const [, m, d] = w.wk.split('-')
  return `Semana de ${d}/${m} · ${w.count} ${w.count === 1 ? 'treino' : 'treinos'} (${w.labels.join(', ')})`
}

/**
 * Comparação Semana × Semana: totais de cada semana e cada treino (A, B, C…) lado a lado.
 */
export async function buildWeeksCompare(student: Student, wkBefore: string, wkAfter: string, executed: { before?: number | null; after?: number | null } = {}): Promise<{ before: MonthSide; after: MonthSide; perTraining: PerTraining[] }> {
  const lookup = await profileLookup()
  const ratings = (await db.ratings.toArray()).filter((r) => !r._deleted)
  const days = await consultDays(student)
  const side = async (wk: string, n?: number | null) => {
    const list = adjustToExecuted(expandWeek(await studentSessions(student, wk, addDays(wk, 6)), days), n)
    const lifts: MonthSide['lifts'] = {}
    for (const s of list) for (const e of s.exercises) {
      const kg = peakOf(e)
      if (kg > (lifts[e.exercise_key]?.kg ?? 0)) lifts[e.exercise_key] = { name: e.display_name, kg, perSide: !!e.per_side }
    }
    const [, m, d] = wk.split('-')
    return { list, side: { label: `${d}/${m}`, agg: aggregateSessions(list, lookup, ratings), lifts } as MonthSide }
  }
  const b = await side(wkBefore, executed.before)
  const a = await side(wkAfter, executed.after)
  // treino a treino pela letra (se repetir na semana, soma as vezes)
  const labels = [...new Set([...b.list, ...a.list].map((s) => s.label))].sort()
  const times = (l: Session[], label: string) => l.filter((s) => s.label === label).length
  const perTraining: PerTraining[] = labels.map((label) => ({
    label: Math.max(times(b.list, label), times(a.list, label)) > 1 ? `${label} ×${Math.max(times(b.list, label), times(a.list, label))}` : label,
    before: b.list.some((s) => s.label === label) ? aggregateSessions(b.list.filter((s) => s.label === label), lookup, ratings) : undefined,
    after: a.list.some((s) => s.label === label) ? aggregateSessions(a.list.filter((s) => s.label === label), lookup, ratings) : undefined,
  }))
  // fase de cada semana (consolidação, base e controle técnico, pico de estímulo)
  const { weekPoints } = await import('./repo')
  const pts = await weekPoints(student, [wkBefore, wkAfter])
  b.side.phase = pts[0]?.agg.sessions ? pts[0].verdict.final : null
  a.side.phase = pts[1]?.agg.sessions ? pts[1].verdict.final : null
  // semana gerada como CHOQUE no Montar: o PDF diz "Semana de choque" e o que mudou (em linguagem de aluno)
  const { shockPhrases } = await import('../consultoria/shockVariables')
  for (const [side, p] of [[b.side, pts[0]], [a.side, pts[1]]] as const) {
    if (p?.agg.sessions && p.ctx?.planned_microcycle === 'choque') {
      side.phase = 'choque'
      side.shock = shockPhrases(p.ctx.justification)
    }
  }
  return { before: b.side, after: a.side, perTraining }
}

/** Semana que um treino colado representa: mandado no domingo = treino da semana seguinte. */
export function suggestWeekFor(date: string): string {
  const d = new Date(date + 'T12:00:00')
  return d.getDay() === 0 ? addDays(date, 1) : weekStart(date)
}

// ---------------- Progressão de carga (presencial) ----------------
/** Melhor série de trabalho de um exercício (aquecimento fora). */
export interface BestSet {
  kg: number
  reps: number | null // null = "Máx"/falha sem reps anotadas
  score: number // força estimada (Epley) para comparar reps diferentes; sem reps = kg
  date: string
}

export interface LoadRow {
  key: string
  name: string
  perSide: boolean
  label: string // treino em que aparece (A, B…)
  /** semanal: [vez anterior, esta semana] · mensal: uma por semana */
  points: (BestSet | null)[]
  status: 'up' | 'same' | 'down' | 'new'
  pct: number | null // variação da força estimada (primeira → última)
  dKg: number | null // variação de carga (kg)
  dReps: number | null // variação de reps quando a carga é a mesma
}

export function bestSetOf(e: Session['exercises'][number], date: string): BestSet | null {
  let best: BestSet | null = null
  for (let i = 0; i < e.valid_sets; i++) {
    const kg = e.loads?.[i] ?? e.load_kg ?? null
    if (!kg || kg <= 0) continue
    const r = e.reps[i]
    const reps = r && !r.failure && r.min > 0 ? r.min : null
    const score = reps ? kg * (1 + Math.min(reps, 20) / 30) : kg
    if (!best || score > best.score || (score === best.score && kg > best.kg)) best = { kg, reps, score, date }
  }
  return best
}

function compare(a: BestSet | null, b: BestSet | null): Pick<LoadRow, 'status' | 'pct' | 'dKg' | 'dReps'> {
  if (!a || !b) return { status: 'new', pct: null, dKg: null, dReps: null }
  // compara pela força estimada quando as duas têm reps; senão, só pela carga
  const sa = a.reps && b.reps ? a.score : a.kg
  const sb = a.reps && b.reps ? b.score : b.kg
  const pct = ((sb - sa) / sa) * 100
  const status = pct > 1 ? 'up' : pct < -1 ? 'down' : 'same'
  return { status, pct, dKg: b.kg - a.kg, dReps: b.kg === a.kg && a.reps != null && b.reps != null ? b.reps - a.reps : null }
}

const RANK = { up: 0, same: 1, down: 2, new: 3 } as const
const sortRows = (rows: LoadRow[]) => rows.sort((a, b) => RANK[a.status] - RANK[b.status] || (b.pct ?? 0) - (a.pct ?? 0) || a.label.localeCompare(b.label) || a.name.localeCompare(b.name))

/**
 * Semanal: cada exercício feito na semana × a última vez que foi feito antes dela.
 * Mensal: as últimas `weeks` semanas lado a lado (melhor série de cada semana).
 */
export async function buildLoadProgress(student: Student, mode: 'semana' | 'mes', anyDay: string, weeks = 4): Promise<{ weeks: string[]; rows: LoadRow[] }> {
  const all = (await studentSessions(student)).filter((s) => s.source === 'presencial' || s.exercises.some((e) => e.load_kg || e.loads?.some(Boolean)))
    .sort((x, z) => (x.date + x.created_at).localeCompare(z.date + z.created_at))
  const wk = weekStart(anyDay)
  const end = addDays(wk, 6)
  const label = (l: string) => l.replace('Treino ', '')
  if (mode === 'semana') {
    const map = new Map<string, LoadRow>()
    for (const s of all.filter((x) => x.date >= wk && x.date <= end)) {
      for (const e of s.exercises) {
        const b = bestSetOf(e, s.date)
        if (!b) continue
        const cur = map.get(e.exercise_key)
        if (cur && cur.points[1] && cur.points[1].score >= b.score) continue
        map.set(e.exercise_key, { key: e.exercise_key, name: e.display_name, perSide: !!e.per_side, label: label(s.label), points: [null, b], status: 'new', pct: null, dKg: null, dReps: null })
      }
    }
    for (const row of map.values()) {
      // vez anterior: a sessão mais recente antes da semana com esse exercício
      for (let i = all.length - 1; i >= 0; i--) {
        const s = all[i]
        if (s.date >= wk) continue
        const e = s.exercises.find((x) => x.exercise_key === row.key)
        const b = e && bestSetOf(e, s.date)
        if (b) { row.points[0] = b; break }
      }
      Object.assign(row, compare(row.points[0], row.points[1]))
    }
    return { weeks: [wk], rows: sortRows([...map.values()]) }
  }
  const list = Array.from({ length: weeks }, (_, i) => addDays(wk, -7 * (weeks - 1 - i)))
  const map = new Map<string, LoadRow>()
  for (const s of all.filter((x) => x.date >= list[0] && x.date <= end)) {
    const wi = list.indexOf(weekStart(s.date))
    if (wi < 0) continue
    for (const e of s.exercises) {
      const b = bestSetOf(e, s.date)
      if (!b) continue
      const row = map.get(e.exercise_key) ?? { key: e.exercise_key, name: e.display_name, perSide: !!e.per_side, label: label(s.label), points: list.map(() => null), status: 'new' as const, pct: null, dKg: null, dReps: null }
      if (!row.points[wi] || row.points[wi]!.score < b.score) row.points[wi] = b
      row.name = e.display_name
      map.set(e.exercise_key, row)
    }
  }
  for (const row of map.values()) {
    const pts = row.points.filter((x): x is BestSet => !!x)
    Object.assign(row, pts.length >= 2 ? compare(pts[0], pts[pts.length - 1]) : compare(null, null))
  }
  return { weeks: list, rows: sortRows([...map.values()]) }
}

// ---------------- Nível do desafio (consultoria) ----------------
/** Pontos por treino da 1ª semana do aluno (respeita "Zerar base"): é o 100 do Nível do desafio. */
export async function challengeBase(student: Student): Promise<{ baseSession: number; baseWeek: string; byLabel: Record<string, number> } | undefined> {
  const all = await studentSessions(student)
  if (!all.length) return undefined
  const lookup = await profileLookup()
  const first = weekStart(all.map((s) => s.date).sort()[0])
  const list = all.filter((s) => s.date >= first && s.date <= addDays(first, 6))
  const a = aggregateSessions(list, lookup)
  if (!a.sessions || !a.challengePoints) return undefined
  // cada treino (A, B, C…) comparado com a 1ª vez em que ele apareceu
  const byLabel: Record<string, number> = {}
  for (const s of [...all].sort((x, z) => (x.date + x.created_at).localeCompare(z.date + z.created_at))) {
    if (byLabel[s.label] != null) continue
    const p = aggregateSessions([s], lookup).challengePoints
    if (p > 0) byLabel[s.label] = p
  }
  return { baseSession: a.challengePoints / a.sessions, baseWeek: first, byLabel }
}

// ---------------- consultoria: semana com treino repetido (ABCDA) ----------------
/** Dias de treino por semana do aluno da consultoria: o da ficha; sem ele, o da anamnese. */
export async function consultDays(student: Student): Promise<number | null> {
  if (student.modality !== 'online') return null
  if (student.weekly_frequency) return student.weekly_frequency
  const { getAnamnese, anamneseTemplateText } = await import('./repo')
  const an = await getAnamnese(student.id)
  if (!an) return null
  const { parseTemplate } = await import('../consultoria/anamneseTemplate')
  const { buildTriage } = await import('../consultoria/triage')
  const d = buildTriage(parseTemplate(await anamneseTemplateText()), an.answers).dias
  return d && d >= 1 && d <= 7 ? d : null
}

/**
 * Na consultoria o treinador manda A, B, C, D e o aluno treina 5 dias repetindo (ABCDA):
 * completa a semana com as repetições, na ordem (A, depois B…), para o volume e as calorias ficarem reais.
 */
export function expandWeek(sessions: Session[], days: number | null): Session[] {
  if (!days || !sessions.length || days <= sessions.length) return sessions
  const sorted = [...sessions].sort((a, b) => a.label.localeCompare(b.label) || a.date.localeCompare(b.date))
  const extra = Array.from({ length: days - sessions.length }, (_, i) => {
    const s = sorted[i % sorted.length]
    return { ...s, id: `${s.id}#rep${i + 1}` }
  })
  return [...sessions, ...extra]
}

/**
 * Treinos que o aluno EXECUTOU no período (informado pelo treinador antes de gerar o PDF):
 * mais que os colados → repete na ordem (A, B…); menos → fica com os primeiros.
 */
export function adjustToExecuted(sessions: Session[], n: number | null | undefined): Session[] {
  if (n == null || n < 0 || !sessions.length || n === sessions.length) return sessions
  const sorted = [...sessions].sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label))
  // fez menos: saem primeiro as repetições (ABCDA → ABCD), depois os últimos treinos
  if (n < sorted.length) return [...sorted].sort((a, b) => Number(a.id.includes('#')) - Number(b.id.includes('#')) || a.label.localeCompare(b.label)).slice(0, n)
  const base = [...sorted].sort((a, b) => a.label.localeCompare(b.label))
  return [...sorted, ...Array.from({ length: n - sorted.length }, (_, i) => ({ ...base[i % base.length], id: `${base[i % base.length].id}#exec${i + 1}` }))]
}

/** Quantos treinos o app conta no período (com a repetição ABCDA pelos dias de treino) — o padrão do campo. */
export async function plannedCount(student: Student, from: string, to: string): Promise<number> {
  const days = await consultDays(student)
  const raw = await studentSessions(student, from, to)
  const byWeek = new Map<string, Session[]>()
  for (const x of raw) byWeek.set(weekStart(x.date), [...(byWeek.get(weekStart(x.date)) ?? []), x])
  return [...byWeek.values()].reduce((a, w) => a + expandWeek(w, days).length, 0)
}
