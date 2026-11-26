/**
 * 1ª SEMANA DE ALUNO NOVO (sem treino colado ainda): monta a semana a partir da anamnese
 * — dias por semana, tempo por treino, ênfase, experiência, restrições e o que o aluno não pode fazer.
 * Usa só exercícios comuns de academia (listas abaixo, editáveis), sorteados para não sair sempre igual.
 */
import { SEED_PROFILES, normalizeKey } from '../engine/exerciseSeed'
import type { RepRange } from '../domain/types'
import { RESTRICTION_RULES } from './reminders'
import type { Triage } from './triage'
import { orderByEmphasis, type GeneratedExercise, type GeneratedTraining } from './generator'
import { pickWeighted, rng } from './shockVariables'

const Q = 'Perna - Quadríceps', P = 'Perna - Posterior', G = 'Glúteo', AD = 'Adutores', PA = 'Panturrilha'
const PE = 'Peito', C = 'Costas', O = 'Ombro', BI = 'Bíceps', TR = 'Tríceps', AB = 'Abdômen'

/** Exercícios por músculo: [nome, multiarticular?]. Os primeiros são os mais usados (saem mais). */
export const FIRST_WEEK_POOLS: Record<string, [string, boolean][]> = {
  [Q]: [['Agachamento livre', true], ['Leg press 45', true], ['Hack', true], ['Agachamento búlgaro', true], ['Agachamento no Smith', true], ['Cadeira extensora', false]],
  [P]: [['Stiff', true], ['Mesa flexora', false], ['Cadeira flexora', false], ['Terra romeno', true], ['Flexora em pé', false]],
  [G]: [['Elevação pélvica', true], ['Agachamento sumô', true], ['Abdutora', false], ['Glúteo no cabo', false], ['Elevação pélvica na máquina', true]],
  [AD]: [['Adutora', false]],
  [PA]: [['Panturrilha em pé', false], ['Panturrilha sentado', false]],
  [PE]: [['Supino reto', true], ['Supino inclinado com halteres', true], ['Supino máquina', true], ['Voador', false], ['Crossover', false]],
  [C]: [['Puxada aberta', true], ['Remada baixa', true], ['Remada curvada', true], ['Remada unilateral', true], ['Pulldown', false]],
  [O]: [['Desenvolvimento com halteres', true], ['Elevação lateral', false], ['Crucifixo inverso', false], ['Elevação frontal', false]],
  [BI]: [['Rosca direta', false], ['Rosca alternada', false], ['Rosca martelo', false], ['Rosca scott', false]],
  [TR]: [['Tríceps corda', false], ['Tríceps testa', false], ['Tríceps francês', false], ['Tríceps barra', false]],
  [AB]: [['Abdominal supra', false], ['Prancha', false], ['Abdominal infra', false]],
}

const LOWER = [Q, P, G, AD, PA]
// divisões por dias: músculos de cada treino (o primeiro de cada lista é o principal)
function split(days: number, lowerFirst: boolean): string[][] {
  const inf1 = [Q, G, AD, PA], inf2 = [P, G, AB], sup = [PE, C, O, BI, TR], push = [PE, O, TR], pull = [C, BI, AB]
  const s: Record<number, string[][]> = {
    1: [[Q, G, PE, C, O]],
    2: [[Q, G, PE, C, O, AB], [P, G, C, PE, O, AB]],
    3: lowerFirst ? [inf1, sup, inf2] : [sup, [Q, P, G, PA], [C, PE, O, BI, TR]],
    4: lowerFirst ? [inf1, push, inf2, pull] : [push, [Q, G, AD, PA], pull, [P, G, AB]],
    5: lowerFirst ? [inf1, push, inf2, pull, [G, O, AB]] : [push, inf1, pull, inf2, [O, BI, TR, AB]],
  }
  return s[Math.max(1, Math.min(5, days))]
}

export interface FirstWeekInput {
  triage: Triage | null
  enfases: string[]
  days?: number
  minutes?: number
  seed?: number
  lookupName?: (name: string) => boolean // exercício existe no banco (para testes)
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function generateFirstWeek(inp: FirstWeekInput): GeneratedTraining[] {
  const rand = rng(inp.seed ?? Date.now())
  const t = inp.triage
  const days = inp.days ?? t?.dias ?? 3
  const minutes = inp.minutes ?? t?.tempoMin ?? 60
  const perTraining = minutes <= 40 ? 4 : minutes <= 50 ? 5 : minutes <= 65 ? 6 : 7
  const exp = t?.experiencia ?? 'intermediario'
  const lowerEmph = inp.enfases.filter((g) => LOWER.includes(g)).length
  const upperEmph = inp.enfases.length - lowerEmph
  const lowerFirst = lowerEmph >= upperEmph // sem ênfase: começa pelos inferiores
  const blocked = (name: string) => {
    const k = norm(name)
    if ((t?.evitarExercicios ?? []).some((x) => k.includes(norm(x)) || norm(x).includes(k))) return true
    return (t?.restricoes ?? []).some((r) => RESTRICTION_RULES[r.area]?.evitarRe?.test(k))
  }
  const usedWeek = new Map<string, number>()
  const scheme = (multi: boolean, first: boolean): { sets: number; reps: RepRange[] } => {
    const same = (n: number, r: number) => ({ sets: n, reps: Array.from({ length: n }, () => ({ min: r, max: r })) })
    if (exp === 'iniciante') return same(3, multi ? 12 : 15)
    if (exp === 'avancado' && multi && first) return { sets: 4, reps: [12, 10, 8, 6].map((r) => ({ min: r, max: r })) }
    return multi ? same(exp === 'avancado' ? 4 : 3 + (rand() < 0.5 ? 1 : 0), exp === 'avancado' ? 8 : 10) : same(3, 12)
  }
  const labels = 'ABCDE'
  const week: GeneratedTraining[] = split(days, lowerFirst).map((groups, ti) => {
    // vagas por músculo: ênfase vale 2, músculo principal do treino 1,5, braço/abdômen 0,7
    const w = groups.map((g, i) => (inp.enfases.includes(g) ? 2 : i === 0 ? 1.5 : [BI, TR, AB, PA, AD].includes(g) ? 0.7 : 1))
    const slots = groups.map(() => 0)
    for (let k = 0; k < perTraining; k++) {
      const i = w.map((x, j) => x / (slots[j] + 1)).reduce((best, x, j, arr) => (x > arr[best] ? j : best), 0)
      slots[i]++
    }
    const exercises: GeneratedExercise[] = []
    const families = new Set<string>() // "Elevação pélvica" e "Elevação pélvica na máquina" não entram no mesmo treino
    const family = (n: string) => norm(n).split(' ').slice(0, 2).join(' ')
    // ênfase primeiro dentro do treino
    const order = groups.map((g, gi) => ({ g, gi })).sort((a, b) => Number(inp.enfases.includes(b.g)) - Number(inp.enfases.includes(a.g)) || a.gi - b.gi)
    order.forEach(({ g, gi }) => {
      const pool = (FIRST_WEEK_POOLS[g] ?? []).filter(([n]) => !blocked(n) && !families.has(family(n)))
      const chosen: [string, boolean][] = []
      for (let k = 0; k < slots[gi] && pool.length; k++) {
        // 1º do músculo grande: multiarticular; depois mistura
        const cand = k === 0 && pool.some(([, m]) => m) && ![BI, TR, AB, PA, AD].includes(g) ? pool.filter(([, m]) => m) : pool
        const pick = pickWeighted(cand, ([n]) => (1 / (1 + pool.findIndex(([x]) => x === n) * 0.5)) * 0.3 ** (usedWeek.get(n) ?? 0), rand)!
        for (let j = pool.length - 1; j >= 0; j--) if (family(pool[j][0]) === family(pick[0])) pool.splice(j, 1)
        families.add(family(pick[0]))
        usedWeek.set(pick[0], (usedWeek.get(pick[0]) ?? 0) + 1)
        chosen.push(pick)
      }
      chosen.sort((a, b) => Number(b[1]) - Number(a[1]))
      for (const [name, multi] of chosen) {
        const sc = scheme(multi, exercises.length === 0)
        exercises.push({ names: [name], sets: sc.sets, warmup: exercises.length === 0 ? 1 : 0, reps: sc.reps, notes: [], changes: [] })
      }
    })
    const emphasisScore = exercises.reduce((a, e) => a + (inp.enfases.some((g) => FIRST_WEEK_POOLS[g]?.some(([n]) => n === e.names[0])) ? e.sets : 0), 0)
    return { label: `Treino ${labels[ti]}`, exercises, emphasisScore }
  })
  return orderByEmphasis(week, inp.enfases)
}

/** Confere se os nomes das listas existem no banco de exercícios (contagem muscular certa). */
export function unknownPoolNames(): string[] {
  const keys = new Set(SEED_PROFILES.flatMap((p) => [p.key, ...p.aliases.map(normalizeKey)]))
  return Object.values(FIRST_WEEK_POOLS).flat().map(([n]) => n).filter((n) => !keys.has(normalizeKey(n)))
}
