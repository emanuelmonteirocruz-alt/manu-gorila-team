import { describe, expect, it } from 'vitest'
import { parseNutritionText } from '../nutrition/extract'

describe('leitura da avaliação do nutricionista', () => {
  it('encontra peso, kcal, fase, proteína e gordura', () => {
    const t = `AVALIAÇÃO NUTRICIONAL\nPaciente: Fulana\nPeso atual: 68,4 kg  Altura 1,65\nPercentual de gordura: 27,5%\nObjetivo: emagrecimento com déficit calórico\nValor energético total (VET): 1.650 kcal/dia\nProteínas: 120 g  Carboidratos 160 g`
    expect(parseNutritionText(t)).toEqual({ weight_kg: 68.4, kcal: 1650, phase: 'deficit', protein_g: 120, body_fat: 27.5 })
  })
  it('manutenção e superávit', () => {
    expect(parseNutritionText('Plano de manutenção - 2200 kcal').phase).toBe('manutencao')
    expect(parseNutritionText('Fase de bulking (superávit) 3.100 kcal').kcal).toBe(3100)
    expect(parseNutritionText('Fase de bulking (superávit) 3.100 kcal').phase).toBe('superavit')
  })
  it('não inventa valor quando não acha', () => {
    expect(parseNutritionText('Cardápio: café da manhã, almoço, jantar')).toEqual({ weight_kg: null, kcal: null, phase: null, protein_g: null, body_fat: null })
  })
})
