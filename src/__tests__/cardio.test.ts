import { describe, expect, it } from 'vitest'
import { cardioKcal, cardioMet } from '../engine/cardio'

describe('cardio por MET', () => {
  it('esteira com km usa a equação do ACSM (caminhada × corrida, inclinação)', () => {
    // 5 km em 60 min = 5 km/h caminhada plana: VO2 = 3,5 + 0,1·83,3 = 11,8 → 3,4 MET
    expect(cardioMet({ kind: 'esteira', minutes: 60, km: 5 }).met).toBeCloseTo(3.4, 1)
    // mesma caminhada com 10% de inclinação: + 1,8·83,3·0,1 = +15 → 7,7 MET
    expect(cardioMet({ kind: 'esteira', minutes: 60, km: 5, incline: 10 }).met).toBeCloseTo(7.7, 1)
    // 10 km/h corrida: VO2 = 3,5 + 0,2·166,7 = 36,8 → 10,5 MET
    expect(cardioMet({ kind: 'esteira', minutes: 30, km: 5 }).met).toBeCloseTo(10.5, 1)
  })
  it('kcal = MET × peso × horas', () => {
    expect(cardioKcal({ kind: 'bicicleta', minutes: 30, intensity: 'moderada' }, 70)).toBe(Math.round(6.8 * 70 * 0.5))
    expect(cardioKcal({ kind: 'escada', minutes: 20, intensity: 'moderada' }, 60)).toBe(Math.round(9 * 60 * (20 / 60)))
  })
  it('bicicleta com km usa a velocidade; sem km, a intensidade', () => {
    expect(cardioMet({ kind: 'bicicleta', minutes: 60, km: 20 }).met).toBe(8.0)
    expect(cardioMet({ kind: 'bicicleta', minutes: 60, intensity: 'leve' }).met).toBe(4.8)
  })
})
