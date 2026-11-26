/**
 * Grupamentos do treino presencial detectados pelos exercícios registrados.
 * Usa só o músculo PRINCIPAL de cada exercício (supino = Peito, nunca "só tríceps"); os auxiliares
 * contam no gráfico de foco, não aqui. Ordem: mais séries primeiro. Assim o treinador não precisa
 * escolher os grupamentos antes de começar (full body, upper, lower… saem sozinhos).
 */
import type { ExerciseProfile, SessionExercise } from '../domain/types'

export function detectMuscleGroups(exercises: SessionExercise[], lookup: (key: string) => ExerciseProfile | undefined): string[] {
  const sets = new Map<string, number>()
  for (const e of exercises) {
    const g = lookup(e.exercise_key)?.muscle_group
    if (!g || g === 'Indefinido') continue
    sets.set(g, (sets.get(g) ?? 0) + Math.max(1, e.valid_sets))
  }
  return [...sets.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g)
}

/** Resumo curto para mostrar: "Upper", "Lower", "Full body" ou os próprios grupamentos. */
const LOWER = ['Perna - Quadríceps', 'Perna - Posterior', 'Glúteo', 'Adutores', 'Panturrilha']
export function splitName(groups: string[]): string | null {
  const real = groups.filter((g) => g !== 'Abdômen')
  if (real.length < 3) return null
  const lower = real.filter((g) => LOWER.includes(g)).length
  if (lower === real.length) return 'Lower'
  if (lower === 0) return 'Upper'
  return lower >= 2 && real.length - lower >= 2 ? 'Full body' : null
}
