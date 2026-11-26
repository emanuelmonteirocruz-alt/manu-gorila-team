/** Periodicidade da consultoria e prazos de troca de treino. */
import type { Student } from './types'
import { addDays, parseISODate, toISODate } from '../engine/metrics'

export type PlanPeriod = 'mensal' | 'quinzenal' | 'semanal'
export const PERIOD_LABEL: Record<PlanPeriod, string> = { mensal: 'Mensal', quinzenal: 'Quinzenal', semanal: 'Semanal' }
export const PERIOD_DAYS: Record<PlanPeriod, number> = { mensal: 30, quinzenal: 15, semanal: 7 }

/** Próxima troca sugerida a partir de uma data (padrão: hoje). */
export function suggestNextChange(period: PlanPeriod, from = toISODate(new Date())): string {
  return addDays(from, PERIOD_DAYS[period])
}

export type ChangeStatus = { level: 'vencido' | 'hoje' | 'proximo'; days: number; label: string }

/** Alerta de troca de treino (consultoria): vencido, hoje ou faltando até 2 dias. */
export function changeStatus(s: Pick<Student, 'modality' | 'next_change_date'>, today = toISODate(new Date())): ChangeStatus | null {
  if (s.modality !== 'online' || !s.next_change_date) return null
  const days = Math.round((parseISODate(s.next_change_date).getTime() - parseISODate(today).getTime()) / 86_400_000)
  if (days < 0) return { level: 'vencido', days, label: `atrasada ${-days} ${days === -1 ? 'dia' : 'dias'}` }
  if (days === 0) return { level: 'hoje', days, label: 'troca hoje' }
  if (days <= 2) return { level: 'proximo', days, label: days === 1 ? 'falta 1 dia' : `faltam ${days} dias` }
  return null
}
