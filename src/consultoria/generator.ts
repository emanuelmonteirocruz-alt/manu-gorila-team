/**
 * Rascunho da próxima semana no padrão de escrita do WhatsApp (o mesmo que o "Colar WhatsApp" lê).
 * Parte da última semana colada do aluno e aplica: fase (Ordinária / Choque / Regenerativa),
 * ajuste de intensidade, ênfase muscular e alertas das restrições da anamnese.
 * Regras simples e explícitas: é um ponto de partida para você revisar e refinar (vamos calibrando).
 */
import type { ExerciseProfile, Microcycle, RepRange, Session, SessionExercise } from '../domain/types'
import { RESTRICTION_RULES } from './reminders'
import type { Triage } from './triage'

export type Intensity = -1 | 0 | 1

export interface GenerateInput {
  base: Session[] // treinos da semana de referência (A, B, C…)
  phase: Microcycle
  intensity: Intensity // -1 mais leve · 0 igual · +1 mais intenso
  enfases: string[]
  triage?: Triage | null
  lookup: (key: string) => ExerciseProfile | undefined
}

export interface GeneratedExercise {
  names: string[]
  sets: number
  warmup: number
  reps: RepRange[]
  notes: string[]
  changes: string[] // o que mudou em relação à semana base (para você conferir)
  alert?: string
}
export interface GeneratedTraining { label: string; exercises: GeneratedExercise[] }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const TECH_RE = /\b(drop|rest[ -]?pause|cluster|fst|excentric|negativ|isometri|piramide)\w*[^·]*/i
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x))

// números de repetição usados na prática (o rascunho não sai com "13" ou "11")
const STD = [4, 5, 6, 8, 10, 12, 15, 20, 25]
const snap = (x: number, dir: number) => (dir < 0 ? [...STD].reverse().find((v) => v <= x) ?? 4 : STD.find((v) => v >= x) ?? 25)
function shiftRange(r: RepRange, delta: number): RepRange {
  if (r.failure && !r.min) return r
  const min = snap(clamp(r.min + delta, 4, 25), delta)
  const max = Math.max(min, snap(clamp((r.max || r.min) + delta, 4, 25), delta))
  return { min, max }
}
const isPyramid = (reps: RepRange[]) => new Set(reps.map((r) => r.min)).size > 1

/** Uma semana inteira de rascunho. */
export function generateWeek(inp: GenerateInput): GeneratedTraining[] {
  const out: GeneratedTraining[] = []
  const restr = inp.triage?.restricoes ?? []
  for (const s of [...inp.base].sort((a, b) => a.label.localeCompare(b.label))) {
    // reagrupa bi-sets (mesmo superset_group seguidos) em uma linha "A + B"
    const groups: SessionExercise[][] = []
    for (const e of [...s.exercises].sort((a, b) => a.position - b.position)) {
      const last = groups[groups.length - 1]
      if (last && e.superset_group != null && last[0].superset_group === e.superset_group) last.push(e)
      else groups.push([e])
    }
    let techDone = false
    const exercises: GeneratedExercise[] = groups.map((g) => {
      const e = g[0]
      const group = inp.lookup(e.exercise_key)?.muscle_group ?? ''
      const isEmph = inp.enfases.includes(group)
      const changes: string[] = []
      let sets = e.valid_sets
      let reps: RepRange[] = e.reps.length ? [...e.reps] : Array.from({ length: sets }, () => ({ min: 10, max: 10 }))
      let notes = (e.notes ?? '').split(' · ').map((x) => x.trim()).filter(Boolean)

      if (inp.phase === 'choque') {
        // pirâmide mantém o formato (não ganha série); as demais ganham +1 série na ênfase
        if (isEmph && sets < 5 && !isPyramid(reps)) { sets += 1; changes.push('+1 série (ênfase)') }
        // reps mais baixas quando a faixa ainda está alta (a pirâmide inteira desce junto)
        const lower = reps.some((r) => !r.failure && (r.min + r.max) / 2 > 10) ? reps.map((r) => (r.failure && !r.min ? r : (r.min + r.max) / 2 <= 6 ? r : shiftRange(r, -2))) : reps
        if (lower.some((r, i) => r.min !== reps[i].min)) changes.push('reps mais baixas')
        reps = lower
        if (isEmph && !techDone && !notes.some((x) => TECH_RE.test(x)) && g.length === 1) {
          notes.push('Drop set na última')
          changes.push('drop set')
          techDone = true
        }
      } else if (inp.phase === 'regenerativa') {
        if (sets > 2) { sets -= 1; changes.push('-1 série') }
        const lighter = reps.map((r) => (r.failure && !r.min ? { min: 12, max: 15 } : (r.min + r.max) / 2 < 12 ? { min: 12, max: 15 } : r))
        if (lighter.some((r, i) => r.min !== reps[i].min)) changes.push('reps 12–15')
        reps = lighter
        const before = notes.length
        notes = notes.filter((x) => !TECH_RE.test(x) && !/carga alta|pesad|falha|m[aá]x/i.test(x))
        if (notes.length < before) changes.push('sem técnica avançada')
      }
      if (inp.intensity !== 0) {
        reps = reps.map((r) => shiftRange(r, inp.intensity === 1 ? -2 : 2))
        changes.push(inp.intensity === 1 ? 'mais intenso (-2 reps)' : 'mais leve (+2 reps)')
      }
      // séries: ajusta a lista de reps ao novo número de séries
      if (reps.length > sets) reps = reps.slice(0, sets)
      while (reps.length < sets) reps.push(reps[reps.length - 1] ?? { min: 10, max: 10 })

      const names = g.map((x) => x.display_name)
      const alertArea = restr.find((r) => RESTRICTION_RULES[r.area]?.evitarRe?.test(norm(names.join(' '))))
      // exercício que o aluno disse que não pode/não consegue fazer
      const asked = (inp.triage?.evitarExercicios ?? []).find((x) => names.some((nm) => norm(nm).includes(norm(x)) || norm(x).includes(norm(nm))))
      return {
        names, sets, warmup: e.warmup_sets, reps, notes, changes,
        alert: asked ? 'trocar: aluno não pode fazer' : alertArea ? `revisar (${RESTRICTION_RULES[alertArea.area].titulo.toLowerCase()})` : undefined,
      }
    })
    out.push({ label: s.label, exercises })
  }
  return out
}

/** "4x10", "3x8-12", "15/12/10/8", "3xMáx" — o padrão que o leitor do WhatsApp entende. */
export function schemeText(sets: number, reps: RepRange[], warmup = 0): string {
  const fmt = (r: RepRange) => (r.failure && !r.min ? 'Máx' : r.min === r.max ? `${r.min}` : `${r.min}-${r.max}`)
  const uniq = [...new Set(reps.map(fmt))]
  const main = uniq.length <= 1 ? `${sets}x${uniq[0] ?? '10'}` : reps.map((r) => (r.failure && !r.min ? 'Máx' : `${r.min}`)).join('/')
  return warmup ? `${warmup}x15 aquecimento + ${main}` : main
}

/** Texto pronto para o WhatsApp (uma mensagem por treino, como você manda). */
export function weekToWhatsApp(week: GeneratedTraining[], withAlerts = false): string {
  return week.map((t) => {
    const lines = [`*${t.label}*`]
    for (const e of t.exercises) {
      lines.push(e.names.join(' + '))
      lines.push(schemeText(e.sets, e.reps, e.warmup))
      for (const nt of e.notes) lines.push(nt)
      if (withAlerts && e.alert) lines.push(`(${e.alert})`)
      lines.push('')
    }
    return lines.join('\n').trim()
  }).join('\n\n')
}
