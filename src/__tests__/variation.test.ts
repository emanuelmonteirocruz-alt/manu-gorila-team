import { expect, test } from 'vitest'
import { generateWeek, weekToWhatsApp } from '../consultoria/generator'
import { parsePlainTrainings } from '../parser/whatsapp'
import { SEED_PROFILES, normalizeKey } from '../engine/exerciseSeed'
import type { Session } from '../domain/types'

const byKey = new Map(SEED_PROFILES.map((p) => [p.key, p]))
const byAlias = new Map(SEED_PROFILES.flatMap((p) => p.aliases.map((a) => [a, p] as const)))
const lookup = (k: string) => byKey.get(k) ?? byKey.get(normalizeKey(k)) ?? byAlias.get(normalizeKey(k))
const TXT = `Treino A\nAgachamento livre\n4x10\n\nLeg press\n4x12\n\nCadeira extensora\n3x15\n\nMesa flexora\n4x12\n\nAbdutora\n4x15\n\nTreino B\nSupino reto\n4x10\n\nRemada baixa\n4x10\n\nDesenvolvimento com halteres\n4x10\n\nTríceps corda\n4x12`
const base = parsePlainTrainings(TXT, '2026-11-23').map((t, i) => ({
  id: 's' + i, student_id: 'x', date: '2026-11-23', label: t.label, source: 'whatsapp', muscle_groups: [], created_at: '', updated_at: '',
  exercises: t.exercises.map((e, j) => ({ id: `e${i}${j}`, position: j, exercise_key: lookup(e.names[0])?.key ?? normalizeKey(e.names[0]), display_name: e.names[0], valid_sets: e.validSets, warmup_sets: 0, heavy_sets: 0, reps: e.reps, drop_set: false })),
})) as unknown as Session[]

test('semana nova troca exercícios, começa por outro músculo e muda o foco', () => {
  const week = generateWeek({ base, phase: 'ordinaria', intensity: 1, enfases: [], lookup, seed: 11 })
  const a = week.find((t) => t.label === 'Treino A')!
  const oldNames = base[0].exercises.map((e) => e.display_name)
  const swapped = a.exercises.filter((e) => !oldNames.includes(e.names[0])).length
  expect(swapped).toBeGreaterThanOrEqual(4)
  expect(lookup(a.exercises[0].names[0])?.muscle_group).not.toBe('Perna - Quadríceps')
  console.log('\n----- ANTES -----\n' + TXT + '\n\n----- DEPOIS -----\n' + weekToWhatsApp(week))
  console.log('\n----- O QUE MUDOU (A) -----\n' + a.exercises.flatMap((e) => e.changes).join('\n'))
})
