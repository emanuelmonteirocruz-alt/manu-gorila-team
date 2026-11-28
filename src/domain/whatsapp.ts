/**
 * Número do WhatsApp do aluno → formato do link wa.me (só dígitos, com código do país).
 * Aceita como foi digitado: "(11) 98765-4321", "11987654321", "+55 11 98765-4321", "0 11 98765-4321",
 * "011 98765 4321" e número de fora com "+" ("+351 912 345 678").
 * Devolve '' quando não dá para montar um número válido (ex.: sem DDD) — aí o WhatsApp abre para escolher a conversa.
 */
export function waNumber(phone: string | null | undefined): string {
  const raw = (phone ?? '').trim()
  if (!raw) return ''
  let d = raw.replace(/\D/g, '')
  if (raw.startsWith('+') || raw.startsWith('00')) {
    d = d.replace(/^00/, '')
    return d.length >= 8 && d.length <= 15 ? d : ''
  }
  d = d.replace(/^0+/, '') // 0 da ligação interurbana (0 11…) ou código de operadora (0 15 11…)
  if (d.length === 12 || d.length === 13) {
    if (d.startsWith('55')) return d
    if (d.length === 13) d = d.slice(2) // operadora (15, 21, 41…) + DDD + número
    else return ''
  }
  if (d.length === 10 || d.length === 11) return '55' + d
  return '' // sem DDD ou número incompleto
}

/** Explica o problema do número, ou null se está ok (para avisar na ficha). */
export function waProblem(phone: string | null | undefined): string | null {
  if (!(phone ?? '').trim()) return null
  return waNumber(phone) ? null : 'Número incompleto: coloque o DDD (ex.: 11 98765-4321). Número de outro país: comece com + e o código do país.'
}

/** Link que abre a conversa do aluno já com o texto escrito. */
export function waLink(phone: string | null | undefined, text?: string): string {
  return `https://wa.me/${waNumber(phone)}${text ? `?text=${encodeURIComponent(text)}` : ''}`
}
