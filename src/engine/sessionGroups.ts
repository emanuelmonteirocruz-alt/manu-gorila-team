/**
 * Grupamentos do treino presencial detectados pelos exercícios registrados.
 * Usa só o músculo PRINCIPAL de cada exercício (supino = Peito, nunca "só tríceps"); os auxiliares
 * contam no gráfico de foco, não aqui. Ordem: mais séries primeiro. Sem rótulos como upper/lower/full body:
 * só a lista do que foi treinado (menos chance de erro).
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
