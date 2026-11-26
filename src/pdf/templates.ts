/**
 * Templates de relatório (Módulo 5) — PDF vetorial "modo limpo" para WhatsApp.
 * Visual primeiro: barras, curvas, setas e números grandes; só rótulos essenciais
 * (a explicação vai no áudio do treinador). Sem notas de rodapé nem textos técnicos.
 */
import type { jsPDF } from 'jspdf'
import { saveFile } from '../artifact/claude'
import { DIET_LABEL, MICRO_LABEL, type Session, type WeekContext } from '../domain/types'
import { aggregateSessions, tonnage, fmtBR, fmtNum, type Aggregate, type ProfileLookup, type WeekVerdict } from '../engine/metrics'
import {
  C, PAGE, applyBrand, badgeRow, card, chartSeal, deltaPill, fill, header, iconDrop, iconFlame, iconTrend, legend, lineSeries,
  muscleRanking, newDoc, ring, seal, sectionTitle, stacked100, text, type MuscleRow, type PdfBrand,
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
}

const W = PAGE.w - PAGE.m * 2
const nm = (o: ReportOptions) => (o.showName ? o.studentName : undefined)

function start(o: ReportOptions): jsPDF {
  applyBrand(o.brand)
  return newDoc()
}

const pct = (cur: number, prev: number | undefined | null) => (prev ? ((cur - prev) / prev) * 100 : null)
const isOnline = (o: ReportOptions) => o.modality === 'online'
const intensityOf = (a: Aggregate, o: ReportOptions) => (isOnline(o) ? a.intensityPrescribed : a.intensityReal)
const kgShort = (t: number) => (t > 0 ? `${fmtNum(t)} kg` : '—')
// coluna da direita das barras: tonelagem no presencial; índice de intensidade na consultoria (sem kg)
const rightOf = (a: Aggregate, o: ReportOptions) => (isOnline(o) ? `${a.intensityPrescribed}/100` : kgShort(a.tonnageKg))
const rightLabelOf = (o: ReportOptions) => (isOnline(o) ? 'Intensidade' : 'Tonelagem')
const BOTTOM = PAGE.h - 14

/** Grupamentos ordenados por volume + intensidade (base do "Foco muscular"). */
function musclesOf(a: Aggregate, prev?: Aggregate): MuscleRow[] {
  return Object.entries(a.byGroup)
    .map(([group, v]) => ({ group, valid: v.valid, heavy: v.heavy, prev: prev?.byGroup[group]?.valid ?? (prev ? 0 : undefined) }))
    .sort((x, y) => y.valid - x.valid || y.heavy - x.heavy) // líder = mais volume; desempate por pesadas
}

/** Seção "Foco muscular" (opção "Especificar musculatura com mais intensidade e volume"). */
function focusSection(d: jsPDF, y: number, a: Aggregate, prev?: Aggregate, maxRows = 5): number {
  const rows = musclesOf(a, prev).filter((r) => r.group !== 'Indefinido' && r.valid > 0).slice(0, maxRows)
  if (!rows.length) return y
  const total = Object.values(a.byGroup).reduce((s, v) => s + v.valid, 0) || 1
  const lead = rows[0]
  sectionTitle(d, 'Foco muscular', y + 6)
  chartSeal(d, PAGE.m + W, y + 6)
  y += 14
  // manchete visual do foco
  const hardest = [...rows].sort((x, z) => z.heavy - x.heavy)[0]
  card(d, PAGE.m, y, W, 30, C.zone.choque)
  text(d, `Ênfase em ${lead.group.replace('Perna - ', '')}`, PAGE.m + 10, y + 19, { size: 12, bold: true, c: C.heavy })
  const sub = hardest.group !== lead.group && hardest.heavy > lead.heavy
    ? `${Math.round((lead.valid / total) * 100)}% do volume · mais pesadas: ${hardest.group.replace('Perna - ', '')} (${hardest.heavy})`
    : `${Math.round((lead.valid / total) * 100)}% do volume · ${lead.heavy} pesadas`
  text(d, sub, PAGE.m + W - 10, y + 19, { size: 7, bold: true, c: C.heavy, align: 'right' })
  y += 38
  if (prev) legend(d, PAGE.m, y, [{ c: C.volume, l: 'Séries agora' }, { c: C.grid, l: 'Antes' }, { c: C.heavy, l: 'Pesadas' }])
  else legend(d, PAGE.m, y, [{ c: C.volume, l: 'Séries válidas' }, { c: C.heavy, l: 'Pesadas' }])
  return muscleRanking(d, PAGE.m, y + 8, W, rows, 15)
}

/**
 * Cartão de destaque: número principal grande + variação, anel de intensidade e
 * terceira métrica (tonelagem no presencial; séries pesadas na consultoria).
 */
function heroCard(d: jsPDF, y: number, o: ReportOptions, a: Aggregate, prev: Aggregate | undefined, title: string): number {
  card(d, PAGE.m, y, W, 84, '#FFFFFF')
  fill(d, C.heavy)
  d.roundedRect(PAGE.m, y, 4, 84, 2, 2, 'F')
  text(d, title.toUpperCase(), PAGE.m + 14, y + 16, { size: 6.5, bold: true, c: C.sub })
  text(d, String(a.validSets), PAGE.m + 14, y + 48, { size: 32, bold: true, c: C.ink })
  text(d, 'séries válidas', PAGE.m + 14, y + 60, { size: 7, c: C.sub })
  deltaPill(d, PAGE.m + 14, y + 64, pct(a.validSets, prev?.validSets))
  ring(d, PAGE.m + 178, y + 38, 22, intensityOf(a, o), C.intensity, isOnline(o) ? 'INTENSIDADE PRESCRITA' : 'INTENSIDADE REAL')
  const rx = PAGE.m + W - 12
  if (isOnline(o)) {
    text(d, 'PESADAS', rx, y + 16, { size: 6.5, bold: true, c: C.sub, align: 'right' })
    text(d, String(a.heavySets), rx, y + 46, { size: 24, bold: true, c: C.heavy, align: 'right' })
    text(d, `${Math.round(a.heavyPct)}% das séries`, rx, y + 58, { size: 7, c: C.sub, align: 'right' })
  } else {
    text(d, 'TONELAGEM', rx, y + 16, { size: 6.5, bold: true, c: C.sub, align: 'right' })
    text(d, a.tonnageKg ? fmtNum(a.tonnageKg) : '—', rx, y + 46, { size: 20, bold: true, c: C.heavy, align: 'right' })
    text(d, 'kg levantados', rx, y + 58, { size: 7, c: C.sub, align: 'right' })
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
  if (prev && intensityOf(last.agg, o) > intensityOf(prev.agg, o)) out.push('Intensidade em alta')
  if (!isOnline(o) && weeks.length > 1 && last.agg.tonnageKg > 0 && last.agg.tonnageKg >= Math.max(...weeks.map((w) => w.agg.tonnageKg))) out.push('Recorde de tonelagem')
  let streak = 0
  for (let i = weeks.length - 1; i >= 0 && weeks[i].agg.sessions > 0; i--) streak++
  if (streak >= 2) out.push(`${streak} semanas seguidas`)
  if (last.verdict.final === 'choque') out.push('Semana de choque concluída')
  if (!out.length) out.push(weeks.length === 1 ? 'Primeira semana registrada' : 'Semana concluída')
  return out.slice(0, 4)
}

/** Card de gasto: chama + kcal, média por treino e gota + equivalente em gordura. */
function kcalCard(d: jsPDF, y: number, kcal: number, fatG: number, sessions = 1) {
  card(d, PAGE.m, y, W, 52, C.card)
  const cols = sessions > 1 ? 3 : 2
  const cw = W / cols
  let x = PAGE.m
  iconFlame(d, x + 18, y + 25, 15, C.heavy)
  text(d, fmtNum(kcal), x + 32, y + 30, { size: 16, bold: true, c: C.ink })
  text(d, sessions > 1 ? `kcal · ${sessions} treinos` : 'kcal', x + 32, y + 42, { size: 6.5, c: C.sub })
  x += cw
  if (sessions > 1) {
    text(d, fmtNum(kcal / sessions), x + 10, y + 30, { size: 16, bold: true, c: C.ink })
    text(d, 'média / treino', x + 10, y + 42, { size: 6.5, c: C.sub })
    x += cw
  }
  iconDrop(d, x + 14, y + 25, 15, C.fat)
  text(d, `${fmtNum(fatG)} g`, x + 28, y + 30, { size: 16, bold: true, c: C.ink })
  text(d, 'gordura', x + 28, y + 42, { size: 6.5, c: C.sub })
  return y + 58
}

interface HRow {
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
function hRows(d: jsPDF, y: number, rows: HRow[], rowH = 28, rightLabel = 'Tonelagem') {
  // coluna do rótulo se ajusta ao maior nome/etiqueta (sem invadir as barras)
  d.setFont('helvetica', 'bold')
  d.setFontSize(8)
  const lw = Math.max(...rows.map((r) => d.getTextWidth(r.label)))
  d.setFontSize(5.8)
  const tw = Math.max(0, ...rows.map((r) => (r.tag ? d.getTextWidth(r.tag) : 0)))
  const labelW = Math.min(150, Math.max(62, lw + 10, tw + 10)), rightW = 70
  const markW = rows.some((r) => r.mark) ? 56 : 0 // coluna fixa da evolução ("+9% carga")
  const barW = W - labelW - rightW - 18 - markW
  const max = Math.max(...rows.map((r) => r.valid), 1)
  legend(d, PAGE.m, y, [{ c: C.volume, l: 'Válidas' }, { c: C.heavy, l: 'Pesadas' }, { c: C.sub, l: rightLabel }])
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
    const wh = Math.max((r.heavy / max) * barW, r.heavy ? 3 : 0)
    fill(d, C.volume)
    if (wv) d.roundedRect(x0, mid - bh - 1, wv, bh, 2, 2, 'F')
    text(d, String(r.valid), x0 + wv + 4, mid - 2.5, { size: 6.5, bold: true, c: C.volume })
    fill(d, C.heavy)
    if (wh) d.roundedRect(x0, mid + 1, wh, bh, 2, 2, 'F')
    text(d, String(r.heavy), x0 + wh + 4, mid + bh - 0.5, { size: 6.5, bold: true, c: C.heavy })
    if (r.mark) text(d, r.mark, PAGE.m + W - rightW + 4, mid + 3, { size: 7, bold: true, c: C.heavy, align: 'right' })
    if (r.right) text(d, r.right, PAGE.m + W, mid + 3, { size: 7.5, bold: true, c: C.ink, align: 'right' })
    y += rowH
  }
  return y + 4
}

/** Perfil biomecânico (multi × mono, livre × máquina) — preenche o espaço quando cabe. */
function profileSection(d: jsPDF, y: number, a: Aggregate): number {
  if (!a.validSets) return y
  sectionTitle(d, 'Perfil do treino', y + 6)
  chartSeal(d, PAGE.m + W, y + 6)
  y += 14
  const half = (W - 12) / 2
  stacked100(d, PAGE.m, y, half, a.multiSets, a.monoSets, C.multi, C.mono, 'Multiarticular', 'Mono')
  stacked100(d, PAGE.m + half + 12, y, half, a.freeSets, a.machineSets, C.free, C.machine, 'Peso livre', 'Máquina')
  return y + 34
}

/** Fecha a página: perfil (se couber) e o card de calorias logo após o conteúdo. */
function finish(d: jsPDF, y: number, a: Aggregate, sessions: number, withProfile = true) {
  if (withProfile && y + 48 + 64 <= BOTTOM) y = profileSection(d, y + 4, a)
  kcalCard(d, Math.min(y + 6, BOTTOM - 52), a.kcal, a.fatGrams, sessions)
}

/** Altura ideal das linhas de barras para caber no espaço restante. */
const fitRowH = (space: number, n: number, max = 28, min = 15) => Math.max(min, Math.min(max, space / Math.max(n, 1)))

// ---------------- Template A — Antes × Depois (Mês 1 × Mês 2) ----------------
export interface MonthSide {
  label: string // "out/26"
  agg: Aggregate
  lifts: Record<string, { name: string; kg: number; perSide: boolean }> // maior carga de cada exercício no mês
}

/** Um treino (A, B, C…) nas duas semanas comparadas. */
export interface PerTraining {
  label: string
  before?: Aggregate
  after?: Aggregate
}

/** Placar "antes → depois" de uma métrica, com barras lado a lado. */
function scoreTile(d: jsPDF, x: number, y: number, w: number, h: number, label: string, before: number, after: number, fmt: (n: number) => string, hasBefore: boolean, first = 'primeiro mês') {
  card(d, x, y, w, h, '#FFFFFF')
  text(d, label.toUpperCase(), x + 10, y + 15, { size: 6.3, bold: true, c: C.sub })
  text(d, fmt(after), x + 10, y + 46, { size: 22, bold: true, c: C.ink })
  text(d, hasBefore ? `antes ${fmt(before)}` : first, x + 10, y + 59, { size: 7, c: C.sub })
  if (hasBefore && before > 0) deltaPill(d, x + 10, y + h - 22, ((after - before) / before) * 100, '')
  // barras verticais: antes (cinza) × depois (destaque)
  const bx = x + w - 52, base = y + h - 14, hMax = h - 36
  const max = Math.max(before, after, 1)
  const hb = hasBefore ? Math.max(2, (before / max) * hMax) : 0
  const ha = Math.max(2, (after / max) * hMax)
  fill(d, C.grid)
  if (hb) d.roundedRect(bx, base - hb, 18, hb, 3, 3, 'F')
  fill(d, after >= before ? C.heavy : C.volume)
  d.roundedRect(bx + 22, base - ha, 18, ha, 3, 3, 'F')
  text(d, 'antes', bx + 9, base + 8, { size: 5.2, c: C.sub, align: 'center' })
  text(d, 'depois', bx + 31, base + 8, { size: 5.2, bold: true, c: C.heavy, align: 'center' })
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
  let y = 92

  // 1) manchete: a maior melhora do período
  const cands: [string, number][] = []
  if (hasBefore) {
    if (!isOnline(o) && b.tonnageKg) cands.push(['mais carga levantada', pct(a.tonnageKg, b.tonnageKg)!])
    cands.push(['mais volume de treino', pct(a.validSets, b.validSets)!])
    if (b.heavySets) cands.push(['mais séries pesadas', pct(a.heavySets, b.heavySets)!])
    if (intensityOf(b, o)) cands.push(['mais intensidade', pct(intensityOf(a, o), intensityOf(b, o))!])
  }
  const best = cands.filter(([, v]) => v > 0).sort((x, z) => z[1] - x[1])[0]
  fill(d, best ? C.heavy : C.headerBg)
  d.roundedRect(PAGE.m, y, W, 66, 10, 10, 'F')
  if (best) {
    text(d, `+${Math.round(best[1])}%`, PAGE.m + 16, y + 45, { size: 36, bold: true, c: '#ffffff' })
    text(d, best[0].toUpperCase(), PAGE.m + W - 16, y + 30, { size: 9, bold: true, c: '#ffffff', align: 'right' })
    text(d, `${before.label} > ${after.label}`, PAGE.m + W - 16, y + 44, { size: 7.5, c: '#E6F4F2', align: 'right' })
  } else {
    text(d, hasBefore ? (wk ? 'Semana de ajuste' : 'Mês de ajuste') : (wk ? 'Primeira semana' : 'Primeiro mês'), PAGE.m + 16, y + 38, { size: 20, bold: true, c: '#ffffff' })
    text(d, hasBefore ? 'base para o próximo salto' : 'ponto de partida da evolução', PAGE.m + 16, y + 52, { size: 7.5, c: '#CBD5E1' })
  }
  y += 76

  // 2) quatro placares grandes
  const first = wk ? 'primeira semana' : 'primeiro mês'
  const tw = (W - 10) / 2, th = 92
  scoreTile(d, PAGE.m, y, tw, th, 'Séries válidas', b.validSets, a.validSets, (n) => fmtNum(n), hasBefore, first)
  scoreTile(d, PAGE.m + tw + 10, y, tw, th, 'Séries pesadas', b.heavySets, a.heavySets, (n) => fmtNum(n), hasBefore, first)
  scoreTile(d, PAGE.m, y + th + 10, tw, th, 'Intensidade (0-100)', intensityOf(b, o), intensityOf(a, o), (n) => String(Math.round(n)), hasBefore, first)
  if (isOnline(o)) scoreTile(d, PAGE.m + tw + 10, y + th + 10, tw, th, 'Treinos realizados', b.sessions, a.sessions, (n) => fmtNum(n), hasBefore, first)
  else scoreTile(d, PAGE.m + tw + 10, y + th + 10, tw, th, 'Tonelagem', b.tonnageKg, a.tonnageKg, (n) => (n >= 10000 ? `${fmtNum(n / 1000, 1)} t` : `${fmtNum(n)} kg`), hasBefore, first)
  y += th * 2 + 22

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
    if (hasBefore) text(d, `antes ${fmtNum(b.kcal)}`, PAGE.m + 140, y + 37, { size: 7.5, c: C.sub })
    iconDrop(d, PAGE.m + W - 74, y + 27, 14, C.fat)
    text(d, `${fmtNum(a.fatGrams)} g`, PAGE.m + W - 12, y + 37, { size: 13, bold: true, c: C.ink, align: 'right' })
  }
  return d
}

/** Treino a treino: séries válidas de cada treino (A, B, C…) na semana anterior × na nova. */
function perTrainingSection(d: jsPDF, y: number, rows: PerTraining[], o: ReportOptions): number {
  const list = rows.filter((r) => r.after || r.before).slice(0, 6)
  if (!list.length) return y
  sectionTitle(d, 'Treino a treino', y + 6)
  chartSeal(d, PAGE.m + W, y + 6)
  y += 16
  const max = Math.max(1, ...list.map((r) => Math.max(r.before?.validSets ?? 0, r.after?.validSets ?? 0)))
  const rowH = fitRowH(BOTTOM - 56 - y, list.length, 26, 20)
  for (const r of list) {
    const b = r.before, a = r.after
    const bs = b?.validSets ?? 0, as = a?.validSets ?? 0
    // destaque: o que mais cresceu nesse treino
    let pill: string | undefined
    if (!b && a) pill = 'novo'
    else if (b && a) {
      const ds = as - bs, dh = a.heavySets - b.heavySets, di = intensityOf(a, o) - intensityOf(b, o)
      const dt = !isOnline(o) && b.tonnageKg ? pct(a.tonnageKg, b.tonnageKg)! : 0
      if (ds > 0) pill = `+${ds} ${ds === 1 ? "série" : "séries"}`
      else if (dh > 0) pill = `+${dh} ${dh === 1 ? "pesada" : "pesadas"}`
      else if (dt >= 1) pill = `+${Math.round(dt)}% carga`
      else if (di >= 1) pill = `+${Math.round(di)} intens.`
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
    ['Séries pesadas', share(b.heavySets, b.validSets), share(a.heavySets, a.validSets)],
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
    return {
      ...acc,
      validSets: acc.validSets + w.agg.validSets, heavySets: acc.heavySets + w.agg.heavySets, tonnageKg: acc.tonnageKg + w.agg.tonnageKg,
      kcal: acc.kcal + w.agg.kcal, fatGrams: acc.fatGrams + w.agg.fatGrams, sessions: acc.sessions + w.agg.sessions, byGroup: g,
    }
  }, { ...weeks[0].agg, validSets: 0, heavySets: 0, tonnageKg: 0, kcal: 0, fatGrams: 0, sessions: 0, byGroup: {} })
  monthAgg.heavyPct = monthAgg.validSets ? (monthAgg.heavySets / monthAgg.validSets) * 100 : 0
  monthAgg.intensityPrescribed = Math.round(weeks.reduce((s, w) => s + w.agg.intensityPrescribed, 0) / weeks.length)
  monthAgg.intensityReal = Math.round(weeks.reduce((s, w) => s + w.agg.intensityReal, 0) / weeks.length)

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
  y = hRows(d, y + 4, weeks.map((w) => ({
    label: fmtBR(w.firstDate ?? w.week),
    tag: `${MICRO_LABEL[w.verdict.final]}${w.agg.avgPse != null ? ` · PSE ${w.agg.avgPse.toFixed(1)}` : ''}`,
    tagColor: C.zoneInk[w.verdict.final],
    bg: C.zone[w.verdict.final],
    valid: w.agg.validSets,
    heavy: w.agg.heavySets,
    right: rightOf(w.agg, o),
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

// ---------------- Template D — Treino do dia ----------------
export function templateD(session: Session, lookup: ProfileLookup, pse: number | null, o: ReportOptions, bests: Record<string, number> = {}): jsPDF {
  const d = start(o)
  header(d, 'Treino do Dia', `${session.label} · ${fmtBR(session.date)}`, nm(o))
  const a = aggregateSessions([session], lookup)
  if (pse != null && !isOnline(o)) a.intensityReal = Math.round(0.45 * pse * 10 + 0.55 * a.intensityPrescribed)
  let y = heroCard(d, 92, o, a, undefined, `${session.exercises.length} exercícios`)

  // recordes pessoais (só presencial, com carga)
  const peakOf = (e: Session['exercises'][number]) => Math.max(e.load_kg ?? 0, ...(e.loads ?? []).map((k) => k ?? 0))
  const prKeys = new Set(isOnline(o) ? [] : session.exercises.filter((e) => peakOf(e) > 0 && bests[e.exercise_key] != null && peakOf(e) > bests[e.exercise_key]).map((e) => e.exercise_key))
  const ach: string[] = []
  if (prKeys.size) ach.push(`${prKeys.size} ${prKeys.size === 1 ? 'recorde pessoal' : 'recordes pessoais'}`)
  if (a.heavySets) ach.push(`${a.heavySets} séries pesadas`)
  if (pse != null && pse >= 8) ach.push(`Entrega alta · PSE ${pse}`)
  ach.push('Treino concluído')
  y = badgeRow(d, PAGE.m, y, W, ach.slice(0, 4))

  const list = session.exercises.filter((e) => e.valid_sets > 0).slice(0, o.showEmphasis ? 7 : 10)
  const maxSets = Math.max(...list.map((e) => e.valid_sets), 1)
  const labelW = 124, rightW = 62, barW = W - labelW - rightW - 40
  legend(d, PAGE.m, y + 4, isOnline(o) ? [{ c: C.volume, l: 'Válidas' }, { c: C.heavy, l: 'Pesadas' }] : [{ c: C.volume, l: 'Válidas' }, { c: C.heavy, l: 'Pesadas' }, { c: C.sub, l: 'Pico · tonelagem' }])
  chartSeal(d, PAGE.m + W, y + 4)
  y += 14
  for (const e of list) {
    const pr = prKeys.has(e.exercise_key)
    const nm2 = e.display_name.length > (pr ? 20 : 25) ? e.display_name.slice(0, pr ? 19 : 24) + '…' : e.display_name
    text(d, nm2, PAGE.m, y + 10, { size: 7.5, bold: true })
    if (pr) {
      const tw = d.getTextWidth(nm2)
      fill(d, C.heavy)
      d.roundedRect(PAGE.m + tw + 4, y + 3, 16, 9, 4.5, 4.5, 'F')
      text(d, 'PR', PAGE.m + tw + 12, y + 9.4, { size: 5.6, bold: true, c: '#ffffff', align: 'center' })
    }
    const w = (e.valid_sets / maxSets) * barW
    fill(d, C.volume)
    d.roundedRect(PAGE.m + labelW, y + 2, Math.max(w, 4), 11, 2, 2, 'F')
    if (e.heavy_sets) {
      fill(d, C.heavy)
      d.roundedRect(PAGE.m + labelW, y + 2, Math.max((e.heavy_sets / maxSets) * barW, 4), 11, 2, 2, 'F')
    }
    text(d, e.heavy_sets ? `${e.valid_sets} · ${e.heavy_sets}P` : String(e.valid_sets), PAGE.m + labelW + Math.max(w, 4) + 4, y + 10.5, { size: 6.5, bold: true, c: e.heavy_sets ? C.heavy : C.volume })
    if (!isOnline(o)) {
      if (e.load_kg) text(d, `${fmtNum(e.load_kg, 1)} ${e.per_side ? 'kg/lado' : 'kg'}`, PAGE.m + W, y + 7.5, { size: 7.5, bold: true, c: pr ? C.heavy : C.ink, align: 'right' })
      const t = tonnage(e)
      if (t) text(d, `${fmtNum(t)} kg`, PAGE.m + W, y + 15.5, { size: 6, c: C.sub, align: 'right' })
    }
    y += 21
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
  let y = heroCard(d, 92, o, cur, prev, prev?.validSets ? 'Semana vs anterior' : 'Total da semana')

  // conquistas da semana
  const ach: string[] = []
  const labels = items.map((i) => i.session.label)
  const distinct = new Set(labels).size
  ach.push(`${items.length} ${items.length === 1 ? 'treino feito' : 'treinos feitos'}`)
  if (distinct >= 3 && distinct === items.length) ach.push('Divisão completa')
  if (items.length > distinct) ach.push('Treino extra na semana')
  if (prev?.validSets && cur.validSets > prev.validSets) ach.push('Mais volume que a semana anterior')
  if (prev && intensityOf(cur, o) > intensityOf(prev, o)) ach.push('Intensidade em alta')
  y = badgeRow(d, PAGE.m, y, W, ach.slice(0, 4))

  // uma linha por treino (A, B, C, D, A 2ª vez…)
  const seen: Record<string, number> = {}
  const groupsOf = (a: Aggregate) => Object.entries(a.byGroup).filter(([g]) => g !== 'Indefinido').sort((x, z) => z[1].valid - x[1].valid).slice(0, 2).map(([g]) => g.replace('Perna - ', '')).join('/')
  const focusH = o.showEmphasis ? 54 + Math.min(5, Object.keys(cur.byGroup).length) * 17 + 10 : 0
  const rowH = fitRowH(BOTTOM - 58 - y - 14 - focusH - 10, items.length, 32, 18)
  // evolução de cada treino contra a vez anterior do mesmo treino
  const evo = (agg: Aggregate, p?: Aggregate): string | undefined => {
    if (!p) return undefined
    if (!isOnline(o) && p.tonnageKg > 0 && agg.tonnageKg > p.tonnageKg) return `+${Math.round(((agg.tonnageKg - p.tonnageKg) / p.tonnageKg) * 100)}% carga`
    if (agg.validSets > p.validSets) return `+${agg.validSets - p.validSets} séries`
    if (agg.heavySets > p.heavySets) return `+${agg.heavySets - p.heavySets} pesadas`
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
      right: isOnline(o) ? `${agg.intensityPrescribed}/100` : kgShort(agg.tonnageKg),
      mark: evo(agg, prevSame),
    }
  }), rowH, rightLabelOf(o))

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
