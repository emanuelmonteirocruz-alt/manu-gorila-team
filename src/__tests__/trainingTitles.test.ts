import { expect, test } from 'vitest'
import { parsePlainTrainings } from '../parser/whatsapp'

// títulos de treino escritos de jeitos diferentes no WhatsApp: cada um deve separar A, B, C e D
const body = (t: string) => `${t}\nAgachamento livre\n4x10\n\nLeg press\n4x12\n\n`
const cases: Record<string, (l: string, n: number) => string> = {
  emoji: (l) => `🔥 TREINO ${l} 🔥`, hifen: (l) => `TREINO - ${l}`, doispontos: (l) => `Treino: ${l}`, seta: (l) => `*➡️ Treino ${l}*`,
  numemoji: (l) => `1️⃣ TREINO ${l}`, invisivel: (l) => `‎Treino ${l}`, zw: (l) => `​Treino ${l}`, travessao: (l) => `*TREINO ${l} — Peito*`,
  semana: (_l, n) => ['Segunda-feira', 'Terça', 'Quinta-feira', 'Sábado'][n], dia: (_l, n) => `DIA ${n + 1} - Pernas`, numero: (_l, n) => `TREINO 0${n + 1}`, ponto: (l) => `• Treino ${l}`,
}
test.each(Object.entries(cases))('título "%s" separa os 4 treinos', (_k, title) => {
  const txt = ['A', 'B', 'C', 'D'].map((l, n) => body(title(l, n))).join('')
  expect(parsePlainTrainings(txt, '2026-11-30').length).toBe(4)
})
test('linha de exercício não vira título', () => {
  expect(parsePlainTrainings('Treino A\n- Abdutora\n4x15\n\nTreinou bem? Elevação pélvica\n4x10', '2026-11-30').length).toBe(1)
})
