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
  it('leg/agachamento/afundo contam meia série de glúteo; búlgaro e sumô contam glúteo inteiro', () => {
    expect(shares('Leg45')).toEqual({ 'Perna - Quadríceps': 1, 'Glúteo': 0.5, Adutores: 0.5 })
    expect(shares('Agachamento livre')).toEqual({ 'Perna - Quadríceps': 1, 'Glúteo': 0.5, Adutores: 0.5 })
    expect(shares('Leg45 pes sumo')).toEqual({ 'Perna - Quadríceps': 1, 'Glúteo': 1, Adutores: 0.75 })
    expect(shares('Agachamento sumo')).toEqual({ 'Perna - Quadríceps': 1, 'Glúteo': 1, Adutores: 0.75 })
    expect(shares('Búlgaro')).toEqual({ 'Perna - Quadríceps': 1, 'Glúteo': 1 })
    expect(shares('Afundo com carga')).toEqual({ 'Perna - Quadríceps': 1, 'Glúteo': 0.5 })
    expect(shares('Stiff')).toEqual({ 'Perna - Posterior': 1, 'Glúteo': 0.5 })
    expect(shares('Supino reto')).toEqual({ Peito: 1, 'Tríceps': 0.5, Ombro: 0.25 })
    expect(shares('Pulley frente')).toEqual({ Costas: 1, 'Bíceps': 0.3 })
    expect(find('Adutor').muscle_group).toBe('Adutores')
    expect(find('Banco adutor').muscle_group).toBe('Adutores')
    expect(find('Abdutora').muscle_group).toBe('Glúteo')
    expect(find('Voador').muscle_group).toBe('Peito')
    expect(find('Voador invertido').muscle_group).toBe('Ombro')
    expect(shares('Triceps pulley')).toEqual({ 'Tríceps': 1 })   // pulley de tríceps não ganha bíceps
    expect(shares('Abdutora')).toEqual({ 'Glúteo': 1 })
    // posterior só nos exercícios de posterior (flexoras, stiff): agachamento/leg/búlgaro/hip thrust não somam
    expect(shares('Elevação pélvica')).toEqual({ 'Glúteo': 1 })
    expect(shares('Agachamento livre')['Perna - Posterior']).toBeUndefined()
    expect(shares('Búlgaro')['Perna - Posterior']).toBeUndefined()
    expect(shares('Mesa flexora')).toEqual({ 'Perna - Posterior': 1 })
  })
})
