/**
 * VARIÁVEIS DE TREINAMENTO DO CHOQUE — para o choque não virar receita.
 *
 * Em vez de "primeiro exercício = drop, segundo = pirâmide", cada semana de choque sorteia
 * QUAIS exercícios recebem estímulo novo e QUAL variável cada um recebe, respeitando:
 *  - o tipo do exercício (multiarticular livre aceita cluster/força/pirâmide; máquina e isolado aceitam drop/rest-pause/parciais…);
 *  - o que o aluno já fez nesse exercício nas semanas anteriores (variável repetida perde peso);
 *  - sem repetir a mesma variável no mesmo treino, e espalhando pela semana;
 *  - iniciante só recebe as variáveis mais simples (excêntrica, isometria, carga, série a mais).
 * Objetivo: hipertrofia, massa magra e força, com estímulo diferente de uma semana para outra.
 */
import type { ExerciseProfile, RepRange, Session } from '../domain/types'
import { techniquesOf } from '../engine/effortGuide'

export interface VarState { sets: number; reps: RepRange[]; notes: string[] }
export interface VarContext { profile?: ExerciseProfile; isEmph: boolean; isLast: boolean; pyramid: boolean; beginner: boolean }

export interface ShockVariable {
  id: string
  change: string // como aparece em "O que mudou"
  weight: number
  beginner?: boolean // liberada para iniciante
  suits: (c: VarContext, s: VarState) => boolean
  apply: (s: VarState) => VarState
}

const multi = (c: VarContext) => c.profile?.mechanic === 'multiarticular'
const machineOrIso = (c: VarContext) => c.profile?.implement === 'maquina_cabo' || c.profile?.mechanic === 'monoarticular'
const same = (n: number, min: number, max = min): RepRange[] => Array.from({ length: n }, () => ({ min, max }))
const avgReps = (s: VarState) => s.reps.reduce((a, r) => a + (r.min + (r.max || r.min)) / 2, 0) / Math.max(1, s.reps.length)

export const SHOCK_VARIABLES: ShockVariable[] = [
  { id: 'drop', change: 'drop set', weight: 3, suits: (c) => machineOrIso(c), apply: (s) => ({ ...s, notes: [...s.notes, 'Drop set na última'] }) },
  { id: 'restpause', change: 'rest-pause', weight: 3, suits: (c) => machineOrIso(c), apply: (s) => ({ ...s, notes: [...s.notes, 'Rest-pause na última'] }) },
  { id: 'cluster', change: 'cluster', weight: 2, suits: (c) => multi(c), apply: (s) => ({ ...s, reps: same(s.sets, 6), notes: [...s.notes, 'Cluster na última série (pausas de 15 segundos)'] }) },
  { id: 'forca', change: 'carga alta (6 a 8 reps)', weight: 3, beginner: false, suits: (c, s) => multi(c) && avgReps(s) > 8, apply: (s) => ({ ...s, reps: same(s.sets, 6, 8), notes: [...s.notes, 'Carga alta, descanso de 2 minutos'] }) },
  { id: 'piramide', change: 'pirâmide de carga', weight: 2, suits: (c, s) => !c.pyramid && s.sets >= 3, apply: (s) => {
    const n = Math.max(4, s.sets)
    return { ...s, sets: n, reps: [12, 10, 8, 6, 6].slice(0, n).map((r) => ({ min: r, max: r })), notes: [...s.notes, 'Pirâmide: sobe a carga a cada série'] }
  } },
  { id: 'excentrica', change: 'excêntrica lenta', weight: 2, beginner: true, suits: () => true, apply: (s) => ({ ...s, notes: [...s.notes, 'Excêntrica de 4 segundos'] }) },
  { id: 'isometria', change: 'isometria no pico', weight: 2, beginner: true, suits: (c) => c.profile?.mechanic === 'monoarticular', apply: (s) => ({ ...s, notes: [...s.notes, 'Isometria de 2 segundos no pico'] }) },
  { id: 'parciais', change: 'parciais', weight: 1, suits: (c) => machineOrIso(c), apply: (s) => ({ ...s, notes: [...s.notes, 'Parciais no final da última série'] }) },
  { id: 'fst7', change: 'FST-7', weight: 1, suits: (c) => c.isEmph && c.isLast && c.profile?.mechanic === 'monoarticular', apply: (s) => ({ ...s, sets: 7, reps: same(7, 10, 12), notes: [...s.notes, 'FST-7 (descanso de 30 segundos)'] }) },
  { id: 'falha', change: 'última até a falha', weight: 2, beginner: false, suits: () => true, apply: (s) => ({ ...s, notes: [...s.notes, 'Última série até a falha'] }) },
  { id: 'volume', change: '+1 série', weight: 2, beginner: true, suits: (c, s) => s.sets < 5 && !c.pyramid, apply: (s) => ({ ...s, sets: s.sets + 1 }) },
]

/** Gerador pseudoaleatório com semente (o mesmo sorteio se repete nos testes). */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function pickWeighted<T>(items: T[], weight: (t: T) => number, rand: () => number): T | undefined {
  const ws = items.map((t) => Math.max(0, weight(t)))
  const total = ws.reduce((a, b) => a + b, 0)
  if (!total) return undefined
  let x = rand() * total
  for (let i = 0; i < items.length; i++) { x -= ws[i]; if (x <= 0) return items[i] }
  return items[items.length - 1]
}

/** Variáveis que o aluno já fez em cada exercício (histórico), para não repetir a mesma receita. */
export function usedVariables(history: Session[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>()
  for (const s of history) for (const e of s.exercises) {
    const ids = new Set(techniquesOf({ names: [e.display_name], reps: e.reps, notes: e.notes ?? undefined, dropSet: e.drop_set }))
    const n = e.notes ?? ''
    if (/carga alta|descanso de 2/i.test(n)) ids.add('forca')
    if (/parcia/i.test(n)) ids.add('parciais')
    if (/falha/i.test(n)) ids.add('falha')
    if (new Set(e.reps.map((r) => r.min)).size > 1) ids.add('piramide')
    if (!ids.size) continue
    const m = out.get(e.exercise_key) ?? new Map<string, number>()
    for (const id of ids) m.set(id, (m.get(id) ?? 0) + 1)
    out.set(e.exercise_key, m)
  }
  return out
}
