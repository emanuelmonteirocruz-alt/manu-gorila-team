import { describe, expect, it } from 'vitest'
import { challengeLevel, exerciseChallenge, repWeight } from '../engine/metrics'
import type { SessionExercise } from '../domain/types'

const ex = (sets: number, min: number, max = min, o: Partial<SessionExercise> = {}): SessionExercise => ({
  id: 'x', position: 0, exercise_key: 'k', display_name: 'Supino', valid_sets: sets, warmup_sets: 0, heavy_sets: 0,
  reps: Array.from({ length: sets }, () => ({ min, max })), drop_set: false, ...o,
})

describe('Nível do desafio', () => {
  it('peso por faixa de repetições: ≤6 = 3 · 7–10 = 2 · 11–15 = 1 · >15 = 0,5', () => {
    expect([repWeight({ min: 5, max: 5 }), repWeight({ min: 8, max: 8 }), repWeight({ min: 12, max: 12 }), repWeight({ min: 20, max: 20 })]).toEqual([3, 2, 1, 0.5])
    expect(repWeight({ min: 8, max: 12 })).toBe(2) // meio = 10
    expect(repWeight({ min: 0, max: 0, failure: true })).toBe(2) // Máx sem reps
  })
  it('métodos (drop, rest-pause, bi-set…) não somam pontos: só contam para o treinador', () => {
    expect(exerciseChallenge(ex(3, 12)).points).toBe(3)
    expect(exerciseChallenge(ex(3, 12, 12, { drop_set: true })).points).toBe(3)
    expect(exerciseChallenge(ex(3, 12, 12, { drop_set: true })).advanced).toBe(3)
    expect(exerciseChallenge(ex(3, 12, 12, { superset_group: 1 })).points).toBe(3)
    expect(exerciseChallenge(ex(3, 12, 12, { notes: 'Rest pause na última' })).advanced).toBe(3)
  })
  it('1ª semana = 100; mais séries, reps mais baixas ou técnicas sobem o nível', () => {
    const base = 30 // pontos por treino na 1ª semana
    expect(challengeLevel({ challengePoints: 120, sessions: 4 }, base)).toBe(100)
    expect(challengeLevel({ challengePoints: 150, sessions: 4 }, base)).toBe(125)
    expect(challengeLevel({ challengePoints: 100, sessions: 4 }, undefined)).toBeNull()
  })
})
