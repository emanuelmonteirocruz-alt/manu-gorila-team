import { describe, expect, it } from 'vitest'
import { effortMessage, itemPoints, techniquesOf } from '../engine/effortGuide'
import { parsePrescriptionBlock } from '../engine/prescription'

const T = `Supino reto\n4x6-8\nCluster na última\n\nCrucifixo\n3x12\nDrop set\n\nLeg45\n4x10\nRest pause\n\nRemada curvada + Pulley\n3x10\n\nExtensora\n3xMáx\n\nAgachamento\npirâmide 12/10/8/6`

describe('treino colado: leitura, técnicas e orientação de esforço', () => {
  const { exercises, ignored } = parsePrescriptionBlock(T)
  it('reconhece tudo, inclusive 3xMáx e pirâmide em linha própria', () => {
    expect(ignored).toEqual([])
    expect(exercises.map((e) => e.names.join(' + '))).toEqual(['Supino reto', 'Crucifixo', 'Leg45', 'Remada curvada + Pulley', 'Extensora', 'Agachamento'])
    expect(exercises[4].reps.every((r) => r.failure)).toBe(true)
    expect(exercises[5].reps.map((r) => r.min)).toEqual([12, 10, 8, 6])
  })
  it('técnicas: cluster, drop, rest-pause, bi-set, pirâmide', () => {
    const t = exercises.map((e) => techniquesOf({ names: e.names, reps: e.reps, notes: e.notes, dropSet: e.dropSet }))
    expect(t).toEqual([['cluster'], ['drop'], ['restpause'], ['biset'], [], ['piramide']])
    // supino 4x6-8 (2 pts/série) + cluster (+1/série) = 12
    expect(itemPoints({ names: ['Supino reto'], reps: exercises[0].reps, notes: exercises[0].notes })).toBe(12)
  })
  it('mensagem só com as faixas e técnicas que aparecem', () => {
    const msg = effortMessage(exercises.map((e) => ({ names: e.names, reps: e.reps, notes: e.notes, dropSet: e.dropSet })), 'Maria')
    expect(msg).toMatch(/^Maria, \*como sentir o esforço/)
    expect(msg).toMatch(/6 a 10 repetições/)
    expect(msg).toMatch(/até a falha \(Máx\)/)
    expect(msg).toMatch(/\*Cluster\*/)
    expect(msg).toMatch(/\*Drop-set\*/)
    expect(msg).not.toMatch(/FST-7|acima de 15/)
  })
})
