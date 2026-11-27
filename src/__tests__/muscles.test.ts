import { describe, expect, it } from 'vitest'
import { SEED_PROFILES, heuristicProfile, muscleShares, normalizeKey } from '../engine/exerciseSeed'

const find = (n: string) => { const k = normalizeKey(n); return SEED_PROFILES.find((p) => p.key === k || p.aliases.includes(k)) ?? heuristicProfile(n, []) }
const shares = (n: string) => { const p = find(n); return Object.fromEntries(muscleShares(`${n} ${p.name}`, p.muscle_group).map((x) => [x.group, x.share])) }

describe('músculos: classificação e séries fracionadas', () => {
  it('"cross" é equipamento, não peito: o movimento decide', () => {
    expect(find('Rosca direta cross').muscle_group).toBe('Bíceps')
    expect(find('Triceps testa cross').muscle_group).toBe('Tríceps')
    expect(find('Remada unilateral cross').muscle_group).toBe('Costas')
    expect(find('Cross over').muscle_group).toBe('Peito')
  })
  it('nomes do dia a dia que estavam sem grupo', () => {
    expect(find('Mesa flexor').muscle_group).toBe('Perna - Posterior')
    expect(find('Voador invertido').muscle_group).toBe('Ombro')
    expect(find('Búlgaro com carga').muscle_group).toBe('Perna - Quadríceps')
    expect(find('Banco extensor').muscle_group).toBe('Perna - Quadríceps')
  })
  it('leg/agachamento/afundo contam meia série de glúteo; búlgaro e sumô contam glúteo inteiro', () => {
    expect(shares('Leg45')).toEqual({ 'Perna - Quadríceps': 1, 'Glúteo': 0.5, Adutores: 0.5 })
    expect(shares('Agachamento livre')).toEqual({ 'Perna - Quadríceps': 1, 'Glúteo': 0.5, Adutores: 0.5 })
    expect(shares('Leg45 pes sumo')).toEqual({ 'Perna - Quadríceps': 1, 'Glúteo': 1, Adutores: 0.75 })
    expect(shares('Agachamento sumo')).toEqual({ 'Perna - Quadríceps': 1, 'Glúteo': 1, Adutores: 0.75 })
    expect(shares('Búlgaro')).toEqual({ 'Perna - Quadríceps': 1, 'Glúteo': 1 })
    expect(shares('Afundo com carga')).toEqual({ 'Perna - Quadríceps': 1, 'Glúteo': 0.5 })
    expect(shares('Stiff')).toEqual({ 'Perna - Posterior': 1, 'Glúteo': 0.5 })
    expect(shares('Supino reto')).toEqual({ Peito: 1, 'Tríceps': 0.25, Ombro: 0.1 })
    expect(shares('Desenvolvimento')).toEqual({ Ombro: 1, 'Tríceps': 0.25 })
    expect(shares('Pulley frente')).toEqual({ Costas: 1, 'Bíceps': 0.3 })
    expect(find('Adutor').muscle_group).toBe('Adutores')
    expect(find('Banco adutor').muscle_group).toBe('Adutores')
    expect(find('Abdutora').muscle_group).toBe('Glúteo')
    expect(find('Voador').muscle_group).toBe('Peito')
    expect(find('Voador invertido').muscle_group).toBe('Ombro')
    expect(shares('Triceps pulley')).toEqual({ 'Tríceps': 1 })   // pulley de tríceps não ganha bíceps
    expect(shares('Abdutora')).toEqual({ 'Glúteo': 1 })
    // posterior só nos exercícios de posterior (flexoras, stiff): agachamento/leg/búlgaro/hip thrust não somam
    expect(shares('Elevação pélvica')).toEqual({ 'Glúteo': 1 })
    expect(shares('Agachamento livre')['Perna - Posterior']).toBeUndefined()
    expect(shares('Búlgaro')['Perna - Posterior']).toBeUndefined()
    expect(shares('Mesa flexora')).toEqual({ 'Perna - Posterior': 1 })
  })
})

describe('grupamentos do presencial detectados pelos exercícios', () => {
  it('músculo principal de cada exercício: supino é Peito (não só tríceps)', async () => {
    const { detectMuscleGroups } = await import('../engine/sessionGroups')
    const { SEED_PROFILES, normalizeKey } = await import('../engine/exerciseSeed')
    const lookup = (k: string) => SEED_PROFILES.find((p) => p.key === k || p.aliases.includes(k))
    const ex = (name: string, sets: number) => ({ id: name, position: 0, exercise_key: normalizeKey(name), display_name: name, valid_sets: sets, warmup_sets: 0, heavy_sets: 0, reps: [], drop_set: false })
    const g = detectMuscleGroups([ex('Supino reto', 4), ex('Tríceps corda', 3), ex('Crucifixo', 3)], lookup)
    expect(g).toEqual(['Peito', 'Tríceps'])
  })
})

describe('o que o aluno treinou (resumo da semana) = músculo principal', () => {
  it('treino só de costas não aparece como "Costas/Bíceps"; supino não aparece como tríceps', async () => {
    const { aggregateSessions } = await import('../engine/metrics')
    const { SEED_PROFILES, normalizeKey } = await import('../engine/exerciseSeed')
    const lookup = (k: string) => SEED_PROFILES.find((p) => p.key === k || p.aliases.includes(k))
    const ex = (name: string, sets: number) => ({ id: name, position: 0, exercise_key: normalizeKey(name), display_name: name, valid_sets: sets, warmup_sets: 0, heavy_sets: 0, reps: [], drop_set: false })
    const sess = (exs: ReturnType<typeof ex>[]) => ({ id: 's', student_id: 'x', date: '2026-11-23', label: 'A', source: 'presencial' as const, muscle_groups: [], created_at: '', updated_at: '', exercises: exs })
    const costas = aggregateSessions([sess([ex('Puxada aberta', 4), ex('Remada baixa', 4), ex('Remada curvada', 4), ex('Remada unilateral', 3)])], lookup)
    expect(Object.keys(costas.primaryGroups!)).toEqual(['Costas'])
    expect(costas.byGroup['Bíceps'].valid).toBeGreaterThan(3) // a fração continua no gráfico de foco
    const peito = aggregateSessions([sess([ex('Supino reto', 4), ex('Supino inclinado com halteres', 4), ex('Voador', 3)])], lookup)
    expect(Object.keys(peito.primaryGroups!)).toEqual(['Peito'])
  })
})

describe('calorias da musculação (MET × peso × tempo)', () => {
  it('treino de 20 séries fica entre musculação geral e vigorosa (Compendium / Harvard)', async () => {
    const { aggregateSessions, setStudentWeight } = await import('../engine/metrics')
    const { SEED_PROFILES, normalizeKey } = await import('../engine/exerciseSeed')
    const lookup = (k: string) => SEED_PROFILES.find((p) => p.key === k || p.aliases.includes(k))
    const ex = (name: string, reps: number) => ({ id: name, position: 0, exercise_key: normalizeKey(name), display_name: name, valid_sets: 4, warmup_sets: 0, heavy_sets: 0, reps: [0, 1, 2, 3].map(() => ({ min: reps, max: reps })), drop_set: false })
    const s = { id: 'k', student_id: 'aluna70', date: '2026-11-27', label: 'A', source: 'presencial' as const, muscle_groups: [], created_at: '', updated_at: '', exercises: [ex('Agachamento livre', 10), ex('Leg press', 10), ex('Cadeira extensora', 12), ex('Mesa flexora', 12), ex('Abdutora', 15)] }
    setStudentWeight('aluna70', 70)
    const a = aggregateSessions([s], lookup)
    // ~40 min de treino: entre 3,7 e 7,4 kcal/min para 70 kg
    expect(a.kcal).toBeGreaterThan(40 * 3.7)
    expect(a.kcal).toBeLessThan(40 * 7.4)
    setStudentWeight('aluna90', 90)
    const b = aggregateSessions([{ ...s, student_id: 'aluna90' }], lookup)
    expect(b.kcal / a.kcal).toBeCloseTo(90 / 70, 2) // mais peso, mais gasto
  })
})

describe('calorias: duração real + MET pelos exercícios + correção anaeróbia', () => {
  it('usa a duração real quando existe; perna e séries pesadas gastam mais', async () => {
    const { sessionKcal, setSessionDuration, setStudentWeight } = await import('../engine/metrics')
    const { SEED_PROFILES, normalizeKey } = await import('../engine/exerciseSeed')
    const lookup = (k: string) => SEED_PROFILES.find((p) => p.key === k || p.aliases.includes(k))
    const ex = (name: string, reps: number) => ({ id: name, position: 0, exercise_key: normalizeKey(name), display_name: name, valid_sets: 4, warmup_sets: 0, heavy_sets: 0, reps: [0, 1, 2, 3].map(() => ({ min: reps, max: reps })), drop_set: false })
    const sess = (id: string, exs: ReturnType<typeof ex>[]) => ({ id, student_id: 'kg60', date: '2026-11-27', label: 'A', source: 'presencial' as const, muscle_groups: [], created_at: '', updated_at: '', exercises: exs })
    setStudentWeight('kg60', 60)
    const perna = sess('p', [ex('Agachamento livre', 12), ex('Leg press', 12), ex('Afundo', 12)])
    const braco = sess('b', [ex('Rosca direta', 12), ex('Tríceps corda', 12), ex('Elevação lateral', 12)])
    expect(sessionKcal(perna, lookup).kcal).toBeGreaterThan(sessionKcal(braco, lookup).kcal * 1.3)
    // pesada (6–8 reps) gasta mais que a mesma série leve
    const pesada = sess('h', [ex('Agachamento livre', 6), ex('Leg press', 6), ex('Afundo', 6)])
    expect(sessionKcal(pesada, lookup).kcal).toBeGreaterThan(sessionKcal(perna, lookup).kcal)
    // duração real: 50 min mudam o total (descanso por percepção entra no tempo)
    setSessionDuration('p', 50)
    const k = sessionKcal(perna, lookup, 8)
    expect(k.real).toBe(true)
    expect(k.minutes).toBe(50)
    expect(Math.round(k.kcal)).toBe(Math.round(5.5 * 1.1 * 60 * (50 / 60))) // MET 5,5 (perna) × PSE 8 × 60 kg × 50 min
  })
})
