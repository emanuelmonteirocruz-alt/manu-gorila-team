/**
 * Templates de relatório (Módulo 5) — PDF vetorial "modo limpo" para WhatsApp.
 * Visual primeiro: barras, curvas, setas e números grandes; só rótulos essenciais
 * (a explicação vai no áudio do treinador). Sem notas de rodapé nem textos técnicos.
 */
import type { jsPDF } from 'jspdf'
import type { BestSet, LoadRow } from '../data/reportData'
import { saveFile } from '../artifact/claude'
import { DIET_LABEL, type Microcycle, type Session, type WeekContext } from '../domain/types'
import { aggregateSessions, challengeLevel, fmtBR, fmtNum, type Aggregate, type ProfileLookup, type WeekVerdict } from '../engine/metrics'
import {
  C, PAGE, applyBrand, badgeRow, card, chartSeal, deltaPill, fill, header, iconFlame, iconTrend, legend, lineSeries,
  muscleRanking, newDoc, ring, seal, sectionTitle, text, type MuscleRow, type PdfBrand,
} from './charts'

export interface WeekPoint {
  week: string
  firstDate?: string // data do 1º treino da semana (rótulo do bloco nos gráficos)
  agg: Aggregate
  verdict: WeekVerdict
  ctx?: WeekContext
  sleep: { bem: number; mal: number; irregular: number }
}

export interface ReportOptions {
  studentName?: string
  showName: boolean
  showEmphasis: boolean // "Especificar musculatura com mais intensidade e volume"
  brand?: PdfBrand
  /** layout por modalidade: consultoria SEM nada de carga em kg; presencial COM tonelagem */
  modality?: 'online' | 'presencial'
  /** consultoria: pontos por treino da 1ª semana do aluno (= 100 no Nível do desafio) */
  challenge?: { baseSession: number; baseWeek: string; byLabel?: Record<string, number> }
  /** fase (microciclo) da semana do treino, para o selo "Fase atual" */
  phase?: Microcycle | null
  /** cardio do período (dia, semana ou mês do relatório): entra no quadro de calorias */
  cardio?: { kcal: number; minutes: number; sessions: number; days: number } | null
  /** Treino do dia: séries da última vez desse mesmo treino (para "+2 vs último Treino A") */
  prevSame?: { sets: number; label: string } | null
  /** Treino do dia: maior série da última vez em cada exercício ("10 × 36 kg") */
  lastTop?: Record<string, string>
}

/** Nomes das fases para o ALUNO (os relatórios valorizam a evolução; o app continua com ordinária/choque/regenerativa). */
export const PHASE_NAME: Record<Microcycle, string> = {
  ordinaria: 'Fase de consolidação',
  regenerativa: 'Base e controle técnico',
  choque: 'Pico de estímulo',
}

const W = PAGE.w - PAGE.m * 2
const nm = (o: ReportOptions) => (o.showName ? o.studentName : undefined)

/**
 * Consultoria: o treinador não acompanha a execução, então "série pesada" e índice de intensidade
 * não são confiáveis. Os PDFs da consultoria mostram só VOLUME (séries, séries/treino, treinos, grupos).
 */
let VOLUME_ONLY = false
let CARDIO: ReportOptions['cardio'] = null
function start(o: ReportOptions): jsPDF {
  applyBrand(o.brand)
  VOLUME_ONLY = o.modality === 'online'
  CH_BASE = o.challenge?.baseSession
  CH_LABEL = o.challenge?.byLabel ?? {}
  CARDIO = o.cardio && o.cardio.sessions > 0 ? o.cardio : null
  BEFORE_LBL = 'antes'; AFTER_LBL = 'depois'
  return newDoc()
}
// grupos realmente trabalhados (músculo auxiliar com pouca fração não conta como "grupo do treino")
/** Músculos que o aluno TREINOU: pelo músculo principal de cada exercício (remada = Costas, não "Costas e Bíceps"). */
const trainedGroups = (a: Aggregate): [string, number][] =>
  a.primaryGroups ? Object.entries(a.primaryGroups).filter(([g, v]) => g !== 'Indefinido' && v > 0).sort((x, z) => z[1] - x[1])
    : Object.entries(a.byGroup).filter(([g, v]) => g !== 'Indefinido' && v.valid >= 3).sort((x, z) => z[1].valid - x[1].valid).map(([g, v]) => [g, v.valid])
const groupsCount = (a: Aggregate) => trainedGroups(a).length
const perSession = (a: Aggregate) => (a.sessions ? Math.round(a.validSets / a.sessions) : a.validSets)
let CH_BASE: number | undefined // pontos por treino da 1ª semana (definido no start)
let CH_LABEL: Record<string, number> = {} // 1ª vez de cada treino (A, B…)
/** Nível de UM treino: comparado com a 1ª vez desse mesmo treino (A × primeiro A). */
const levelOfTraining = (label: string, a: Aggregate) => (CH_LABEL[label] ? Math.round((a.challengePoints / CH_LABEL[label]) * 100) : levelOf(a))
/** Nível do desafio do período (1ª semana do aluno = 100). */
const levelOf = (a: Aggregate) => challengeLevel(a, CH_BASE)
const levelSub = (lv: number) => (lv > 100 ? `+${lv - 100}% desde o início` : lv === 100 ? 'nível de estímulo inicial' : 'fase mais leve')

const pct = (cur: number, prev: number | undefined | null) => (prev ? ((cur - prev) / prev) * 100 : null)
const isOnline = (o: ReportOptions) => o.modality === 'online'
const intensityOf = (a: Aggregate, o: ReportOptions) => (isOnline(o) ? a.intensityPrescribed : a.intensityReal)
const kgShort = (t: number) => (t > 0 ? `${fmtNum(t)} kg` : '—')
// coluna da direita das barras: tonelagem no presencial; índice de intensidade na consultoria (sem kg)
const rightOf = (a: Aggregate, o: ReportOptions) => (isOnline(o) ? (o.challenge ? `desafio ${challengeLevel(a, o.challenge.baseSession) ?? '—'}` : `${a.sessions} ${a.sessions === 1 ? 'treino' : 'treinos'}`) : kgShort(a.tonnageKg))
const rightLabelOf = (o: ReportOptions) => (isOnline(o) ? (o.challenge ? 'Nível de estímulo' : 'Treinos') : 'Quilos levantados')
const BOTTOM = PAGE.h - 14

/** Grupamentos ordenados por volume + intensidade (base do "Foco muscular"). */
function musclesOf(a: Aggregate, prev?: Aggregate): MuscleRow[] {
  return Object.entries(a.byGroup)
    .map(([group, v]) => ({ group, valid: Math.round(v.valid), heavy: Math.round(v.heavy), prev: prev ? Math.round(prev.byGroup[group]?.valid ?? 0) : undefined }))
    .sort((x, y) => y.valid - x.valid || y.heavy - x.heavy) // líder = mais volume; desempate por pesadas
}

/** Seção "Foco muscular" (opção "Especificar musculatura com mais intensidade e volume"). */
function focusSection(d: jsPDF, y: number, a: Aggregate, prev?: Aggregate, maxRows = 5): number {
  const rows = musclesOf(a, prev).filter((r) => r.group !== 'Indefinido' && r.valid > 0).slice(0, maxRows).map((r) => (VOLUME_ONLY ? { ...r, heavy: 0 } : r))
  if (!rows.length) return y
  const total = Object.values(a.byGroup).reduce((s, v) => s + v.valid, 0) || 1
  const lead = rows[0] // foco MEDIDO no que foi prescrito
  sectionTitle(d, 'Foco muscular', y + 6)
  chartSeal(d, PAGE.m + W, y + 6)
  y += 14
  // manchete visual do foco
  const hardest = [...rows].sort((x, z) => z.heavy - x.heavy)[0]
  card(d, PAGE.m, y, W, 30, C.zone.choque)
  text(d, `Ênfase em ${lead.group.replace('Perna - ', '')}`, PAGE.m + 10, y + 19, { size: 12, bold: true, c: C.heavy })
  const sub = VOLUME_ONLY
    ? `${Math.round((lead.valid / total) * 100)}% do volume · ${lead.valid} séries`
    : hardest.group !== lead.group && hardest.heavy > lead.heavy
    ? `${Math.round((lead.valid / total) * 100)}% do volume · mais pesadas: ${hardest.group.replace('Perna - ', '')} (${hardest.heavy})`
    : `${Math.round((lead.valid / total) * 100)}% do volume · ${lead.heavy} pesadas`
  text(d, sub, PAGE.m + W - 10, y + 19, { size: 7, bold: true, c: C.heavy, align: 'right' })
  y += 36
  // consultoria sem "antes": uma barra só, a legenda não acrescenta nada (economiza espaço)
  if (prev) legend(d, PAGE.m, y, VOLUME_ONLY ? [{ c: C.volume, l: 'Séries agora' }, { c: C.grid, l: 'Antes' }] : [{ c: C.volume, l: 'Séries agora' }, { c: C.grid, l: 'Antes' }, { c: C.heavy, l: 'Pesadas' }])
  else if (!VOLUME_ONLY) legend(d, PAGE.m, y, [{ c: C.volume, l: 'Séries de trabalho' }, { c: C.heavy, l: 'Pesadas' }])
  else y -= 8
  // muitos músculos: linhas mais baixas para caber acima do quadro de calorias (≈58 pt no rodapé)
  const rh = Math.max(9.5, Math.min(15, (BOTTOM - 60 - (y + 12)) / Math.max(rows.length, 1)))
  return muscleRanking(d, PAGE.m, y + 8, W, rows, rh)
}

/**
 * Cartão de destaque: número principal grande + variação, anel de intensidade e
 * terceira métrica (tonelagem no presencial; séries pesadas na consultoria).
 */
/** PSE em palavras (escala 0–10 de esforço percebido). */
export function pseWord(p: number): string {
  if (p >= 10) return 'Máximo'
  if (p >= 9) return 'Muito intenso'
  if (p >= 7) return 'Intenso'
  if (p >= 5) return 'Moderado'
  if (p >= 3) return 'Leve'
  return 'Muito leve'
}

/** Presencial: anel com a PSE (o que o aluno relatou) — "8/10 · Intenso". Sem PSE: % de séries pesadas. */
function effortRing(d: jsPDF, cx: number, cy: number, r: number, a: Aggregate, pse: number | null) {
  if (pse == null) {
    if (a.minutes) {
      // sem PSE: duração do treino (real no presencial; estimada sem horário)
      ring(d, cx, cy, r, 100, C.grid, '')
      fill(d, '#FFFFFF')
      d.circle(cx, cy, r - 4, 'F')
      text(d, fmtNum(a.minutes), cx, cy + 3, { size: r * 0.62, bold: true, c: C.ink, align: 'center' })
      text(d, 'min', cx, cy + 11, { size: 6, bold: true, c: C.sub, align: 'center' })
      text(d, a.realMinutes ? 'DURAÇÃO DO TREINO' : 'DURAÇÃO ESTIMADA', cx, cy + r + 11, { size: 6, bold: true, c: C.sub, align: 'center' })
      return
    }
    ring(d, cx, cy, r, a.heavyPct, C.intensity, 'SÉRIES PESADAS %')
    return
  }
  const p = Math.round(pse * 10) / 10
  ring(d, cx, cy, r, p * 10, C.intensity, '')
  // o ring escreve o valor 0–100; cobre com o valor em /10
  fill(d, '#FFFFFF')
  d.circle(cx, cy, r - 4, 'F')
  // número + "/10" centralizados juntos
  const num = fmtNum(p, Number.isInteger(p) ? 0 : 1)
  d.setFont('helvetica', 'bold')
  d.setFontSize(r * 0.72)
  const nw = d.getTextWidth(num)
  d.setFontSize(6.5)
  const sw = d.getTextWidth('/10')
  const x0 = cx - (nw + 1.5 + sw) / 2
  text(d, num, x0, cy + 5, { size: r * 0.72, bold: true, c: C.ink })
  text(d, '/10', x0 + nw + 1.5, cy + 5, { size: 6.5, bold: true, c: C.sub })
  text(d, `ESFORÇO · ${pseWord(p).toUpperCase()}`, cx, cy + r + 11, { size: 6, bold: true, c: C.sub, align: 'center' })
}

function heroCard(d: jsPDF, y: number, o: ReportOptions, a: Aggregate, prev: Aggregate | undefined, title: string, pse: number | null = a.avgPse ?? null, level?: number | null): number {
  card(d, PAGE.m, y, W, 84, '#FFFFFF')
  fill(d, C.heavy)
  d.roundedRect(PAGE.m, y, 4, 84, 2, 2, 'F')
  text(d, title.toUpperCase(), PAGE.m + 14, y + 16, { size: 6.5, bold: true, c: C.sub })
  text(d, String(a.validSets), PAGE.m + 14, y + 48, { size: 32, bold: true, c: C.ink })
  text(d, 'séries de trabalho', PAGE.m + 14, y + 60, { size: 7.5, bold: true, c: C.ink })
  text(d, 'sem contar o aquecimento', PAGE.m + 14, y + 69, { size: 6, c: C.sub })
  // variação ao lado do número (embaixo fica a explicação das séries)
  d.setFont('helvetica', 'bold'); d.setFontSize(32)
  const nx = PAGE.m + 14 + d.getTextWidth(String(a.validSets)) + 6
  if (o.prevSame) {
    const diff = a.validSets - o.prevSame.sets
    const t = diff ? `${diff > 0 ? '+' : ''}${diff} vs último ${o.prevSame.label}` : `= último ${o.prevSame.label}`
    text(d, t, nx, y + 42, { size: 6.8, bold: true, c: diff > 0 ? C.heavy : C.sub })
  } else deltaPill(d, nx, y + 30, pct(a.validSets, prev?.validSets))
  const rx = PAGE.m + W - 12
  if (isOnline(o)) {
    // volume: séries por treino (vários treinos) ou grupos trabalhados (um treino)
    const cx = PAGE.m + 178
    const multi = a.sessions > 1
    const lv = level !== undefined ? level : levelOf(a)
    if (lv != null) {
      text(d, 'NÍVEL DE ESTÍMULO', cx, y + 16, { size: 6.5, bold: true, c: C.sub, align: 'center' })
      text(d, String(lv), cx, y + 48, { size: 28, bold: true, c: C.heavy, align: 'center' })
      text(d, levelSub(lv), cx, y + 60, { size: 7, c: lv > 100 ? C.heavy : C.sub, bold: lv > 100, align: 'center' })
    } else {
      text(d, multi ? 'SÉRIES POR TREINO' : 'GRUPOS MUSCULARES', cx, y + 16, { size: 6.5, bold: true, c: C.sub, align: 'center' })
      text(d, String(multi ? perSession(a) : groupsCount(a)), cx, y + 48, { size: 28, bold: true, c: C.heavy, align: 'center' })
      text(d, multi ? 'média' : 'trabalhados', cx, y + 60, { size: 7, c: C.sub, align: 'center' })
    }
    text(d, multi ? 'TREINOS' : 'SÉRIES POR GRUPO', rx, y + 16, { size: 6.5, bold: true, c: C.sub, align: 'right' })
    text(d, String(multi ? a.sessions : groupsCount(a) ? Math.round(a.validSets / groupsCount(a)) : 0), rx, y + 46, { size: 24, bold: true, c: C.ink, align: 'right' })
    text(d, multi ? `${groupsCount(a)} grupos musculares` : 'em média', rx, y + 58, { size: 7, c: C.sub, align: 'right' })
  } else {
    effortRing(d, PAGE.m + 178, y + 38, 22, a, pse)
    text(d, 'QUILOS LEVANTADOS', rx, y + 16, { size: 6.5, bold: true, c: C.sub, align: 'right' })
    text(d, a.tonnageKg ? fmtNum(a.tonnageKg) : '—', rx, y + 46, { size: 20, bold: true, c: C.heavy, align: 'right' })
    text(d, 'kg no total', rx, y + 58, { size: 7, c: C.sub, align: 'right' })
    const tp = pct(a.tonnageKg, prev?.tonnageKg)
    if (tp != null) text(d, `${tp >= 0 ? '+' : '-'}${Math.abs(Math.round(tp))}%`, rx, y + 72, { size: 7.5, bold: true, c: tp >= 0 ? C.heavy : C.sub, align: 'right' })
  }
  return y + 92
}

/** Conquistas do período, a partir dos dados (sem texto livre). */
function achievementsOf(weeks: WeekPoint[], o: ReportOptions): string[] {
  const out: string[] = []
  const last = weeks[weeks.length - 1]
  const prev = weeks[weeks.length - 2]
  if (!last) return out
  if (weeks.length > 1 && last.agg.validSets >= Math.max(...weeks.map((w) => w.agg.validSets))) out.push('Maior volume do período')
  if (prev && isOnline(o) && (levelOf(last.agg) ?? 0) > (levelOf(prev.agg) ?? 0)) out.push('Desafio em alta')
  else if (prev && isOnline(o) && perSession(last.agg) > perSession(prev.agg)) out.push('Mais séries por treino')
  if (!isOnline(o) && weeks.length > 1 && last.agg.tonnageKg > 0 && last.agg.tonnageKg >= Math.max(...weeks.map((w) => w.agg.tonnageKg))) out.push('Recorde de quilos levantados')
  let streak = 0
  for (let i = weeks.length - 1; i >= 0 && weeks[i].agg.sessions > 0; i--) streak++
  if (streak >= 2) out.push(`${streak} semanas seguidas`)
  if (last.verdict.final === 'choque') out.push('Semana de choque concluída')
  if (!out.length) out.push(weeks.length === 1 ? 'Primeira semana registrada' : 'Semana concluída')
  return out.slice(0, 4)
}

/** Card de gasto: chama + kcal, média por treino e gota + equivalente em gordura. */
function kcalCard(d: jsPDF, y: number, kcal: number, minutes: number | undefined, realMin: boolean | undefined, sessions = 1) {
  card(d, PAGE.m, y, W, 52, C.card)
  const cols = sessions > 1 ? 3 : 2
  const cw = W / cols
  let x = PAGE.m
  iconFlame(d, x + 18, y + 25, 15, C.heavy)
  text(d, fmtNum(kcal), x + 32, y + 30, { size: 16, bold: true, c: C.ink })
  text(d, 'kcal na musculação', x + 32, y + 41, { size: 6.5, c: C.sub })
  if (sessions > 1) text(d, `em ${sessions} treinos`, x + 32, y + 48, { size: 6.5, c: C.sub })
  x += cw
  if (sessions > 1) {
    // coluna do meio: média por treino (cada coluna com o seu espaço, sem sobrepor)
    text(d, fmtNum(kcal / sessions), x + 6, y + 30, { size: 16, bold: true, c: C.ink })
    text(d, 'média de calorias', x + 6, y + 41, { size: 6.5, c: C.sub })
    text(d, 'por treino', x + 6, y + 48, { size: 6.5, c: C.sub })
    x += cw
  }
  if (minutes) {
    text(d, `${fmtNum(minutes)} min`, x + 6, y + 30, { size: 16, bold: true, c: C.ink })
    text(d, sessions > 1 ? 'de treino no total' : realMin ? 'de treino' : 'de treino', x + 6, y + 41, { size: 6.5, c: C.sub })
    if (sessions === 1 && !realMin) text(d, '(estimado)', x + 6, y + 48, { size: 6.5, c: C.sub })
  }
  if (CARDIO) {
    // linha do cardio: kcal, sessões/dias, minutos e o total (treino + cardio)
    const cy = y + 56
    card(d, PAGE.m, cy, W, 40, C.zone.choque)
    text(d, 'CARDIO', PAGE.m + 12, cy + 15, { size: 6, bold: true, c: C.sub })
    text(d, `${fmtNum(CARDIO.kcal)} kcal`, PAGE.m + 12, cy + 31, { size: 13, bold: true, c: C.heavy })
    text(d, `${CARDIO.sessions} ${CARDIO.sessions === 1 ? 'sessão' : 'sessões'}${CARDIO.days > 1 ? ` em ${CARDIO.days} dias` : ''} · ${fmtNum(CARDIO.minutes)} min`, PAGE.m + 92, cy + 30, { size: 7.5, c: C.ink })
    text(d, 'TOTAL TREINO + CARDIO', PAGE.m + W - 12, cy + 15, { size: 6, bold: true, c: C.sub, align: 'right' })
    text(d, `${fmtNum(kcal + CARDIO.kcal)} kcal`, PAGE.m + W - 12, cy + 31, { size: 13, bold: true, c: C.ink, align: 'right' })
    return cy + 46
  }
  return y + 58
}

interface HRow {
  down?: boolean // seta para baixo antes do selo (fase regenerativa)
  label: string
  tag?: string
  tagColor?: string
  bg?: string
  valid: number
  heavy: number
  right?: string
  mark?: string
}

/** Barras horizontais: uma linha por período, válidas e pesadas lado a lado, métrica à direita. */
function hRows(d: jsPDF, y: number, rows: HRow[], rowH = 28, rightLabel = 'Quilos levantados') {
  // coluna do rótulo se ajusta ao maior nome/etiqueta (sem invadir as barras)
  d.setFont('helvetica', 'bold')
  d.setFontSize(8)
  const lw = Math.max(...rows.map((r) => d.getTextWidth(r.label)))
  d.setFontSize(5.8)
  const tw = Math.max(0, ...rows.map((r) => (r.tag ? d.getTextWidth(r.tag) : 0)))
  const labelW = Math.min(150, Math.max(62, lw + 10, tw + 10)), rightW = 70
  d.setFont('helvetica', 'bold'); d.setFontSize(6.6)
  const downW = Math.max(0, ...rows.filter((r) => r.down && r.mark).map((r) => d.getTextWidth(r.mark!) + 14))
  const markW = rows.some((r) => r.mark) ? Math.max(56, downW) : 0 // coluna fixa da evolução ("+9% carga" / selo da regenerativa)
  const barW = W - labelW - rightW - 18 - markW - (VOLUME_ONLY && markW ? 36 : 0) // espaço do "76 séries" depois da barra
  const max = Math.max(...rows.map((r) => r.valid), 1)
  legend(d, PAGE.m, y, VOLUME_ONLY ? [{ c: C.volume, l: 'Séries de trabalho' }, { c: C.sub, l: rightLabel }] : [{ c: C.volume, l: 'Séries de trabalho' }, { c: C.heavy, l: 'Pesadas' }, { c: C.sub, l: rightLabel }])
  chartSeal(d, PAGE.m + W, y)
  y += 10
  const bh = Math.max(4, Math.min(9, (rowH - 10) / 2))
  for (const r of rows) {
    if (r.bg) {
      fill(d, r.bg)
      d.roundedRect(PAGE.m - 4, y, W + 8, rowH - 3, 5, 5, 'F')
    }
    const mid = y + (rowH - 3) / 2
    text(d, r.label, PAGE.m + 2, r.tag && rowH >= 20 ? mid - 1 : mid + 3, { size: 8, bold: true })
    if (r.tag && rowH >= 20) text(d, r.tag, PAGE.m + 2, mid + 8, { size: 5.8, bold: true, c: r.tagColor ?? C.sub })
    const x0 = PAGE.m + labelW
    const wv = Math.max((r.valid / max) * barW, r.valid ? 3 : 0)
    if (VOLUME_ONLY) {
      // consultoria: uma barra só (volume), mais grossa
      fill(d, C.heavy)
      if (wv) d.roundedRect(x0, mid - bh, wv, bh * 2, 3, 3, 'F')
      text(d, `${r.valid} séries`, x0 + wv + 4, mid + 2.5, { size: 7, bold: true, c: C.heavy })
    } else {
      const wh = Math.max((r.heavy / max) * barW, r.heavy ? 3 : 0)
      fill(d, C.volume)
      if (wv) d.roundedRect(x0, mid - bh - 1, wv, bh, 2, 2, 'F')
      text(d, String(r.valid), x0 + wv + 4, mid - 2.5, { size: 6.5, bold: true, c: C.volume })
      fill(d, C.heavy)
      if (wh) d.roundedRect(x0, mid + 1, wh, bh, 2, 2, 'F')
      text(d, String(r.heavy), x0 + wh + 4, mid + bh - 0.5, { size: 6.5, bold: true, c: C.heavy })
    }
    if (r.mark && r.down) {
      // selo da fase regenerativa: ▼ + o que diminuiu
      const mx = PAGE.m + W - rightW + 4
      d.setFont('helvetica', 'bold'); d.setFontSize(6.6)
      const tw2 = d.getTextWidth(r.mark)
      iconTrend(d, mx - tw2 - 9, mid, 6, false, C.zoneInk.regenerativa)
      text(d, r.mark, mx, mid + 2.5, { size: 6.6, bold: true, c: C.zoneInk.regenerativa, align: 'right' })
    } else if (r.mark) text(d, r.mark, PAGE.m + W - rightW + 4, mid + 3, { size: 7, bold: true, c: C.heavy, align: 'right' })
    if (r.right) text(d, r.right, PAGE.m + W, mid + 3, { size: 7.5, bold: true, c: C.ink, align: 'right' })
    y += rowH
  }
  return y + 4
}

/** Perfil biomecânico (multi × mono, livre × máquina) — preenche o espaço quando cabe. */
function profileSection(d: jsPDF, y: number, a: Aggregate): number {
  // "Músculos do dia": o músculo principal de cada exercício (séries de trabalho), sem termos técnicos
  const rows = trainedGroups(a).slice(0, 5)
  if (!rows.length) return y
  sectionTitle(d, a.sessions > 1 ? 'Músculos trabalhados' : 'Músculos do dia', y + 6)
  chartSeal(d, PAGE.m + W, y + 6)
  y += 14
  const max = Math.max(...rows.map(([, v]) => v), 1)
  const labelW = 92, barW = W - labelW - 56
  for (const [g, v] of rows) {
    text(d, g.replace('Perna - ', ''), PAGE.m, y + 8, { size: 7.5, bold: true })
    fill(d, C.heavy)
    d.roundedRect(PAGE.m + labelW, y + 1.5, Math.max((v / max) * barW, 4), 8, 2, 2, 'F')
    text(d, `${fmtNum(v)} ${v === 1 ? 'série' : 'séries'}`, PAGE.m + W, y + 8, { size: 7, c: C.sub, align: 'right' })
    y += 13
  }
  return y + 4
}

/** Fecha a página: perfil (se couber) e o card de calorias logo após o conteúdo. */
function finish(d: jsPDF, y: number, a: Aggregate, sessions: number, withProfile = true) {
  const musclesH = 22 + Math.min(5, trainedGroups(a).length) * 13
  if (withProfile && y + musclesH + 64 + (CARDIO ? 44 : 0) <= BOTTOM) y = profileSection(d, y + 4, a)
  kcalCard(d, Math.min(y + 6, BOTTOM - (CARDIO ? 96 : 52)), a.kcal, a.minutes, a.realMinutes, sessions)
}

/** Altura ideal das linhas de barras para caber no espaço restante. */
const fitRowH = (space: number, n: number, max = 28, min = 15) => Math.max(min, Math.min(max, space / Math.max(n, 1)))

// ---------------- Template A — Antes × Depois (Mês 1 × Mês 2) ----------------
export interface MonthSide {
  label: string // "out/26"
  agg: Aggregate
  lifts: Record<string, { name: string; kg: number; perSide: boolean }> // maior carga de cada exercício no mês
  phase?: Microcycle | null // fase da semana (Semana × Semana)
}

/** Um treino (A, B, C…) nas duas semanas comparadas. */
export interface PerTraining {
  label: string
  before?: Aggregate
  after?: Aggregate
}

/** Nomes do "antes" e do "depois" nos placares: as datas das semanas (ou os meses) em vez de antes/depois. */
let BEFORE_LBL = 'antes', AFTER_LBL = 'depois'
/** Placar "antes → depois" de uma métrica, com barras lado a lado. */
function scoreTile(d: jsPDF, x: number, y: number, w: number, h: number, label: string, before: number, after: number, fmt: (n: number) => string, hasBefore: boolean, first = 'primeiro mês', neutral = false, hint?: string) {
  card(d, x, y, w, h, '#FFFFFF')
  text(d, label.toUpperCase(), x + 10, y + 15, { size: 6.3, bold: true, c: C.sub })
  // frase curta que explica o número (ex.: "cada treino teve ~21 séries")
  if (hint) text(d, hint, x + 10, y + 23, { size: 5.8, c: C.sub })
  const short = h < 90 // placar compacto: número e "antes" um pouco mais acima, para a pílula não encostar
  const dy = hint ? 4 : 0
  text(d, fmt(after), x + 10, y + (short ? 39 : 46) + dy, { size: 22, bold: true, c: C.ink })
  text(d, hasBefore ? `${BEFORE_LBL}: ${fmt(before)}` : first, x + 10, y + (short ? 50 : 59) + dy, { size: 7, c: C.sub })
  const same = hasBefore && Math.round(before) === Math.round(after)
  if (same) {
    // sem mudança: pílula cinza "= manteve" em vez de nada
    fill(d, '#EEF2F6')
    d.roundedRect(x + 10, y + h - 22, 44, 13, 6.5, 6.5, 'F')
    text(d, '= manteve', x + 32, y + h - 13, { size: 6.5, bold: true, c: C.sub, align: 'center' })
  }
  // neutral: PSE mais baixa com mais carga é adaptação, não piora — sem seta de queda
  else if (hasBefore && before > 0 && !neutral) deltaPill(d, x + 10, y + h - 22, ((after - before) / before) * 100, '')
  // barras verticais: antes (cinza) × depois (destaque)
  const bx = x + w - 52, base = y + h - 14, hMax = h - 36
  const max = Math.max(before, after, 1)
  const hb = hasBefore ? Math.max(2, (before / max) * hMax) : 0
  const ha = Math.max(2, (after / max) * hMax)
  fill(d, C.grid)
  if (hb) d.roundedRect(bx, base - hb, 18, hb, 3, 3, 'F')
  fill(d, after >= before || neutral ? C.heavy : C.volume)
  d.roundedRect(bx + 22, base - ha, 18, ha, 3, 3, 'F')
  text(d, BEFORE_LBL, bx + 9, base + 8, { size: 5.2, c: C.sub, align: 'center' })
  text(d, AFTER_LBL, bx + 31, base + 8, { size: 5.2, bold: true, c: C.heavy, align: 'center' })
}

/** Barra dupla horizontal "antes × depois" (usada em cargas e qualidade). */
function pairRow(d: jsPDF, y: number, label: string, before: number, after: number, max: number, left: string, right: string, pill?: string, labelW = 112) {
  // espaço do selo à direita + do número depois da barra, para nunca encostar
  d.setFont('helvetica', 'bold')
  d.setFontSize(7)
  const pillW = pill ? d.getTextWidth(pill) + 12 : 0
  d.setFontSize(5.8)
  const numW = Math.max(d.getTextWidth(left), d.getTextWidth(right)) + 8
  const bw = W - labelW - numW - (pill ? pillW + 6 : 0)
  text(d, label, PAGE.m, y + 9, { size: 7.5, bold: true })
  const x0 = PAGE.m + labelW
  fill(d, C.grid)
  d.roundedRect(x0, y + 1, Math.max(3, (before / max) * bw), 6, 3, 3, 'F')
  fill(d, after >= before ? C.heavy : C.volume)
  d.roundedRect(x0, y + 9, Math.max(3, (after / max) * bw), 6, 3, 3, 'F')
  text(d, left, x0 + Math.max(3, (before / max) * bw) + 4, y + 6.5, { size: 5.8, c: C.sub })
  text(d, right, x0 + Math.max(3, (after / max) * bw) + 4, y + 14.5, { size: 5.8, bold: true, c: C.heavy })
  if (pill) {
    d.setFont('helvetica', 'bold')
    d.setFontSize(7)
    const pw = pillW
    fill(d, C.heavy)
    d.roundedRect(PAGE.m + W - pw, y + 2, pw, 13, 6.5, 6.5, 'F')
    text(d, pill, PAGE.m + W - pw / 2, y + 10.8, { size: 7, bold: true, c: '#ffffff', align: 'center' })
  }
}

/**
 * Antes × Depois. Por padrão Mês × Mês; com `weeks`, Semana × Semana (o treino que você montou
 * agora contra o anterior), com a seção "Treino a treino".
 */
export function templateA(before: MonthSide, after: MonthSide, o: ReportOptions, weeks?: PerTraining[]): jsPDF {
  const d = start(o)
  const wk = !!weeks
  if (wk) header(d, 'Semana × Semana', `semana de ${before.label}  >  semana de ${after.label}`, nm(o))
  else header(d, 'Antes × Depois', `${before.label}  >  ${after.label}`, nm(o))
  const b = before.agg, a = after.agg
  const hasBefore = b.validSets > 0
  BEFORE_LBL = before.label; AFTER_LBL = after.label
  let y = 92

  // 1) manchete: a maior melhora do período
  const cands: [string, number][] = []
  if (hasBefore) {
    if (!isOnline(o) && b.tonnageKg) cands.push(['mais carga levantada', pct(a.tonnageKg, b.tonnageKg)!])
    cands.push(['mais volume de treino', pct(a.validSets, b.validSets)!])
    if (!isOnline(o) && b.heavySets) cands.push(['mais séries pesadas', pct(a.heavySets, b.heavySets)!])
    if (isOnline(o) && perSession(b)) cands.push(['mais séries por treino', pct(perSession(a), perSession(b))!])
    if (isOnline(o) && levelOf(b)) cands.push(['mais intensidade', pct(levelOf(a)!, levelOf(b)!)!])
    // intensidade é uma escala de 0 a 100: a diferença em PONTOS (não em %) — base pequena não vira "+500%"
    if (isOnline(o) && intensityOf(b, o) != null) cands.push(['pontos de intensidade', intensityOf(a, o) - intensityOf(b, o)])
  }
  const best = cands.filter(([, v]) => v > 0).sort((x, z) => z[1] - x[1])[0]
  const regen = wk && after.phase === 'regenerativa'
  fill(d, regen ? C.zone.regenerativa : best ? C.heavy : C.headerBg)
  d.roundedRect(PAGE.m, y, W, 66, 10, 10, 'F')
  if (regen) {
    // menos volume aqui é de propósito: o aluno não está destreinando, está recuperando para o próximo pico
    text(d, 'Semana regenerativa', PAGE.m + 16, y + 30, { size: 18, bold: true, c: C.zoneInk.regenerativa })
    text(d, 'Redução planejada de volume e esforço para o corpo recuperar e voltar mais forte.', PAGE.m + 16, y + 44, { size: 7.2, c: C.zoneInk.regenerativa })
    text(d, 'Não é perda de treino: é parte da periodização.', PAGE.m + 16, y + 55, { size: 7.2, bold: true, c: C.zoneInk.regenerativa })
  } else if (best) {
    const isPts = best[0] === 'pontos de intensidade'
    text(d, `+${Math.round(best[1])}${isPts ? '' : '%'}`, PAGE.m + 16, y + 45, { size: 36, bold: true, c: '#ffffff' })
    text(d, isPts ? 'MAIS INTENSIDADE' : best[0].toUpperCase(), PAGE.m + W - 16, y + 30, { size: 9, bold: true, c: '#ffffff', align: 'right' })
    if (isPts) text(d, `pontos (0 a 100): ${Math.round(intensityOf(b, o))} > ${Math.round(intensityOf(a, o))}`, PAGE.m + W - 16, y + 56, { size: 6.5, c: '#E6F4F2', align: 'right' })
    else if (best[0] === 'mais intensidade' && levelOf(b)) text(d, `nível de estímulo ${levelOf(b)} > ${levelOf(a)}`, PAGE.m + W - 16, y + 56, { size: 6.5, c: '#E6F4F2', align: 'right' })
    text(d, `${before.label} > ${after.label}`, PAGE.m + W - 16, y + 44, { size: 7.5, c: '#E6F4F2', align: 'right' })
  } else {
    text(d, hasBefore ? (wk ? 'Semana de ajuste' : 'Mês de ajuste') : (wk ? 'Primeira semana' : 'Primeiro mês'), PAGE.m + 16, y + 38, { size: 20, bold: true, c: '#ffffff' })
    text(d, hasBefore ? 'base para o próximo salto' : 'nível de estímulo inicial', PAGE.m + 16, y + 52, { size: 7.5, c: '#CBD5E1' })
  }
  y += 76

  // fase de cada semana (nomes para o aluno) e quem é quem: cinza = antes, cor = depois
  if (wk && (before.phase || after.phase)) {
    card(d, PAGE.m, y, W, 30, C.card)
    const half = W / 2
    fill(d, C.grid); d.roundedRect(PAGE.m + 10, y + 11, 8, 8, 2, 2, 'F')
    text(d, `Semana de ${before.label}`, PAGE.m + 22, y + 13, { size: 6.2, bold: true, c: C.sub })
    text(d, before.phase ? PHASE_NAME[before.phase] : '—', PAGE.m + 22, y + 23, { size: 8, bold: true, c: before.phase ? C.zoneInk[before.phase] : C.sub })
    fill(d, C.heavy); d.roundedRect(PAGE.m + half + 4, y + 11, 8, 8, 2, 2, 'F')
    text(d, `Semana de ${after.label}`, PAGE.m + half + 16, y + 13, { size: 6.2, bold: true, c: C.sub })
    text(d, after.phase ? PHASE_NAME[after.phase] : '—', PAGE.m + half + 16, y + 23, { size: 8, bold: true, c: after.phase ? C.zoneInk[after.phase] : C.sub })
    y += 38
  }

  // 2) quatro placares grandes
  const first = wk ? 'primeira semana' : 'primeiro mês'
  const tw = (W - 10) / 2, th = wk && (before.phase || after.phase) ? 80 : 92 // com a faixa das fases, placares mais baixos para caber o gasto
  const rg = !!regen // regenerativa: placares neutros (sem pílula de queda)
  scoreTile(d, PAGE.m, y, tw, th, 'Séries de trabalho', b.validSets, a.validSets, (n) => fmtNum(n), hasBefore, first, rg)
  if (isOnline(o)) scoreTile(d, PAGE.m + tw + 10, y, tw, th, 'Média de séries por treino', perSession(b), perSession(a), (n) => fmtNum(n), hasBefore, first, rg, `cada treino teve ~${perSession(a)} séries`)
  else scoreTile(d, PAGE.m + tw + 10, y, tw, th, 'Séries pesadas', b.heavySets, a.heavySets, (n) => fmtNum(n), hasBefore, first)
  if (isOnline(o) && levelOf(a) != null) scoreTile(d, PAGE.m, y + th + 10, W, th, 'Nível de estímulo', levelOf(b) ?? 0, levelOf(a)!, (n) => String(Math.round(n)), hasBefore && levelOf(b) != null, first, rg)
  else if (isOnline(o)) scoreTile(d, PAGE.m, y + th + 10, tw, th, 'Grupos musculares', groupsCount(b), groupsCount(a), (n) => fmtNum(n), hasBefore, first, true)
  else scoreTile(d, PAGE.m, y + th + 10, tw, th, 'Esforço médio (PSE)', b.avgPse ?? 0, a.avgPse ?? 0, (n) => (n ? `${fmtNum(n, 1)}/10` : '—'), hasBefore && b.avgPse != null, first, true)
  if (isOnline(o) && levelOf(a) == null) scoreTile(d, PAGE.m + tw + 10, y + th + 10, tw, th, 'Séries em até 10 reps', b.lowRepSets, a.lowRepSets, (n) => fmtNum(n), hasBefore, first, rg)
  else if (!isOnline(o)) scoreTile(d, PAGE.m + tw + 10, y + th + 10, tw, th, 'Quilos levantados', b.tonnageKg, a.tonnageKg, (n) => (n >= 10000 ? `${fmtNum(n / 1000, 1)} t` : `${fmtNum(n)} kg`), hasBefore, first)
  y += th * 2 + 22

  // consultoria: o que ficou mais desafiador (só o que subiu)
  if (isOnline(o) && hasBefore) {
    const per = (n: number, x: Aggregate) => (x.sessions ? n / x.sessions : n)
    const what: string[] = []
    const dl = Math.round(per(a.lowRepSets, a) - per(b.lowRepSets, b))
    const dt = Math.round(per(a.advancedSets, a) - per(b.advancedSets, b))
    const ds = perSession(a) - perSession(b)
    if (ds > 0) what.push(`+${ds} ${ds === 1 ? 'série' : 'séries'} por treino`)
    if (dl > 0) what.push(`+${dl} ${dl === 1 ? 'série' : 'séries'} em até 10 reps por treino`)
    if (dt > 0) what.push(`+${dt} ${dt === 1 ? 'série' : 'séries'} com técnica avançada por treino`)
    if (what.length) {
      text(d, 'O QUE FICOU MAIS DESAFIADOR', PAGE.m, y - 6, { size: 6.3, bold: true, c: C.sub })
      y = badgeRow(d, PAGE.m, y, W, what) + 2
    }
  }

  // 3) onde melhorou
  if (weeks) {
    y = perTrainingSection(d, y, weeks, o)
    if (o.showEmphasis && y + 90 <= BOTTOM - 56) y = focusSection(d, y + 4, a, hasBefore ? b : undefined, 3)
  } else if (o.showEmphasis) {
    y = focusSection(d, y, a, hasBefore ? b : undefined, 4)
  } else if (!isOnline(o)) {
    const evolved = Object.entries(after.lifts)
      .filter(([k, v]) => before.lifts[k] && v.kg > before.lifts[k].kg)
      .map(([k, v]) => ({ ...v, before: before.lifts[k].kg }))
      .sort((x, z) => (z.kg - z.before) / z.before - (x.kg - x.before) / x.before)
      .slice(0, 4)
    if (evolved.length) {
      sectionTitle(d, 'Cargas que evoluíram', y + 6)
      chartSeal(d, PAGE.m + W, y + 6)
      y += 16
      const max = Math.max(...evolved.map((e) => e.kg))
      for (const e of evolved) {
        const u = e.perSide ? 'kg/lado' : 'kg'
        pairRow(d, y, e.name.length > 22 ? e.name.slice(0, 21) + '…' : e.name, e.before, e.kg, max, `${fmtNum(e.before)} ${u}`, `${fmtNum(e.kg)} ${u}`, `+${fmtNum(e.kg - e.before)} kg`)
        y += 24
      }
    } else y = qualitySection(d, y, b, a, hasBefore)
  } else y = qualitySection(d, y, b, a, hasBefore)

  // 4) calorias do mês: antes × depois
  if (y + 56 <= BOTTOM) {
    card(d, PAGE.m, y + 4, W, 48, C.card)
    iconFlame(d, PAGE.m + 18, y + 27, 14, C.heavy)
    text(d, wk ? 'GASTO NA SEMANA' : 'GASTO NO MÊS', PAGE.m + 32, y + 20, { size: 6.3, bold: true, c: C.sub })
    text(d, `${fmtNum(a.kcal)} kcal`, PAGE.m + 32, y + 37, { size: 15, bold: true, c: C.ink })
    if (hasBefore) text(d, `${before.label}: ${fmtNum(b.kcal)} kcal`, PAGE.m + 140, y + 37, { size: 7.5, c: C.sub })
    if (a.sessions > 1) {
      text(d, `${fmtNum(a.kcal / a.sessions)} kcal`, PAGE.m + W - 12, y + 30, { size: 11, bold: true, c: C.ink, align: 'right' })
      text(d, 'média de calorias por treino', PAGE.m + W - 12, y + 41, { size: 6, c: C.sub, align: 'right' })
    }
  }
  return d
}

/** Treino a treino: séries válidas de cada treino (A, B, C…) na semana anterior × na nova. */
function perTrainingSection(d: jsPDF, y: number, rows: PerTraining[], o: ReportOptions): number {
  const list = rows.filter((r) => r.after || r.before).slice(0, 6)
  if (!list.length) return y
  sectionTitle(d, 'Treino a treino', y + 6)
  chartSeal(d, PAGE.m + W, y + 6)
  y += 14
  legend(d, PAGE.m, y, [{ c: C.grid, l: `Semana de ${BEFORE_LBL}` }, { c: C.heavy, l: `Semana de ${AFTER_LBL}` }])
  y += 12
  const max = Math.max(1, ...list.map((r) => Math.max(r.before?.validSets ?? 0, r.after?.validSets ?? 0)))
  const rowH = fitRowH(BOTTOM - 56 - y, list.length, 26, 20)
  for (const r of list) {
    const b = r.before, a = r.after
    const bs = b?.validSets ?? 0, as = a?.validSets ?? 0
    // destaque: o que mais cresceu nesse treino
    let pill: string | undefined
    if (!b && a) pill = 'novo'
    else if (b && a) {
      const ds = as - bs, dh = a.heavySets - b.heavySets
      const dt = !isOnline(o) && b.tonnageKg ? pct(a.tonnageKg, b.tonnageKg)! : 0
      if (ds > 0) pill = `+${ds} ${ds === 1 ? "série" : "séries"}`
      else if (dh > 0 && !isOnline(o)) pill = `+${dh} ${dh === 1 ? "pesada" : "pesadas"}`
      else if (dt >= 1) pill = `+${Math.round(dt)}% carga`
    }
    pairRow(d, y, r.label, bs, as, max, b ? `${bs} séries` : '—', a ? `${as} séries` : '—', pill, 62)
    y += rowH
  }
  return y
}

/** Qualidade do treino: % pesadas, % multiarticular, % peso livre — antes × depois. */
function qualitySection(d: jsPDF, y: number, b: Aggregate, a: Aggregate, hasBefore: boolean): number {
  if (!a.validSets) return y
  sectionTitle(d, 'Qualidade do treino', y + 6)
  chartSeal(d, PAGE.m + W, y + 6)
  y += 16
  const share = (n: number, t: number) => (t ? Math.round((n / t) * 100) : 0)
  const rows: [string, number, number][] = [
    ...(VOLUME_ONLY ? [] : [['Séries pesadas', share(b.heavySets, b.validSets), share(a.heavySets, a.validSets)] as [string, number, number]]),
    ['Multiarticulares', share(b.multiSets, b.validSets), share(a.multiSets, a.validSets)],
    ['Peso livre', share(b.freeSets, b.validSets), share(a.freeSets, a.validSets)],
  ]
  for (const [l, bv, av] of rows) {
    const diff = av - bv
    pairRow(d, y, l, hasBefore ? bv : 0, av, 100, hasBefore ? `${bv}%` : '—', `${av}%`, hasBefore && diff > 0 ? `+${diff} pts` : undefined)
    y += 24
  }
  return y
}

// ---------------- Template C — Resumo mensal (dia do pagamento) ----------------
export interface KeyLift {
  name: string
  points: { date: string; kg: number }[]
  perSide?: boolean
}

export function templateC(month: string, lifts: KeyLift[], weeks: WeekPoint[], o: ReportOptions): jsPDF {
  const d = start(o)
  header(d, 'Resumo do Mês', month, nm(o))
  if (!weeks.length) return d
  // total do mês para o destaque e o foco muscular
  const monthAgg = weeks.reduce<Aggregate>((acc, w) => {
    const g = { ...acc.byGroup }
    for (const [k, v] of Object.entries(w.agg.byGroup)) g[k] = { valid: (g[k]?.valid ?? 0) + v.valid, heavy: (g[k]?.heavy ?? 0) + v.heavy }
    const pg = { ...(acc.primaryGroups ?? {}) }
    for (const [k, v] of Object.entries(w.agg.primaryGroups ?? {})) pg[k] = (pg[k] ?? 0) + v
    return {
      ...acc,
      validSets: acc.validSets + w.agg.validSets, heavySets: acc.heavySets + w.agg.heavySets, tonnageKg: acc.tonnageKg + w.agg.tonnageKg,
      kcal: acc.kcal + w.agg.kcal, fatGrams: acc.fatGrams + w.agg.fatGrams, sessions: acc.sessions + w.agg.sessions, byGroup: g, primaryGroups: pg,
      challengePoints: acc.challengePoints + w.agg.challengePoints, lowRepSets: acc.lowRepSets + w.agg.lowRepSets, advancedSets: acc.advancedSets + w.agg.advancedSets,
    }
  }, { ...weeks[0].agg, validSets: 0, heavySets: 0, tonnageKg: 0, kcal: 0, fatGrams: 0, sessions: 0, byGroup: {}, primaryGroups: {}, challengePoints: 0, lowRepSets: 0, advancedSets: 0 })
  monthAgg.heavyPct = monthAgg.validSets ? (monthAgg.heavySets / monthAgg.validSets) * 100 : 0
  monthAgg.intensityPrescribed = Math.round(weeks.reduce((s, w) => s + w.agg.intensityPrescribed, 0) / weeks.length)
  monthAgg.intensityReal = Math.round(weeks.reduce((s, w) => s + w.agg.intensityReal, 0) / weeks.length)
  const wp = weeks.map((w) => w.agg.avgPse).filter((x): x is number => x != null)
  monthAgg.avgPse = wp.length ? wp.reduce((x, y) => x + y, 0) / wp.length : null

  let y = heroCard(d, 92, o, monthAgg, undefined, `${monthAgg.sessions} treinos no mês`)
  const ach = achievementsOf(weeks, o)
  const prs = lifts.filter((l) => l.points.length > 1 && l.points[l.points.length - 1].kg > l.points[0].kg).length
  if (prs) ach.unshift(`${prs} ${prs === 1 ? 'carga evoluiu' : 'cargas evoluíram'}`)
  y = badgeRow(d, PAGE.m, y, W, ach.slice(0, 4))

  const liftsShown = isOnline(o) ? [] : lifts.slice(0, o.showEmphasis ? 2 : 3)
  if (liftsShown.length) {
    sectionTitle(d, 'Evolução de carga', y + 6)
    chartSeal(d, PAGE.m + W, y + 6)
    y += 12
  }
  for (const l of liftsShown) {
    const first = l.points[0]?.kg ?? 0
    const lastKg = l.points[l.points.length - 1]?.kg ?? 0
    const diff = lastKg - first
    const unit = l.perSide ? 'kg/lado' : 'kg'
    card(d, PAGE.m, y, W, 32)
    text(d, l.name, PAGE.m + 10, y + 13, { size: 8.5, bold: true })
    const multi = l.points.length > 1
    text(d, multi ? `${fmtNum(first)} > ${fmtNum(lastKg)} ${unit}` : `${l.points.length} registro no mês`, PAGE.m + 10, y + 25, { size: 7, c: C.sub })
    const sb = { x: PAGE.m + 140, y: y + 6, w: 100, h: 20 }
    if (multi) lineSeries(d, sb, l.points.map((p) => p.kg), Math.max(...l.points.map((p) => p.kg)) * 1.05, C.heavy)
    if (multi && diff !== 0) iconTrend(d, PAGE.m + W - 72, y + 17, 8, diff > 0, diff > 0 ? C.heavy : C.sub)
    text(d, multi ? `${diff >= 0 ? '+' : ''}${fmtNum(diff)} ${unit}` : `${fmtNum(lastKg)} ${unit}`, PAGE.m + W - 10, y + 21, { size: 11, bold: true, c: multi && diff > 0 ? C.heavy : C.ink, align: 'right' })
    y += 36
  }

  const focusH = o.showEmphasis ? 54 + Math.min(5, Object.keys(monthAgg.byGroup).length) * 17 + 10 : 0
  const rowH = fitRowH(BOTTOM - 58 - (isOnline(o) ? 0 : 50) - y - 14 - focusH - 8, weeks.length, 30)
  y = hRows(d, y + 4, weeks.map((w, i) => ({
    label: fmtBR(w.firstDate ?? w.week),
    tag: `${PHASE_NAME[w.verdict.final]}${w.agg.avgPse != null ? ` · PSE ${w.agg.avgPse.toFixed(1)}` : ''}`,
    tagColor: C.zoneInk[w.verdict.final],
    bg: C.zone[w.verdict.final],
    valid: w.agg.validSets,
    heavy: w.agg.heavySets,
    right: rightOf(w.agg, o),
    // regenerativa: selo curto mostrando o que diminuiu (ex.: "força 9 > 5"), com seta para baixo
    ...regenMark(w, i ? weeks[i - 1] : undefined, isOnline(o)),
  })), rowH, rightLabelOf(o))

  if (o.showEmphasis) y = focusSection(d, y + 2, monthAgg)

  // contexto (sono, dieta, ciclo) — selos compactos
  const sleep = weeks.reduce((a, w) => ({ bem: a.bem + w.sleep.bem, mal: a.mal + w.sleep.mal, irregular: a.irregular + w.sleep.irregular }), { bem: 0, mal: 0, irregular: 0 })
  const totalSleep = sleep.bem + sleep.mal + sleep.irregular
  const diet = weeks[weeks.length - 1]?.ctx?.diet
  const menstrualWeeks = weeks.filter((w) => w.ctx?.menstrual).length
  // sono/dieta/ciclo só existem no presencial (na consultoria vêm pelo WhatsApp)
  if (!isOnline(o)) {
    const items: [string, string][] = [['Sono', totalSleep ? `${Math.round((sleep.bem / totalSleep) * 100)}% bom` : '—'], ['Dieta', diet ? DIET_LABEL[diet] : '—']]
    if (menstrualWeeks) items.push(['Ciclo', `${menstrualWeeks} sem.`])
    const sy = Math.min(y + 4, BOTTOM - 58 - 44)
    const sw = (W - 8 * (items.length - 1)) / items.length
    items.forEach(([t, v], i) => seal(d, PAGE.m + (sw + 8) * i, sy, sw, t, v, '#F1F5F9', '#0F172A'))
    y = sy + 46
  }
  finish(d, y, monthAgg, monthAgg.sessions, !o.showEmphasis)
  return d
}

/** Regenerativa: o que diminuiu em relação à semana anterior (só o essencial, para o selo). */
function regenMark(w: WeekPoint, prev: WeekPoint | undefined, online: boolean): { mark?: string; down?: boolean } {
  if (w.verdict.final !== 'regenerativa' || !prev || !prev.agg.validSets) return {}
  const a = w.agg, b = prev.agg
  const n = (x: number, um: string, varios: string) => `${x} ${x === 1 ? um : varios}`
  // ciclo menstrual e esforço só existem no presencial (a consultoria não tem esse retorno)
  if (!online && w.verdict.justification.some((j) => /menstrual/i.test(j))) return { mark: 'semana do ciclo', down: true }
  if (a.validSets <= b.validSets * 0.85) return { mark: `${n(b.validSets - a.validSets, 'série', 'séries')} a menos`, down: true }
  if (a.heavySets < b.heavySets) return { mark: `${n(b.heavySets - a.heavySets, 'série', 'séries')} de força a menos`, down: true }
  if (!online && w.verdict.justification.some((j) => /PSE/i.test(j))) return { mark: 'esforço menor', down: true }
  return {}
}

/** Faixa "Fase atual" + "Nível de estímulo" (presencial): o que o aluno precisa ver para sentir a evolução. */
function phaseStrip(d: jsPDF, y: number, phase: Microcycle | null | undefined, level0: number | null | undefined, label = ''): number {
  // "100" sozinho não diz nada ao aluno: o nível só aparece quando já há comparação com o 1º treino igual
  const level = level0 != null && level0 !== 100 ? level0 : null
  if (!phase && level == null) return y
  const h = 34
  card(d, PAGE.m, y, W, h, phase ? C.zone[phase] : C.card)
  const half = PAGE.m + W / 2
  if (phase) {
    text(d, 'FASE ATUAL', PAGE.m + 12, y + 13, { size: 6, bold: true, c: C.sub })
    text(d, PHASE_NAME[phase], PAGE.m + 12, y + 26, { size: 10.5, bold: true, c: C.zoneInk[phase] })
  }
  if (level != null) {
    const x = phase ? half + 8 : PAGE.m + 12
    text(d, 'NÍVEL DE ESTÍMULO', x, y + 13, { size: 6, bold: true, c: C.sub })
    text(d, String(level), x, y + 27, { size: 13, bold: true, c: C.heavy })
    d.setFont('helvetica', 'bold'); d.setFontSize(13)
    text(d, level > 100 ? `+${level - 100}% vs seu 1º ${label || 'treino'}` : `100 = seu 1º ${label || 'treino'}`, x + d.getTextWidth(String(level)) + 6, y + 26, { size: 7, bold: level > 100, c: level > 100 ? C.heavy : C.sub })
  }
  return y + h + 8
}

// ---------------- Template D — Treino do dia ----------------
export function templateD(session: Session, lookup: ProfileLookup, pse: number | null, o: ReportOptions, bests: Record<string, number> = {}, last: Record<string, number> = {}): jsPDF {
  const d = start(o)
  header(d, 'Treino do Dia', `${session.label} · ${fmtBR(session.date)}`, nm(o))
  const a = aggregateSessions([session], lookup, pse != null ? [{ id: 'x', session_id: session.id, pse, reported_by: 'trainer', created_at: '', updated_at: '' }] : [])
  if (pse != null && !isOnline(o)) a.intensityReal = Math.round(0.45 * pse * 10 + 0.55 * a.intensityPrescribed)
  let y = heroCard(d, 92, o, a, undefined, `${session.exercises.length} exercícios`, pse, isOnline(o) ? levelOfTraining(session.label, a) : undefined)
  if (!isOnline(o)) y = phaseStrip(d, y, o.phase, CH_LABEL[session.label] ? levelOfTraining(session.label, a) : null, session.label)

  // recordes pessoais (só presencial, com carga)
  const peakOf = (e: Session['exercises'][number]) => Math.max(e.load_kg ?? 0, ...(e.loads ?? []).map((k) => k ?? 0))
  const prKeys = new Set(isOnline(o) ? [] : session.exercises.filter((e) => peakOf(e) > 0 && bests[e.exercise_key] != null && peakOf(e) > bests[e.exercise_key]).map((e) => e.exercise_key))
  const ach: string[] = []
  if (prKeys.size) ach.push(`${prKeys.size} ${prKeys.size === 1 ? 'recorde pessoal' : 'recordes pessoais'}`)
  if (a.heavySets && !isOnline(o)) ach.push(`${a.heavySets} séries pesadas`)
  if (isOnline(o)) ach.push(`${groupsCount(a)} grupos musculares`)
  if (pse != null && pse >= 8 && isOnline(o)) ach.push(`Entrega alta · PSE ${pse}`)
  ach.push('Treino concluído')
  y = badgeRow(d, PAGE.m, y, W, ach.slice(0, 4))

  const list = session.exercises.filter((e) => e.valid_sets > 0).slice(0, o.showEmphasis ? 7 : 10)
  if (!isOnline(o)) {
    // PRESENCIAL: o que o aluno quer ver — a maior série de hoje × a da última vez, com seta quando subiu
    const top = (e: Session['exercises'][number]) => {
      const loads = Array.from({ length: e.valid_sets }, (_, i) => e.loads?.[i] ?? e.load_kg ?? null)
      let bi = -1
      loads.forEach((k, i) => { if (k != null && (bi < 0 || k > (loads[bi] ?? 0) || (k === loads[bi] && (e.reps[i]?.max ?? 0) > (e.reps[bi]?.max ?? 0)))) bi = i })
      const r = bi >= 0 ? e.reps[bi] ?? e.reps[e.reps.length - 1] : e.reps[0]
      const rt = !r ? '' : r.failure ? 'Máx' : r.min === r.max ? `${r.min}` : `${r.min}-${r.max}`
      const kgv = bi >= 0 ? loads[bi]! : null
      return kgv != null ? `${rt ? `${rt} × ` : ''}${fmtNum(kgv, Number.isInteger(kgv) ? 0 : 1)} kg${e.per_side ? '/lado' : ''}` : `${e.valid_sets} séries`
    }
    const cHoje = PAGE.m + W * 0.5, cAnt = PAGE.m + W
    text(d, 'EXERCÍCIO', PAGE.m, y + 8, { size: 6, bold: true, c: C.sub })
    text(d, 'HOJE', cHoje, y + 8, { size: 6, bold: true, c: C.sub })
    text(d, 'ÚLTIMA VEZ', cAnt, y + 8, { size: 6, bold: true, c: C.sub, align: 'right' })
    y += 14
    for (const e of list) {
      const pr = prKeys.has(e.exercise_key)
      const nm2 = e.display_name.length > 26 ? e.display_name.slice(0, 25) + '…' : e.display_name
      text(d, nm2, PAGE.m, y + 9, { size: 7.5, bold: true })
      text(d, `${e.valid_sets} ${e.valid_sets === 1 ? 'série' : 'séries'}${e.heavy_sets ? ` · ${e.heavy_sets} ${e.heavy_sets === 1 ? 'pesada' : 'pesadas'}` : ''}`, PAGE.m, y + 17, { size: 5.8, c: C.sub })
      const up = last[e.exercise_key] ? peakOf(e) - last[e.exercise_key] : 0
      const hoje = top(e)
      text(d, hoje, cHoje, y + 10, { size: 8, bold: true, c: up > 0 || pr ? C.heavy : C.ink })
      d.setFont('helvetica', 'bold'); d.setFontSize(8)
      const hw = d.getTextWidth(hoje)
      if (up > 0) iconTrend(d, cHoje + hw + 6, y + 7.5, 5, true, C.heavy)
      if (pr) {
        fill(d, C.heavy)
        d.roundedRect(cHoje + hw + (up > 0 ? 12 : 4), y + 3, 16, 9, 4.5, 4.5, 'F')
        text(d, 'PR', cHoje + hw + (up > 0 ? 20 : 12), y + 9.4, { size: 5.6, bold: true, c: '#ffffff', align: 'center' })
      }
      if (up > 0) text(d, `+${fmtNum(up, Number.isInteger(up) ? 0 : 1)} kg`, cHoje, y + 17.5, { size: 5.8, bold: true, c: C.heavy })
      text(d, o.lastTop?.[e.exercise_key] ?? '—', cAnt, y + 10, { size: 7.5, c: C.sub, align: 'right' })
      y += 22
    }
  } else {
  const maxSets = Math.max(...list.map((e) => e.valid_sets), 1)
  const labelW = 124, rightW = 62, barW = W - labelW - rightW - 40
  legend(d, PAGE.m, y + 4, [{ c: C.heavy, l: 'Séries de trabalho' }])
  chartSeal(d, PAGE.m + W, y + 4)
  y += 14
  for (const e of list) {
    const nm2 = e.display_name.length > 25 ? e.display_name.slice(0, 24) + '…' : e.display_name
    text(d, nm2, PAGE.m, y + 10, { size: 7.5, bold: true })
    const w = (e.valid_sets / maxSets) * barW
    fill(d, C.heavy)
    d.roundedRect(PAGE.m + labelW, y + 2, Math.max(w, 4), 11, 2, 2, 'F')
    text(d, `${e.valid_sets} ${e.valid_sets === 1 ? 'série' : 'séries'}`, PAGE.m + labelW + Math.max(w, 4) + 4, y + 10.5, { size: 6.5, bold: true, c: C.volume })
    y += 21
  }
  }
  if (o.showEmphasis) y = focusSection(d, y + 4, a, undefined, 4)
  finish(d, y, a, 1, !o.showEmphasis)
  return d
}

// ---------------- Template E — Resumo da semana (treinos A, B, C, D… da semana) ----------------
export interface WeekSession {
  session: Session
  agg: Aggregate
  pse: number | null
  prevSame?: Aggregate // a vez anterior do MESMO treino (Treino A × Treino A anterior)
}

const WEEKDAY = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

/**
 * Um treino por linha, na ordem em que aconteceram — inclusive repetições (ABCDA vira
 * "Treino A · 2ª vez"). Destaque da semana comparado à anterior, conquistas, foco muscular opcional.
 */
export function templateE(weekStartDate: string, items: WeekSession[], cur: Aggregate, prev: Aggregate | undefined, o: ReportOptions): jsPDF {
  const d = start(o)
  header(d, 'Resumo da Semana', `Semana de ${fmtBR(weekStartDate)} · ${items.length} ${items.length === 1 ? 'treino' : 'treinos'}`, nm(o))
  if (!items.length) return d
  const regen = o.phase === 'regenerativa'
  let y = heroCard(d, 92, o, cur, regen ? undefined : prev, regen ? 'Semana regenerativa' : prev?.validSets ? 'Semana vs anterior' : 'Total da semana')
  if (regen) {
    // menos volume é planejado: deixa claro que não é destreino
    card(d, PAGE.m, y, W, 30, C.zone.regenerativa)
    text(d, 'Semana regenerativa: redução planejada para recuperar e voltar mais forte.', PAGE.m + 12, y + 13, { size: 7.2, bold: true, c: C.zoneInk.regenerativa })
    text(d, 'Não é perda de treino: é parte da periodização.', PAGE.m + 12, y + 23, { size: 7, c: C.zoneInk.regenerativa })
    y += 38
  }

  // conquistas da semana
  const ach: string[] = []
  const labels = items.map((i) => i.session.label)
  const distinct = new Set(labels).size
  ach.push(`${items.length} ${items.length === 1 ? 'treino feito' : 'treinos feitos'}`)
  if (distinct >= 3 && distinct === items.length) ach.push('Divisão completa')
  if (items.length > distinct) ach.push('Treino extra na semana')
  if (!regen && prev?.validSets && cur.validSets > prev.validSets) ach.push('Mais volume que a semana anterior')
  if (prev && isOnline(o) && (levelOf(cur) ?? 0) > (levelOf(prev) ?? 0)) ach.push('Desafio em alta')
  else if (prev && isOnline(o) && perSession(cur) > perSession(prev)) ach.push('Mais séries por treino')
  y = badgeRow(d, PAGE.m, y, W, ach.slice(0, 4))

  // uma linha por treino (A, B, C, D, A 2ª vez…)
  const seen: Record<string, number> = {}
  const groupsOf = (a: Aggregate) => trainedGroups(a).slice(0, 3).map(([g]) => g.replace('Perna - ', '')).join('/')
  const focusH = o.showEmphasis ? 54 + Math.min(5, Object.keys(cur.byGroup).length) * 17 + 10 : 0
  const rowH = fitRowH(BOTTOM - 58 - y - 14 - focusH - 10, items.length, 32, 18)
  // evolução de cada treino contra a vez anterior do mesmo treino
  const evo = (agg: Aggregate, p?: Aggregate): string | undefined => {
    if (!p) return undefined
    if (!isOnline(o) && p.tonnageKg > 0 && agg.tonnageKg > p.tonnageKg) return `+${Math.round(((agg.tonnageKg - p.tonnageKg) / p.tonnageKg) * 100)}% carga`
    if (agg.validSets > p.validSets) return `+${agg.validSets - p.validSets} séries`
    if (agg.heavySets > p.heavySets && !isOnline(o)) return `+${agg.heavySets - p.heavySets} pesadas`
    return undefined
  }
  const improved = items.filter((i) => evo(i.agg, i.prevSame)).length
  if (improved) y = badgeRow(d, PAGE.m, y - 2, W, [`${improved} ${improved === 1 ? 'treino evoluiu' : 'treinos evoluíram'} vs a vez anterior`])
  y = hRows(d, y + 2, items.map(({ session: s, agg, pse, prevSame }) => {
    seen[s.label] = (seen[s.label] ?? 0) + 1
    const n = seen[s.label]
    const dt = new Date(s.date + 'T12:00:00')
    const tag = [isOnline(o) ? '' : `${WEEKDAY[dt.getDay()]} ${fmtBR(s.date)}`, groupsOf(agg), !isOnline(o) && pse != null ? `PSE ${pse}` : ''].filter(Boolean).join(' · ')
    return {
      label: n > 1 ? `${s.label} · ${n}ª vez` : s.label,
      tag,
      tagColor: C.sub,
      bg: n > 1 ? C.zone.choque : C.card,
      valid: agg.validSets,
      heavy: agg.heavySets,
      right: isOnline(o) ? (levelOfTraining(s.label, agg) != null ? `desafio ${levelOfTraining(s.label, agg)}` : `${s.exercises.length} exercícios`) : kgShort(agg.tonnageKg),
      mark: evo(agg, prevSame),
    }
  }), rowH, isOnline(o) ? (CH_BASE ? 'Nível de estímulo' : 'Exercícios') : rightLabelOf(o))

  if (o.showEmphasis) y = focusSection(d, y + 2, cur, prev?.validSets ? prev : undefined)
  finish(d, y, cur, items.length, !o.showEmphasis)
  return d
}

// ---------------- saída ----------------
/** Compartilha via Web Share (abre o WhatsApp no tablet/celular) ou salva o arquivo. */
export async function sharePdf(d: jsPDF, filename: string) {
  const blob = d.output('blob')
  const file = new File([blob], filename, { type: 'application/pdf' })
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean }
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: filename })
      return
    } catch {
      /* usuário cancelou ou compartilhamento bloqueado — salva o arquivo */
    }
  }
  await saveFile(filename, blob)
}

// ---------------- Template L — Progressão de carga (presencial) ----------------
// PDF separado e enxuto: só a carga. Melhor série de trabalho de cada exercício (aquecimento fora);
// reps diferentes são comparadas pela força estimada (Epley), mas o PDF mostra só reps × kg.

const UP = { ink: '#047857', bg: '#ECFDF5', line: '#A7F3D0' }
const DOWN = { ink: '#B91C1C', bg: '#FEF2F2', line: '#FECACA' }
const SAME = { ink: '#475569', bg: '#F1F5F9', line: '#E2E8F0' }
const NEW = { ink: '#64748B', bg: '#FFFFFF', line: '#E2E8F0' }
const tone = (r: LoadRow) => (r.status === 'up' ? UP : r.status === 'down' ? DOWN : r.status === 'same' ? SAME : NEW)

const kgN = (kg: number) => fmtNum(kg, Number.isInteger(kg) ? 0 : 1)
const kgTxt = (b: BestSet | null, perSide: boolean) => (b ? `${b.reps ? `${b.reps} × ` : ''}${kgN(b.kg)}${perSide ? ' kg/lado' : ' kg'}` : '—')
function pillText(r: LoadRow): string {
  if (r.status === 'new') return '1ª vez'
  if (r.dKg && Math.abs(r.dKg) >= 0.5) return `${r.dKg > 0 ? '+' : '-'}${kgN(Math.abs(r.dKg))} kg`
  if (r.dReps) return `${r.dReps > 0 ? '+' : '-'}${Math.abs(r.dReps)} ${Math.abs(r.dReps) === 1 ? 'rep' : 'reps'}`
  return r.status === 'up' ? 'subiu' : r.status === 'down' ? 'caiu' : 'mantém'
}
function statusPill(d: jsPDF, xRight: number, y: number, r: LoadRow) {
  const t = tone(r)
  const label = pillText(r)
  d.setFont('helvetica', 'bold')
  d.setFontSize(8)
  const w = Math.max(48, d.getTextWidth(label) + 16)
  fill(d, t.bg)
  d.setDrawColor(...([1, 3, 5].map((i) => parseInt(t.line.slice(i, i + 2), 16)) as [number, number, number]))
  d.setLineWidth(0.8)
  d.roundedRect(xRight - w, y, w, 17, 8.5, 8.5, 'FD')
  text(d, label, xRight - w / 2, y + 11.6, { size: 8, bold: true, c: t.ink, align: 'center' })
  if (r.pct != null && r.status !== 'same' && Math.abs(r.pct) >= 1) text(d, `${r.pct > 0 ? '+' : '-'}${Math.round(Math.abs(r.pct))}% força`, xRight - w / 2, y + 26, { size: 5.8, c: t.ink, align: 'center' })
}

export function templateL(mode: 'semana' | 'mes', weeks: string[], rows: LoadRow[], o: ReportOptions): jsPDF {
  // (as linhas são reordenadas por treino mais abaixo)
  const d = start(o)
  const wk = weeks[weeks.length - 1]
  header(d, 'Progressão de Carga', mode === 'semana' ? `Semana de ${fmtBR(wk).slice(0, 5)} · cada exercício × a vez anterior` : `${weeks.length} semanas · ${fmtBR(weeks[0]).slice(0, 5)} a ${fmtBR(addDaysISO(wk, 6)).slice(0, 5)}`, nm(o))
  let y = 92
  const compared = rows.filter((r) => r.status !== 'new')
  const up = rows.filter((r) => r.status === 'up').length
  const same = rows.filter((r) => r.status === 'same').length
  const down = rows.filter((r) => r.status === 'down').length

  // 1) manchete
  fill(d, up ? C.heavy : C.headerBg)
  d.roundedRect(PAGE.m, y, W, 62, 10, 10, 'F')
  if (!rows.length) {
    text(d, 'Sem cargas registradas', PAGE.m + 16, y + 36, { size: 16, bold: true, c: '#ffffff' })
    return d
  }
  text(d, compared.length ? `${up} de ${compared.length}` : `${rows.length}`, PAGE.m + 16, y + 38, { size: 26, bold: true, c: '#ffffff' })
  text(d, compared.length ? 'EXERCÍCIOS COM CARGA EM ALTA' : 'EXERCÍCIOS REGISTRADOS', PAGE.m + 16, y + 52, { size: 6.8, bold: true, c: '#E6F4F2' })
  const best = rows.filter((r) => r.status === 'up').sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0))[0]
  if (best) {
    text(d, 'MAIOR EVOLUÇÃO', PAGE.m + W - 14, y + 20, { size: 6.2, bold: true, c: '#CCFBF1', align: 'right' })
    const nm2 = best.name.length > 22 ? best.name.slice(0, 21) + '…' : best.name
    text(d, nm2, PAGE.m + W - 14, y + 34, { size: 9.5, bold: true, c: '#ffffff', align: 'right' })
    text(d, pillText(best), PAGE.m + W - 14, y + 48, { size: 9, bold: true, c: '#ffffff', align: 'right' })
  }
  y += 72

  // 2) contadores
  const tiles: [string, number, typeof UP][] = [['subiram', up, UP], ['mantiveram', same, SAME], ['caíram', down, DOWN]]
  const tw = (W - 16) / 3
  tiles.forEach(([l, n, t], i) => {
    const x = PAGE.m + i * (tw + 8)
    fill(d, t.bg)
    d.roundedRect(x, y, tw, 34, 8, 8, 'F')
    text(d, String(n), x + 12, y + 23, { size: 15, bold: true, c: t.ink })
    text(d, l, x + 12 + d.getTextWidth(String(n)) + 6, y + 22, { size: 7.5, bold: true, c: t.ink })
  })
  y += 46

  // 3) linhas por exercício, agrupadas por treino (A, B, C…); dentro do treino, quem mais evoluiu primeiro
  const RANKL = { up: 0, same: 1, down: 2, new: 3 } as const
  rows = [...rows].sort((a, b) => a.label.localeCompare(b.label) || RANKL[a.status] - RANKL[b.status] || (b.pct ?? 0) - (a.pct ?? 0))
  const rowH = mode === 'semana' ? 36 : 44
  const groupH = 16
  const colX0 = PAGE.m + 118, colX1 = PAGE.m + W - 66
  const drawHeadRow = () => {
    if (mode === 'mes') {
      const cw = (colX1 - colX0) / weeks.length
      weeks.forEach((w, i) => text(d, fmtBR(w).slice(0, 5), colX0 + cw * i + cw / 2, y + 6, { size: 5.8, bold: true, c: C.sub, align: 'center' }))
      y += 12
    }
  }
  sectionTitle(d, mode === 'semana' ? 'Exercício a exercício' : 'Carga por semana (melhor série)', y + 6)
  chartSeal(d, PAGE.m + W, y + 6)
  y += 16
  drawHeadRow()
  let group = ''
  for (const r of rows) {
    const newGroup = r.label !== group
    if (y + rowH + (newGroup ? groupH : 0) > BOTTOM) {
      d.addPage([PAGE.w, PAGE.h], 'portrait')
      y = 28
      text(d, 'PROGRESSÃO DE CARGA · CONTINUAÇÃO', PAGE.m, y, { size: 6.5, bold: true, c: C.sub })
      chartSeal(d, PAGE.m + W, y)
      y += 12
      drawHeadRow()
      group = ''
    }
    if (r.label !== group) {
      group = r.label
      text(d, `TREINO ${r.label}`, PAGE.m + 2, y + 10, { size: 7, bold: true, c: C.heavy })
      fill(d, C.grid)
      d.rect(PAGE.m + 52, y + 7, W - 52, 0.8, 'F')
      y += groupH
    }
    const t = tone(r)
    card(d, PAGE.m, y, W, rowH - 6, '#FFFFFF')
    fill(d, t.ink === NEW.ink ? C.grid : t.ink)
    d.roundedRect(PAGE.m, y, 3, rowH - 6, 1.5, 1.5, 'F')
    const name = r.name.length > 21 ? r.name.slice(0, 20) + '…' : r.name
    if (mode === 'semana') {
      const [a, b] = r.points
      text(d, name, PAGE.m + 10, y + 13, { size: 8.3, bold: true })
      text(d, a ? `antes ${kgTxt(a, r.perSide)} · ${fmtBR(a.date).slice(0, 5)}` : 'primeira vez com carga', PAGE.m + 10, y + 24, { size: 6.2, c: C.sub })
      text(d, kgTxt(b, r.perSide), colX0 + 8, y + 19, { size: 9.5, bold: true, c: C.ink })
    } else {
      text(d, name, PAGE.m + 10, y + 15, { size: 8.3, bold: true })
      if (r.perSide) text(d, 'kg por lado', PAGE.m + 10, y + 26, { size: 6, c: C.sub })
      const cw = (colX1 - colX0) / weeks.length
      const vals = r.points.map((p) => p?.kg).filter((v): v is number => v != null)
      // escala a partir de perto da menor carga: a subida fica visível (60 → 75 kg não parece "igual")
      const max = Math.max(...vals, 1)
      const min = Math.min(...vals)
      const base = vals.length > 1 && max > min ? Math.max(0, min - (max - min) * 0.6) : 0
      const hMax = rowH - 26
      r.points.forEach((p, i) => {
        const cx = colX0 + cw * i + cw / 2
        if (!p) { text(d, '·', cx, y + rowH - 14, { size: 9, c: '#CBD5E1', align: 'center' }); return }
        const h = Math.max(3, ((p.kg - base) / (max - base || 1)) * hMax)
        const last = i === r.points.length - 1 || r.points.slice(i + 1).every((q) => !q)
        fill(d, last ? (r.status === 'down' ? DOWN.ink : C.heavy) : '#CBD5E1')
        d.roundedRect(cx - 7, y + rowH - 10 - h, 14, h, 2.5, 2.5, 'F')
        text(d, kgN(p.kg), cx, y + rowH - 12 - h, { size: 5.8, bold: last, c: last ? C.ink : C.sub, align: 'center' })
      })
    }
    statusPill(d, PAGE.m + W - 8, y + 6, r)
    y += rowH
  }
  if (y + 14 <= BOTTOM) text(d, 'Melhor série de trabalho de cada exercício (aquecimento fora).', PAGE.m, y + 6, { size: 5.8, c: '#94A3B8' })
  return d
}
const addDaysISO = (iso: string, n: number) => {
  const x = new Date(iso + 'T12:00:00')
  x.setDate(x.getDate() + n)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}
