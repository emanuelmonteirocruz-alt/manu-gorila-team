/**
 * Repositório de alto nível — junta banco local + motor de cálculo.
 */
import { db, LOCAL_TRAINER_ID, nowISO, save, softDelete, uid } from './db'
import type { ExerciseProfile, Session, SessionExercise, SleepQuality, Student, WeekContext } from '../domain/types'
import { aggregateSessions, addDays, toISODate, computeHourlyRate, weekStart, weekVerdict } from '../engine/metrics'
import { resolveProfiles } from '../engine/classifier'
import type { ParsedExerciseLine } from '../engine/prescription'
import type { ParsedWeek } from '../parser/whatsapp'
import type { KeyLift, WeekPoint } from '../pdf/templates'
import { normalizeKey } from '../engine/exerciseSeed'
import { titleCase } from '../ui/format'

export function newStudent(partial: Partial<Student> = {}): Student {
  return {
    id: uid(), trainer_id: LOCAL_TRAINER_ID, full_name: '', sex: 'F', modality: 'online', hourly_rate_manual: false,
    payment_status: 'em_dia', archived: false, created_at: nowISO(), updated_at: nowISO(), ...partial,
  }
}

export async function saveStudent(s: Student) {
  const hr = s.modality === 'online' ? null : s.hourly_rate_manual ? s.hourly_rate : computeHourlyRate(s.plan_value, s.weekly_frequency)
  const due_day = s.due_date ? Number(s.due_date.slice(8, 10)) : s.due_day
  return save(db.students, { ...s, full_name: titleCase(s.full_name), hourly_rate: hr ?? null, due_day })
}

/** Exclui o aluno e todo o histórico dele (sessões, avaliações, check-ins, contexto semanal). */
export async function deleteStudent(studentId: string) {
  const sessions = await db.sessions.where('student_id').equals(studentId).toArray()
  const sessionIds = sessions.map((x) => x.id)
  await db.transaction('rw', [db.students, db.sessions, db.ratings, db.checkins, db.weekContexts], async () => {
    for (const r of await db.ratings.where('session_id').anyOf(sessionIds).toArray()) await softDelete(db.ratings, r.id)
    for (const x of sessions) await softDelete(db.sessions, x.id)
    for (const c of await db.checkins.where('student_id').equals(studentId).toArray()) await softDelete(db.checkins, c.id)
    for (const w of await db.weekContexts.where('student_id').equals(studentId).toArray()) await softDelete(db.weekContexts, w.id)
    await softDelete(db.students, studentId)
  })
}

export async function profileLookup(): Promise<(key: string) => ExerciseProfile | undefined> {
  const all = await db.exerciseCache.toArray()
  const byKey = new Map(all.map((p) => [p.key, p]))
  const byAlias = new Map(all.flatMap((p) => p.aliases.map((a) => [a, p] as const)))
  return (k: string) => byKey.get(k) ?? byKey.get(normalizeKey(k)) ?? byAlias.get(normalizeKey(k))
}

/** Sessões ativas do aluno, respeitando "Novo Aluno (Zerar Base)". */
export async function studentSessions(student: Student, from?: string, to?: string): Promise<Session[]> {
  let list = await db.sessions.where('student_id').equals(student.id).toArray()
  list = list.filter((s) => !s._deleted)
  if (student.timeline_reset_at) list = list.filter((s) => s.created_at >= student.timeline_reset_at!)
  if (from) list = list.filter((s) => s.date >= from)
  if (to) list = list.filter((s) => s.date <= to)
  return list.sort((a, b) => (a.date + a.label).localeCompare(b.date + b.label))
}

export async function getWeekContext(studentId: string, week: string): Promise<WeekContext | undefined> {
  return db.weekContexts.where('[student_id+week_start]').equals([studentId, week]).first()
}

export async function upsertWeekContext(studentId: string, week: string, patch: Partial<WeekContext>) {
  const cur = await getWeekContext(studentId, week)
  const base: WeekContext = cur ?? { id: uid(), student_id: studentId, week_start: week, menstrual: false, diet: 'manutencao', updated_at: nowISO() }
  // herda fase da dieta da semana anterior quando a semana é nova
  if (!cur && !patch.diet) {
    const prev = await getWeekContext(studentId, addDays(week, -7))
    if (prev) base.diet = prev.diet
  }
  return save(db.weekContexts, { ...base, ...patch })
}

export async function weekPoints(student: Student, weeks: string[]): Promise<WeekPoint[]> {
  const lookup = await profileLookup()
  const ratings = await db.ratings.toArray()
  const checkins = await db.checkins.where('student_id').equals(student.id).toArray()
  const out: WeekPoint[] = []
  let prevAgg = null as WeekPoint['agg'] | null
  // inclui a semana anterior à primeira para classificar corretamente
  const firstPrev = addDays(weeks[0], -7)
  const prevSessions = await studentSessions(student, firstPrev, addDays(firstPrev, 6))
  if (prevSessions.length) prevAgg = aggregateSessions(prevSessions, lookup, ratings)
  for (const w of weeks) {
    const sessions = await studentSessions(student, w, addDays(w, 6))
    const agg = aggregateSessions(sessions, lookup, ratings)
    const ctx = await getWeekContext(student.id, w)
    const verdict = weekVerdict(agg, prevAgg, student.sex === 'F' ? ctx : ctx && { ...ctx, menstrual: false })
    const sleep = { bem: 0, mal: 0, irregular: 0 }
    for (const c of checkins) if (!c._deleted && c.date >= w && c.date <= addDays(w, 6)) sleep[c.sleep]++
    out.push({ week: w, firstDate: sessions[0]?.date, agg, verdict, ctx, sleep })
    prevAgg = agg
  }
  return out
}

export function lastNWeeks(n: number, ref: Date | string = new Date()): string[] {
  // data local (toISOString usa UTC e podia pular de semana perto da meia-noite)
  const cur = weekStart(typeof ref === 'string' ? ref : toISODate(ref))
  return Array.from({ length: n }, (_, i) => addDays(cur, -7 * (n - 1 - i)))
}

export function weeksBetween(from: string, to: string): string[] {
  const out: string[] = []
  for (let w = weekStart(from); w <= to; w = addDays(w, 7)) out.push(w)
  return out
}

/** Converte linhas parseadas em SessionExercise (bi-set => um registro por exercício com o mesmo grupo). */
export async function linesToExercises(lines: ParsedExerciseLine[], activeGroups: string[], transcript?: string): Promise<SessionExercise[]> {
  const names = [...new Set(lines.flatMap((l) => l.names))]
  const profiles = await resolveProfiles(names, activeGroups, transcript)
  const out: SessionExercise[] = []
  let ss = 0
  lines.forEach((l) => {
    const group = l.names.length > 1 ? ++ss : null
    for (const n of l.names) {
      const p = profiles.get(n)!
      out.push({
        id: uid(), position: out.length, superset_group: group, exercise_key: p.key, display_name: n,
        valid_sets: l.validSets, warmup_sets: l.warmupSets, heavy_sets: l.heavySets, reps: l.reps,
        load_kg: l.loadKg, drop_set: l.dropSet, notes: l.notes || undefined,
      })
    }
  })
  return out
}

/** Treinos colados do WhatsApp já salvos nessas semanas (serão substituídos ao salvar de novo). */
export async function whatsappInWeeks(student: Student, weeks: string[]): Promise<Session[]> {
  const out: Session[] = []
  for (const wk of weeks) out.push(...(await studentSessions(student, wk, addDays(wk, 6))).filter((s) => s.source === 'whatsapp'))
  return out
}

export async function importWhatsApp(student: Student, weeks: ParsedWeek[], replace = false): Promise<number> {
  let n = 0
  if (replace) for (const old of await whatsappInWeeks(student, weeks.map((w) => w.week))) await softDelete(db.sessions, old.id)
  for (const w of weeks) {
    for (const t of w.trainings) {
      const exercises = await linesToExercises(t.exercises, [])
      await save(db.sessions, {
        id: uid(), student_id: student.id, date: t.date, label: t.label, source: 'whatsapp', muscle_groups: [],
        raw_text: t.rawText, exercises, created_at: nowISO(), updated_at: nowISO(),
      })
      n++
    }
  }
  return n
}

export async function resetTimeline(student: Student) {
  return save(db.students, { ...student, timeline_reset_at: nowISO() })
}

export async function getCheckin(studentId: string, date: string) {
  return db.checkins.where('[student_id+date]').equals([studentId, date]).filter((c) => c.reported_by === 'trainer' && !c._deleted).first()
}

export async function clearCheckin(studentId: string, date: string) {
  const c = await getCheckin(studentId, date)
  if (c) await softDelete(db.checkins, c.id)
}

export async function saveCheckin(studentId: string, date: string, sleep: SleepQuality) {
  const existing = await db.checkins.where('[student_id+date]').equals([studentId, date]).filter((c) => c.reported_by === 'trainer').first()
  return save(db.checkins, { id: existing?.id ?? uid(), student_id: studentId, date, sleep, reported_by: 'trainer', updated_at: nowISO(), _deleted: 0 })
}

export async function saveRating(sessionId: string, pse: number) {
  const existing = await db.ratings.where('session_id').equals(sessionId).filter((r) => r.reported_by === 'trainer').first()
  return save(db.ratings, { id: existing?.id ?? uid(), session_id: sessionId, pse, reported_by: 'trainer', created_at: existing?.created_at ?? nowISO(), updated_at: nowISO() })
}

/** Exercícios-chave do mês: os com carga registrada em mais sessões. */
export async function keyLifts(student: Student, from: string, to: string): Promise<KeyLift[]> {
  const sessions = await studentSessions(student, from, to)
  const map = new Map<string, KeyLift>()
  for (const s of sessions) {
    for (const ex of s.exercises) {
      if (!ex.load_kg) continue
      const k = ex.exercise_key
      const l = map.get(k) ?? { name: ex.display_name, points: [], perSide: !!ex.per_side }
      const sameDay = l.points.find((p) => p.date === s.date)
      if (sameDay) sameDay.kg = Math.max(sameDay.kg, ex.load_kg)
      else l.points.push({ date: s.date, kg: ex.load_kg })
      map.set(k, l)
    }
  }
  return [...map.values()].filter((l) => l.points.length >= 1).sort((a, b) => b.points.length - a.points.length)
}

/**
 * Melhor carga anterior de cada exercício do aluno (antes da data / sessão informada).
 * Usado para marcar RECORDE PESSOAL no relatório do treino do dia.
 */
export async function previousBests(studentId: string, session: Session): Promise<Record<string, number>> {
  const all = await db.sessions.where('student_id').equals(studentId).toArray()
  const best: Record<string, number> = {}
  for (const s of all) {
    if (s._deleted || s.id === session.id) continue
    if (s.date > session.date || (s.date === session.date && s.created_at >= session.created_at)) continue
    for (const e of s.exercises) {
      const peak = Math.max(e.load_kg ?? 0, ...(e.loads ?? []).map((k) => k ?? 0))
      if (peak > (best[e.exercise_key] ?? 0)) best[e.exercise_key] = peak
    }
  }
  return best
}
