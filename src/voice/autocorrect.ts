/**
 * Autocorreção da transcrição de voz com vocabulário de musculação.
 * Duas camadas, aplicadas ANTES de estruturar os cards:
 *  1. Regras de confusões comuns de fala na academia (com contexto: grupamentos ativos
 *     e palavras vizinhas — ex.: "subindo reto" → "supino reto").
 *  2. Semelhança fonética (pt-BR) com o cache de exercícios, priorizando os grupamentos ativos.
 */
import type { ExerciseProfile } from '../domain/types'

export interface Correction {
  from: string
  to: string
}

export interface AutocorrectContext {
  activeGroups: string[]
  cache: ExerciseProfile[]
}

const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Chave fonética simplificada para o português falado. */
export function phonetic(s: string): string {
  return strip(s)
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/ph/g, 'f')
    .replace(/ch|sh/g, 'x')
    .replace(/lh/g, 'li')
    .replace(/nh/g, 'ni')
    .replace(/qu/g, 'k')
    .replace(/c(?=[aou]|$|\s)/g, 'k')
    .replace(/c(?=[ei])/g, 's')
    .replace(/z/g, 's')
    .replace(/y/g, 'i')
    .replace(/w/g, 'u')
    .replace(/h/g, '')
    .replace(/(.)\1+/g, '$1')
    .replace(/e\b/g, 'i')
    .replace(/o\b/g, 'u')
    .trim()
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  const dp = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return dp[n]
}

const similarity = (a: string, b: string) => 1 - levenshtein(a, b) / Math.max(a.length, b.length, 1)

interface Rule {
  re: RegExp // aplicado sobre o texto em minúsculas (com acentos)
  to: string
  /** grupamento que, se ativo, libera a troca mesmo sem palavra de contexto */
  group?: string
  /** palavras logo depois que confirmam a troca */
  next?: RegExp
  /** troca sempre (confusão sem outro significado na academia) */
  always?: boolean
}

const PEITO_NEXT = /^\s+(reto|inclinado|declinado|halter|halteres|m[aá]quina|barra|articulado|smith|com)/
const COSTAS_NEXT = /^\s+(frente|costas|tri[aâ]ngulo|neutr|supinad|pronad|alta|unilateral)/

const RULES: Rule[] = [
  { re: /\b(subindo|subino|supina|sopino|supinho|suspino|super no)\b/g, to: 'supino', group: 'Peito', next: PEITO_NEXT },
  { re: /\b(pulei|pule|puley|pulli|pula|pullei|pole|polei)\b/g, to: 'pulley', group: 'Costas', next: COSTAS_NEXT },
  { re: /\bpuxada\b/g, to: 'pulley', always: true },
  { re: /\bagachando\b/g, to: 'agachamento', always: true },
  { re: /\btrem\b(?=\s+[a-e]\b|\s+(de|do|da)\b|$)/g, to: 'treino', always: true },
  { re: /\b(legue|légue|lege|lég|legi|lag|lego)\b(?=\s*(press|prés|45|quarenta|horizontal|\d))/g, to: 'leg', always: true },
  { re: /\b(legue|légue|lege|legi)\b/g, to: 'leg', group: 'Perna - Quadríceps' },
  { re: /\bleg\s+(pres|prés|prece|presse)\b/g, to: 'leg press', always: true },
  { re: /\b(extensor|extenso|estensora|extensoras|ex tensora|tensora)\b/g, to: 'extensora', always: true },
  { re: /\b(flexor|flexo|reflexora|flexoras|fléxora|flexura)\b/g, to: 'flexora', always: true },
  { re: /\b(raque|haque|réqui|hacky|hak|rack|reck)\b/g, to: 'hack', group: 'Perna - Quadríceps' },
  { re: /\b(estife|estiff|stif|stiffi|estif|istife)\b/g, to: 'stiff', always: true },
  { re: /\b(crossover|crosso ver|cross ouver|crós over|cros over)\b/g, to: 'cross over', always: true },
  { re: /\b(pec deck|peck dec|peque deque|pek dek|pequi deque)\b/g, to: 'peck deck', always: true },
  { re: /\b(tr[ií]cepis|tr[ií]ceps|triceps|tríceis)\b/g, to: 'tríceps', always: true },
  { re: /\b(b[ií]cepis|b[ií]ceps|biceps)\b/g, to: 'bíceps', always: true },
  { re: /\bdesenvolvimentos\b/g, to: 'desenvolvimento', always: true },
  { re: /\b(abdutor|abidutora)\b/g, to: 'abdutora', always: true },
  { re: /\b(remadas)\b/g, to: 'remada', always: true },
  { re: /\b(hip trust|ripi trust|rip thrust)\b/g, to: 'hip thrust', always: true },
]

function applyRules(text: string, ctx: AutocorrectContext, changes: Correction[]): string {
  let out = text
  for (const r of RULES) {
    out = out.replace(r.re, (m: string, ...args: unknown[]) => {
      const offset = args[args.length - 2] as number
      const whole = args[args.length - 1] as string
      const after = whole.slice(offset + m.length)
      const ok = r.always || (r.next && r.next.test(after)) || (r.group && ctx.activeGroups.includes(r.group))
      if (!ok || strip(m) === strip(r.to)) return m
      changes.push({ from: m, to: r.to })
      return r.to
    })
  }
  return out
}

// limite do "nome do exercício" dentro de um trecho ditado
const DETAIL = /\s(\d|quatro|tr[eê]s|duas?|dois|cinco|seis|s[eé]ries?|com\b|de\b|x\b|aquec|drop)/i

function fuzzyNames(text: string, ctx: AutocorrectContext, changes: Correction[]): string {
  if (!ctx.cache.length) return text
  const entries = ctx.cache.flatMap((p) => [p.name, ...p.aliases].map((n) => ({ p, text: n, key: phonetic(n), words: n.split(/\s+/).length })))
  return text
    .split(/([,;.\n]|\bdepois\b|\bpr[oó]ximo\b)/i)
    .map((seg) => {
      if (/^[,;.\n]$/.test(seg) || /^(depois|pr[oó]ximo)$/i.test(seg)) return seg
      const lead = seg.match(/^\s*/)![0]
      const body = seg.slice(lead.length)
      const cut = body.search(DETAIL)
      const name = (cut >= 0 ? body.slice(0, cut) : body).trim()
      if (name.length < 4) return seg
      const words = name.split(/\s+/)
      // tenta da janela mais longa para a mais curta, sempre a partir do início do nome
      for (let n = Math.min(words.length, 3); n >= 1; n--) {
        const win = words.slice(0, n).join(' ')
        const k = phonetic(win)
        if (k.length < 4) continue
        const whole = n === words.length
        let best: { p: ExerciseProfile; text: string; exact: boolean; s: number } | null = null
        for (const e of entries) {
          if (Math.abs(e.words - n) > 1) continue
          if (!whole && e.words !== n) continue // prefixo: só troca palavra por palavra equivalente
          const exact = e.key === k
          const s = (exact ? 1 : similarity(k, e.key)) + (ctx.activeGroups.includes(e.p.muscle_group) ? 0.07 : 0)
          if (!best || s > best.s) best = { p: e.p, text: e.text, exact, s }
        }
        if (best && best.s >= 0.84) {
          // nome inteiro → nome padrão do cache; prefixo (ex.: "supino" em "supino máquina") → só corrige a grafia
          if (!whole && best.exact) return seg
          const to = whole ? best.p.name : best.text
          if (strip(win) === strip(to)) return seg
          changes.push({ from: win, to })
          let rest = body.slice(body.indexOf(win) + win.length)
          // "leg press 45" → "Leg45": não repetir o número que já está no nome padrão
          const tail = to.match(/(\d+)$/)
          if (tail) rest = rest.replace(new RegExp(`^\\s*${tail[1]}\\b`), '')
          return lead + to + rest
        }
      }
      return seg
    })
    .join('')
}

/** Horários que o reconhecimento de voz cria a partir de faixas de repetição: "8:10" → "8 a 10". */
const TIME_AS_RANGE: Record<string, string> = { '17:12': '10 a 12' } // casos vistos no ditado
/** "4shared 10", "4 share de 10", "4 cheries": o reconhecimento de voz troca "séries" por palavras parecidas. */
function fixSeriesWord(text: string, changes: Correction[]): string {
  return text.replace(/\b(\d{1,2})\s*(shared?s?|shares|cheri(?:es|e)?|xer(?:ies|is)?|ceri(?:es|e)?|series?|seriez|sherry)\b/gi, (m, n: string, w: string) => {
    if (/^s[eé]ries?$/i.test(w)) return m
    const to = `${n} séries de`
    changes.push({ from: m, to: `${n} séries` })
    return to
  }).replace(/séries de\s+de\b/g, 'séries de')
}

function fixTimesAsReps(text: string, changes: Correction[]): string {
  return text.replace(/\b(\d{1,2}):(\d{2})\b/g, (m, a: string, b: string) => {
    const lo = Number(a), hi = Number(b)
    const to = TIME_AS_RANGE[m] ?? (lo > 0 && lo < hi && hi <= 30 ? `${lo} a ${hi}` : null)
    if (!to) return m
    changes.push({ from: m, to })
    return to
  })
}

export function autocorrect(text: string, ctx: AutocorrectContext): { text: string; changes: Correction[] } {
  const changes: Correction[] = []
  let out = applyRules(fixTimesAsReps(fixSeriesWord(text.toLowerCase(), changes), changes), ctx, changes)
  out = fuzzyNames(out, ctx, changes)
  return { text: out.replace(/\s+/g, ' ').replace(/\s+([,;.])/g, '$1').trim(), changes }
}
