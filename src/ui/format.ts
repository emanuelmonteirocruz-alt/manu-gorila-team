import type { RepRange } from '../domain/types'
import { fmtNum } from '../engine/metrics'
/** "rafa da silva" → "Rafa da Silva" (partículas em minúsculas). */
export function titleCase(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) => (i > 0 && /^(da|de|do|das|dos|e)$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
}

export const SOURCE_LABEL: Record<string, string> = { presencial: 'Presencial', whatsapp: 'WhatsApp', copiloto: 'Copiloto' }

const kgFmt = (k: number) => fmtNum(k, Number.isInteger(k) ? 0 : 1)
/** Série de maior carga (a referência para progredir): "30 kg de cada lado × 8". Empate na carga: a de mais reps. */
export function topSetText(loads: (number | null | undefined)[], reps: (RepRange | undefined)[], perSide: boolean): string {
  let best = -1
  let bestReps = -1
  loads.forEach((kg, i) => {
    if (kg == null) return
    const r = reps[i] ?? reps[reps.length - 1]
    const n = r ? (r.failure ? 99 : r.max || r.min) : 0
    if (kg > (best < 0 ? -1 : loads[best]!) || (kg === loads[best] && n > bestReps)) { best = i; bestReps = n }
  })
  if (best < 0) return '—'
  const r = reps[best] ?? reps[reps.length - 1]
  const rt = !r ? '' : r.failure ? 'Máx × ' : `${r.min === r.max ? r.min : `${r.min}-${r.max}`} × `
  return `${rt}${kgFmt(loads[best]!)} kg${perSide ? ' de cada lado' : ''}`
}
