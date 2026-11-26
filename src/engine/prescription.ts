/**
 * Parser de linhas de prescrição no padrão do treinador.
 * Implementa as regras de contagem do Módulo 2:
 *  - Só séries de trabalho válidas (aquecimento/adaptação excluídas)
 *  - Bi-set: séries contadas para CADA exercício
 *  - Drop-set: série principal conta normalmente
 *  - Séries pesadas: faixas 6–8, 8 e 8–10
 */
import type { RepRange } from '../domain/types'

export interface ParsedExerciseLine {
  names: string[] // >1 => bi-set / conjugado
  validSets: number
  warmupSets: number
  reps: RepRange[] // por série válida
  heavySets: number
  dropSet: boolean
  loadKg: number | null
  notes: string
}

const NUM_WORDS: Record<string, number> = {
  uma: 1, um: 1, primeira: 1, duas: 2, dois: 2, tres: 3, três: 3, quatro: 4, cinco: 5,
}

const WARMUP_RE = /aquec|adapta[cç][aã]o|neuromuscular|ativa[cç][aã]o/i

/** Faixa pesada: 6–8, 8, 8–10 (e variações dentro de 6..10 começando em ≤8). */
export function isHeavy(r: RepRange): boolean {
  if (r.heavy !== undefined) return r.heavy // o treinador marcou
  if (r.failure) return false // "Máx" sem faixa definida não entra como pesada
  return r.min >= 6 && r.min <= 8 && r.max <= 10 && r.max >= r.min
}

function parseRange(txt: string): RepRange | null {
  // "8 a 12/15" -> 8..12 (o /15 é back-off/drop, não muda a faixa principal)
  const m = txt.match(/^\s*(\d{1,2})(?:\s*(?:a|-|–|até)\s*(\d{1,2}))?/i)
  if (!m) return null
  const min = Number(m[1])
  const max = m[2] ? Number(m[2]) : min
  return { min: Math.min(min, max), max: Math.max(min, max) }
}

// N x R  (ex.: 4x15, 3 x 8 a 10, 3x8-10, 4x falha)
const SET_SCHEME_RE = /(\d{1,2})\s*[xX×]\s*(\d{1,2}(?:\s*(?:a|-|–|até)\s*\d{1,2})?(?:\s*\/\s*\d{1,2})?|falha)/g
// Pirâmide: 15/15/12/10
const PYRAMID_RE = /\b(\d{1,2}(?:\s*\/\s*\d{1,2}){1,7})\b/

export function parsePrescriptionLine(raw: string): ParsedExerciseLine | null {
  const line = raw.replace(/\s+/g, ' ').trim()
  if (!line) return null

  const schemes = [...line.matchAll(SET_SCHEME_RE)]
  let namePart: string
  let validSets = 0
  let warmupSets = 0
  const reps: RepRange[] = []
  let notes = ''

  if (schemes.length > 0) {
    namePart = line.slice(0, schemes[0].index).trim()
    for (let i = 0; i < schemes.length; i++) {
      const s = schemes[i]
      const n = Number(s[1])
      const range = s[2].toLowerCase() === 'falha' ? { min: 12, max: 15 } : parseRange(s[2])!
      const segEnd = i + 1 < schemes.length ? schemes[i + 1].index! : line.length
      const tail = line.slice(s.index! + s[0].length, segEnd)
      // aquecimento é a palavra que acompanha o segmento (antes de "+" / ","), não a linha toda
      const ownTail = tail.split(/\+|,|;| e (?=\d)/)[0]
      if (WARMUP_RE.test(ownTail)) {
        warmupSets += n
      } else {
        validSets += n
        for (let k = 0; k < n; k++) reps.push(range)
      }
      if (i === schemes.length - 1) notes = tail.replace(/^[\s,;+-]+/, '').trim()
    }
  } else {
    const p = line.match(PYRAMID_RE)
    if (!p) return null
    namePart = line.slice(0, p.index).trim()
    const after = line.slice(p.index! + p[0].length).trim()
    const sets = p[1].split('/').map((x) => Number(x.trim()))
    // "Duas primeiras de 15 como aquecimento" / "1ª de aquecimento" / "primeira aquecimento"
    let wu = 0
    if (WARMUP_RE.test(after)) {
      const m = after.match(/(\d|uma|um|duas|dois|tr[eê]s|quatro)\s*(?:ª|a)?\s*primeir|primeir[ao]s?\s*(\d|uma|duas|dois|tr[eê]s)?|(\d)\s*ª/i)
      if (m) {
        const token = (m[1] || m[2] || m[3] || 'uma').toLowerCase()
        wu = Number(token) || NUM_WORDS[token] || 1
      } else wu = 1
    }
    sets.forEach((r, idx) => {
      if (idx < wu) warmupSets++
      else {
        validSets++
        reps.push({ min: r, max: r })
      }
    })
    notes = after
  }

  // "Supino 2x15 aquecimento" (palavra no nome inteiro => tudo aquecimento)
  if (WARMUP_RE.test(namePart)) {
    warmupSets += validSets
    validSets = 0
    reps.length = 0
    namePart = namePart.replace(/[-–(]?\s*(aquecimento|adapta[cç][aã]o( neuromuscular)?)\s*\)?/gi, '').trim()
  }

  const names = namePart
    .replace(/[:\-–]\s*$/, '')
    .split(/\s*\+\s*|\s+\/\/\s+|\s+bi-?set\s+com\s+/i)
    .map((n) => n.replace(/^[•*\-–\d.)\s]+/, '').trim())
    .filter(Boolean)
  if (names.length === 0) return null

  const loadM = line.match(/(\d+(?:[.,]\d+)?)\s*kg/i)
  return {
    names,
    validSets,
    warmupSets,
    reps,
    heavySets: reps.filter(isHeavy).length,
    dropSet: /drop/i.test(line),
    loadKg: loadM ? Number(loadM[1].replace(',', '.')) : null,
    notes,
  }
}

// linha só de esquema: "15/15/12/10", "4x8", "3 x 8 a 10", "2x15 aquecimento", "4x10/10"
const SCHEME_ONLY = /^\s*(\d{1,2}\s*[xX×]\s*(\d{1,2}|falha)|\d{1,2}(\s*\/\s*\d{1,2}){1,7}\b)/
const isSchemeOnly = (l: string) => SCHEME_ONLY.test(l)

/**
 * Faz o parse de um treino inteiro. Aceita os dois jeitos de escrever:
 *  - mesma linha:  "Leg45 4x8 Carga alta"
 *  - em blocos:    "Leg45 pes sumo" / "4x8" / "Amplitude maxima"   (linha em branco entre exercícios)
 * Linhas entre o nome e as séries ("Ou afundo", "(Ou maquina)", "Aquecimento sem carga") viram
 * observação — e "aquecimento" faz as séries daquele exercício contarem como aquecimento.
 */
export function parsePrescriptionBlock(text: string): { exercises: ParsedExerciseLine[]; ignored: string[] } {
  const exercises: ParsedExerciseLine[] = []
  const ignored: string[] = []
  const lines = text.split(/\n/).map((l) => l.trim())
  type Entry = { name?: string; full?: ParsedExerciseLine; qualifiers: string[]; schemes: string[]; notes: string[] }
  let cur: Entry | null = null

  const flush = () => {
    const e = cur
    cur = null
    if (!e) return
    if (e.full) {
      if (e.notes.length) e.full.notes = [e.full.notes, ...e.notes].filter(Boolean).join(' · ')
      exercises.push(e.full)
      return
    }
    if (!e.name || !e.schemes.length) {
      ignored.push(...[e.name, ...e.qualifiers, ...e.notes].filter((x): x is string => !!x))
      return
    }
    const warm = e.qualifiers.some((q) => WARMUP_RE.test(q))
    // cada linha de esquema é lida com o nome e os resultados são somados ("2x15" + "3 x 8 a 10")
    const parts = e.schemes
      .map((sch) => parsePrescriptionLine(`${e.name} ${sch}${warm && !WARMUP_RE.test(sch) ? ' aquecimento' : ''}`))
      .filter((x): x is ParsedExerciseLine => !!x)
    if (!parts.length) {
      ignored.push(e.name, ...e.schemes)
      return
    }
    const reps = parts.flatMap((x) => x.reps)
    exercises.push({
      names: parts[0].names,
      validSets: parts.reduce((a, x) => a + x.validSets, 0),
      warmupSets: parts.reduce((a, x) => a + x.warmupSets, 0),
      reps,
      heavySets: reps.filter(isHeavy).length,
      dropSet: parts.some((x) => x.dropSet),
      loadKg: parts.map((x) => x.loadKg).find((k) => k != null) ?? null,
      notes: [...e.qualifiers.filter((q) => !WARMUP_RE.test(q)), ...parts.map((x) => x.notes), ...e.notes].filter(Boolean).join(' · '),
    })
  }

  // próxima linha não vazia antes de uma linha em branco
  const nextLine = (i: number) => (lines[i + 1] ? lines[i + 1] : '')

  lines.forEach((l, i) => {
    if (!l) return flush() // linha em branco separa exercícios
    if (isSchemeOnly(l)) {
      if (cur && !cur.full) cur.schemes.push(l)
      else ignored.push(l)
      return
    }
    const p = parsePrescriptionLine(l)
    if (p && p.names.length && /[a-zà-ú]/i.test(p.names[0])) {
      flush()
      cur = { full: p, qualifiers: [], schemes: [], notes: [] }
      return
    }
    // linha de texto: nome, qualificador ou observação
    if (cur && (cur.full || cur.schemes.length)) {
      if (isSchemeOnly(nextLine(i))) {
        flush()
        cur = { name: l, qualifiers: [], schemes: [], notes: [] }
      } else cur.notes.push(l)
    } else if (cur) cur.qualifiers.push(l)
    else cur = { name: l, qualifiers: [], schemes: [], notes: [] }
  })
  flush()
  return { exercises, ignored }
}
