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

// ---------- semanas da consultoria (o treino é montado no domingo para a semana seguinte) ----------
/** Quantas semanas cada treino cobre. */
export const PERIOD_WEEKS: Record<PlanPeriod, number> = { semanal: 1, quinzenal: 2, mensal: 4 }

const mondayOf = (iso: string) => {
  const d = parseISODate(iso)
  return addDays(iso, -((d.getDay() + 6) % 7))
}

/** Próxima troca depois de colar o treino que começa em `wk`: o domingo antes do próximo bloco. */
export function nextChangeAfter(period: PlanPeriod, wk: string): string {
  return addDays(mondayOf(wk), 7 * PERIOD_WEEKS[period] - 1)
}

/**
 * Semana do próximo treino a colar: a seguinte à última colada (conforme o plano),
 * nunca antes da semana atual (domingo já conta como a semana que vem).
 */
export function nextWeekToPaste(period: PlanPeriod | null | undefined, lastWk: string | null, today = toISODate(new Date())): string {
  const t = parseISODate(today)
  const current = t.getDay() === 0 ? addDays(today, 1) : mondayOf(today)
  if (!lastWk) return current
  const next = addDays(mondayOf(lastWk), 7 * PERIOD_WEEKS[period ?? 'semanal'])
  return next > current ? next : current
}

/** Últimas `n` semanas (segundas-feiras) até a semana de referência, mais antiga primeiro. */
export function recentWeeks(ref: string, n = 4): string[] {
  const wk = mondayOf(ref)
  return Array.from({ length: n }, (_, i) => addDays(wk, -7 * (n - 1 - i)))
}
