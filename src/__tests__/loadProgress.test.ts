import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { db, uid } from '../data/db'
import { bestSetOf, buildLoadProgress } from '../data/reportData'
import type { Session, SessionExercise, Student } from '../domain/types'

const ex = (key: string, sets: [number | null, number | null][], o: Partial<SessionExercise> = {}): SessionExercise => ({
  id: uid(), position: 0, exercise_key: key, display_name: key, valid_sets: sets.length, warmup_sets: 0, heavy_sets: 0,
  reps: sets.map(([, r]) => (r == null ? { min: 0, max: 0, failure: true } : { min: r, max: r })), loads: sets.map(([k]) => k),
  load_kg: Math.max(...sets.map(([k]) => k ?? 0)) || null, drop_set: false, ...o,
})
const st: Student = { id: 's1', trainer_id: 't', full_name: 'Pedro', sex: 'M', modality: 'presencial', hourly_rate_manual: false, payment_status: 'em_dia', archived: false, created_at: '2026-01-01', updated_at: '' }
const sess = (date: string, label: string, exercises: SessionExercise[]): Session => ({ id: uid(), student_id: 's1', date, label, source: 'presencial', muscle_groups: [], exercises, created_at: date + 'T10:00:00Z', updated_at: '' })

describe('progressão de carga', () => {
  it('melhor série ignora aquecimento (só séries válidas) e compara reps diferentes pela força estimada', () => {
    const b = bestSetOf(ex('supino', [[60, 12], [70, 10], [80, 6]]), '2026-11-02')!
    // 80×6 = 96 · 70×10 = 93,3 · 60×12 = 84 → melhor = 80×6
    expect([b.kg, b.reps]).toEqual([80, 6])
    expect(bestSetOf(ex('paralelas', [[null, 12]]), '2026-11-02')).toBeNull() // peso corporal fica de fora
  })

  it('semanal: compara com a vez anterior; mesma carga com mais reps conta como evolução', async () => {
    await db.sessions.bulkPut([
      sess('2026-11-09', 'Treino A', [ex('supino', [[60, 10], [60, 10]]), ex('agachamento', [[100, 8]]), ex('rosca', [[14, 12]])]),
      sess('2026-11-16', 'Treino A', [ex('supino', [[65, 10]]), ex('agachamento', [[100, 8]]), ex('rosca', [[14, 12]])]),
      sess('2026-11-23', 'Treino A', [ex('supino', [[70, 8]]), ex('agachamento', [[100, 10]]), ex('rosca', [[12, 12]]), ex('leg press', [[200, 12]])]),
    ])
    await db.students.put(st)
    const { rows } = await buildLoadProgress(st, 'semana', '2026-11-26')
    const by = Object.fromEntries(rows.map((r) => [r.key, r]))
    expect(by['supino'].status).toBe('up')            // 65×10 → 70×8
    expect(by['supino'].dKg).toBe(5)
    expect(by['agachamento'].status).toBe('up')       // 100×8 → 100×10
    expect(by['agachamento'].dReps).toBe(2)
    expect(by['rosca'].status).toBe('down')           // 14 → 12 kg
    expect(by['leg press'].status).toBe('new')
    expect(rows[rows.length - 1].status).toBe('new')  // ordem: subiram, mantiveram, caíram, 1ª vez
  })

  it('mensal: 4 semanas lado a lado, primeira → última', async () => {
    const { weeks, rows } = await buildLoadProgress(st, 'mes', '2026-11-26')
    expect(weeks).toEqual(['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23'])
    const supino = rows.find((r) => r.key === 'supino')!
    expect(supino.points.map((p) => p?.kg ?? null)).toEqual([null, 60, 65, 70])
    expect(supino.dKg).toBe(10)
  })
})
