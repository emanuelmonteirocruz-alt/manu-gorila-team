/**
 * Banco de exercícios offline: vocabulário recorrente do treinador (SEED) + biblioteca ampla
 * (exerciseLibrary). O que ainda faltar é classificado pela IA / heurística e salvo no cache.
 */
import type { ExerciseProfile } from '../domain/types'
import { LIBRARY } from './exerciseLibrary'

export function normalizeKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(com|de|da|do|no|na|o|a)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

type Seed = [name: string, group: string, sub: string, mech: 'multi' | 'mono', impl: 'livre' | 'maq', aliases?: string[], disputed?: boolean]

const SEED: Seed[] = [
  ['Leg45', 'Perna - Quadríceps', 'quadríceps', 'multi', 'maq', ['leg 45', 'leg press 45', 'leg press', 'legpress']],
  ['Hack', 'Perna - Quadríceps', 'quadríceps', 'multi', 'maq', ['hack squat', 'hack machine']],
  ['Agachamento livre', 'Perna - Quadríceps', 'quadríceps', 'multi', 'livre', ['agachamento', 'agachamento barra', 'back squat']],
  ['Agachamento búlgaro', 'Perna - Quadríceps', 'quadríceps', 'multi', 'livre', ['bulgaro', 'búlgaro', 'bulgaro com carga', 'búlgaro com carga', 'bulgaro halteres']],
  ['Smith agachamento', 'Perna - Quadríceps', 'quadríceps', 'multi', 'maq', ['agachamento smith', 'smith']],
  ['Afundo', 'Perna - Quadríceps', 'quadríceps', 'multi', 'livre', ['passada', 'avanço', 'lunge']],
  ['Extensora', 'Perna - Quadríceps', 'quadríceps', 'mono', 'maq', ['cadeira extensora', 'banco extensor', 'cadeira extensor']],
  ['Flexora deitada', 'Perna - Posterior', 'posterior', 'mono', 'maq', ['mesa flexora', 'flexora', 'mesa flexor', 'flexor deitado']],
  ['Flexora sentada', 'Perna - Posterior', 'posterior', 'mono', 'maq', ['cadeira flexora']],
  ['Stiff', 'Perna - Posterior', 'posterior', 'multi', 'livre', ['stiff barra', 'stiff halteres', 'rdl', 'terra romeno']],
  ['Levantamento terra', 'Perna - Posterior', 'posterior', 'multi', 'livre', ['terra', 'deadlift']],
  ['Elevação pélvica', 'Glúteo', 'glúteo', 'multi', 'livre', ['hip thrust', 'elevacao pelvica']],
  ['Abdutora', 'Glúteo', 'glúteo médio', 'mono', 'maq', ['cadeira abdutora']],
  ['Glúteo cabo', 'Glúteo', 'glúteo', 'mono', 'maq', ['coice cabo', 'kickback cabo', 'gluteo polia']],
  ['Panturrilha em pé', 'Panturrilha', 'gastrocnêmio', 'mono', 'maq', ['panturrilha', 'gemeos']],
  ['Supino reto', 'Peito', 'peitoral', 'multi', 'livre', ['supino', 'supino barra']],
  ['Supino halteres', 'Peito', 'peitoral', 'multi', 'livre', ['supino reto halteres']],
  ['Supino inclinado halteres', 'Peito', 'peitoral superior', 'multi', 'livre', ['supino inclinado']],
  ['Crucifixo', 'Peito', 'peitoral', 'mono', 'livre', ['crucifixo halteres']],
  ['Peck deck', 'Peito', 'peitoral', 'mono', 'maq', ['voador', 'fly maquina']],
  ['Cross over', 'Peito', 'peitoral', 'mono', 'maq', ['crossover', 'cross'], true],
  ['Pulley frente', 'Costas', 'dorsal', 'multi', 'maq', ['puxada frente', 'pulley', 'puxada alta']],
  ['Remada baixa', 'Costas', 'dorsal', 'multi', 'maq', ['remada sentada', 'remada triangulo']],
  ['Remada curvada', 'Costas', 'dorsal', 'multi', 'livre', ['remada barra']],
  ['Remada unilateral', 'Costas', 'dorsal', 'multi', 'livre', ['serrote', 'remada halter']],
  ['Pullover polia', 'Costas', 'dorsal', 'mono', 'maq', ['pulldown', 'pullover']],
  ['Barra fixa', 'Costas', 'dorsal', 'multi', 'livre', ['barra', 'pull up']],
  ['Desenvolvimento', 'Ombro', 'deltoide anterior', 'multi', 'livre', ['desenvolvimento halteres', 'desenvolvimento com halteres']],
  ['Desenvolvimento máquina', 'Ombro', 'deltoide anterior', 'multi', 'maq', []],
  ['Elevação lateral', 'Ombro', 'deltoide lateral', 'mono', 'livre', ['elevacao lateral', 'lateral halteres']],
  ['Elevação lateral cabo', 'Ombro', 'deltoide lateral', 'mono', 'maq', ['lateral polia', 'lateral cabo']],
  ['Crucifixo inverso', 'Ombro', 'deltoide posterior', 'mono', 'maq', ['peck deck inverso', 'voador inverso', 'voador invertido', 'peck deck invertido']],
  ['Rosca direta', 'Bíceps', 'bíceps', 'mono', 'livre', ['rosca barra', 'rosca']],
  ['Rosca alternada', 'Bíceps', 'bíceps', 'mono', 'livre', []],
  ['Rosca martelo', 'Bíceps', 'braquial', 'mono', 'livre', ['martelo']],
  ['Rosca Scott', 'Bíceps', 'bíceps', 'mono', 'maq', ['scott']],
  ['Tríceps corda', 'Tríceps', 'tríceps', 'mono', 'maq', ['triceps corda', 'corda']],
  ['Tríceps pulley', 'Tríceps', 'tríceps', 'mono', 'maq', ['triceps barra', 'triceps polia']],
  ['Tríceps francês', 'Tríceps', 'tríceps cabeça longa', 'mono', 'livre', ['frances', 'triceps testa', 'testa']],
  ['Paralelas', 'Tríceps', 'tríceps', 'multi', 'livre', ['paralela', 'mergulho', 'dips', 'mergulho paralela']],
  ['Abdominal', 'Abdômen', 'reto abdominal', 'mono', 'livre', ['abdominal supra', 'crunch']],
  ['Prancha', 'Abdômen', 'core', 'mono', 'livre', []],
]

const toProfile = ([name, group, sub, mech, impl, aliases = [], disputed = false]: Seed): ExerciseProfile => ({
  key: normalizeKey(name),
  name,
  aliases: aliases.map(normalizeKey),
  muscle_group: group,
  sub_region: sub,
  mechanic: mech === 'multi' ? 'multiarticular' : 'monoarticular',
  implement: impl === 'livre' ? 'livre' : 'maquina_cabo',
  disputed,
  source: 'seed',
})

/** Semente + biblioteca, sem chaves repetidas (a semente do treinador vence). */
export const SEED_PROFILES: ExerciseProfile[] = (() => {
  const seen = new Set<string>()
  const out: ExerciseProfile[] = []
  for (const s of [...SEED, ...LIBRARY.map((l): Seed => [l[0], l[1], l[2], l[3], l[4], l[5] ?? []])]) {
    const p = toProfile(s)
    if (seen.has(p.key)) continue
    seen.add(p.key)
    // apelido igual à chave de outro exercício confundiria a busca: fica só no dono da chave
    out.push(p)
  }
  const keys = new Set(out.map((p) => p.key))
  for (const p of out) p.aliases = [...new Set(p.aliases)].filter((a) => a !== p.key && !keys.has(a))
  return out
})()

/** Versão do banco: quando muda, aparelhos já instalados recebem os exercícios novos. */
export const SEED_VERSION = 4

/** Heurística offline usada só quando IA indisponível (marcada como 'heuristic' para revisão). */
export function heuristicProfile(name: string, activeGroups: string[]): ExerciseProfile {
  const k = normalizeKey(name)
  const machine = /maquina|polia|cabo|cross|pulley|smith|cadeira|mesa|leg|hack|peck|voador|articulad|graviton|pendul|aparelho/.test(k)
  const multi = /supino|agach|leg|hack|remada|puxada|pulley|desenvolv|terra|stiff|afundo|passada|barra fixa|paralela|mergulho|flexao bra|elevacao pelvica|hip|thrust|step|subida|burpee|thruster|clean|snatch|swing|press\b|push|pull up|chin/.test(k)
  // o MOVIMENTO decide o músculo (primeiro que bater); "cross/polia/cabo" só indica o equipamento
  const guess: [RegExp, string][] = [
    [/(voador|peck|crucifixo|fly|cross)\w* (invertid|invers)|face pull|posterior de ombro/, 'Ombro'],
    [/rosca|biceps|martelo|antebraco|punho/, 'Bíceps'],
    [/triceps|frances|testa|corda|coice tri|kickback/, 'Tríceps'],
    [/remada|puxada|pulley|pulldown|dorsal|costas|barra fixa|pull up|chin|lombar|hiperext|superman|serrote/, 'Costas'],
    [/desenvolv|\blateral|frontal|ombro|deltoide|militar|arnold|encolh|trapezio|rotacao/, 'Ombro'],
    [/flexora|flexor|stiff|terra|posterior|nordic|good morning|isquio/, 'Perna - Posterior'],
    [/\badut|\baduc/, 'Adutores'],
    [/gluteo|pelvica|thrust|abdut|coice|ponte|quatro apoios|swing/, 'Glúteo'],
    [/panturr|gemeo|soleo|tibial/, 'Panturrilha'],
    [/agach|squat|leg|hack|extensora|extensor|afundo|passada|avanco|lunge|bulgaro|quadri|step|subida|sissy|pistol|salto/, 'Perna - Quadríceps'],
    [/supino|crucifixo|peck|voador|peito|peitoral|fly|flexao bra|push up|apoio|cross/, 'Peito'],
    [/paralela|mergulho/, 'Tríceps'],
    [/abdom|prancha|crunch|infra|obliq|core|canivete|remador|russian|twist|escalador/, 'Abdômen'],
  ]
  const hit = guess.find(([re]) => re.test(k))
  const group = hit?.[1] ?? activeGroups[0] ?? 'Indefinido'
  return {
    key: k,
    name: name.trim().replace(/^\p{L}/u, (c) => c.toUpperCase()),
    aliases: [],
    muscle_group: group,
    sub_region: undefined,
    mechanic: multi ? 'multiarticular' : 'monoarticular',
    implement: machine ? 'maquina_cabo' : 'livre',
    disputed: /cross/.test(k),
    source: 'heuristic',
  }
}

/**
 * Músculos que AJUDAM no exercício (séries fracionadas): o principal conta a série inteira,
 * os auxiliares contam uma fração. Assim leg press, agachamento, búlgaro e afundo também
 * somam glúteo; supino soma tríceps; remada soma bíceps.
 */
const Q = 'Perna - Quadríceps', P = 'Perna - Posterior', G = 'Glúteo'
// [nome, músculos principais em que vale, auxiliares]
const SECONDARY: [RegExp, string[], { group: string; share: number }[]][] = [
  // sumô: amplitude maior, abaixo de 90° entra o glúteo (acima, quadríceps) → os dois por igual
  [/(sumo|afastad|pes abertos)/, [Q, P], [{ group: G, share: 1 }]],
  // búlgaro: quadríceps e glúteo por igual
  [/bulgaro/, [Q], [{ group: G, share: 1 }]],
  // afundo/passada/avanço: mais quadríceps que glúteo; leg/hack/agachamento: glúteo auxiliar
  [/(leg|hack|agach|squat|afundo|passada|avanco|lunge|step|subida|pistol|belt|pendul)/, [Q], [{ group: G, share: 0.5 }]],
  [/(stiff|terra|good morning|rdl|romeno)/, [P], [{ group: G, share: 0.5 }]],
  // elevação pélvica: sem posterior (Plotkin 2023: posteriores praticamente não cresceram com hip thrust nem agachamento)
  [/(supino|flexao bra|push up|\bapoio\b)/, ['Peito'], [{ group: 'Tríceps', share: 0.5 }, { group: 'Ombro', share: 0.25 }]],
  [/(paralela|mergulho)/, ['Tríceps'], [{ group: 'Peito', share: 0.5 }]],
  [/(desenvolv|militar|arnold|landmine)/, ['Ombro'], [{ group: 'Tríceps', share: 0.5 }]],
  // remada/puxada: costas trabalha muito mais que bíceps (no máximo 30%)
  [/(remada|puxada|pulley|barra fixa|pull up|chin|serrote)/, ['Costas'], [{ group: 'Bíceps', share: 0.3 }]],
]

/** Distribuição de uma série entre músculos: principal = 1, auxiliares = fração (sem repetir o principal). */
export function muscleShares(name: string, primary: string): { group: string; share: number }[] {
  const k = normalizeKey(name)
  const out: { group: string; share: number }[] = [{ group: primary, share: 1 }]
  for (const [re, primaries, list] of SECONDARY) {
    if (!primaries.includes(primary) || !re.test(k)) continue
    // cada músculo entra uma vez: no sumô/búlgaro o glúteo já entrou inteiro (não soma os 0,5 do leg/agachamento)
    for (const x of list) if (x.group !== primary && !out.some((o) => o.group === x.group)) out.push(x)
  }
  return out
}
