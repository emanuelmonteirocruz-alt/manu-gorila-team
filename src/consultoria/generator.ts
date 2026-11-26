/**
 * Rascunho da próxima semana no padrão de escrita do WhatsApp (o mesmo que o "Colar WhatsApp" lê).
 * Parte da última semana colada do aluno e aplica: fase (Ordinária / Choque / Regenerativa),
 * ajuste de intensidade, ênfase muscular e alertas das restrições da anamnese.
 * Regras simples e explícitas: é um ponto de partida para você revisar e refinar (vamos calibrando).
 */
import type { ExerciseProfile, Microcycle, RepRange, Session, SessionExercise } from '../domain/types'
import { RESTRICTION_RULES } from './reminders'
import type { Triage } from './triage'
import { muscleShares } from '../engine/exerciseSeed'
import { SHOCK_VARIABLES, pickWeighted, rng, usedVariables, type ShockVariable } from './shockVariables'
import { levelFor, type LevelRule } from './levels'
import type { TrainingLevel } from '../domain/types'

export type Intensity = -1 | 0 | 1

export interface GenerateInput {
  base: Session[] // treinos da semana de referência (A, B, C…)
  phase: Microcycle
  intensity: Intensity // -1 mais leve · 0 igual · +1 mais intenso
  enfases: string[]
  triage?: Triage | null
  lookup: (key: string) => ExerciseProfile | undefined
  history?: Session[] // semanas anteriores do aluno: o choque evita repetir a variável que ele já fez no exercício
  seed?: number // sorteio das variáveis (cada "Gerar" sai diferente; nos testes fica fixo)
  level?: TrainingLevel | null // nível da ficha (adaptação … atleta); sem ele, vem da anamnese
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
export interface GeneratedTraining {
  label: string
  exercises: GeneratedExercise[]
  emphasisScore?: number // séries da ênfase no treino (para pôr o treino prioritário primeiro)
  movedFrom?: string // rótulo que o treino tinha na semana base, quando a ênfase mudou a ordem
}

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
  const rand = rng(inp.seed ?? Date.now())
  const used = usedVariables(inp.history ?? [])
  const weekUse = new Map<string, number>() // variáveis já usadas nesta semana (espalhar)
  const lv: LevelRule = levelFor(inp.level, inp.triage?.experiencia)
  for (const s of [...inp.base].sort((a, b) => a.label.localeCompare(b.label))) {
    // reagrupa bi-sets (mesmo superset_group seguidos) em uma linha "A + B"
    const groups: SessionExercise[][] = []
    for (const e of [...s.exercises].sort((a, b) => a.position - b.position)) {
      const last = groups[groups.length - 1]
      if (last && e.superset_group != null && last[0].superset_group === e.superset_group) last.push(e)
      else groups.push([e])
    }
    const meta = groups.map((g) => {
      const e = g[0]
      const profile = inp.lookup(e.exercise_key)
      const group = profile?.muscle_group ?? ''
      // ênfase: músculo principal do exercício ou que ele trabalha por inteiro (glúteo no sumô/búlgaro)
      const emphShare = Math.max(0, ...g.flatMap((x) => muscleShares(x.display_name, inp.lookup(x.exercise_key)?.muscle_group ?? '').filter((m) => inp.enfases.includes(m.group)).map((m) => m.share)))
      const isEmph = inp.enfases.includes(group) || emphShare >= 1
      const hasTech = TECH_RE.test(e.notes ?? '') || e.drop_set
      return { profile, emphShare, isEmph, single: g.length === 1 && !hasTech }
    })

    // CHOQUE (e ordinária dos avançados): quais exercícios recebem variável — sorteado (ênfase pesa mais),
    // sem posição fixa, só variáveis do nível do aluno e no máximo UMA por família de método em cada treino
    const shock = new Map<number, ShockVariable>()
    const extraSet = new Set<number>()
    const glp1 = !!inp.triage?.glp1 // Monjaro/Ozempic: uma variável por treino, sem as mais extenuantes
    const assign = (howMany: number, allowed: string[]) => {
      const pool = meta.map((_, i) => i).filter((i) => meta[i].single)
      const families = new Set<string>()
      for (let k = 0; k < howMany && pool.length; k++) {
        const i = pickWeighted(pool, (j) => (meta[j].isEmph ? 3 : 1), rand)!
        pool.splice(pool.indexOf(i), 1)
        const g = groups[i]
        const reps0 = g[0].reps.length ? g[0].reps : [{ min: 10, max: 10 }]
        const ctx = { profile: meta[i].profile, isEmph: meta[i].isEmph, isLast: i === groups.length - 1, pyramid: isPyramid(reps0), beginner: lv.id === 'iniciante' || lv.id === 'adaptacao' }
        const st = { sets: g[0].valid_sets, reps: reps0, notes: [] as string[] }
        const hist = used.get(g[0].exercise_key)
        const v = pickWeighted(
          SHOCK_VARIABLES.filter((x) => allowed.includes(x.id) && x.suits(ctx, st) && !families.has(x.family) && !(glp1 && /fst7|falha|parciais|dropduplo|myoreps/.test(x.id))),
          (x) => x.weight * (hist?.get(x.id) ? 0.2 : 1) * 0.4 ** (weekUse.get(x.id) ?? 0),
          rand,
        )
        if (!v) { k--; if (!pool.length) break; continue }
        shock.set(i, v)
        families.add(v.family)
        weekUse.set(v.id, (weekUse.get(v.id) ?? 0) + 1)
      }
    }
    if (inp.phase === 'choque') {
      const [lo, hi] = lv.choque
      const n = glp1 ? Math.min(1, hi) : lo + Math.floor(rand() * (hi - lo + 1))
      assign(Math.min(meta.filter((m) => m.single).length, n), lv.permitidas)
      // parte da ênfase restante ganha volume (não todos: o aluno não identifica o padrão)
      for (let i = 0; i < meta.length; i++) if (meta[i].isEmph && !shock.has(i) && rand() < 0.5) extraSet.add(i)
    } else if (inp.phase === 'ordinaria') {
      // ORDINÁRIA: +1 série em 1 ou 2 exercícios da ênfase (sorteados) com até 3 séries
      const pool = meta.map((_, i) => i).filter((i) => meta[i].isEmph && groups[i][0].valid_sets <= 3 && !isPyramid(groups[i][0].reps))
      const n = Math.min(pool.length, 1 + (rand() < 0.5 ? 1 : 0))
      for (let k = 0; k < n; k++) { const i = pickWeighted(pool, () => 1, rand)!; pool.splice(pool.indexOf(i), 1); extraSet.add(i) }
      // avançados: um método leve na ordinária também (não só no choque)
      if (!glp1 && lv.ordinariaPermitidas.length && rand() < lv.ordinaria) assign(1, lv.ordinariaPermitidas)
    }

    const exercises: GeneratedExercise[] = groups.map((g, i) => {
      const e = g[0]
      const changes: string[] = []
      let sets = e.valid_sets
      let reps: RepRange[] = e.reps.length ? [...e.reps] : Array.from({ length: sets }, () => ({ min: 10, max: 10 }))
      let notes = (e.notes ?? '').split(' · ').map((x) => x.trim()).filter(Boolean)

      const v = shock.get(i)
      if (v) {
        const r = v.apply({ sets, reps, notes })
        sets = r.sets; reps = r.reps; notes = r.notes
        changes.push(v.change)
      }
      if (extraSet.has(i) && sets < 5 && !isPyramid(reps)) { sets += 1; changes.push('+1 série (ênfase)') }
      if (inp.phase === 'regenerativa' && lv.deloadPorVolume) {
        // avançado 2 / atleta: deload pelo volume (cerca de 40% menos séries), mantém a faixa de reps, sem técnicas
        const nsets = Math.max(2, Math.round(sets * 0.6))
        if (nsets < sets) { changes.push(`-${sets - nsets} ${sets - nsets === 1 ? 'série' : 'séries'} (deload)`); sets = nsets }
        const before = notes.length
        notes = notes.filter((x) => !TECH_RE.test(x) && !/falha|m[aá]x|myo|parcia/i.test(x))
        if (notes.length < before) changes.push('sem técnica avançada')
      } else if (inp.phase === 'regenerativa') {
        if (sets > 2) { sets -= 1; changes.push('-1 série') }
        const lighter = reps.map((r) => (r.failure && !r.min ? { min: 12, max: 15 } : (r.min + r.max) / 2 < 12 ? { min: 12, max: 15 } : r))
        if (lighter.some((r, i) => r.min !== reps[i].min)) changes.push('reps 12–15')
        reps = lighter
        const before = notes.length
        notes = notes.filter((x) => !TECH_RE.test(x) && !/carga alta|pesad|falha|m[aá]x/i.test(x))
        if (notes.length < before) changes.push('sem técnica avançada')
      }
      if (inp.intensity !== 0 && !(v && /forca|cluster|piramide|fst7/.test(v.id))) {
        reps = reps.map((r) => shiftRange(r, inp.intensity === 1 ? -2 : 2)).map((r) => (r.failure && !r.min ? r : r.min < lv.minReps ? { min: lv.minReps, max: Math.max(lv.minReps, r.max) } : r))
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
    const emphasisScore = exercises.reduce((a, x, i) => a + x.sets * meta[i].emphShare, 0)
    out.push({ label: s.label, exercises, emphasisScore })
  }
  return orderByEmphasis(out, inp.enfases)
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

export interface TrainingMessage {
  label: string // "Treino A"
  text: string // mensagem pronta (sem as linhas "(revisar…)"/"(trocar…)", que são só para o treinador)
}

/**
 * Separa o texto da semana em UMA MENSAGEM POR TREINO, para mandar no WhatsApp um de cada vez.
 * Um treino começa na linha do título ("*Treino A*", "Treino B - Pernas"…); o texto editado à mão também vale.
 */
export function splitForWhatsApp(text: string): TrainingMessage[] {
  const TITLE = /^\s*\*?\s*(treino\s+[a-z0-9]+)\b/i
  const out: { label: string; lines: string[] }[] = []
  for (const line of text.replace(/\r/g, '').split('\n')) {
    const m = line.match(TITLE)
    if (m) out.push({ label: m[1].replace(/\s+/g, ' ').replace(/^treino/i, 'Treino').replace(/\s(\S+)$/, (_, x: string) => ' ' + x.toUpperCase()), lines: [line] })
    else if (out.length) out[out.length - 1].lines.push(line)
    else if (line.trim()) out.push({ label: 'Treino', lines: [line] })
  }
  return out
    .map((b) => ({
      label: b.label,
      text: b.lines.filter((l) => !/^\s*\((revisar|trocar)\b[^)]*\)?.*$/i.test(l)).join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    }))
    .filter((b) => b.text)
}

/**
 * Com ênfase escolhida, o treino com mais séries da ênfase vira o Treino A (o aluno começa a semana por ele).
 * As letras ficam na sequência (A, B, C…); empate mantém a ordem da semana base.
 */
export function orderByEmphasis(week: GeneratedTraining[], enfases: string[]): GeneratedTraining[] {
  if (!enfases.length || week.length < 2) return week
  const labels = week.map((t) => t.label)
  const sorted = week.map((t, i) => ({ t, i })).sort((a, b) => (b.t.emphasisScore ?? 0) - (a.t.emphasisScore ?? 0) || a.i - b.i).map((x) => x.t)
  const LETTER = /^\s*treino\s+\S+/i
  return sorted.map((t, i) => {
    if (t.label === labels[i]) return t
    const want = labels[i].match(LETTER)?.[0]
    const have = t.label.match(LETTER)?.[0]
    const label = want && have ? t.label.replace(have, want.trim()) : labels[i]
    return { ...t, label, movedFrom: t.label }
  })
}

/** Músculos da ênfase que não aparecem em nenhum exercício da semana base (o rascunho não inventa exercício). */
export function missingEmphasis(base: Session[], enfases: string[], lookup: GenerateInput['lookup']): string[] {
  const seen = new Set<string>()
  for (const s of base) for (const e of s.exercises) for (const m of muscleShares(e.display_name, lookup(e.exercise_key)?.muscle_group ?? '')) if (m.share >= 0.5) seen.add(m.group)
  return enfases.filter((g) => !seen.has(g))
}

/** Alerta de um exercício para um aluno: "trocar" (ele disse que não pode) ou "revisar (área)" pelas restrições da anamnese. */
export function exerciseAlert(names: string[], triage: Triage | null | undefined): string | undefined {
  if (!triage) return undefined
  const asked = triage.evitarExercicios.find((x) => names.some((nm) => norm(nm).includes(norm(x)) || norm(x).includes(norm(nm))))
  if (asked) return 'trocar: aluno não pode fazer'
  const area = triage.restricoes.find((r) => RESTRICTION_RULES[r.area]?.evitarRe?.test(norm(names.join(' '))))
  return area ? `revisar (${RESTRICTION_RULES[area.area].titulo.toLowerCase()})` : undefined
}

/** Texto de uma semana já salva, no padrão do WhatsApp (o que foi colado; sem o texto original, remonta pelos exercícios). */
export function sessionsToWhatsApp(sessions: Session[]): string {
  return [...sessions].sort((a, b) => a.label.localeCompare(b.label) || a.date.localeCompare(b.date)).map((s) => {
    if (s.raw_text?.trim()) return `*${s.label}*\n${s.raw_text.trim()}`
    const groups: SessionExercise[][] = []
    for (const e of [...s.exercises].sort((a, b) => a.position - b.position)) {
      const last = groups[groups.length - 1]
      if (last && e.superset_group != null && last[0].superset_group === e.superset_group) last.push(e)
      else groups.push([e])
    }
    return weekToWhatsApp([{ label: s.label, exercises: groups.map((g) => ({ names: g.map((x) => x.display_name), sets: g[0].valid_sets, warmup: g[0].warmup_sets, reps: g[0].reps, notes: (g[0].notes ?? '').split(' · ').filter(Boolean), changes: [] })) }])
  }).join('\n\n')
}
