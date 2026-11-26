import { describe, expect, it } from 'vitest'
import { ANAMNESE_TEMPLATE, answersFromPasted, parseTemplate } from '../consultoria/anamneseTemplate'
import { buildTriage } from '../consultoria/triage'
import { remindersFor } from '../consultoria/reminders'
import { generateWeek, weekToWhatsApp } from '../consultoria/generator'
import { parsePrescriptionBlock } from '../engine/prescription'
import { splitTrainingBlocks } from '../parser/whatsapp'
import { SEED_PROFILES, normalizeKey } from '../engine/exerciseSeed'
import type { Session, SessionExercise } from '../domain/types'

const sections = parseTemplate(ANAMNESE_TEMPLATE)
const q = (field: string) => sections.flatMap((s) => s.questions).find((x) => x.field === field)!.id
void q

const EXEMPLO = require('fs').readFileSync(require('path').join(__dirname, 'fixtures/anamnese-exemplo.txt'), 'utf8') as string
const byNum = (n: number) => sections.flatMap((s) => s.questions).find((x) => x.number === n)!.id

describe('anamnese: o questionário do Emanuel', () => {
  it('modelo padrão: 17 perguntas numeradas, com as linhas de exemplo separadas', () => {
    const qs = sections.flatMap((s) => s.questions)
    expect(qs).toHaveLength(17)
    expect(qs[0]).toMatchObject({ number: 1, label: 'Qual é o seu principal objetivo?', field: 'objetivo' })
    expect(qs[7].hints).toEqual(['Se sim, qual e com que frequência?'])
  })

  it('aluna copiou tudo e respondeu por cima (com a mensagem do treinador junto)', () => {
    const a = answersFromPasted(EXEMPLO, sections, 'Emanuel Monteiro')
    expect(a[byNum(1)]).toBe('Ganho de massa muscular, melhora na postura')
    expect(a[byNum(2)]).toBe('27')
    expect(a[byNum(3)]).toBe('1,62')
    expect(a[byNum(4)]).toBe('57kg')
    expect(a[byNum(5)]).toBe('6 meses, porém sem muita disciplina')
    expect(a[byNum(6)]).toBe('de 3 a 4')
    expect(a[byNum(8)]).toBe('Não')                       // "Se sim, qual…" é linha de exemplo
    expect(a[byNum(9)]).toBe('não posso fazer elevação pélvica, pois tenho endometriose')
    expect(a[byNum(11)]).toBeUndefined()                  // ficou sem resposta
    expect(a[byNum(12)]).toBe('Isotretinoína, minoxidil e paroxetina')
    expect(a[byNum(14)]).toBe('Academia do bairro')                // "Caso seja uma academia de bairro…" ignorado
    expect(a[byNum(16)]).toBe('treinos com drop set')
    expect(a[byNum(17)]).toBeUndefined()                  // "Obrigado!" não vira resposta

    const t = buildTriage(sections, a)
    expect(t.objetivoTipo).toBe('hipertrofia')
    expect(t.postura).toBe(true)
    expect(t.experiencia).toBe('iniciante')               // 6 meses
    expect(t.dias).toBe(3)
    expect(t.diasTexto).toBe('de 3 a 4')
    expect(t.tempoMin).toBe(60)
    expect(t.atividade).toBeNull()                        // "Não"
    expect(t.condicoes).toContain('endometriose')
    expect(t.evitarExercicios).toEqual(['Elevação pélvica'])
    expect(t.medicamentos).toEqual(['Isotretinoína, minoxidil e paroxetina'])
    expect(t.dificuldades).toEqual(['Falta de disciplina'])

    const r = remindersFor(t, [])
    expect(r.evitar.join(' ')).toMatch(/Elevação pélvica/)
    expect(r.atencao.join(' ')).toMatch(/Endometriose/)
    expect(r.atencao.join(' ')).toMatch(/Isotretinoína/)
    expect(r.atencao.join(' ')).toMatch(/Minoxidil/)
    expect(r.processos.join(' ')).toMatch(/Disciplina/)
    expect(r.processos.join(' ')).toMatch(/postura/)
    expect(r.processos.join(' ')).toMatch(/Adaptação neuromuscular/)
  })

  it('aluno respondendo só pelo número', () => {
    const a = answersFromPasted('1. Hipertrofia, quero bumbum maior\n2) 25\n6 - 5 dias\n7: 1h30\n9. dor no ombro direito\n15. Afundo', sections)
    expect(a[byNum(1)]).toBe('Hipertrofia, quero bumbum maior')
    expect(a[byNum(2)]).toBe('25')
    expect(a[byNum(6)]).toBe('5 dias')
    const t = buildTriage(sections, a)
    expect(t.enfases).toEqual(['Glúteo'])
    expect(t.tempoMin).toBe(90)
    expect(t.restricoes.map((r) => r.area)).toEqual(['ombro'])
    expect(t.evitarExercicios).toEqual(['Afundo'])
  })

  it('respostas "não / nenhuma" não viram restrição', () => {
    const t = buildTriage(sections, { [byNum(10)]: 'não', [byNum(9)]: 'Nenhuma' })
    expect(t.restricoes).toEqual([])
  })
})

describe('rascunho da semana no padrão do WhatsApp', () => {
  const lookup = (k: string) => SEED_PROFILES.find((p) => p.key === k)
  const ex = (name: string, sets: number, reps: number, o: Partial<SessionExercise> = {}): SessionExercise => ({
    id: name, position: 0, exercise_key: normalizeKey(name), display_name: name, valid_sets: sets, warmup_sets: 0, heavy_sets: 0,
    reps: Array.from({ length: sets }, () => ({ min: reps, max: reps })), drop_set: false, ...o,
  })
  const base: Session[] = [{
    id: 's', student_id: 'x', date: '2026-11-23', label: 'Treino A', source: 'whatsapp', muscle_groups: [], created_at: '', updated_at: '',
    exercises: [ex('Elevação pélvica', 3, 12), ex('Agachamento búlgaro', 3, 12, { position: 1 }), { ...ex('Mesa flexora', 3, 12, { position: 2 }), superset_group: 1 }, { ...ex('Abdutora', 3, 15, { position: 3 }), superset_group: 1 }],
  }]
  it('choque: estímulo novo na ênfase, sem posição fixa, e o texto volta a ser lido pelo Colar WhatsApp', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const week = generateWeek({ base, phase: 'choque', intensity: 0, enfases: ['Glúteo'], lookup, seed })
      const txt = weekToWhatsApp(week)
      expect(txt.startsWith('*Treino A*')).toBe(true)
      const { exercises, ignored } = parsePrescriptionBlock(splitTrainingBlocks(txt, false)[0])
      expect(ignored).toEqual([])
      expect(exercises.map((e) => e.names.join(' + '))).toEqual(['Elevação pélvica', 'Agachamento búlgaro', 'Mesa flexora + Abdutora'])
      expect(week[0].exercises.some((e) => e.changes.length)).toBe(true)
    }
  })
  it('regenerativa: -1 série, 12–15 reps, sem técnicas', () => {
    const week = generateWeek({ base: [{ ...base[0], exercises: [{ ...ex('Leg45', 4, 8), notes: 'Drop set · carga alta' }] }], phase: 'regenerativa', intensity: 0, enfases: [], lookup })
    const [e] = parsePrescriptionBlock(splitTrainingBlocks(weekToWhatsApp(week), false)[0]).exercises
    expect(e.validSets).toBe(3)
    expect(e.reps[0]).toEqual({ min: 12, max: 15 })
    expect(e.dropSet).toBe(false)
  })
  it('restrição de joelho marca o búlgaro para revisão; exercício que o aluno não pode fazer pede troca', () => {
    const t = buildTriage(sections, { [q('dores')]: 'dor no joelho', [q('nao_consegue')]: 'Elevação pélvica' })
    const week = generateWeek({ base, phase: 'ordinaria', intensity: 0, enfases: [], triage: t, lookup })
    expect(week[0].exercises.find((e) => e.names[0] === 'Agachamento búlgaro')?.alert).toMatch(/joelho/)
    expect(weekToWhatsApp(week, true)).toMatch(/\(revisar \(joelho\)\)/)
    expect(week[0].exercises.find((e) => e.names[0] === 'Elevação pélvica')?.alert).toBe('trocar: aluno não pode fazer')
  })
})

describe('choque sem receita fixa', () => {
  const lookup = (k: string) => SEED_PROFILES.find((p) => p.key === k || p.aliases.includes(k))
  const ex = (name: string, sets: number, position: number, reps = 10): SessionExercise => ({
    id: name, position, exercise_key: normalizeKey(name), display_name: name, valid_sets: sets, warmup_sets: 0, heavy_sets: 0,
    reps: Array.from({ length: sets }, () => ({ min: reps, max: reps })), drop_set: false,
  })
  const treino: Session = { id: 's', student_id: 'x', date: '2026-11-23', label: 'Treino A', source: 'whatsapp', muscle_groups: [], created_at: '', updated_at: '',
    exercises: [ex('Agachamento livre', 4, 0), ex('Leg press', 4, 1), ex('Elevação pélvica', 3, 2), ex('Cadeira extensora', 3, 3, 12), ex('Mesa flexora', 3, 4, 12), ex('Abdutora', 3, 5, 15)] }
  const enfases = ['Glúteo', 'Perna - Quadríceps']
  const plan = (seed: number, extra: Partial<Parameters<typeof generateWeek>[0]> = {}) =>
    generateWeek({ base: [treino], phase: 'choque', intensity: 0, enfases, lookup, seed, ...extra })[0].exercises.map((e) => e.changes.filter((c) => c !== '+1 série (ênfase)').join(',') || '-')

  it('varia de uma geração para outra: exercício, posição e variável', () => {
    const plans = new Set(Array.from({ length: 20 }, (_, i) => plan(i + 1).join('|')))
    expect(plans.size).toBeGreaterThan(10)
    const firstGetsDrop = Array.from({ length: 40 }, (_, i) => plan(i + 1)[0] === 'drop set').filter(Boolean).length
    expect(firstGetsDrop).toBeLessThan(10) // nada de "primeiro é sempre drop"
  })
  it('não repete a mesma variável no mesmo treino e respeita o tipo do exercício', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const p = plan(seed).filter((x) => x !== '-')
      expect(new Set(p).size).toBe(p.length)
      const [agach] = plan(seed)
      expect(['drop set', 'rest-pause', 'parciais']).not.toContain(agach) // livre multiarticular: sem drop/rest-pause
    }
  })
  it('evita a variável que o aluno já fez no exercício nas semanas anteriores', () => {
    const hist: Session[] = [{ ...treino, id: 'h', date: '2026-11-02', exercises: treino.exercises.map((e) => ({ ...e, notes: 'Drop set na última · Rest-pause' })) }]
    const count = (h?: Session[]) => Array.from({ length: 60 }, (_, i) => plan(i + 1, { history: h })).flat().filter((x) => x === 'drop set' || x === 'rest-pause').length
    expect(count(hist)).toBeLessThan(count() / 2)
  })
  it('iniciante só recebe variáveis simples', () => {
    const t = buildTriage(sections, { [q('experiencia')]: '3 meses' })
    for (let seed = 1; seed <= 30; seed++) for (const x of plan(seed, { triage: t })) expect(['-', 'excêntrica lenta', 'isometria no pico', '+1 série']).toContain(x)
  })
  it('pirâmide do aluno não ganha série extra', () => {
    const e: SessionExercise = { ...ex('Mesa flexora', 4, 0), reps: [15, 15, 12, 10].map((r) => ({ min: r, max: r })) }
    for (let seed = 1; seed <= 20; seed++) {
      const w = generateWeek({ base: [{ ...treino, exercises: [e] }], phase: 'choque', intensity: 0, enfases: ['Perna - Posterior'], lookup, seed })
      expect(w[0].exercises[0].changes).not.toContain('+1 série (ênfase)')
    }
  })
  it('todas as variáveis saem num texto que o app lê de volta', async () => {
    const { SHOCK_VARIABLES } = await import('../consultoria/shockVariables')
    for (const v of SHOCK_VARIABLES) {
      const r = v.apply({ sets: 4, reps: Array.from({ length: 4 }, () => ({ min: 10, max: 10 })), notes: [] })
      const txt = weekToWhatsApp([{ label: 'Treino A', exercises: [{ names: ['Leg press'], sets: r.sets, warmup: 0, reps: r.reps, notes: r.notes, changes: [] }] }])
      const { exercises, ignored } = parsePrescriptionBlock(splitTrainingBlocks(txt, false)[0])
      expect(ignored, v.id).toEqual([])
      expect(exercises[0].validSets, v.id).toBe(r.sets)
    }
  })
})

describe('ênfase manda na ordem e no volume', () => {
  const lookup = (k: string) => SEED_PROFILES.find((p) => p.key === k || p.aliases.includes(k))
  const ex = (name: string, sets: number, position = 0): SessionExercise => ({
    id: name, position, exercise_key: normalizeKey(name), display_name: name, valid_sets: sets, warmup_sets: 0, heavy_sets: 0,
    reps: Array.from({ length: sets }, () => ({ min: 10, max: 10 })), drop_set: false,
  })
  const sess = (label: string, exs: SessionExercise[]): Session => ({ id: label, student_id: 'x', date: '2026-11-23', label, source: 'whatsapp', muscle_groups: [], created_at: '', updated_at: '', exercises: exs })
  const base = [
    sess('Treino A', [ex('Supino reto', 4), ex('Crucifixo', 3, 1), ex('Tríceps corda', 3, 2)]),
    sess('Treino B', [ex('Puxada frontal', 4), ex('Remada baixa', 3, 1)]),
    sess('Treino C', [ex('Stiff', 3), ex('Elevação pélvica', 3, 1), ex('Mesa flexora', 3, 2)]),
  ]
  it('glúteo + posterior: o treino de posterior vira o Treino A e a ênfase ganha +1 série', async () => {
    const { missingEmphasis } = await import('../consultoria/generator')
    const week = generateWeek({ base, phase: 'ordinaria', intensity: 0, enfases: ['Glúteo', 'Perna - Posterior'], lookup, seed: 7 })
    expect(week.map((t) => t.label)).toEqual(['Treino A', 'Treino B', 'Treino C'])
    expect(week[0].exercises.map((e) => e.names[0])).toEqual(['Stiff', 'Elevação pélvica', 'Mesa flexora'])
    expect(week[0].movedFrom).toBe('Treino C')
    const plus = week[0].exercises.filter((e) => e.sets === 4).length
    expect(plus).toBeGreaterThanOrEqual(1) // +1 série em 1 ou 2 exercícios da ênfase (sorteados), não em todos
    expect(plus).toBeLessThanOrEqual(2)
    expect(week[1].exercises[0].names[0]).toBe('Supino reto') // o resto mantém a ordem
    expect(week[1].exercises[0].sets).toBe(4) // fora da ênfase não muda
    expect(missingEmphasis(base, ['Glúteo', 'Panturrilha'], lookup)).toEqual(['Panturrilha'])
  })
  it('sem ênfase a ordem da semana base fica igual', () => {
    const week = generateWeek({ base, phase: 'ordinaria', intensity: 0, enfases: [], lookup })
    expect(week.map((t) => t.exercises[0].names[0])).toEqual(['Supino reto', 'Puxada frontal', 'Stiff'])
  })
})
