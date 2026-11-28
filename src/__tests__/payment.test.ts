import { expect, test } from 'vitest'
import { dueOverdue, nextMonthSameDay, paidUpdate } from '../domain/plan'

test('mês seguinte', () => {
  expect(nextMonthSameDay('2026-11-10')).toBe('2026-12-10')
  expect(nextMonthSameDay('2026-12-15')).toBe('2027-01-15')
  expect(nextMonthSameDay('2027-01-31')).toBe('2027-02-28')
})
test('pagou', () => {
  expect(paidUpdate({ due_date: '2026-11-16' })).toEqual({ due_date: '2026-12-16', payment_status: 'em_dia' })
  expect(paidUpdate({ due_date: null, due_day: 5 }, '2026-11-28').due_date).toBe('2026-12-05')
})
test('vencido com status em dia', () => {
  expect(dueOverdue({ due_date: '2026-11-16', payment_status: 'em_dia' }, '2026-11-28')).toBe(true)
  expect(dueOverdue({ due_date: '2026-12-16', payment_status: 'em_dia' }, '2026-11-28')).toBe(false)
  expect(dueOverdue({ due_date: '2026-11-16', payment_status: 'atrasado' }, '2026-11-28')).toBe(false)
})
import { prevMonthSameDay } from '../domain/plan'
test('último pagamento ↔ vencimento', () => {
  expect(prevMonthSameDay('2026-12-04')).toBe('2026-11-04')
  expect(prevMonthSameDay('2027-01-10')).toBe('2026-12-10')
})
