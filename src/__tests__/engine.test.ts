import { describe, expect, it } from 'vitest'
import { parsePrescriptionLine } from '../engine/prescription'
import { parseWhatsApp } from '../parser/whatsapp'
import { checkPrescriptionLock, weekVerdict, emptyAggregate, divergenceAlert, KCAL_PER_KG_FAT } from '../engine/metrics'

const p = (s: string) => parsePrescriptionLine(s)!

describe('contagem de séries (Módulo 2)', () => {
  it('exclui aquecimento explícito', () => {
    expect(p('Supino reto 2x15 aquecimento').validSets).toBe(0)
    const r = p('Supino halteres 15/15/12/10 Duas primeiras de 15 como aquecimento')
    expect(r.validSets).toBe(2)
    expect(r.warmupSets).toBe(2)
  })
  it('aquecimento + trabalho na mesma linha', () => {
    const r = p('Leg45 2x15 aquecimento + 4x8 Carga alta')
    expect(r.warmupSets).toBe(2)
    expect(r.validSets).toBe(4)
    expect(r.heavySets).toBe(4)
  })
  it('bi-set conta para cada exercício', () => {
    const r = p('Desenvolvimento + Elevação lateral 3x8 a 12/15')
    expect(r.names).toEqual(['Desenvolvimento', 'Elevação lateral'])
    expect(r.validSets * r.names.length).toBe(6)
    expect(r.heavySets).toBe(0)
  })
  it('drop-set conta a série principal', () => {
    const r = p('Pulley frente 3x10 1x drop')
    expect(r.validSets).toBe(3)
    expect(r.dropSet).toBe(true)
  })
})

describe('séries pesadas', () => {
  it('pirâmides', () => {
    expect(p('Hack 12/10/8/8').heavySets).toBe(2)
    expect(p('Hack 15/12/10/8').heavySets).toBe(1)
  })
  it('10 fixo é moderado mesmo com "pesado"; 8 a 10 é pesado', () => {
    expect(p('Remada baixa 4x10 pesado').heavySets).toBe(0)
    expect(p('Remada baixa 4x8 a 10').heavySets).toBe(4)
    expect(p('Stiff 3x6 a 8').heavySets).toBe(3)
  })
  it('extrai carga em kg', () => {
    expect(p('Extensora 4x15 20kg').loadKg).toBe(20)
  })
})

describe('parser WhatsApp', () => {
  const raw = `[11/10, 21:44] Emanuel Monteiro: Leg45 2x15 aquecimento + 4x8 Carga alta
Extensora 3x12 Amplitude máxima
[11/10, 21:45] Emanuel Monteiro: Supino halteres 4x8 a 10
Cross over 3x12
[12/10, 08:00] Aluna: Bom dia!
[20/10, 10:00] Emanuel Monteiro: Pulley frente 3x10 1x drop`
  it('separa treinos e agrupa por semana', () => {
    const weeks = parseWhatsApp(raw, { ref: new Date(2026, 10, 1) })
    expect(weeks).toHaveLength(2)
    expect(weeks[0].trainings.map((t) => t.label)).toEqual(['Treino A', 'Treino B'])
    expect(weeks[1].trainings[0].label).toBe('Treino A')
    expect(weeks[0].trainings[0].exercises).toHaveLength(2)
  })
})

describe('travas e PSE', () => {
  it('bloqueia choque em semana menstrual', () => {
    const ctx = { id: '1', student_id: 's', week_start: '2026-11-23', menstrual: true, diet: 'manutencao' as const, updated_at: '' }
    expect(checkPrescriptionLock('F', ctx, 'choque').allowed).toBe('regenerativa')
    const cur = { ...emptyAggregate(), validSets: 30, heavySets: 15 }
    const prev = { ...emptyAggregate(), validSets: 20, heavySets: 5 }
    expect(weekVerdict(cur, prev, ctx).final).toBe('regenerativa')
  })
  it('alerta divergência ordinária com PSE 9', () => {
    expect(divergenceAlert('ordinaria', 9, { sleep: 'mal' })?.reasons).toContain('dormiu mal')
    expect(divergenceAlert('ordinaria', 7)).toBeNull()
    expect(KCAL_PER_KG_FAT).toBe(7700)
  })
})

import { parseSpoken, wordsToNumbers } from '../voice/spokenParser'
describe('voz', () => {
  it('converte números por extenso', () => {
    expect(wordsToNumbers('duzentos e cinquenta quilos')).toBe('250 quilos')
  })
  it('estrutura o ditado', () => {
    const r = parseSpoken('extensora, quatro séries de 15 com 20 kg; leg press 45 com 200 kg')
    expect(r).toHaveLength(2)
    expect(r[0]).toMatchObject({ name: 'extensora', sets: 4, repsMin: 15, loadKg: 20 })
    expect(r[1]).toMatchObject({ name: 'leg press 45', loadKg: 200, needsReview: true })
  })
  it('separa por "depois" e faixas', () => {
    const r = parseSpoken('hack três séries de oito a dez com cento e vinte quilos depois stiff três séries de doze')
    expect(r[0]).toMatchObject({ name: 'hack', sets: 3, repsMin: 8, repsMax: 10, loadKg: 120 })
    expect(r[1]).toMatchObject({ name: 'stiff', sets: 3, repsMin: 12 })
  })
})

describe('ditado corrido', () => {
  it('separa exercícios sem pausa após a carga', () => {
    const r = parseSpoken('Extensora, quatro séries de 15 com 20 kg leg press 45 quatro séries de 10 com 200 kg carga fixa. Stiff três séries de 12')
    expect(r.map((e) => e.name)).toEqual(['extensora', 'leg press 45', 'stiff'])
    expect(r[1]).toMatchObject({ sets: 4, repsMin: 10, loadKg: 200 })
  })
})

import { autocorrect } from '../voice/autocorrect'
import { SEED_PROFILES } from '../engine/exerciseSeed'
describe('autocorreção de voz', () => {
  const ctx = (g: string[]) => ({ activeGroups: g, cache: SEED_PROFILES })
  it('subindo → supino pelo contexto', () => {
    expect(autocorrect('subindo reto quatro séries de 10', ctx([])).text).toMatch(/^supino reto/i)
    expect(autocorrect('subindo, três séries de 12', ctx(['Peito'])).text).toMatch(/^supino/i)
    expect(autocorrect('subindo a carga', ctx(['Perna - Quadríceps'])).text).toMatch(/^subindo/)
  })
  it('pulley, agachamento, leg, extensora, flexora', () => {
    expect(autocorrect('pulei frente três séries de 10', ctx([])).text).toMatch(/^pulley frente/i)
    expect(autocorrect('pula três séries de 10', ctx(['Costas'])).text).toMatch(/^pulley/i)
    expect(autocorrect('agachando livre quatro séries de 8', ctx([])).text).toMatch(/^agachamento livre/i)
    expect(autocorrect('legue press quatro séries de 10 com 200 kg', ctx([])).text).toMatch(/^leg/i)
    const r = autocorrect('extensor três séries de 12, flexor três séries de 12', ctx([]))
    expect(r.text).toMatch(/^extensora.*flexora/i)
    expect(r.changes.length).toBeGreaterThanOrEqual(2)
  })
  it('fonética com o cache', () => {
    expect(autocorrect('remada baicha quatro séries de 10', ctx(['Costas'])).text).toMatch(/^remada baixa/i)
    expect(autocorrect('elevassão lateral três séries de 12', ctx(['Ombro'])).text).toMatch(/^elevação lateral/i)
  })
})

describe('séries progressivas por voz', () => {
  it('resumo: buscando 10, 20→50 de cada lado, 5 séries (completa com a última carga)', () => {
    const r = parseSpoken('supino reto, cinco séries buscando 10 repetições, progredindo de 20 kg de cada lado, 30 de cada lado, 40 de cada lado, 50 de cada lado')
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ name: 'supino reto', sets: 5, perSide: true, loadKg: 50, repsMin: 10 })
    expect(r[0].series.map((s) => s.kg)).toEqual([20, 30, 40, 50, 50])
  })
  it('do máximo, começou com / foi para', () => {
    const r = parseSpoken('supino máquina, quatro séries do máximo, começou com 20 de cada lado, foi para 30, 40, 50 de cada lado')
    expect(r).toHaveLength(1)
    expect(r[0].series.map((s) => s.kg)).toEqual([20, 30, 40, 50])
    expect(r[0].series.every((s) => s.failure)).toBe(true)
    expect(r[0].perSide).toBe(true)
  })
  it('série a série e listas por extenso', () => {
    expect(parseSpoken('supino reto, 20 de cada lado')[0]).toMatchObject({ name: 'supino reto', perSide: true, loadKg: 20, sets: 1 })
    expect(parseSpoken('leg press quatro séries de dez, quarenta e cinquenta quilos')[0].series.map((s) => s.kg)).toEqual([40, 50, 50, 50])
  })
})

import { tonnage } from '../engine/metrics'
describe('tonelagem por série', () => {
  it('kg/lado conta em dobro; cargas individuais por série', () => {
    const base = { id: 'x', position: 0, exercise_key: 'supino', display_name: 'Supino', warmup_sets: 0, heavy_sets: 0, drop_set: false }
    const reps = [10, 10].map(() => ({ min: 10, max: 10 }))
    expect(tonnage({ ...base, valid_sets: 2, reps, loads: [20, 30] })).toBe(500)
    expect(tonnage({ ...base, valid_sets: 2, reps, loads: [20, 30], per_side: true })).toBe(1000)
  })
})

describe('autocorreção não estraga nomes compostos', () => {
  it('supino máquina continua supino máquina', () => {
    expect(autocorrect('supino máquina quatro séries de 10', { activeGroups: ['Peito'], cache: SEED_PROFILES }).text).toMatch(/^supino máquina/)
  })
})

describe('digitação manual (mesmo motor da voz)', () => {
  it('Extensora 4x15 30kg', () => {
    const r = parseSpoken('Extensora 4x15 30kg')
    expect(r[0]).toMatchObject({ name: 'extensora', sets: 4, repsMin: 15, loadKg: 30 })
    expect(r[0].series).toHaveLength(4)
  })
  it('Supino máquina, 4 séries do máximo, 20, 30, 40, 50 kg de cada lado', () => {
    const r = parseSpoken('Supino máquina, 4 séries do máximo, 20, 30, 40, 50 kg de cada lado')
    expect(r).toHaveLength(1)
    expect(r[0].series.map((x) => x.kg)).toEqual([20, 30, 40, 50])
    expect(r[0].perSide).toBe(true)
    expect(r[0].series[0].failure).toBe(true)
  })
  it('3x8-10 com 60 kg', () => {
    expect(parseSpoken('hack 3x8-10 com 60 kg')[0]).toMatchObject({ sets: 3, repsMin: 8, repsMax: 10, loadKg: 60 })
  })
})

import { changeStatus, suggestNextChange } from '../domain/plan'
describe('troca de treino (consultoria)', () => {
  it('sugere pela periodicidade e alerta com 2 dias', () => {
    expect(suggestNextChange('quinzenal', '2026-11-25')).toBe('2026-12-10')
    expect(changeStatus({ modality: 'online', next_change_date: '2026-11-27' }, '2026-11-25')?.level).toBe('proximo')
    expect(changeStatus({ modality: 'online', next_change_date: '2026-11-25' }, '2026-11-25')?.level).toBe('hoje')
    expect(changeStatus({ modality: 'online', next_change_date: '2026-11-20' }, '2026-11-25')?.level).toBe('vencido')
    expect(changeStatus({ modality: 'online', next_change_date: '2026-12-10' }, '2026-11-25')).toBeNull()
    expect(changeStatus({ modality: 'presencial', next_change_date: '2026-11-20' }, '2026-11-25')).toBeNull()
  })
})

describe('blocos de aquecimento + trabalho no mesmo exercício', () => {
  it('2 de aquecimento com 50 kg e 3x8 com 90 kg', () => {
    const r = parseSpoken('extensora, 2 séries de 20 de aquecimento com 50 kg e 3 séries de 8 com 90 kg')
    expect(r).toHaveLength(1)
    expect(r[0].series.map((x) => [x.kg, x.repsMin, !!x.warmup])).toEqual([[50, 20, true], [50, 20, true], [90, 8, false], [90, 8, false], [90, 8, false]])
    expect(r[0].loadKg).toBe(90)
    expect(r[0].warmup).toBe(false)
  })
  it('aquecimento sozinho continua aquecimento', () => {
    const r = parseSpoken('supino 2 séries de 15 aquecimento com 20 kg')
    expect(r[0].series.every((x) => x.warmup)).toBe(true)
  })
})

import { parsePlainTrainings, regroupByDate } from '../parser/whatsapp'
describe('colar sem WhatsApp e datas escolhidas (retroativo)', () => {
  it('separa por "Treino A/B" e por 2 linhas em branco', () => {
    const t = parsePlainTrainings('Treino A\nLeg45 4x10\nExtensora 3x12\nTreino B\nSupino reto 4x8\nRemada baixa 3x10', '2026-09-01')
    expect(t.map((x) => x.exercises.length)).toEqual([2, 2])
    const t2 = parsePlainTrainings('Leg45 4x10\nExtensora 3x12\n\n\nSupino reto 4x8', '2026-09-01')
    expect(t2).toHaveLength(2)
  })
  it('reagrupa pelas datas definidas', () => {
    const t = parsePlainTrainings('Treino A\nLeg45 4x10\nTreino B\nSupino 4x8\nTreino C\nRemada baixa 3x10', '2026-09-01')
    const weeks = regroupByDate([{ ...t[0], date: '2026-09-01' }, { ...t[1], date: '2026-09-03' }, { ...t[2], date: '2026-09-08' }])
    // a letra do treino é mantida: o Treino C feito na semana seguinte continua sendo "Treino C"
    expect(weeks.map((w) => [w.week, w.trainings.map((x) => x.label)])).toEqual([['2026-08-31', ['Treino A', 'Treino B']], ['2026-09-07', ['Treino C']]])
  })
})

import { parseWhatsAppTrainings } from '../parser/whatsapp'
describe('WhatsApp: 4 semanas, cada mensagem com 4 treinos', () => {
  const week = (d: string, fmt: 'ios' | 'web', who = 'Emanuel Monteiro') => {
    const head = fmt === 'ios' ? `[${d}, 21:44] ${who}:` : `[21:44, ${d}/2026] ${who}:`
    return `${head} *Treino A*\nLeg45 2x15 aquecimento + 4x8\nExtensora 3x12\n*Treino B*\nSupino reto 4x8\nCrucifixo 3x12\n\n*Treino C*\nStiff 3x10\nFlexora deitada 3x12\nTREINO D - Ombro\nDesenvolvimento + Elevação lateral 3x8 a 12/15`
  }
  it('separa 16 treinos em 4 blocos pela data', () => {
    const raw = ['08/11', '15/11', '22/11', '29/11'].map((d) => week(d, 'ios')).join('\n')
    const weeks = parseWhatsApp(raw, { trainerName: 'Emanuel Monteiro', ref: new Date(2026, 11, 1) })
    expect(weeks).toHaveLength(4)
    expect(weeks.map((w) => w.trainings.map((t) => t.label).join(''))).toEqual(['Treino ATreino BTreino CTreino D', 'Treino ATreino BTreino CTreino D', 'Treino ATreino BTreino CTreino D', 'Treino ATreino BTreino CTreino D'])
    expect(weeks[0].trainings[0].date).toBe('2026-11-08')
  })
  it('formato do WhatsApp Web ([21:44, 08/11/2026]) e remetente diferente ("Você")', () => {
    const raw = [week('08/11', 'web', 'Você'), week('22/11', 'web', 'Você')].join('\n')
    const t = parseWhatsAppTrainings(raw, { trainerName: 'Emanuel Monteiro' })
    expect(t).toHaveLength(8)
    expect(t[4].date).toBe('2026-11-22')
  })
})

import { readFileSync } from 'node:fs'
describe('formato real do treinador (nome numa linha, séries na de baixo)', () => {
  const raw = readFileSync(new URL('./fixtures/whatsapp-blocos.txt', import.meta.url), 'utf8')
  const weeks = parseWhatsApp(raw, { trainerName: 'Emanuel Monteiro', ref: new Date(2026, 10, 25) })
  it('8 treinos em 2 blocos (08/11 e 22/11)', () => {
    expect(weeks.map((w) => [w.trainings[0].date, w.trainings.length])).toEqual([['2026-11-08', 4], ['2026-11-22', 4]])
    expect(weeks.flatMap((w) => w.trainings.map((t) => t.exercises.length))).toEqual([5, 7, 5, 6, 5, 5, 5, 5])
  })
  it('contagens e observações', () => {
    const [a, , c] = weeks[0].trainings
    expect(a.exercises.map((e) => [e.names.join('+'), e.validSets, e.heavySets])).toEqual([
      ['Mesa flexora', 4, 0], ['Agachamento livre pes sumo', 3, 1], ['Abdutora', 4, 0], ['Leg45 pes sumo', 4, 4], ['Búlgaro com carga', 3, 0],
    ])
    expect(a.exercises[3].notes).toMatch(/Amplitude maxima/)
    expect(a.exercises[4].notes).toMatch(/Ou afundo/)
    expect(c.exercises[0]).toMatchObject({ names: ['Afundo'], validSets: 0, warmupSets: 4 }) // "Aquecimento sem carga"
    expect(c.exercises[3].names).toEqual(['Banco extensor', 'afundo com carga']) // bi-set 4x10/10
    const e = weeks[1].trainings
    expect(e[0].exercises[0]).toMatchObject({ names: ['Mesa flexor'], validSets: 5, heavySets: 3 }) // 2x15 + 3x8 a 10
    expect(e[2].exercises[0]).toMatchObject({ names: ['Agachamento hack'], warmupSets: 2, validSets: 3 })
    expect(e[2].exercises[1]).toMatchObject({ names: ['Banco extensor'], validSets: 4, heavySets: 2 })
  })
})

import { formatTraining, learnStyle } from '../copilot/generator'
describe('copiloto escreve no estilo em blocos do treinador', () => {
  it('detecta o estilo e o texto gerado volta a ser lido igual', () => {
    const raw = readFileSync(new URL('./fixtures/whatsapp-blocos.txt', import.meta.url), 'utf8')
    expect(learnStyle([raw]).multiline).toBe(true)
    const txt = formatTraining({ label: 'Treino A', mainGroup: 'x', lines: [
      { names: ['Leg45'], profiles: [], warmup: 2, sets: 4, range: { min: 8, max: 8 }, pyramid: null, drop: false, notes: ['Amplitude maxima'] },
      { names: ['Extensora'], profiles: [], warmup: 0, sets: 3, range: { min: 12, max: 12 }, pyramid: null, drop: false, notes: [] },
    ] }, null, true)
    expect(txt).toBe('Leg45\n2x15 aquecimento\n4x8\nAmplitude maxima\n\nExtensora\n3x12')
    const back = parseWhatsApp(`[01/11, 10:00] Emanuel Monteiro: ${txt}`, { ref: new Date(2026, 10, 25) })[0].trainings[0].exercises
    expect(back.map((e) => [e.names[0], e.validSets, e.warmupSets])).toEqual([['Leg45', 4, 2], ['Extensora', 3, 0]])
  })
})

describe('autocorreção: horários viram faixas e "trem" vira treino', () => {
  const ctx = { activeGroups: ['Peito'], cache: SEED_PROFILES }
  it('8:10, 6:08, 10:12, 17:12', () => {
    expect(autocorrect('supino reto 3 séries de 8:10', ctx).text).toMatch(/3 séries de 8 a 10/)
    expect(autocorrect('stiff 4 séries de 6:08', ctx).text).toMatch(/6 a 8/)
    expect(autocorrect('crucifixo 3 séries de 10:12', ctx).text).toMatch(/10 a 12/)
    expect(autocorrect('crucifixo 3 séries de 17:12', ctx).text).toMatch(/10 a 12/)
    expect(parseSpoken(autocorrect('supino reto 3 séries de 8:10 com 30 kg', ctx).text)[0]).toMatchObject({ repsMin: 8, repsMax: 10, loadKg: 30 })
  })
  it('trem → treino', () => {
    expect(autocorrect('trem b', ctx).text).toBe('treino b')
  })
})

describe('fatiamento de aquecimento na mesma linha', () => {
  it('Supino reto 2x15 aquecimento 3x10 · Banco extensor 2x15 aquecimento + 3x8 · Voador 15/15/12/10', () => {
    expect(parsePrescriptionLine('Supino reto 2x15 aquecimento 3x10')).toMatchObject({ warmupSets: 2, validSets: 3 })
    expect(parsePrescriptionLine('Banco extensor 2x15 aquecimento + 3x8')).toMatchObject({ warmupSets: 2, validSets: 3, heavySets: 3 })
    expect(parsePrescriptionLine('Voador 15/15/12/10 duas primeiras de 15 como aquecimento')).toMatchObject({ warmupSets: 2, validSets: 2 })
    expect(parsePrescriptionLine('Remada baixa 4x10')).toMatchObject({ warmupSets: 0, validSets: 4 })
  })
})

import { intensityIndex } from '../engine/metrics'
describe('índice de intensidade (não depende só de 6–8 reps)', () => {
  it('treino de 12–15 com Máx, bi-sets e multiarticulares livres não fica "fraco"', () => {
    const base = { validSets: 20, multiSets: 14, freeSets: 12 }
    const so68 = intensityIndex({ ...base, heavySets: 0, markedSets: 0, techniqueSets: 0 })
    const denso = intensityIndex({ ...base, heavySets: 0, markedSets: 10, techniqueSets: 8 })
    expect(denso).toBeGreaterThan(so68 + 25)
    expect(intensityIndex({ validSets: 0, heavySets: 0, markedSets: 0, techniqueSets: 0, multiSets: 0, freeSets: 0 })).toBe(0)
  })
})

describe('nome padrão com número', () => {
  it('leg press 45 → Leg45 (sem repetir o 45)', () => {
    const r = autocorrect('leg press 45 4 séries de 10 com 100 kg', { activeGroups: [], cache: SEED_PROFILES })
    expect(r.text).toMatch(/^Leg45 4 séries/)
    expect(parseSpoken(r.text)[0]).toMatchObject({ name: 'leg45', sets: 4, loadKg: 100 })
  })
})
