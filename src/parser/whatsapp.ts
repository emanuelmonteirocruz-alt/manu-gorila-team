/**
 * Parser de blocos copiados do WhatsApp.
 * Formatos aceitos:
 *   iOS/desktop: [11/10, 21:44] Emanuel Monteiro: texto
 *                [11/10/2025, 21:44:03] Emanuel Monteiro: texto
 *   Android:     11/10/2025 21:44 - Emanuel Monteiro: texto
 * Cada marcação = um treino distinto (Treino A, B, C… reiniciando a cada semana).
 */
import { parsePrescriptionBlock, type ParsedExerciseLine } from '../engine/prescription'
import { toISODate, weekStart } from '../engine/metrics'

export interface WaMessage {
  date: string // YYYY-MM-DD
  time: string
  sender: string
  text: string
}

export interface ParsedTraining {
  date: string
  time: string
  week: string
  label: string
  rawText: string
  exercises: ParsedExerciseLine[]
  ignoredLines: string[]
}

export interface ParsedWeek {
  week: string
  trainings: ParsedTraining[]
}

const HEADER_IOS = /^‎?\[(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?,?\s+(\d{1,2}:\d{2})(?::\d{2})?\]\s*([^:]+?):\s?(.*)$/
// WhatsApp Web/desktop: [21:44, 08/11/2025] Nome: texto
const HEADER_TIME_FIRST = /^\u200e?\[(\d{1,2}:\d{2})(?::\d{2})?,?\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\]\s*([^:]+?):\s?(.*)$/
const HEADER_ANDROID = /^‎?(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}:\d{2})\s*-\s*([^:]+?):\s?(.*)$/

function resolveYear(day: number, month: number, y: string | undefined, ref: Date): number {
  if (y) return y.length === 2 ? 2000 + Number(y) : Number(y)
  // sem ano: ano atual, a não ser que caia mais de 7 dias no futuro (aí é do ano passado)
  const candidate = new Date(ref.getFullYear(), month - 1, day)
  return candidate.getTime() > ref.getTime() + 7 * 86400000 ? ref.getFullYear() - 1 : ref.getFullYear()
}

export function splitMessages(raw: string, ref = new Date()): WaMessage[] {
  const out: WaMessage[] = []
  let cur: WaMessage | null = null
  for (const line of raw.replace(/\r/g, '').split('\n')) {
    const tf = line.match(HEADER_TIME_FIRST)
    const m = tf ? [tf[0], tf[2], tf[3], tf[4], tf[1], tf[5], tf[6]] : line.match(HEADER_IOS) ?? line.match(HEADER_ANDROID)
    if (m) {
      const day = Number(m[1]), month = Number(m[2])
      const year = resolveYear(day, month, m[3], ref)
      cur = { date: toISODate(new Date(year, month - 1, day)), time: m[4], sender: m[5].trim(), text: m[6] ?? '' }
      out.push(cur)
    } else if (cur) {
      cur.text += '\n' + line
    }
  }
  return out
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

export interface ParseOptions {
  /** Só mensagens deste remetente viram treino (ex.: "Emanuel Monteiro"). Vazio = todos. */
  trainerName?: string
  ref?: Date
}

export function parseWhatsApp(raw: string, opts: ParseOptions = {}): ParsedWeek[] {
  return regroupByDate(parseWhatsAppTrainings(raw, opts))
}

/**
 * Lê as mensagens e devolve os treinos na ordem. Uma mensagem pode trazer VÁRIOS treinos
 * ("Treino A … Treino B …"): cada um vira um treino com a data da mensagem.
 * O filtro de remetente só é aplicado se ele bater com alguma mensagem de treino
 * (no WhatsApp o seu nome pode aparecer como "Você" ou outro apelido).
 */
export function parseWhatsAppTrainings(raw: string, opts: ParseOptions = {}): ParsedTraining[] {
  const msgs = splitMessages(raw, opts.ref)
  const trainer = opts.trainerName?.trim().toLowerCase()
  const isTrainer = (m: WaMessage) => !!trainer && m.sender.toLowerCase().includes(trainer)
  const useFilter = !!trainer && msgs.some((m) => isTrainer(m) && parsePrescriptionBlock(m.text).exercises.length > 0)
  const out: ParsedTraining[] = []
  const perBlock: Record<string, number> = {} // letra A, B, C… dentro de cada bloco (data da mensagem)
  for (const msg of msgs) {
    if (useFilter && !isTrainer(msg)) continue
    for (const text of splitTrainingBlocks(msg.text, false)) {
      const { exercises, ignored } = parsePrescriptionBlock(text)
      if (!exercises.length) continue // "Bom treino!", áudios, etc.
      const n = perBlock[msg.date] ?? 0
      perBlock[msg.date] = n + 1
      out.push({ date: msg.date, time: msg.time, week: weekStart(msg.date), label: `Treino ${LETTERS[n] ?? n + 1}`, rawText: text, exercises, ignoredLines: ignored })
    }
  }
  return out
}

// títulos de treino, inclusive em negrito do WhatsApp: *Treino A*, _Treino B_, TREINO C - Pernas
const TITLE = /^\s*[*_~]*\s*(treino\s+[a-z0-9]+|dia\s+\d+|[a-f]\s*[).:-])[*_~]*\s*[:\-–]?\s*/i

/** Separa um texto em treinos: por títulos; sem títulos, por 2 linhas em branco (só no texto livre). */
export function splitTrainingBlocks(raw: string, blankLineSplits: boolean): string[] {
  const blocks: { title?: string; lines: string[] }[] = []
  let cur: { title?: string; lines: string[] } = { lines: [] }
  const hasTitles = raw.split('\n').some((l) => TITLE.test(l) && !/\d+\s*x\s*\d+/i.test(l.match(TITLE)![0]))
  let blankRun = 0
  for (const line of raw.replace(/\r/g, '').split('\n')) {
    const t = line.match(TITLE)
    blankRun = line.trim() ? 0 : blankRun + 1
    if (t && !/\d+\s*x\s*\d+/i.test(t[0])) {
      if (cur.lines.some((l) => l.trim())) blocks.push(cur)
      cur = { title: t[1].trim(), lines: [line.slice(t[0].length)] }
    } else if (blankRun >= 2 && blankLineSplits && !hasTitles && cur.lines.some((l) => l.trim())) {
      // texto livre sem títulos: 2 linhas em branco separam treinos (1 linha em branco separa exercícios)
      blocks.push(cur)
      cur = { lines: [] }
    } else cur.lines.push(line)
  }
  if (cur.lines.some((l) => l.trim())) blocks.push(cur)
  return blocks.map((b) => b.lines.join('\n').trim())
}

/** Texto sem cabeçalho do WhatsApp ([data, hora] Remetente:) — ex.: treino montado à mão. */
export function hasWhatsAppHeaders(raw: string): boolean {
  return raw.split('\n').some((l) => HEADER_IOS.test(l) || HEADER_ANDROID.test(l) || HEADER_TIME_FIRST.test(l))
}

/**
 * Separa treinos num texto livre: por títulos ("Treino A", "Treino B:", "A)", "Dia 1")
 * ou por linha em branco. Cada bloco com exercícios vira um treino.
 */
export function parsePlainTrainings(raw: string, date: string): ParsedTraining[] {
  const out: ParsedTraining[] = []
  for (const text of splitTrainingBlocks(raw, true)) {
    const { exercises, ignored } = parsePrescriptionBlock(text)
    if (!exercises.length) continue
    out.push({ date, time: '', week: weekStart(date), label: `Treino ${LETTERS[out.length] ?? out.length + 1}`, rawText: text, exercises, ignoredLines: ignored })
  }
  return out
}

/**
 * Reagrupa treinos por semana a partir das datas escolhidas. A letra de cada treino (A, B, C…)
 * vem do bloco de origem e é mantida — assim uma semana ABCDA mostra o "Treino A" repetido.
 */
export function regroupByDate(trainings: (ParsedTraining & { date: string })[]): ParsedWeek[] {
  const weeks = new Map<string, ParsedTraining[]>()
  const sorted = trainings.map((t, i) => ({ t, i })).sort((a, b) => a.t.date.localeCompare(b.t.date) || a.i - b.i)
  for (const { t } of sorted) {
    const wk = weekStart(t.date)
    const list = weeks.get(wk) ?? []
    list.push({ ...t, week: wk, label: t.label || `Treino ${LETTERS[list.length] ?? list.length + 1}` })
    weeks.set(wk, list)
  }
  return [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, ts]) => ({ week, trainings: ts }))
}
