/**
 * Motor de cálculo — volume, intensidade, perfil biomecânico, gasto calórico,
 * equivalência em gordura, microciclos e PSE (Módulos 2 e 4).
 */
import type {
  DailyCheckin, DietPhase, ExerciseProfile, Microcycle, RepRange, Session, SessionExercise, SessionRating, WeekContext,
} from '../domain/types'
import { muscleShares } from './exerciseSeed'

export const KCAL_PER_KG_FAT = 7700

// ---------- datas ----------
export function toISODate(d: Date): string {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
export function parseISODate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
/** Segunda-feira da semana da data. */
export function weekStart(date: string): string {
  const d = parseISODate(date)
  const dow = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - dow)
  return toISODate(d)
}
export function addDays(date: string, n: number): string {
  const d = parseISODate(date)
  d.setDate(d.getDate() + n)
  return toISODate(d)
}
export function fmtBR(date: string): string {
  const [, m, d] = date.split('-')
  return `${d}/${m}`
}

// ---------- gasto calórico ----------

export function avgReps(ex: SessionExercise): number {
  if (!ex.reps.length) return 10
  return ex.reps.reduce((a, r) => a + (r.min + r.max) / 2, 0) / ex.reps.length
}

export function tonnage(ex: SessionExercise): number {
  const mult = ex.per_side ? 2 : 1 // "de cada lado": carga bilateral
  if (ex.loads?.length) {
    return ex.loads.reduce<number>((acc, kg, i) => {
      const r = ex.reps[i] ?? ex.reps[ex.reps.length - 1] ?? { min: 10, max: 10 }
      return acc + (kg ?? 0) * mult * ((r.min + r.max) / 2)
    }, 0)
  }
  return ex.load_kg ? ex.load_kg * mult * avgReps(ex) * ex.valid_sets : 0
}

/**
 * CALORIAS DA MUSCULAÇÃO — kcal = MET do treino × peso (kg) × duração (h) × correção anaeróbia.
 *  - DURAÇÃO REAL (presencial): do início do treino até salvar a PSE — o descanso por percepção entra
 *    naturalmente. Sem horário (consultoria) ou fora de 15–150 min: duração ESTIMADA pelas séries
 *    (multiarticular 2,5 min · isolado 1,75 min · aquecimento 1 min por série).
 *  - MET DO TREINO = média das séries, por tipo de exercício (2024 Adult Compendium of Physical Activities:
 *    musculação variada 3,5 · agachamento/terra 5,0 · circuito com super série 5,8 · vigoroso 6,0):
 *    perna multiarticular 5,5 · multiarticular superior 5,0 · isolado 3,5 · bi-set +0,8 ·
 *    drop/série pesada +0,5 · excêntrica/cadência lenta +0,3; aquecimento 3,5.
 *    Esforço (PSE): 9–10 ×1,2 · 7–8 ×1,1 · até 4 ×0,9.
 *  - CORREÇÃO ANAERÓBIA: +15% proporcional às séries pesadas/até a falha/drop (medir só O₂ subestima a
 *    musculação; revisão Sports Medicine 2024 aponta fração anaeróbia que pode passar de 40%).
 * Peso: o do aluno (ficha, nutricionista ou anamnese); sem peso, 70 kg.
 */
const WEIGHTS = new Map<string, number>()
const DURATIONS = new Map<string, number>() // sessão → minutos reais (presencial)
/** Registra o peso do aluno para o cálculo de calorias (chamado ao carregar os treinos dele). */
export function setStudentWeight(studentId: string, kg: number | null | undefined) {
  if (kg && kg > 20) WEIGHTS.set(studentId, kg)
}
/** Registra a duração real do treino (início → PSE salva). */
export function setSessionDuration(sessionId: string, minutes: number | null | undefined) {
  if (minutes && minutes >= 15 && minutes <= 150) DURATIONS.set(sessionId, minutes)
  else DURATIONS.delete(sessionId)
}
export const DEFAULT_KCAL_WEIGHT = 70
const LOWER_GROUPS = ['Perna - Quadríceps', 'Perna - Posterior', 'Glúteo', 'Adutores']
const SLOW_RE = /exc[eê]ntric|negativ|cad[eê]ncia|isometri/i

/** MET e minutos estimados de um exercício (para a média do treino). */
function exerciseMetMinutes(ex: SessionExercise, p?: ExerciseProfile): { metMin: number; minutes: number; heavy: number } {
  const multi = p?.mechanic === 'multiarticular'
  const lower = LOWER_GROUPS.includes(p?.muscle_group ?? '')
  let base = multi ? (lower ? 5.5 : 5.0) : 3.5
  if (ex.superset_group != null) base += 0.8
  if (SLOW_RE.test(ex.notes ?? '')) base += 0.3
  const perSet = multi ? 2.5 : 1.75
  let metMin = 0, heavy = 0
  for (let i = 0; i < ex.valid_sets; i++) {
    const r = ex.reps[i] ?? ex.reps[ex.reps.length - 1]
    const isH = !!r && (r.failure || (r.heavy ?? (r.min >= 4 && r.max <= 8)))
    const dropHere = ex.drop_set && i === ex.valid_sets - 1
    if (isH || dropHere) heavy++
    metMin += (base + (isH || dropHere ? 0.5 : 0)) * perSet
  }
  metMin += ex.warmup_sets * 3.5 * 1
  return { metMin, minutes: ex.valid_sets * perSet + ex.warmup_sets, heavy }
}

/** Calorias de um treino (sessão) e a duração usada. */
export function sessionKcal(s: Session, lookup: ProfileLookup, pse?: number | null): { kcal: number; minutes: number; real: boolean } {
  let metMin = 0, minutes = 0, heavy = 0, sets = 0
  for (const ex of s.exercises) {
    const r = exerciseMetMinutes(ex, lookup(ex.exercise_key))
    metMin += r.metMin; minutes += r.minutes; heavy += r.heavy; sets += ex.valid_sets
  }
  if (!minutes) return { kcal: 0, minutes: 0, real: false }
  let met = metMin / minutes
  if (pse != null) met *= pse >= 9 ? 1.2 : pse >= 7 ? 1.1 : pse <= 4 ? 0.9 : 1
  const real = DURATIONS.get(s.id)
  const dur = real ?? minutes
  const kg = WEIGHTS.get(s.student_id) ?? DEFAULT_KCAL_WEIGHT
  const kcal = met * kg * (dur / 60) * (1 + 0.15 * (sets ? heavy / sets : 0))
  return { kcal, minutes: Math.round(dur), real: real != null }
}

// ---------- agregados por sessão / semana ----------
export interface Aggregate {
  validSets: number
  heavySets: number
  heavyPct: number // 0..100 sobre séries válidas
  multiSets: number
  monoSets: number
  freeSets: number
  machineSets: number
  tonnageKg: number
  kcal: number
  fatGrams: number
  sessions: number
  avgPse: number | null
  failureSets: number // séries "Máx" / até a falha
  markedSets: number // séries com marcação de intensidade no texto ("Carga alta", "Pesado", "Máx")
  techniqueSets: number // séries em bi-set / drop-set
  intensityPrescribed: number // 0–100, só pelo que foi prescrito (consultoria)
  intensityReal: number // 0–100, prescrito + PSE do dia (presencial; sem PSE = prescrito)
  byGroup: Record<string, { valid: number; heavy: number }>
  /** Séries pelo músculo PRINCIPAL de cada exercício (sem frações): "o que o aluno treinou" (supino = Peito, remada = Costas) */
  primaryGroups?: Record<string, number>
  /** média de repetições por série de trabalho (menos reps = carga mais pesada) */
  avgReps?: number
  /** duração do(s) treino(s) usada nas calorias (real no presencial; senão estimada) */
  minutes?: number
  realMinutes?: boolean
  /** Nível do desafio (consultoria): pontos do que foi prescrito — faixa de reps + técnicas avançadas */
  challengePoints: number
  lowRepSets: number // séries válidas em até 10 reps
  advancedSets: number // séries com técnica avançada (drop, rest-pause, bi-set…)
}

export function emptyAggregate(): Aggregate {
  return {
    validSets: 0, heavySets: 0, heavyPct: 0, multiSets: 0, monoSets: 0, freeSets: 0, machineSets: 0,
    tonnageKg: 0, kcal: 0, fatGrams: 0, sessions: 0, avgPse: null, byGroup: {}, primaryGroups: {},
    failureSets: 0, markedSets: 0, techniqueSets: 0, intensityPrescribed: 0, intensityReal: 0,
    challengePoints: 0, lowRepSets: 0, advancedSets: 0,
  }
}

export type ProfileLookup = (key: string) => ExerciseProfile | undefined

export function aggregateSessions(sessions: Session[], lookup: ProfileLookup, ratings: SessionRating[] = []): Aggregate {
  const a = emptyAggregate()
  const pses: number[] = []
  let repSum = 0, repN = 0
  for (const s of sessions) {
    a.sessions++
    for (const ex of s.exercises) {
      const p = lookup(ex.exercise_key)
      a.validSets += ex.valid_sets
      a.heavySets += ex.heavy_sets
      for (let i = 0; i < ex.valid_sets; i++) { const r = ex.reps[i] ?? ex.reps[ex.reps.length - 1]; if (r && !(r.failure && !r.min)) { repSum += (r.min + (r.max || r.min)) / 2; repN++ } }
      if (p?.mechanic === 'multiarticular') a.multiSets += ex.valid_sets
      else a.monoSets += ex.valid_sets
      if (p?.implement === 'livre') a.freeSets += ex.valid_sets
      else a.machineSets += ex.valid_sets
      a.tonnageKg += tonnage(ex)
      const fails = ex.reps.filter((r) => r.failure).length
      a.failureSets += fails
      if (MARKER_RE.test(ex.notes ?? '') || MARKER_RE.test(ex.display_name)) a.markedSets += ex.valid_sets
      else a.markedSets += fails
      if (ex.superset_group != null || ex.drop_set) a.techniqueSets += ex.valid_sets
      const ch = exerciseChallenge(ex)
      a.challengePoints += ch.points
      a.lowRepSets += ch.lowRep
      a.advancedSets += ch.advanced
      const pg = p?.muscle_group ?? 'Indefinido'
      a.primaryGroups![pg] = (a.primaryGroups![pg] ?? 0) + ex.valid_sets
      // séries fracionadas: o músculo principal conta inteiro, os auxiliares contam uma fração
      for (const { group: g, share } of muscleShares(`${ex.display_name} ${p?.name ?? ''}`, p?.muscle_group ?? 'Indefinido')) {
        a.byGroup[g] ??= { valid: 0, heavy: 0 }
        a.byGroup[g].valid += ex.valid_sets * share
        a.byGroup[g].heavy += ex.heavy_sets * share
      }
    }
    // PSE do aluno (Fase 2) tem precedência sobre a do treinador quando existir
    const rs = ratings.filter((r) => r.session_id === s.id && !r._deleted)
    const r = rs.find((x) => x.reported_by === 'student') ?? rs.find((x) => x.reported_by === 'trainer')
    if (r) pses.push(r.pse)
    const k = sessionKcal(s, lookup, r?.pse ?? null)
    a.kcal += k.kcal
    a.minutes = (a.minutes ?? 0) + k.minutes
    if (k.real) a.realMinutes = true
  }
  a.heavyPct = a.validSets ? (a.heavySets / a.validSets) * 100 : 0
  a.avgReps = repN ? repSum / repN : undefined
  a.fatGrams = (a.kcal / KCAL_PER_KG_FAT) * 1000
  a.intensityPrescribed = intensityIndex(a)
  a.intensityReal = a.avgPse == null ? a.intensityPrescribed : Math.round(0.45 * a.avgPse * 10 + 0.55 * a.intensityPrescribed)
  a.avgPse = pses.length ? pses.reduce((x, y) => x + y, 0) / pses.length : null
  a.kcal = Math.round(a.kcal)
  return a
}

const MARKER_RE = /carga alta|pesad|m[aá]x|falha|carga m[aá]xima/i

// ---------- Nível do desafio (consultoria) ----------
/** Técnicas avançadas — todas com o mesmo peso (+1 por série). */
export const ADVANCED_RE = /drop|rest[ -]?pause|bi[ -]?set|tri[ -]?set|super ?s[eé]rie|s[eé]rie gigante|giant|cluster|fst|exc[eê]ntric|negativ|pir[aâ]mide|isometri|m[eé]todo 21|gvt|parciais|myo|pr[eé][ -]?exaust|p[oó]s[ -]?exaust/i

/** Peso da série pela faixa de repetições: ≤6 = 3 · 7–10 = 2 · 11–15 = 1 · >15 = 0,5 (faixa 8–12 usa o meio). */
export function repWeight(r: RepRange | undefined): number {
  if (!r) return 1
  if (r.failure && !r.min) return 2 // "Máx" sem reps anotadas
  const mid = (r.min + (r.max || r.min)) / 2
  if (mid <= 6) return 3
  if (mid <= 10) return 2
  if (mid <= 15) return 1
  return 0.5
}

/** Pontos de desafio de um exercício prescrito (volume entra porque cada série soma). */
export function exerciseChallenge(ex: SessionExercise): { points: number; lowRep: number; advanced: number } {
  let points = 0, lowRep = 0
  for (let i = 0; i < ex.valid_sets; i++) {
    const r = ex.reps[i] ?? ex.reps[ex.reps.length - 1]
    const w = repWeight(r)
    points += w
    if (w >= 2) lowRep++
  }
  const advanced = ex.superset_group != null || ex.drop_set || ADVANCED_RE.test(ex.notes ?? '') || ADVANCED_RE.test(ex.display_name) ? ex.valid_sets : 0
  // métodos (drop, bi-set…) não somam pontos: são ferramentas, não intensidade (contagem fica só para o treinador)
  return { points, lowRep, advanced }
}

/** Nível do desafio por treino, com a 1ª semana do aluno = 100. */
export function challengeLevel(a: Pick<Aggregate, 'challengePoints' | 'sessions'>, baseSession: number | undefined): number | null {
  if (!baseSession || !a.sessions) return null
  return Math.round((a.challengePoints / a.sessions / baseSession) * 100)
}

/**
 * Índice de Intensidade (0–100) — não depende só de séries de 6–8 reps:
 *  35% séries pesadas (faixas 6–8 / 8 / 8–10 ou marcadas pelo treinador)
 *  20% marcações de intensidade ("Carga alta", "Pesado", "Máx"/falha)
 *  15% técnicas de densidade (bi-set, drop-set)
 *  15% multiarticulares · 15% peso livre
 * Cada fator satura num patamar realista (ex.: 50% de séries pesadas já vale o máximo do fator).
 */
export function intensityIndex(a: Pick<Aggregate, 'validSets' | 'heavySets' | 'markedSets' | 'techniqueSets' | 'multiSets' | 'freeSets'>): number {
  if (!a.validSets) return 0
  const share = (n: number, cap: number) => Math.min(1, n / a.validSets / cap)
  const v = 0.35 * share(a.heavySets, 0.5) + 0.2 * share(a.markedSets, 0.5) + 0.15 * share(a.techniqueSets, 0.4) + 0.15 * share(a.multiSets, 0.7) + 0.15 * share(a.freeSets, 0.6)
  return Math.round(v * 100)
}

/** Ênfase sob demanda: grupamento com maior volume e intensidade. */
export function dominantGroup(a: Aggregate): { group: string; valid: number; heavy: number } | null {
  const entries = Object.entries(a.byGroup)
  if (!entries.length) return null
  entries.sort((x, y) => y[1].valid + y[1].heavy * 1.5 - (x[1].valid + x[1].heavy * 1.5))
  const [group, v] = entries[0]
  return { group, ...v }
}

// ---------- microciclos ----------
/** Classificação estrutural da semana comparada à anterior (Ordinária/Choque/Regenerativa). */
export function classifyWeek(cur: Aggregate, prev: Aggregate | null): Microcycle {
  if (!prev || prev.validSets === 0) return 'ordinaria'
  const dv = cur.validSets - prev.validSets
  const dh = cur.heavySets - prev.heavySets
  if ((dh >= 3 && cur.heavySets >= prev.heavySets * 1.25) || (dv >= 4 && cur.validSets >= prev.validSets * 1.15)) return 'choque'
  if (cur.validSets <= prev.validSets * 0.85 || (prev.heavySets >= 4 && cur.heavySets <= prev.heavySets * 0.7)) return 'regenerativa'
  return 'ordinaria'
}

export interface WeekVerdict {
  structural: Microcycle
  final: Microcycle
  blocked: boolean
  justification: string[]
}

/** Aplica PSE e contexto fisiológico (inclui a trava do ciclo menstrual). */
export function weekVerdict(cur: Aggregate, prev: Aggregate | null, ctx?: WeekContext): WeekVerdict {
  const structural = classifyWeek(cur, prev)
  let final = structural
  const justification: string[] = []
  if (cur.avgPse != null) {
    if (cur.avgPse >= 8.5 && final === 'ordinaria') {
      final = 'choque'
      justification.push(`PSE média ${cur.avgPse.toFixed(1)} elevou o impacto real para Choque`)
    } else if (cur.avgPse <= 4 && final === 'ordinaria') {
      final = 'regenerativa'
      justification.push(`PSE média ${cur.avgPse.toFixed(1)} indica resposta regenerativa`)
    }
  }
  let blocked = false
  if (ctx?.menstrual) {
    if (final === 'choque') blocked = true
    justification.push('Semana menstrual: Choque bloqueado, direcionado para Regenerativa / controle de carga')
    if (final === 'choque') final = 'regenerativa'
  }
  if (ctx?.diet === 'cutting' && prev && cur.heavySets >= prev.heavySets && cur.heavySets > 0) {
    justification.push('Manteve/aumentou séries pesadas em Cutting — alta eficiência')
  }
  return { structural, final, blocked, justification }
}

/** Trava de prescrição: semana menstrual não pode receber Choque. */
export function checkPrescriptionLock(sex: 'F' | 'M', ctx: WeekContext | undefined, wanted: Microcycle): { allowed: Microcycle; warning?: string } {
  if (sex === 'F' && ctx?.menstrual && wanted === 'choque') {
    return { allowed: 'regenerativa', warning: 'Semana marcada como menstrual: Choque bloqueado → Regenerativa (justificativa registrada nos gráficos).' }
  }
  return { allowed: wanted }
}

// ---------- PSE / nível do treino ----------
export type SessionLevel = 'leve' | 'moderada' | 'alta'
export const LEVEL_TO_MICRO: Record<SessionLevel, Microcycle> = { leve: 'regenerativa', moderada: 'ordinaria', alta: 'choque' }
export const LEVEL_LABEL: Record<SessionLevel, string> = { leve: 'Leve / Regenerativa', moderada: 'Moderada / Ordinária', alta: 'Alta / Choque' }

export interface SessionContext {
  sleep?: DailyCheckin['sleep']
  diet?: DietPhase
  menstrual?: boolean
}

export function classifySessionLevel(pse: number, agg: Aggregate, ctx: SessionContext = {}): SessionLevel {
  let score = pse
  if (agg.heavyPct >= 30) score += 0.75
  if (agg.validSets >= 22) score += 0.5
  if (agg.validSets < 10 && agg.heavySets === 0) score -= 1
  // Contexto que "infla" a PSE reduz levemente o peso da percepção sobre o estímulo real
  if (ctx.sleep === 'mal' || ctx.sleep === 'irregular') score -= 0.5
  if (ctx.menstrual) score -= 0.5
  if (score <= 4.5) return 'leve'
  if (score <= 7.75) return 'moderada'
  return 'alta'
}

export interface DivergenceAlert {
  message: string
  reasons: string[]
}

/** Prescrito vs. Percebido: Ordinária (ou Regenerativa) com PSE 9–10. */
export function divergenceAlert(planned: Microcycle | null | undefined, pse: number, ctx: SessionContext = {}): DivergenceAlert | null {
  if (pse < 9 || planned === 'choque') return null
  const reasons: string[] = []
  if (ctx.sleep === 'mal') reasons.push('dormiu mal')
  if (ctx.sleep === 'irregular') reasons.push('sono irregular')
  if (ctx.diet === 'cutting') reasons.push('fase de cutting (déficit calórico)')
  if (ctx.menstrual) reasons.push('semana menstrual')
  if (!reasons.length) reasons.push('possível fadiga acumulada')
  return {
    message: `Sessão planejada como ${planned === 'regenerativa' ? 'Regenerativa' : 'Ordinária'} com PSE ${pse}: sinal de fadiga acumulada / baixa recuperação. Considere reduzir séries pesadas na próxima sessão.`,
    reasons,
  }
}

// ---------- financeiro ----------
/** Valor hora/aula: valor do plano ÷ sessões no mês (freq. semanal × 52/12). */
export function computeHourlyRate(planValue?: number, weeklyFrequency?: number): number | null {
  if (!planValue || !weeklyFrequency) return null
  return Math.round((planValue / (weeklyFrequency * (52 / 12))) * 100) / 100
}

export function fmtPct(n: number): string {
  return `${n.toFixed(1).replace('.', ',')}%`
}
export function fmtNum(n: number, d = 0): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d })
}
