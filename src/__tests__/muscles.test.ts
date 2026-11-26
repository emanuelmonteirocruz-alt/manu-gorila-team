import { describe, expect, it } from 'vitest'
import { SEED_PROFILES, heuristicProfile, muscleShares, normalizeKey } from '../engine/exerciseSeed'

const find = (n: string) => { const k = normalizeKey(n); return SEED_PROFILES.find((p) => p.key === k || p.aliases.includes(k)) ?? heuristicProfile(n, []) }
const shares = (n: string) => { const p = find(n); return Object.fromEntries(muscleShares(`${n} ${p.name}`, p.muscle_group).map((x) => [x.group, x.share])) }

describe('músculos: classificação e séries fracionadas', () => {
  it('"cross" é equipamento, não peito: o movimento decide', () => {
    expect(find('Rosca direta cross').muscle_group).toBe('Bíceps')
    expect(find('Triceps testa cross').muscle_group).toBe('Tríceps')
    expect(find('Remada unilateral cross').muscle_group).toBe('Costas')
    expect(find('Cross over').muscle_group).toBe('Peito')
  })
  it('nomes do dia a dia que estavam sem grupo', () => {
    expect(find('Mesa flexor').muscle_group).toBe('Perna - Posterior')
    expect(find('Voador invertido').muscle_group).toBe('Ombro')
    expect(find('Búlgaro com carga').muscle_group).toBe('Perna - Quadríceps')
    expect(find('Banco extensor').muscle_group).toBe('Perna - Quadríceps')
  })
  it('leg/agachamento/búlgaro também contam glúteo; sumô conta mais', () => {
    expect(shares('Leg45')).toEqual({ 'Perna - Quadríceps': 1, 'Glúteo': 0.5 })
    expect(shares('Leg45 pes sumo')).toEqual({ 'Perna - Quadríceps': 1, 'Glúteo': 0.75 })
    expect(shares('Stiff')).toEqual({ 'Perna - Posterior': 1, 'Glúteo': 0.5 })
    expect(shares('Supino reto')).toEqual({ Peito: 1, 'Tríceps': 0.5, Ombro: 0.25 })
    expect(shares('Pulley frente')).toEqual({ Costas: 1, 'Bíceps': 0.5 })
    expect(shares('Triceps pulley')).toEqual({ 'Tríceps': 1 })   // pulley de tríceps não ganha bíceps
    expect(shares('Abdutora')).toEqual({ 'Glúteo': 1 })
  })
})
