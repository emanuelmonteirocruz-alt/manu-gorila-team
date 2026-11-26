/**
 * CARDIO — gasto calórico por MET (equivalente metabólico).
 *   kcal = MET × peso (kg) × horas
 * Fontes:
 *  - Esteira (caminhada/corrida) com tempo e km: equações metabólicas do ACSM (Guidelines for Exercise Testing
 *    and Prescription): caminhada VO2 = 3,5 + 0,1·v + 1,8·v·inclinação; corrida VO2 = 3,5 + 0,2·v + 0,9·v·inclinação
 *    (v em m/min; MET = VO2 / 3,5). Abaixo de 7 km/h conta como caminhada.
 *  - Bicicleta, escada e elíptico: Compendium of Physical Activities (Ainsworth et al., 2011; atualização 2024):
 *    bicicleta ergométrica leve 4,8 · moderada 6,8 · intensa 8,8 MET; pela velocidade (km e tempo) 6,8 a 12 MET;
 *    escada (stair-treadmill) geral 9,0 MET; elíptico moderado 5,0 MET.
 *  - Sem km na esteira: caminhada leve 3,5 · caminhada rápida 5,0 · corrida 9,8 MET (Compendium).
 * É uma estimativa (o gasto real varia com condicionamento, técnica e máquina), boa para acompanhar a constância.
 */
export type CardioKind = 'esteira' | 'bicicleta' | 'escada' | 'eliptico'
export type CardioIntensity = 'leve' | 'moderada' | 'intensa'

export const CARDIO_KINDS: { id: CardioKind; label: string }[] = [
  { id: 'esteira', label: 'Esteira' },
  { id: 'bicicleta', label: 'Bicicleta' },
  { id: 'escada', label: 'Escada' },
  { id: 'eliptico', label: 'Elíptico' },
]
export const INTENSITY_LABEL: Record<CardioIntensity, string> = { leve: 'Leve', moderada: 'Moderada', intensa: 'Intensa' }

const FIXED: Record<Exclude<CardioKind, 'esteira'>, Record<CardioIntensity, number>> = {
  bicicleta: { leve: 4.8, moderada: 6.8, intensa: 8.8 },
  escada: { leve: 7.0, moderada: 9.0, intensa: 10.5 },
  eliptico: { leve: 4.0, moderada: 5.0, intensa: 7.5 },
}
const TREADMILL_NO_KM: Record<CardioIntensity, number> = { leve: 3.5, moderada: 5.0, intensa: 9.8 }

export interface CardioInput {
  kind: CardioKind
  minutes: number
  km?: number | null
  intensity?: CardioIntensity | null
  incline?: number | null // % (esteira)
}

/** MET da atividade (e de onde ele veio, para mostrar ao treinador). */
export function cardioMet(c: CardioInput): { met: number; how: string } {
  const it = c.intensity ?? 'moderada'
  const kmh = c.km && c.minutes ? c.km / (c.minutes / 60) : null
  if (c.kind === 'esteira') {
    if (kmh && kmh > 0) {
      const v = (kmh * 1000) / 60 // m/min
      const g = Math.max(0, (c.incline ?? 0) / 100)
      const run = kmh >= 7
      const vo2 = 3.5 + (run ? 0.2 : 0.1) * v + (run ? 0.9 : 1.8) * v * g
      return { met: Math.round((vo2 / 3.5) * 10) / 10, how: `${run ? 'corrida' : 'caminhada'} a ${kmh.toFixed(1).replace('.', ',')} km/h${g ? ` com ${c.incline}% de inclinação` : ''} (ACSM)` }
    }
    return { met: TREADMILL_NO_KM[it], how: `${it === 'intensa' ? 'corrida' : it === 'moderada' ? 'caminhada rápida' : 'caminhada leve'} (Compendium)` }
  }
  if (c.kind === 'bicicleta' && kmh && kmh > 0) {
    const met = kmh < 16 ? 4.0 : kmh < 19.3 ? 6.8 : kmh < 22.5 ? 8.0 : kmh < 25.7 ? 10.0 : kmh < 30.6 ? 12.0 : 15.8
    return { met, how: `bicicleta a ${kmh.toFixed(1).replace('.', ',')} km/h (Compendium)` }
  }
  return { met: FIXED[c.kind][it], how: `${CARDIO_KINDS.find((k) => k.id === c.kind)!.label.toLowerCase()} ${it} (Compendium)` }
}

/** Calorias: MET × peso × horas. */
export function cardioKcal(c: CardioInput, weightKg: number): number {
  return Math.round(cardioMet(c).met * weightKg * (c.minutes / 60))
}

export const DEFAULT_WEIGHT = 70
