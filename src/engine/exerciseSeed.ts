/**
 * Semente mínima de classificação (não é um "banco gigante"): só o vocabulário
 * recorrente do treinador, para o app funcionar offline desde o 1º dia.
 * Todo o resto é classificado pela IA sob demanda e salvo no cache.
 */
import type { ExerciseProfile } from '../domain/types'

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
  ['Agachamento búlgaro', 'Perna - Quadríceps', 'quadríceps', 'multi', 'livre', ['bulgaro', 'búlgaro']],
  ['Smith agachamento', 'Perna - Quadríceps', 'quadríceps', 'multi', 'maq', ['agachamento smith', 'smith']],
  ['Afundo', 'Perna - Quadríceps', 'quadríceps', 'multi', 'livre', ['passada', 'avanço', 'lunge']],
  ['Extensora', 'Perna - Quadríceps', 'quadríceps', 'mono', 'maq', ['cadeira extensora']],
  ['Flexora deitada', 'Perna - Posterior', 'posterior', 'mono', 'maq', ['mesa flexora', 'flexora']],
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
  ['Crucifixo inverso', 'Ombro', 'deltoide posterior', 'mono', 'maq', ['peck deck inverso', 'voador inverso']],
  ['Rosca direta', 'Bíceps', 'bíceps', 'mono', 'livre', ['rosca barra', 'rosca']],
  ['Rosca alternada', 'Bíceps', 'bíceps', 'mono', 'livre', []],
  ['Rosca martelo', 'Bíceps', 'braquial', 'mono', 'livre', ['martelo']],
  ['Rosca Scott', 'Bíceps', 'bíceps', 'mono', 'maq', ['scott']],
  ['Tríceps corda', 'Tríceps', 'tríceps', 'mono', 'maq', ['triceps corda', 'corda']],
  ['Tríceps pulley', 'Tríceps', 'tríceps', 'mono', 'maq', ['triceps barra', 'triceps polia']],
  ['Tríceps francês', 'Tríceps', 'tríceps cabeça longa', 'mono', 'livre', ['frances', 'triceps testa', 'testa']],
  ['Paralelas', 'Tríceps', 'tríceps', 'multi', 'livre', ['mergulho', 'dips']],
  ['Abdominal', 'Abdômen', 'reto abdominal', 'mono', 'livre', ['abdominal supra', 'crunch']],
  ['Prancha', 'Abdômen', 'core', 'mono', 'livre', []],
]

export const SEED_PROFILES: ExerciseProfile[] = SEED.map(([name, group, sub, mech, impl, aliases = [], disputed = false]) => ({
  key: normalizeKey(name),
  name,
  aliases: aliases.map(normalizeKey),
  muscle_group: group,
  sub_region: sub,
  mechanic: mech === 'multi' ? 'multiarticular' : 'monoarticular',
  implement: impl === 'livre' ? 'livre' : 'maquina_cabo',
  disputed,
  source: 'seed',
}))

/** Heurística offline usada só quando IA indisponível (marcada como 'heuristic' para revisão). */
export function heuristicProfile(name: string, activeGroups: string[]): ExerciseProfile {
  const k = normalizeKey(name)
  const machine = /maquina|polia|cabo|cross|pulley|smith|cadeira|mesa|leg|hack|peck|voador|articulad/.test(k)
  const multi = /supino|agach|leg|hack|remada|puxada|pulley|desenvolv|terra|stiff|afundo|passada|barra fixa|paralela|elevacao pelvica|hip/.test(k)
  const guess: [RegExp, string][] = [
    [/supino|crucifixo|peck|cross|peito/, 'Peito'],
    [/remada|puxada|pulley|pulldown|dorsal|costas/, 'Costas'],
    [/desenvolv|lateral|ombro|deltoide|frontal/, 'Ombro'],
    [/rosca|biceps/, 'Bíceps'],
    [/triceps|frances|testa|corda/, 'Tríceps'],
    [/flexora|stiff|terra|posterior/, 'Perna - Posterior'],
    [/gluteo|pelvica|abdut|coice/, 'Glúteo'],
    [/panturr|gemeo/, 'Panturrilha'],
    [/agach|leg|hack|extensora|afundo|passada|quadri/, 'Perna - Quadríceps'],
    [/abdom|prancha/, 'Abdômen'],
  ]
  // Regra 1 do prompt: priorizar grupamentos ativos para desambiguar
  const candidates = guess.filter(([re]) => re.test(k)).map(([, g]) => g)
  const group = candidates.find((g) => activeGroups.includes(g)) ?? candidates[0] ?? activeGroups[0] ?? 'Indefinido'
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
