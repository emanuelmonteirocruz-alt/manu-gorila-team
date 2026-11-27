import { describe, expect, it } from 'vitest'
import { parseNutritionText } from '../nutrition/extract'

describe('leitura da avaliação do nutricionista (só dados corporais)', () => {
  it('encontra peso, altura, idade, % gordura e massa magra', () => {
    const t = `AVALIAÇÃO ANTROPOMÉTRICA\nPaciente: Fulana  Idade: 29 anos\nPeso atual: 68,4 kg  Altura: 1,65 m\nPerimetria: braço 28 cm, cintura 72 cm\nPercentual de gordura: 27,5%\nMassa magra: 49,6 kg`
    expect(parseNutritionText(t)).toEqual({ weight_kg: 68.4, height_m: 1.65, age: 29, body_fat: 27.5, lean_mass_kg: 49.6 })
  })
  it('altura em cm vira metros', () => {
    expect(parseNutritionText('Estatura 172 cm · Peso 80 kg').height_m).toBe(1.72)
  })
  it('não inventa valor quando não acha', () => {
    expect(parseNutritionText('Perimetria: braço 30 cm, coxa 55 cm')).toEqual({ weight_kg: null, height_m: null, age: null, body_fat: null, lean_mass_kg: null })
  })
})
