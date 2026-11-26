import { describe, expect, it } from 'vitest'
import { SEED_PROFILES, heuristicProfile, normalizeKey } from '../engine/exerciseSeed'
import { MUSCLE_GROUPS } from '../domain/types'
import { parseSpoken } from '../voice/spokenParser'
import { autocorrect } from '../voice/autocorrect'

const find = (n: string) => {
  const k = normalizeKey(n)
  return SEED_PROFILES.find((p) => p.key === k || p.aliases.includes(k))
}
const dictate = (t: string, groups: string[] = []) => parseSpoken(autocorrect(t, { activeGroups: groups, cache: SEED_PROFILES }).text)

describe('banco de exercícios', () => {
  it('é amplo, sem chaves repetidas e só com grupos do app', () => {
    expect(SEED_PROFILES.length).toBeGreaterThan(200)
    expect(new Set(SEED_PROFILES.map((p) => p.key)).size).toBe(SEED_PROFILES.length)
    for (const p of SEED_PROFILES) expect(MUSCLE_GROUPS as readonly string[]).toContain(p.muscle_group)
  })
  it('reconhece exercícios menos comuns pelo nome ou apelido', () => {
    const cases: [string, string][] = [
      ['paralela', 'Tríceps'], ['remada cavalinho', 'Costas'], ['puxada supinada', 'Costas'], ['graviton', 'Costas'],
      ['face pull', 'Ombro'], ['encolhimento', 'Ombro'], ['flexão de braço', 'Peito'], ['agachamento sumô', 'Perna - Quadríceps'],
      ['nórdico', 'Perna - Posterior'], ['panturrilha sentado', 'Panturrilha'], ['kettlebell swing', 'Glúteo'], ['adutora', 'Glúteo'],
      ['rosca bayesian', 'Bíceps'], ['tríceps coice', 'Tríceps'], ['elevação de pernas na barra', 'Abdômen'], ['hiperextensão lombar', 'Costas'],
    ]
    for (const [n, g] of cases) expect(find(n)?.muscle_group, n).toBe(g)
  })
  it('nome inédito ainda ganha um grupo razoável', () => {
    expect(heuristicProfile('mergulho entre bancos', []).muscle_group).toBe('Tríceps')
    expect(heuristicProfile('ponte unilateral com pausa', []).muscle_group).toBe('Glúteo')
    expect(heuristicProfile('crunch invertido', []).muscle_group).toBe('Abdômen')
  })
})

describe('ditado: peso corporal e métodos', () => {
  it('peso corporal / peso livre não entram no nome', () => {
    const [e] = dictate('paralela peso livre corporal 3x12')
    expect(find(e.name)?.name).toBe('Paralelas')
    expect(e.loadKg).toBeNull()
    expect(e.notes).toContain('Peso corporal')
    expect(e.series).toHaveLength(3)
  })
  it('pirâmide crescente com reps e cargas por série', () => {
    for (const t of ['supino reto pirâmide crescente 12 10 8 6 com 60 70 80 90', 'supino reto pirâmide crescente 4 séries 12 10 8 6 60 kg 70 kg 80 kg 90 kg']) {
      const [e] = dictate(t)
      expect(e.name).toBe('supino reto')
      expect(e.notes).toBe('Pirâmide crescente')
      expect(e.series.map((x) => [x.kg, x.repsMin])).toEqual([[60, 12], [70, 10], [80, 8], [90, 6]])
    }
  })
  it('pirâmide sem carga e outros métodos', () => {
    const [lp] = dictate('leg press pirâmide crescente 4 séries 15 12 10 8')
    expect(lp.series.map((x) => x.repsMin)).toEqual([15, 12, 10, 8])
    const [ag] = dictate('agachamento livre rest pause 3x8 100kg')
    expect(ag.name).toBe('agachamento livre')
    expect(ag.notes).toBe('Rest-pause')
    expect(ag.series.map((x) => x.kg)).toEqual([100, 100, 100])
  })
  it('"leg press 45" continua sendo o nome (o 45 não vira repetição)', () => {
    const [e] = dictate('leg press 45 4 séries de 12 com 200 kg')
    expect(e.series.map((x) => [x.kg, x.repsMin])).toEqual([[200, 12], [200, 12], [200, 12], [200, 12]])
  })
})

import { nextChangeAfter, nextWeekToPaste } from '../domain/plan'
describe('consultoria: semanas', () => {
  it('próxima semana a colar e próxima troca', () => {
    // quinta 26/11, última colada 23/11 (semanal) → próxima 30/11; troca no domingo 29/11
    expect(nextWeekToPaste('semanal', '2026-11-23', '2026-11-26')).toBe('2026-11-30')
    expect(nextChangeAfter('semanal', '2026-11-23')).toBe('2026-11-29')
    // quinzenal: bloco de 2 semanas
    expect(nextWeekToPaste('quinzenal', '2026-11-16', '2026-11-18')).toBe('2026-11-30')
    expect(nextChangeAfter('quinzenal', '2026-11-16')).toBe('2026-11-29')
    // sem treino há semanas: volta para a semana atual; no domingo, a que começa amanhã
    expect(nextWeekToPaste('semanal', '2026-10-05', '2026-11-26')).toBe('2026-11-23')
    expect(nextWeekToPaste('semanal', null, '2026-11-29')).toBe('2026-11-30')
  })
})
