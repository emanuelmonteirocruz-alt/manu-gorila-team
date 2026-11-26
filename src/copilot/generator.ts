/**
 * Copiloto de montagem do próximo ciclo (determinístico, offline).
 * - Parte do histórico do aluno (última semana de treinos)
 * - Aplica a diretriz (protocolo + intensidade) e as travas (ciclo menstrual)
 * - Renova ordem das divisões, sequência e repertório
 * - Escreve no estilo do treinador (nomes curtos, anotações curtas, descanso no padrão dele)
 * A versão IA (Edge Function copilot-draft) refina este rascunho e passa pelas mesmas travas.
 */
import type { ExerciseProfile, Microcycle, Session } from '../domain/types'
import { isHeavy } from '../engine/prescription'

export type IntensityDirective = 'aumentar' | 'diminuir' | 'manter'

export interface CopilotInput {
  lastWeek: Session[] // ordenadas por data
  protocol: Microcycle
  intensity: IntensityDirective
  minutesAvailable?: number
  catalog: ExerciseProfile[]
  lookup: (key: string) => ExerciseProfile | undefined
  styleSamples: string[] // raw_text das mensagens antigas
  seed?: number
}

export interface DraftLine {
  names: string[]
  profiles: (ExerciseProfile | undefined)[]
  warmup: number
  sets: number
  range: { min: number; max: number } | null
  pyramid: number[] | null
  drop: boolean
  notes: string[]
}

export interface DraftTraining {
  label: string
  mainGroup: string
  lines: DraftLine[]
}

// PRNG determinístico (mesmo histórico + seed => mesmo rascunho)
function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}

const LETTERS = 'ABCDEFGHIJ'

/** Extrai o "vocabulário" do treinador: descanso e anotações frequentes. */
export function learnStyle(samples: string[]) {
  const rest = new Map<string, number>()
  const tags = new Map<string, number>()
  for (const s of samples) {
    for (const line of s.split('\n')) {
      const r = line.match(/descanso[^\n]*/i)
      if (r) rest.set(r[0].trim(), (rest.get(r[0].trim()) ?? 0) + 1)
      for (const t of ['Carga alta', 'Amplitude máxima', 'Carga fixa', 'Cadência controlada', 'Pico de contração']) {
        if (line.toLowerCase().includes(t.toLowerCase())) tags.set(t, (tags.get(t) ?? 0) + 1)
      }
    }
  }
  const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
  // estilo em blocos: nome numa linha e séries na linha de baixo ("Leg45\n4x8\nAmplitude maxima")
  const multiline = samples.some((x) => /\n\s*(\d{1,2}\s*x\s*\d|\d{1,2}\s*\/\s*\d)/i.test(x))
  return { rest: top(rest)[0] ?? null, tags: top(tags), multiline }
}

function sessionToLines(s: Session, lookup: CopilotInput['lookup']): DraftLine[] {
  const lines: DraftLine[] = []
  const seen = new Set<number>()
  for (const ex of s.exercises) {
    if (ex.superset_group != null) {
      if (seen.has(ex.superset_group)) continue
      seen.add(ex.superset_group)
      const group = s.exercises.filter((e) => e.superset_group === ex.superset_group)
      lines.push(toLine(group.map((g) => g.display_name), group.map((g) => lookup(g.exercise_key)), ex))
    } else lines.push(toLine([ex.display_name], [lookup(ex.exercise_key)], ex))
  }
  return lines
}

function toLine(names: string[], profiles: (ExerciseProfile | undefined)[], ex: Session['exercises'][number]): DraftLine {
  const uniform = ex.reps.every((r) => r.min === ex.reps[0]?.min && r.max === ex.reps[0]?.max)
  return {
    names,
    profiles,
    warmup: ex.warmup_sets,
    sets: ex.valid_sets,
    range: uniform && ex.reps[0] ? { ...ex.reps[0] } : null,
    pyramid: uniform ? null : ex.reps.map((r) => r.max),
    drop: ex.drop_set,
    notes: [],
  }
}

function mainGroupOf(lines: DraftLine[]): string {
  const count = new Map<string, number>()
  for (const l of lines) for (const p of l.profiles) if (p) count.set(p.muscle_group, (count.get(p.muscle_group) ?? 0) + l.sets)
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'
}

function applyProtocol(l: DraftLine, protocol: Microcycle, intensity: IntensityDirective, idx: number) {
  const multi = l.profiles[0]?.mechanic === 'multiarticular'
  const setRange = (min: number, max: number) => {
    l.range = { min, max }
    l.pyramid = null
  }
  if (protocol === 'regenerativa') {
    l.sets = Math.max(2, l.sets - 1)
    setRange(12, 15)
    l.drop = false
    if (multi) l.notes.push('Carga controlada')
  } else if (protocol === 'choque') {
    if (multi && idx < 3) {
      l.sets = Math.min(5, l.sets + 1)
      setRange(idx === 0 ? 6 : 8, idx === 0 ? 8 : 10)
      l.notes.push('Carga alta')
    } else if (!multi) {
      l.drop = l.drop || idx % 2 === 1
    }
  }
  if (intensity === 'aumentar' && multi && protocol !== 'regenerativa') {
    if (!l.range || !isHeavy(l.range)) setRange(8, 10)
    if (!l.notes.includes('Carga alta')) l.notes.push('Carga alta')
  } else if (intensity === 'diminuir') {
    if (l.range && isHeavy(l.range)) setRange(10, 12)
    if (l.pyramid) l.pyramid = l.pyramid.map((r) => Math.max(10, r))
    l.notes = l.notes.filter((n) => n !== 'Carga alta')
  }
}

export function generateNextCycle(input: CopilotInput): DraftTraining[] {
  const rand = rng(input.seed ?? Date.now())
  const usedKeys = new Set(input.lastWeek.flatMap((s) => s.exercises.map((e) => e.exercise_key)))

  let trainings: DraftTraining[] = input.lastWeek.map((s) => {
    const lines = sessionToLines(s, input.lookup)
    return { label: s.label, mainGroup: mainGroupOf(lines), lines }
  })
  if (!trainings.length) return []

  // 1) Ordem das divisões na semana: rotaciona (A,B,C → B,C,A)
  if (trainings.length > 1) trainings = [...trainings.slice(1), trainings[0]]

  for (const t of trainings) {
    // 2) Repertório: troca ~40% dos exercícios por alternativas do mesmo grupo/mecânica ainda não usadas
    for (const l of t.lines) {
      if (l.names.length > 1) continue
      const p = l.profiles[0]
      if (!p || rand() > 0.45) continue
      const alts = input.catalog.filter(
        (c) => c.muscle_group === p.muscle_group && c.mechanic === p.mechanic && !usedKeys.has(c.key) && !c.disputed,
      )
      if (!alts.length) continue
      const alt = alts[Math.floor(rand() * alts.length)]
      usedKeys.add(alt.key)
      l.names = [alt.name]
      l.profiles = [alt]
    }
    // 3) Sequência: multiarticulares na frente, mas rotacionando entre eles; monos invertidos
    const multis = t.lines.filter((l) => l.profiles[0]?.mechanic === 'multiarticular')
    const monos = t.lines.filter((l) => l.profiles[0]?.mechanic !== 'multiarticular')
    const rotated = multis.length > 1 ? [...multis.slice(1), multis[0]] : multis
    t.lines = [...rotated, ...monos.reverse()]
    // aquecimento fica só na abertura (enforceRules recoloca se a 1ª linha for multi pesada)
    t.lines.forEach((l, i) => { if (i > 0) l.warmup = 0 })

    // 4) Protocolo / intensidade
    t.lines.forEach((l, i) => applyProtocol(l, input.protocol, input.intensity, i))

    // 5) Tempo disponível: corta monoarticulares do fim (~2,5 min por série válida)
    if (input.minutesAvailable) {
      const minutes = () => t.lines.reduce((a, l) => a + (l.sets * l.names.length + l.warmup) * 2.5, 0)
      while (minutes() > input.minutesAvailable && t.lines.length > 3) t.lines.pop()
    }
    enforceRules(t, input.catalog)
  }

  // Re-letra (A, B, C…) na nova ordem
  trainings.forEach((t, i) => (t.label = `Treino ${LETTERS[i]}`))
  return trainings.map((t) => ({ ...t, mainGroup: mainGroupOf(t.lines) }))
}

/** Aplica as travas no rascunho (correção automática, não só aviso). */
export function enforceRules(t: DraftTraining, catalog: ExerciseProfile[]) {
  // Aquecimento antes de multiarticular pesado na abertura
  const first = t.lines[0]
  if (first) {
    const heavy = first.range ? isHeavy(first.range) : (first.pyramid ?? []).some((r) => r >= 6 && r <= 10)
    if (first.profiles[0]?.mechanic === 'multiarticular' && heavy && first.warmup === 0) first.warmup = 2
  }
  // Séries picadas em aparelho disputado → consolida no movimento de carga real do mesmo grupo
  for (const l of [...t.lines]) {
    const p = l.profiles[0]
    if (!p?.disputed || l.sets > 2) continue
    const target = t.lines.find((o) => o !== l && o.profiles[0]?.muscle_group === p.muscle_group && !o.profiles[0]?.disputed)
    if (target) {
      target.sets = Math.min(5, target.sets + 1)
      t.lines.splice(t.lines.indexOf(l), 1)
    } else {
      const alt = catalog.find((c) => c.muscle_group === p.muscle_group && !c.disputed && c.mechanic === p.mechanic)
      if (alt) {
        l.names = [alt.name]
        l.profiles = [alt]
      }
      l.sets = Math.max(3, l.sets)
    }
  }
}

// ---------- escrita no estilo do treinador ----------
function scheme(l: DraftLine): string {
  const body = l.pyramid?.length ? l.pyramid.join('/') : l.range ? `${l.sets}x${l.range.min === l.range.max ? l.range.min : `${l.range.min} a ${l.range.max}`}` : `${l.sets}x12`
  const wu = l.warmup ? `${l.warmup}x15 aquecimento + ` : ''
  return wu + body
}

export function formatTraining(t: DraftTraining, rest: string | null, multiline = false): string {
  if (multiline) {
    // mesmo jeito que o treinador escreve: nome / séries / observação, linha em branco entre exercícios
    const blocks = t.lines.map((l) => {
      const sch = l.warmup ? [`${l.warmup}x15 aquecimento`, scheme({ ...l, warmup: 0 })] : [scheme(l)]
      return [l.names.join(' + '), ...sch, ...(l.drop ? ['1x drop'] : []), ...(l.notes.length ? [l.notes.join('. ')] : [])].join('\n')
    })
    if (rest) blocks.push(rest)
    return blocks.join('\n\n')
  }
  const out = t.lines.map((l) => {
    const parts = [l.names.join(' + '), scheme(l)]
    if (l.drop) parts.push('1x drop')
    if (l.notes.length) parts.push(l.notes.join('. '))
    return parts.join(' ')
  })
  if (rest) out.push(rest)
  return out.join('\n')
}

export function formatCycle(ts: DraftTraining[], styleSamples: string[]): { label: string; text: string; mainGroup: string; names: string[] }[] {
  const { rest, multiline } = learnStyle(styleSamples)
  return ts.map((t) => ({ label: t.label, text: formatTraining(t, rest, multiline), mainGroup: t.mainGroup, names: t.lines.flatMap((l) => l.names) }))
}
