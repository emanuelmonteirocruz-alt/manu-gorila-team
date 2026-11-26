/**
 * Orientação de esforço para o aluno (consultoria): explica, só para o que aparece no treino,
 * que esforço cada faixa de repetições e cada técnica pede. Vai pronta para o WhatsApp.
 * Também alimenta a conferência do "Colar WhatsApp" (o que o app entendeu de cada exercício).
 */
import type { RepRange } from '../domain/types'
import { repWeight } from './metrics'

export type Zone = 'forca' | 'alta' | 'moderada' | 'resistencia' | 'falha'

export function zoneOf(r: RepRange | undefined): Zone | null {
  if (!r) return null
  if (r.failure && !r.min) return 'falha'
  const mid = (r.min + (r.max || r.min)) / 2
  if (mid <= 6) return 'forca'
  if (mid <= 10) return 'alta'
  if (mid <= 15) return 'moderada'
  return 'resistencia'
}

export const ZONE_LABEL: Record<Zone, string> = {
  forca: 'força máxima', alta: 'força alta', moderada: 'esforço moderado', resistencia: 'resistência', falha: 'até a falha',
}

const ZONE_TEXT: Record<Zone, string> = {
  forca: '*Séries de até 6 repetições* (força máxima): carga bem alta. Cada repetição é pesada e a última sai no limite, sem conseguir fazer mais uma com boa técnica.',
  alta: '*Séries de 6 a 10 repetições* (força alta): escolha uma carga que deixe as 2 últimas repetições muito difíceis. Se terminar sentindo que faria mais 3 ou mais, aumente a carga na próxima série.',
  moderada: '*Séries de 11 a 15 repetições* (esforço moderado a alto): carga média, com queimação forte no músculo no final. Termine sentindo que faria no máximo mais 1 ou 2.',
  resistencia: '*Séries acima de 15 repetições* (resistência): carga mais leve, mantendo ritmo e técnica até o fim. A queimação no final é esperada.',
  falha: '*Séries até a falha (Máx)*: faça repetições até não conseguir completar mais nenhuma com boa técnica. Não pare antes.',
}

/** Técnicas reconhecidas na escrita (todas com o mesmo peso no Nível do desafio). */
export const TECHNIQUES: { key: string; label: string; re: RegExp; text: string }[] = [
  { key: 'drop', label: 'Drop-set', re: /\bdrop/i, text: '*Drop-set*: ao terminar a série, reduza a carga em cerca de 20 a 30% e continue sem descanso, até a falha.' },
  { key: 'restpause', label: 'Rest-pause', re: /rest[ -]?pause/i, text: '*Rest-pause*: chegue perto da falha, descanse 10 a 15 segundos e faça mais repetições com a mesma carga.' },
  { key: 'cluster', label: 'Cluster', re: /\bcluster/i, text: '*Cluster*: divida a série em blocos curtos (2 a 3 repetições) com 10 a 20 segundos de pausa entre eles, mantendo a carga alta.' },
  { key: 'biset', label: 'Bi-set', re: /\bbi[ -]?set/i, text: '*Bi-set* (exercícios ligados por +): faça um seguido do outro, sem descanso entre eles; descanse só no final.' },
  { key: 'triset', label: 'Tri-set', re: /\btri[ -]?set/i, text: '*Tri-set*: três exercícios seguidos, sem descanso entre eles; descanse só no final.' },
  { key: 'super', label: 'Super série', re: /super ?s[eé]rie|s[eé]rie gigante|giant/i, text: '*Super série*: exercícios em sequência, sem descanso entre eles, para aumentar a densidade do treino.' },
  { key: 'piramide', label: 'Pirâmide', re: /pir[aâ]mide/i, text: '*Pirâmide*: a cada série as repetições mudam (por exemplo 12/10/8/6) e a carga acompanha: menos repetições, mais carga.' },
  { key: 'fst7', label: 'FST-7', re: /\bfst[ -]?7/i, text: '*FST-7*: 7 séries com descanso curto (30 a 45 segundos), buscando o máximo de bombeamento no músculo.' },
  { key: 'excentrica', label: 'Excêntrica', re: /exc[eê]ntric|negativ/i, text: '*Excêntrica / negativa*: desça o peso devagar, em 3 a 4 segundos, controlando todo o movimento.' },
  { key: 'isometria', label: 'Isometria', re: /isometri|pico de contra/i, text: '*Isometria*: segure a contração no ponto indicado, pelo tempo pedido, sem soltar.' },
  { key: 'cadencia', label: 'Cadência', re: /cad[eê]ncia/i, text: '*Cadência* (ex.: 3-1-1): o 1º número é a descida em segundos, o 2º a pausa e o 3º a subida.' },
]

export interface GuideItem {
  names: string[]
  reps: RepRange[]
  notes?: string
  dropSet?: boolean
}

/** Técnicas presentes num exercício (bi-set = vários nomes ligados por +). */
export function techniquesOf(it: GuideItem): string[] {
  const txt = `${it.names.join(' ')} ${it.notes ?? ''}`
  const out = TECHNIQUES.filter((t) => t.re.test(txt)).map((t) => t.key)
  if (it.dropSet && !out.includes('drop')) out.push('drop')
  if (it.names.length === 2 && !out.includes('biset')) out.push('biset')
  if (it.names.length >= 3 && !out.includes('triset')) out.push('triset')
  return out
}

/** Pontos de desafio de um exercício prescrito (mesma regra do Nível do desafio). */
export function itemPoints(it: GuideItem): number {
  const sets = it.reps.length * Math.max(1, it.names.length)
  const per = it.reps.reduce((a, r) => a + repWeight(r), 0) * Math.max(1, it.names.length)
  const advanced = techniquesOf(it).filter((k) => k !== 'cadencia').length ? sets : 0
  return Math.round((per + advanced) * 10) / 10
}

const ZONE_ORDER: Zone[] = ['forca', 'alta', 'moderada', 'resistencia', 'falha']

/** Mensagem para o WhatsApp explicando o esforço de cada faixa/técnica que aparece no treino. */
export function effortMessage(items: GuideItem[], firstName?: string): string {
  const zones = new Set<Zone>()
  const techs = new Set<string>()
  for (const it of items) {
    for (const r of it.reps) {
      const z = zoneOf(r)
      if (z) zones.add(z)
    }
    for (const t of techniquesOf(it)) techs.add(t)
  }
  const lines: string[] = []
  lines.push(`${firstName ? `${firstName}, ` : ''}*como sentir o esforço neste treino:*`)
  lines.push('')
  for (const z of ZONE_ORDER) if (zones.has(z)) lines.push(`• ${ZONE_TEXT[z]}`)
  const tl = TECHNIQUES.filter((t) => techs.has(t.key))
  if (tl.length) {
    lines.push('')
    lines.push('*Técnicas do treino:*')
    for (const t of tl) lines.push(`• ${t.text}`)
  }
  lines.push('')
  lines.push('A carga certa é a que deixa você no esforço pedido. Se ficou fácil, aumente na próxima série. Qualquer dúvida, me chama aqui.')
  return lines.join('\n')
}
