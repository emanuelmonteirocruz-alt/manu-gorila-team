/**
 * Áudio → dados estruturados (pós-transcrição).
 * Ex.: "extensora, quatro séries de 15 com 20 kg; leg press 45 com 200 kg"
 *      "supino máquina, quatro séries do máximo, começou com 20 de cada lado, foi para 30, 40, 50"
 * Cada exercício vira 1 entrada com a lista das séries executadas (carga e reps por série).
 */
export interface SpokenSet {
  kg: number | null // como ditada (por lado se perSide)
  repsMin: number | null
  repsMax: number | null
  failure: boolean // "do máximo / até a falha" → Máx
  heavy: boolean | null // null = automático pela faixa de reps; true/false = marcado
  warmup?: boolean // série de aquecimento (não conta como válida)
}

export interface SpokenEntry {
  name: string
  sets: number | null // total de séries citado
  repsMin: number | null
  repsMax: number | null
  loadKg: number | null // carga pico
  perSide: boolean // "de cada lado / por lado"
  failure: boolean
  series: SpokenSet[]
  warmup: boolean
  drop: boolean
  notes: string
  needsReview: boolean
}

const UNITS: Record<string, number> = {
  zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9,
  dez: 10, onze: 11, doze: 12, treze: 13, catorze: 14, quatorze: 14, quinze: 15, dezesseis: 16, dezessete: 17,
  dezoito: 18, dezenove: 19, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70,
  oitenta: 80, noventa: 90, cem: 100, cento: 100, duzentos: 200, trezentos: 300, quatrocentos: 400, quinhentos: 500,
}

const strip = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

/** "vinte e cinco" → 25, "cento e vinte" → 120, "duzentos" → 200. Mantém o resto do texto. */
export function wordsToNumbers(text: string): string {
  const tokens = strip(text).replace(/(\d),(\d)/g, '$1.$2').split(/(\s+|[,;.])/)
  const out: string[] = []
  let acc: number | null = null
  let pendingE = false
  const flush = () => {
    if (acc != null) out.push(` ${acc} `)
    if (pendingE) out.push(' e ')
    acc = null
    pendingE = false
  }
  for (const t of tokens) {
    if (t === '' || /^\s+$/.test(t)) {
      if (acc == null) out.push(t)
      continue
    }
    const isNum = t in UNITS && (acc == null || (t !== 'um' && t !== 'uma'))
    if (isNum) {
      const v = UNITS[t]
      if (acc == null) acc = v
      else if (pendingE && ((acc % 100 === 0 && v < 100) || (acc % 10 === 0 && acc >= 20 && acc < 100 && v < 10))) {
        acc += v // "vinte e cinco", "cento e vinte"
        pendingE = false
      } else {
        flush()
        acc = v
      }
      continue
    }
    if (t === 'e' && acc != null && !pendingE) {
      pendingE = true
      continue
    }
    flush()
    out.push(t)
  }
  flush()
  return out.join('').replace(/\s+/g, ' ').replace(/\s+([,;.])/g, '$1').trim()
}

// trechos que continuam o exercício anterior (detalhes, cargas da progressão)
const DETAIL_START = /^\s*(\d|series?\b|x\b|com\b|de\b|carga\b|repeti|reps?\b|aquec|drop|ate\b|a\b|e\b|progred|comec|foi\b|buscando|do maximo|cada\b|por lado|subi[ru]|para\b|na falha|maximo)/
const CONTINUE_WORDS = 'de|com|e|cada|por|carga|drop|aquec\\w*|amplitude|cadencia|lado|no|na|foi|progred\\w*|comec\\w*|buscando|ate|do|para|subi[ru]\\w*|depois|series?|x|reps?|repeticoes|maximo'
const FAILURE = /\b(do maximo|ate o maximo|ao maximo|ate a falha|na falha|falha|maximo de repeticoes|maximo)\b/
const HEAVY_WORDS = /\b(pesad[ao]s?|carga alta|serie pesada)\b/
const PER_SIDE = /\b(de cada lado|cada lado|por lado)\b/

export function parseSpoken(transcript: string): SpokenEntry[] {
  const norm = wordsToNumbers(transcript)
    // formato escrito: "4x15" → "4 series de 15"; "3x8-10" → "3 series de 8 a 10"
    .replace(/\b(\d{1,2})\s*[x×]\s*(\d{1,2})(?:\s*[-–]\s*(\d{1,2})|\s+a\s+(\d{1,2}))?\b/g, (_m, n, a, b, c) => ` ${n} series de ${a}${b || c ? ` a ${b || c}` : ''} `)
    .replace(/\b(depois|proximo|agora|em seguida)\b/g, ';')
    .replace(/\s*[.;]\s+|\s*;\s*/g, ';')
    // ditado corrido sem pausa: "... com 20 kg leg press ..." → novo exercício após a carga
    .replace(new RegExp(`(\\d+(?:\\.\\d+)?\\s*(?:kg|quilos?|kilos?))\\s+(?=[a-z])(?!(?:${CONTINUE_WORDS})\\b)`, 'g'), '$1;')

  // junta pedaços que são continuação (ex.: ", 30 de cada lado", "; foi para 40")
  const segments: string[] = []
  for (const c of norm.split(/[;,\n]+/)) {
    if (!c.trim()) continue
    if (segments.length && DETAIL_START.test(c)) segments[segments.length - 1] += ' ' + c.trim()
    else segments.push(c.trim())
  }

  return segments
    .map((seg): SpokenEntry => {
      const cut = seg.search(/\s(\d+\s*(?:series?|x|vezes)\b|com\s+\d|\d+(?:\.\d+)?\s*(?:kg|quilos?|kilos?)\b|\d+\s*(?:de cada lado|por lado|cada lado)|aquec|progred|comec|buscando|do maximo|ate a falha|na falha)/)
      const name = (cut >= 0 ? seg.slice(0, cut) : seg).replace(/\b(com|de)$/, '').trim()
      const detail = cut >= 0 ? seg.slice(cut) : ''

      // vários blocos no mesmo exercício: "2 séries de 20 de aquecimento com 50 kg e 3 séries de 8 com 90 kg"
      const starts = [...detail.matchAll(/(\d+)\s*(?:series?|x|vezes)\b/g)].map((m) => m.index!)
      const cuts = starts.length > 1 ? [0, ...starts.slice(1), detail.length] : [0, detail.length]
      const blocks = cuts.slice(0, -1).map((c, i) => parseBlock(detail.slice(c, cuts[i + 1]), seg))
      const series = blocks.flatMap((bl) => bl.series)
      const work = blocks.filter((bl) => !bl.warmup)
      const main = work[0] ?? blocks[0]
      const workLoads = series.filter((x) => !x.warmup).map((x) => x.kg).filter((k): k is number => k != null)
      const anyDeclared = blocks.some((bl) => bl.declared != null)
      return {
        name,
        sets: series.length || null,
        repsMin: main.rMin,
        repsMax: main.rMax,
        loadKg: workLoads.length ? Math.max(...workLoads) : null,
        perSide: PER_SIDE.test(seg),
        failure: FAILURE.test(seg),
        series,
        warmup: series.length > 0 && series.every((x) => x.warmup),
        drop: /drop/.test(seg),
        notes: '',
        needsReview: series.length === 0 || (!anyDeclared && main.loads.length < 2) || (main.rMin == null && !main.failure),
      }
    })
    .filter((e) => e.name.length > 1)
}

/** Um bloco de séries ("3 séries de 8 com 90 kg"); aquecimento vale só para o próprio bloco. */
function parseBlock(detail: string, seg: string) {
  // localiza o que é séries/reps no texto; os números que sobram são as cargas, na ordem ditada
  const spans: [number, number][] = []
  const find = (re: RegExp) => {
    const m = detail.match(re)
    if (m) spans.push([m.index!, m.index! + m[0].length])
    return m
  }
  const setsM = find(/(\d+)\s*(?:series?|x|vezes)\b/)
  const targetM = find(/buscando\s*(\d+)/) ?? find(/para\s*(\d+)\s*(?:repeticoes|reps?)\b/)
  find(/(\d+)\s*(?:repeticoes|reps?)\b/) // "10 repetições" junto do "buscando"
  // "séries de 8 a 10" (mas "séries de 20 kg" é carga)
  const repsM =
    find(/(?:series?|x)\s*(?:de\s*)?(\d+)(?:\s*(?:a|ate)\s*(\d+))?\b(?!\s*(?:kg|quilos?|kilos?|de cada lado|por lado|cada lado))/) ??
    find(/(\d+)(?:\s*(?:a|ate)\s*(\d+))?\s*(?:repeticoes|reps?)\b/)
  let masked = detail
  for (const [i, j] of spans) masked = masked.slice(0, i) + ' '.repeat(j - i) + masked.slice(j)
  const loads = [...masked.matchAll(/(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1])).filter((n) => n > 0 && n <= 500)

  const warmup = /aquec|adaptacao/.test(detail) || (/aquec|adaptacao/.test(seg) && !/\d+\s*(?:series?|x|vezes)\b[^]*\d+\s*(?:series?|x|vezes)\b/.test(seg))
  const failure = FAILURE.test(detail) || (FAILURE.test(seg) && !warmup)
  const declared = setsM ? Number(setsM[1]) : null
  const target = targetM ? Number(targetM[1]) : null
  const rMin = target ?? (repsM ? Number(repsM[1]) : null)
  const rMax = target ?? (repsM ? Number(repsM[2] ?? repsM[1]) : null)
  const n = Math.max(declared ?? 0, loads.length)
  const series: SpokenSet[] = Array.from({ length: n }, (_, i) => ({
    // faltando cargas ("5 séries progredindo 20, 30, 40, 50"): repete a última carga dita
    kg: loads.length ? loads[Math.min(i, loads.length - 1)] : null,
    repsMin: rMin,
    repsMax: rMax,
    failure: failure && target == null && rMin == null,
    heavy: warmup ? false : HEAVY_WORDS.test(detail) || HEAVY_WORDS.test(seg) ? true : null,
    warmup,
  }))
  return { declared, rMin, rMax, loads, failure, warmup, series }
}
