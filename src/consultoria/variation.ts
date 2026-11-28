/**
 * VARIAÇÃO DA SEMANA (consultoria): a semana nova não pode parecer a anterior com "-2 reps".
 * 1) troca quase todos os exercícios por equivalentes (mesmo músculo e mesmo tipo: multi↔multi, isolado↔isolado),
 *    sem repetir o que o aluno fez nas últimas 2 semanas e respeitando anamnese/restrições;
 * 2) cada treino começa por OUTRO músculo (multiarticular continua antes do isolado);
 * 3) foco da semana alterna: força (6–8) → hipertrofia (10–12, pirâmide no principal) → metabólico (15–20).
 */
import type { ExerciseProfile, Microcycle, RepRange, Session } from '../domain/types'
import { SEED_PROFILES, normalizeKey } from '../engine/exerciseSeed'
import { RESTRICTION_RULES } from './reminders'
import { rng } from './shockVariables'
import type { Triage } from './triage'
import type { GeneratedExercise, GeneratedTraining } from './generator'

export type Focus = 'forca' | 'hipertrofia' | 'metabolico'
export const FOCUS_LABEL: Record<Focus, string> = { forca: 'força (6–8)', hipertrofia: 'hipertrofia (10–12)', metabolico: 'metabólico (15–20)' }
const ACCESSORY = /gl[uú]teo m[eé]dio|Panturrilha|Abd[oô]men|Adutores/i
const MINOR = new Set(['Tríceps', 'Bíceps', 'Panturrilha', 'Abdômen', 'Antebraço'])
const NEXT: Record<Focus, Focus> = { forca: 'hipertrofia', hipertrofia: 'metabolico', metabolico: 'forca' }

export interface VaryInput {
  phase: Microcycle
  triage?: Triage | null
  lookup: (key: string) => ExerciseProfile | undefined
  history?: Session[] // semanas anteriores (evita voltar para o que o aluno fez há pouco)
  minReps?: number // nível do aluno (iniciante não desce para 6)
  intensity?: number // -1 aliviar · 0 manter · +1 progredir
  seed?: number
  catalog?: ExerciseProfile[]
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
// fora das trocas: peso corporal/funcional/avançado ou pouco comum em academia (o treino tem que parecer de academia)
const NOT_GYM = /peso corporal|pistol|salto|burpee|thruster|box jump|wall ball|com desenvolvimento|com rota[cç][aã]o|adutora com extens|n[oó]rdica|na bola|com el[aá]stico|kettlebell|frog pump|superman|battle rope|farmer|turkish|escalador|flex[aã]o (de bra|de joelho|inclinada|declinada|diamante)|paralelas|barra fixa(?! assistida)|sissy|good morning|pull through|tibial|rota[cç][aã]o (externa|interna)|rosca de punho|svend|hollow|dead bug|pendlay|landmine|trap bar|clean|snatch|abdu[cç][aã]o deitad|caneleira|remada invertida|no banco romano|lenhador|prancha/i

// variáveis do choque que já definem as repetições: não mexer nelas
const REPS_FROM_SHOCK = /carga alta|cluster|pir[aâ]mide|fst-7/i

/** Foco da semana de referência pela média de repetições → o foco da próxima é o seguinte do ciclo. */
export function nextFocus(week: GeneratedTraining[], intensity = 0): Focus {
  const all = week.flatMap((t) => t.exercises.flatMap((e) => e.reps.filter((r) => r.min).map((r) => (r.min + (r.max || r.min)) / 2)))
  const avg = all.length ? all.reduce((a, b) => a + b, 0) / all.length : 10
  const cur: Focus = avg <= 8.5 ? 'forca' : avg <= 13 ? 'hipertrofia' : 'metabolico'
  // progredir = carga mais pesada; aliviar = cargas mais leves; manter = gira o ciclo
  if (intensity > 0) return cur === 'forca' ? 'hipertrofia' : 'forca'
  if (intensity < 0) return cur === 'metabolico' ? 'hipertrofia' : 'metabolico'
  return NEXT[cur]
}

function blocked(name: string, triage?: Triage | null): boolean {
  if (!triage) return false
  const n = norm(name)
  if (triage.evitarExercicios.some((x) => n.includes(norm(x)) || norm(x).includes(n))) return true
  return triage.restricoes.some((r) => RESTRICTION_RULES[r.area]?.evitarRe?.test(n))
}

function repsFor(focus: Focus, multi: boolean, mainLift: boolean, sets: number, minReps: number): RepRange[] {
  const r = (min: number, max = min): RepRange => ({ min: Math.max(min, minReps), max: Math.max(max, minReps) })
  let list: RepRange[]
  if (focus === 'forca') list = Array.from({ length: sets }, () => (multi ? r(6, 8) : r(8, 10)))
  else if (focus === 'hipertrofia') list = multi && mainLift && sets >= 4 ? [r(12), r(10), r(8), r(8), r(8)].slice(0, sets) : Array.from({ length: sets }, () => (multi ? r(10, 12) : r(12)))
  else list = Array.from({ length: sets }, () => (multi ? r(12, 15) : r(15, 20)))
  return list
}

export function varyWeek(week: GeneratedTraining[], v: VaryInput): GeneratedTraining[] {
  const rand = rng((v.seed ?? Date.now()) + 7)
  const catalog = (v.catalog ?? SEED_PROFILES).filter((p) => !p.disputed && !NOT_GYM.test(p.name))
  const prof = (name: string) => v.lookup(normalizeKey(name)) ?? v.lookup(name)
  // o que o aluno fez nas semanas anteriores e na semana de referência: não volta logo
  const recent = new Set<string>([
    ...(v.history ?? []).slice(-20).flatMap((s) => s.exercises.map((e) => prof(e.display_name)?.key ?? normalizeKey(e.display_name))),
    ...week.flatMap((t) => t.exercises.flatMap((e) => e.names.map((n) => prof(n)?.key ?? normalizeKey(n)))),
  ])
  const usedNow = new Set<string>()
  const focus = v.phase === 'regenerativa' ? null : nextFocus(week, v.intensity ?? 0)

  return week.map((t) => {
    // 1) TROCA de exercícios por equivalentes
    let exercises: (GeneratedExercise & { _group?: string; _multi?: boolean; _acc?: boolean })[] = t.exercises.map((e) => {
      const changes = [...e.changes]
      const names = e.names.map((n) => {
        const p = prof(n)
        if (!p) return n
        const pool = catalog.filter((c) => c.muscle_group === p.muscle_group && c.mechanic === p.mechanic && c.key !== p.key && !usedNow.has(c.key) && !blocked(c.name, v.triage))
        const fresh = pool.filter((c) => !recent.has(c.key))
        const same = fresh.filter((c) => c.sub_region && c.sub_region === p.sub_region)
        const opts = same.length ? same : fresh.length ? fresh : []
        if (!opts.length) { usedNow.add(p.key); return n }
        const pick = opts[Math.floor(rand() * opts.length)]
        usedNow.add(pick.key)
        changes.push(`troca: ${n} → ${pick.name}`)
        return pick.name
      })
      const p0 = prof(names[0])
      return { ...e, names, changes, alert: names.some((n) => blocked(n, v.triage)) ? 'revisar (anamnese)' : e.alert, _group: p0?.muscle_group ?? '', _multi: p0?.mechanic === 'multiarticular', _acc: ACCESSORY.test(`${p0?.muscle_group ?? ''} ${p0?.sub_region ?? ''}`) }
    })

    // 2) ORDEM: começa por outro músculo (dentro de cada músculo, multiarticular antes do isolado)
    // músculos menores (tríceps, bíceps, panturrilha, abdômen) ficam no fim; os grandes giram
    const groups = [...new Set(exercises.map((e) => e._group ?? ''))]
    const big = groups.filter((g) => !MINOR.has(g)), small = groups.filter((g) => MINOR.has(g))
    if (big.length > 1) {
      const order = [...big.slice(1), big[0], ...small]
      exercises = order.flatMap((g) => {
        const list = exercises.filter((e) => (e._group ?? '') === g)
        return [...list.filter((e) => e._multi), ...list.filter((e) => !e._multi)]
      })
      if (exercises[0] && order[0]) exercises[0] = { ...exercises[0], changes: [...exercises[0].changes, `ordem: começa por ${order[0].replace('Perna - ', '')}`] }
    }

    // 3) FOCO DA SEMANA nas séries e repetições
    if (focus) {
      let firstMulti = true
      exercises = exercises.map((e, i) => {
        if (e.changes.some((c) => REPS_FROM_SHOCK.test(c)) || e.reps.some((r) => r.failure && !r.min)) return e
        const main = !!e._multi && firstMulti
        if (e._multi) firstMulti = false
        // acessórios (glúteo médio, panturrilha, abdômen) nunca abaixo de 12
        const reps = repsFor(focus, !!e._multi, main, e.sets, e._acc ? Math.max(12, v.minReps ?? 6) : v.minReps ?? 6)
        const ch = e.changes.filter((c) => !/^mais (intenso|leve)/.test(c)) // as reps agora vêm do foco da semana
        return { ...e, reps, changes: i === 0 ? [...ch, `foco da semana: ${FOCUS_LABEL[focus]}`] : ch }
      })
    }
    return { ...t, exercises: exercises.map(({ _group, _multi, _acc, ...e }) => (void _group, void _multi, void _acc, e)) }
  })
}
