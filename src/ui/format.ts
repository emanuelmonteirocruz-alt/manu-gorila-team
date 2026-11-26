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
