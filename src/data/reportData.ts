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
export async function buildBeforeAfter(student: Student, ymAfter: string): Promise<{ before: MonthSide; after: MonthSide }> {
  const lookup = await profileLookup()
  const ratings = (await db.ratings.toArray()).filter((r) => !r._deleted)
  const side = async (ym: string): Promise<MonthSide> => {
    const r = monthRange(ym)
    const list = await studentSessions(student, r.from, r.to)
    const lifts: MonthSide['lifts'] = {}
    for (const s of list) for (const e of s.exercises) {
      const kg = peakOf(e)
      if (kg > (lifts[e.exercise_key]?.kg ?? 0)) lifts[e.exercise_key] = { name: e.display_name, kg, perSide: !!e.per_side }
    }
    return { label: r.label, agg: aggregateSessions(list, lookup, ratings), lifts }
  }
  return { before: await side(prevMonth(ymAfter)), after: await side(ymAfter) }
}

/**
 * Semana: cada treino na ordem real + a vez anterior do MESMO treino (Treino A × Treino A anterior),
 * para mostrar a evolução treino a treino. Também o total da semana e o da semana anterior.
 */
export async function buildWeek(student: Student, anyDay: string): Promise<{ wk: string; items: WeekSession[]; cur: Aggregate; prev?: Aggregate }> {
  const lookup = await profileLookup()
  const ratings = (await db.ratings.toArray()).filter((r) => !r._deleted)
  const wk = weekStart(anyDay)
  const all = (await studentSessions(student)).sort((x, z) => (x.date + x.created_at).localeCompare(z.date + z.created_at))
  const list = all.filter((s) => s.date >= wk && s.date <= addDays(wk, 6))
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
  const prevList = all.filter((s) => s.date >= addDays(wk, -7) && s.date < wk)
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
export async function buildWeeksCompare(student: Student, wkBefore: string, wkAfter: string): Promise<{ before: MonthSide; after: MonthSide; perTraining: PerTraining[] }> {
  const lookup = await profileLookup()
  const ratings = (await db.ratings.toArray()).filter((r) => !r._deleted)
  const side = async (wk: string) => {
    const list = await studentSessions(student, wk, addDays(wk, 6))
    const lifts: MonthSide['lifts'] = {}
    for (const s of list) for (const e of s.exercises) {
      const kg = peakOf(e)
      if (kg > (lifts[e.exercise_key]?.kg ?? 0)) lifts[e.exercise_key] = { name: e.display_name, kg, perSide: !!e.per_side }
    }
    const [, m, d] = wk.split('-')
    return { list, side: { label: `${d}/${m}`, agg: aggregateSessions(list, lookup, ratings), lifts } as MonthSide }
  }
  const b = await side(wkBefore)
  const a = await side(wkAfter)
  // treino a treino pela letra (se repetir na semana, soma as vezes)
  const labels = [...new Set([...b.list, ...a.list].map((s) => s.label))].sort()
  const perTraining: PerTraining[] = labels.map((label) => ({
    label,
    before: b.list.some((s) => s.label === label) ? aggregateSessions(b.list.filter((s) => s.label === label), lookup, ratings) : undefined,
    after: a.list.some((s) => s.label === label) ? aggregateSessions(a.list.filter((s) => s.label === label), lookup, ratings) : undefined,
  }))
  return { before: b.side, after: a.side, perTraining }
}

/** Semana que um treino colado representa: mandado no domingo = treino da semana seguinte. */
export function suggestWeekFor(date: string): string {
  const d = new Date(date + 'T12:00:00')
  return d.getDay() === 0 ? addDays(date, 1) : weekStart(date)
}
