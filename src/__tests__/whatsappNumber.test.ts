import { expect, test } from 'vitest'
import { waLink, waNumber } from '../domain/whatsapp'

test.each([
  ['(11) 98765-4321', '5511987654321'], ['11987654321', '5511987654321'], ['+55 11 98765-4321', '5511987654321'],
  ['55 11 98765-4321', '5511987654321'], ['0 11 98765-4321', '5511987654321'], ['011987654321', '5511987654321'],
  ['0 15 11 98765-4321', '5511987654321'], ['(31) 3333-4444', '553133334444'], ['+351 912 345 678', '351912345678'],
  ['98765-4321', ''], ['', ''], ['123', ''],
])('%s → %s', (inp, out) => expect(waNumber(inp)).toBe(out))

test('link com texto', () => expect(waLink('11 98765-4321', 'Oi, Ana!')).toBe('https://wa.me/5511987654321?text=Oi%2C%20Ana!'))

import { feedbackMsg } from '../ui/components/FollowUps'
import type { Student } from '../domain/types'
test('check-in muda com o plano', () => {
  const st = (p: Student['plan_period']) => ({ full_name: 'Rafa Souza', plan_period: p }) as Student
  expect(feedbackMsg(st('semanal'))).toContain('check-in da semana')
  expect(feedbackMsg(st('semanal'))).toContain('na próxima semana?')
  expect(feedbackMsg(st('quinzenal'))).toContain('check-in da quinzena')
  expect(feedbackMsg(st('quinzenal'))).toContain('nessas duas semanas?')
  expect(feedbackMsg(st('mensal'))).toContain('check-in do mês')
  expect(feedbackMsg(st('mensal'))).toContain('Oi, Rafa!')
})
