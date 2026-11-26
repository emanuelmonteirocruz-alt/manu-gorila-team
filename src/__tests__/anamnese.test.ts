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

describe('anamnese: modelo, leitura e triagem', () => {
  it('modelo padrão vira seções e perguntas com campos e opções', () => {
    expect(sections.map((s) => s.title)).toEqual(['Objetivo', 'Saúde e restrições', 'Experiência e rotina', 'Preferências', 'Contexto'])
    expect(sections[0].questions[0].options).toContain('Hipertrofia (ganhar massa)')
  })
  it('lê anamnese respondida colada (pergunta + resposta)', () => {
    const txt = `Qual é o seu principal objetivo com o treino?\nGanhar massa, principalmente bumbum\n\nQuais músculos você mais quer desenvolver ou destacar?\nGlúteo e posterior\n\nSente dor em alguma articulação ou região ao treinar (ombro, joelho, lombar...)?\nSim, dor no joelho direito quando agacho fundo\n\nQuantos dias por semana pode treinar? 4\nHá quanto tempo treina musculação?: 3 anos`
    const a = answersFromPasted(txt, sections)
    expect(a[q('objetivo')]).toMatch(/Ganhar massa/)
    expect(a[q('enfase')]).toBe('Glúteo e posterior')
    expect(a[q('dores')]).toMatch(/joelho/)
    expect(a[q('dias')]).toBe('4')
    const t = buildTriage(sections, a)
    expect(t.objetivoTipo).toBe('hipertrofia')
    expect(t.enfases).toEqual(['Glúteo', 'Perna - Posterior'])
    expect(t.restricoes.map((r) => r.area)).toEqual(['joelho'])
    expect(t.dias).toBe(4)
    expect(t.experiencia).toBe('avancado')
    const r = remindersFor(t, t.enfases)
    expect(r.processos.join(' ')).toMatch(/glúteo médio/i)
    expect(r.evitar.join(' ')).toMatch(/Joelho/)
  })
  it('respostas "não / nenhuma" não viram restrição', () => {
    const t = buildTriage(sections, { [q('lesoes')]: 'não', [q('dores')]: 'Nenhuma' })
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
  it('choque: +1 série na ênfase, reps mais baixas, drop na ênfase; volta a ser lido pelo Colar WhatsApp', () => {
    const week = generateWeek({ base, phase: 'choque', intensity: 0, enfases: ['Glúteo'], lookup })
    const txt = weekToWhatsApp(week)
    expect(txt.startsWith('*Treino A*')).toBe(true)
    const blocks = splitTrainingBlocks(txt, false)
    const { exercises, ignored } = parsePrescriptionBlock(blocks[0])
    expect(ignored).toEqual([])
    expect(exercises[0].names).toEqual(['Elevação pélvica'])
    expect(exercises[0].validSets).toBe(4)               // +1 série (ênfase)
    expect(exercises[0].reps[0]).toEqual({ min: 10, max: 10 }) // 12 → 10
    expect(exercises[0].dropSet).toBe(true)
    expect(exercises.find((e) => e.names.length === 2)?.names).toEqual(['Mesa flexora', 'Abdutora']) // bi-set preservado
  })
  it('regenerativa: -1 série, 12–15 reps, sem técnicas', () => {
    const week = generateWeek({ base: [{ ...base[0], exercises: [{ ...ex('Leg45', 4, 8), notes: 'Drop set · carga alta' }] }], phase: 'regenerativa', intensity: 0, enfases: [], lookup })
    const [e] = parsePrescriptionBlock(splitTrainingBlocks(weekToWhatsApp(week), false)[0]).exercises
    expect(e.validSets).toBe(3)
    expect(e.reps[0]).toEqual({ min: 12, max: 15 })
    expect(e.dropSet).toBe(false)
  })
  it('restrição de joelho marca o búlgaro para revisão', () => {
    const t = buildTriage(sections, { [q('dores')]: 'dor no joelho' })
    const week = generateWeek({ base, phase: 'ordinaria', intensity: 0, enfases: [], triage: t, lookup })
    expect(week[0].exercises.find((e) => e.names[0] === 'Agachamento búlgaro')?.alert).toMatch(/joelho/)
    expect(weekToWhatsApp(week, true)).toMatch(/\(revisar \(joelho\)\)/)
  })
})

describe('rascunho: pirâmide mantém o formato', () => {
  it('choque desce a pirâmide inteira em números usuais e não acrescenta série', () => {
    const e: SessionExercise = { id: 'm', position: 0, exercise_key: 'mesa flexora', display_name: 'Mesa flexora', valid_sets: 4, warmup_sets: 0, heavy_sets: 0, reps: [15, 15, 12, 10].map((r) => ({ min: r, max: r })), drop_set: false }
    const s: Session = { id: 's', student_id: 'x', date: '2026-11-23', label: 'Treino A', source: 'whatsapp', muscle_groups: [], created_at: '', updated_at: '', exercises: [e] }
    const week = generateWeek({ base: [s], phase: 'choque', intensity: 0, enfases: ['Perna - Posterior'], lookup: (k) => SEED_PROFILES.find((p) => p.key === k || p.aliases.includes(k)) })
    expect(weekToWhatsApp(week).split('\n')[2]).toBe('12/12/10/8')
  })
})
