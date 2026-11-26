/**
 * Primitivas de gráfico VETORIAL para jsPDF (linhas, retângulos e texto — sem rasterização).
 * Página em proporção de celular (9:16) para leitura direta no WhatsApp.
 */
import { jsPDF } from 'jspdf'
import { CanvasDoc, lastPageCount } from './canvasDoc'

export const PAGE = { w: 360, h: 640, m: 20 }

// Paleta dos relatórios (clean): fundo branco, grafite e azul petróleo da marca
export const C = {
  ink: '#0F172A',
  sub: '#64748B',
  grid: '#E2E8F0',
  card: '#F8FAFC',
  volume: '#334155', // grafite/ardósia
  heavy: '#0F766E', // azul petróleo (destaque)
  pse: '#0F172A',
  intensity: '#0F766E',
  multi: '#334155',
  mono: '#CBD5E1',
  free: '#0F766E',
  machine: '#99F6E4',
  fat: '#334155',
  zone: { regenerativa: '#F0FDF4', ordinaria: '#F8FAFC', choque: '#E6F4F2' },
  zoneInk: { regenerativa: '#15803D', ordinaria: '#475569', choque: '#0F766E' },
  headerBg: '#18181B',
}

export interface PdfBrand {
  name: string
  primary: string
  accent: string
  logo: string | null
}
let brand: PdfBrand | null = null

/** Aplica as cores/logo da marca antes de montar um relatório. */
export function applyBrand(b: PdfBrand | null | undefined) {
  brand = b ?? null
  C.volume = '#334155'
  C.multi = '#334155'
  C.heavy = b?.accent ?? '#0F766E'
  C.intensity = b?.accent ?? '#0F766E'
  C.free = b?.accent ?? '#0F766E'
  C.zone.choque = mix(b?.accent ?? '#0F766E', '#ffffff', 0.9)
  C.zoneInk.choque = b?.accent ?? '#0F766E'
  C.headerBg = b?.primary ?? '#18181B'
}

/** Mistura duas cores hex (t = peso da segunda). */
function mix(a: string, b: string, t: number): string {
  const pa = hex(a), pb = hex(b)
  return '#' + pa.map((v, i) => Math.round(v * (1 - t) + pb[i] * t).toString(16).padStart(2, '0')).join('')
}

let canvasTarget: HTMLCanvasElement | null = null
let previewPages = 1

export function newDoc(): jsPDF {
  if (canvasTarget) return new CanvasDoc(canvasTarget, PAGE.w, PAGE.h, 2, previewPages) as unknown as jsPDF
  return new jsPDF({ unit: 'pt', format: [PAGE.w, PAGE.h], orientation: 'portrait', compress: true })
}

/** Roda um template desenhando no canvas (prévia na tela) em vez de gerar o PDF. */
export function drawPreview(canvas: HTMLCanvasElement, build: () => unknown) {
  try {
    // 1ª passada num canvas de rascunho só para contar as páginas; 2ª desenha de verdade
    canvasTarget = document.createElement('canvas')
    previewPages = 1
    build()
    previewPages = lastPageCount
    canvasTarget = canvas
    build()
  } finally {
    canvasTarget = null
    previewPages = 1
  }
}

const hex = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
export const fill = (d: jsPDF, c: string) => d.setFillColor(...hex(c))
export const stroke = (d: jsPDF, c: string) => d.setDrawColor(...hex(c))
export const color = (d: jsPDF, c: string) => d.setTextColor(...hex(c))

export function text(d: jsPDF, s: string, x: number, y: number, o: { size?: number; bold?: boolean; c?: string; align?: 'left' | 'center' | 'right' } = {}) {
  d.setFont('helvetica', o.bold ? 'bold' : 'normal')
  d.setFontSize(o.size ?? 9)
  color(d, o.c ?? C.ink)
  d.text(s, x, y, { align: o.align ?? 'left', baseline: 'alphabetic' })
}

/** Emblema padrão Manu Team (vetorial): preto, anel vermelho, "MG" e faixa cinza. */
export function drawEmblem(d: jsPDF, x: number, y: number, size: number) {
  fill(d, '#111111')
  d.roundedRect(x, y, size, size, size * 0.22, size * 0.22, 'F')
  stroke(d, '#e10600')
  d.setLineWidth(Math.max(0.6, size * 0.07))
  d.circle(x + size / 2, y + size / 2, size * 0.36, 'S')
  d.setLineWidth(0.5)
  text(d, 'MG', x + size / 2, y + size * 0.6, { size: size * 0.34, bold: true, c: '#ffffff', align: 'center' })
  fill(d, '#a1a1aa')
  d.rect(x + size * 0.3, y + size * 0.74, size * 0.4, Math.max(0.6, size * 0.05), 'F')
}

/** Logo enviada nas configurações; sem logo, o emblema padrão. */
function logoOrEmblem(d: jsPDF, x: number, y: number, size: number) {
  if (brand?.logo) {
    try {
      d.addImage(brand.logo, brand.logo.startsWith('data:image/jpeg') ? 'JPEG' : 'PNG', x, y, size, size, undefined, 'FAST')
      return
    } catch {
      /* imagem inválida: usa o emblema */
    }
  }
  drawEmblem(d, x, y, size)
}

export const brandName = () => (brand?.name || 'Manu Team')

/**
 * Selo da marca DENTRO da área do gráfico (canto superior direito): logo + nome.
 * Vai em todos os gráficos — na prévia em tela e no PDF.
 */
export function chartSeal(d: jsPDF, xRight: number, yTop: number) {
  const s = 11
  logoOrEmblem(d, xRight - s, yTop - s + 2, s)
  text(d, brandName().toUpperCase(), xRight - s - 4, yTop - 1.5, { size: 5.6, bold: true, c: '#94A3B8', align: 'right' })
}

export function header(d: jsPDF, title: string, subtitle: string, studentName?: string) {
  fill(d, C.headerBg)
  d.rect(0, 0, PAGE.w, 78, 'F')
  fill(d, C.heavy)
  d.rect(0, 78, PAGE.w, 2, 'F') // filete fino na cor da marca
  // logo à esquerda + nome da marca; título e aluno à direita da logo
  logoOrEmblem(d, PAGE.m, 15, 48)
  const tx = PAGE.m + 60
  text(d, brandName().toUpperCase(), tx, 24, { size: 6.8, c: '#94A3B8', bold: true })
  text(d, title, tx, 44, { size: 16, bold: true, c: '#ffffff' })
  text(d, studentName ? `${studentName} · ${subtitle}` : subtitle, tx, 61, { size: 8.5, c: '#CBD5E1' })
}

/** Ícone de chama (gasto calórico). */
export function iconFlame(d: jsPDF, x: number, y: number, s: number, c: string) {
  fill(d, c)
  d.circle(x, y + s * 0.18, s * 0.42, 'F')
  d.triangle(x - s * 0.38, y + s * 0.05, x + s * 0.38, y + s * 0.05, x + s * 0.05, y - s * 0.62, 'F')
  fill(d, '#ffffff')
  d.circle(x, y + s * 0.3, s * 0.17, 'F')
}

/** Ícone de gota (gordura). */
export function iconDrop(d: jsPDF, x: number, y: number, s: number, c: string) {
  fill(d, c)
  d.circle(x, y + s * 0.2, s * 0.4, 'F')
  d.triangle(x - s * 0.36, y + s * 0.02, x + s * 0.36, y + s * 0.02, x, y - s * 0.6, 'F')
}

/** Seta de tendência (sobe/desce) desenhada em vetor. */
export function iconTrend(d: jsPDF, x: number, y: number, s: number, up: boolean, c: string) {
  fill(d, c)
  if (up) d.triangle(x - s / 2, y + s / 2, x + s / 2, y + s / 2, x, y - s / 2, 'F')
  else d.triangle(x - s / 2, y - s / 2, x + s / 2, y - s / 2, x, y + s / 2, 'F')
}

export function footer(d: jsPDF, note: string) {
  text(d, note, PAGE.w / 2, PAGE.h - 12, { size: 6.5, c: C.sub, align: 'center' })
}

export function sectionTitle(d: jsPDF, s: string, y: number) {
  text(d, s.toUpperCase(), PAGE.m, y, { size: 7.5, bold: true, c: C.sub })
}

export function card(d: jsPDF, x: number, y: number, w: number, h: number, bg: string = C.card) {
  // card clean: fundo suave + borda fina
  fill(d, bg)
  stroke(d, C.grid)
  d.setLineWidth(0.6)
  d.roundedRect(x, y, w, h, 8, 8, 'FD')
}

/** KPI grande: valor + rótulo + variação opcional. */
export function kpi(d: jsPDF, x: number, y: number, w: number, value: string, label: string, delta?: string, accent: string = C.ink) {
  card(d, x, y, w, 52)
  text(d, value, x + 10, y + 24, { size: 17, bold: true, c: accent })
  text(d, label, x + 10, y + 38, { size: 7, c: C.sub })
  if (delta) text(d, delta, x + w - 8, y + 16, { size: 7.5, bold: true, c: accent, align: 'right' })
}

export interface Box { x: number; y: number; w: number; h: number }

/** Máximo "redondo" divisível em 4 ticks inteiros (ex.: 40, 60, 80, 100). */
function niceMax(v: number): number {
  if (v <= 0) return 4
  const raw = (v * 1.1) / 4
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((st) => st >= raw && Number.isInteger(st)) ?? Math.ceil(raw)
  return step * 4
}

function gridLines(d: jsPDF, b: Box, max: number, ticks = 4, suffix = '') {
  stroke(d, C.grid)
  d.setLineWidth(0.5)
  for (let i = 0; i <= ticks; i++) {
    const y = b.y + b.h - (b.h * i) / ticks
    d.line(b.x, y, b.x + b.w, y)
    text(d, `${Math.round((max * i) / ticks)}${suffix}`, b.x - 3, y + 2, { size: 5.5, c: C.sub, align: 'right' })
  }
}

/** Barras agrupadas (ex.: Volume válido × Séries pesadas). */
export function groupedBars(d: jsPDF, b: Box, labels: string[], series: { values: number[]; color: string; name: string }[], opts: { zones?: (keyof typeof C.zone | null)[]; valueLabels?: boolean; fixedMax?: number; suffix?: string } = {}) {
  const max = opts.fixedMax ?? niceMax(Math.max(...series.flatMap((s) => s.values), 1))
  const n = labels.length || 1
  const slot = b.w / n
  if (opts.zones) {
    opts.zones.forEach((z, i) => {
      if (!z) return
      fill(d, C.zone[z])
      d.rect(b.x + slot * i, b.y, slot, b.h, 'F')
    })
  }
  gridLines(d, b, max, 4, opts.suffix)
  const bw = Math.min(16, (slot * 0.7) / series.length)
  labels.forEach((lab, i) => {
    const x0 = b.x + slot * i + (slot - bw * series.length) / 2
    series.forEach((s, k) => {
      const v = s.values[i] ?? 0
      const h = (v / max) * b.h
      fill(d, s.color)
      d.rect(x0 + k * bw, b.y + b.h - h, bw - 1.5, h, 'F')
      if (opts.valueLabels !== false && v > 0) text(d, String(Math.round(v)), x0 + k * bw + (bw - 1.5) / 2, b.y + b.h - h - 2.5, { size: 5.5, c: s.color, align: 'center', bold: true })
    })
    text(d, lab, b.x + slot * i + slot / 2, b.y + b.h + 9, { size: 6, c: C.sub, align: 'center' })
  })
  return { max, slot }
}

/** Linha sobre eixo secundário (ex.: % intensidade ou PSE 0–10). */
export function lineSeries(d: jsPDF, b: Box, values: (number | null)[], max: number, c: string, o: { dash?: boolean; label?: (v: number) => string; axisRight?: string } = {}) {
  const n = values.length || 1
  const slot = b.w / n
  const pts = values.map((v, i) => (v == null ? null : { x: b.x + slot * i + slot / 2, y: b.y + b.h - (Math.min(v, max) / max) * b.h, v }))
  stroke(d, c)
  d.setLineWidth(1.6)
  if (o.dash) d.setLineDashPattern([3, 2], 0)
  let prev: { x: number; y: number } | null = null
  for (const p of pts) {
    if (p && prev) d.line(prev.x, prev.y, p.x, p.y)
    if (p) prev = p
  }
  d.setLineDashPattern([], 0)
  for (const p of pts) {
    if (!p) continue
    fill(d, '#ffffff')
    d.circle(p.x, p.y, 2.4, 'F')
    fill(d, c)
    d.circle(p.x, p.y, 1.6, 'F')
    if (o.label) text(d, o.label(p.v), p.x, p.y - 5, { size: 5.5, c, align: 'center', bold: true })
  }
  if (o.axisRight) text(d, o.axisRight, b.x + b.w + 2, b.y - 3, { size: 5.5, c, align: 'right' })
  return pts
}

/** Seta destacando pico de progressão. */
export function peakArrow(d: jsPDF, x: number, y: number, label: string, c: string = C.heavy) {
  stroke(d, c)
  fill(d, c)
  d.setLineWidth(1.2)
  d.line(x, y - 20, x, y - 6)
  d.triangle(x - 3, y - 8, x + 3, y - 8, x, y - 3, 'F')
  text(d, label, x, y - 23, { size: 6, c, bold: true, align: 'center' })
}

/** Barra 100% empilhada horizontal (ex.: Multi × Mono). */
export function stacked100(d: jsPDF, x: number, y: number, w: number, a: number, b: number, ca: string, cb: string, la: string, lb: string) {
  const tot = a + b || 1
  const wa = (a / tot) * w
  fill(d, ca)
  d.roundedRect(x, y, w, 14, 3, 3, 'F')
  fill(d, cb)
  if (wa < w) d.rect(x + wa, y, w - wa, 14, 'F')
  if (wa > 24) text(d, `${Math.round((a / tot) * 100)}%`, x + 5, y + 10, { size: 7, c: '#ffffff', bold: true })
  if (w - wa > 24) text(d, `${Math.round((b / tot) * 100)}%`, x + w - 5, y + 10, { size: 7, c: C.ink, bold: true, align: 'right' })
  text(d, `${la} ${a}`, x, y + 23, { size: 6.5, c: ca, bold: true })
  text(d, `${lb} ${b}`, x + w, y + 23, { size: 6.5, c: C.sub, bold: true, align: 'right' })
}

export function legend(d: jsPDF, x: number, y: number, items: { c: string; l: string }[]) {
  let cx = x
  for (const it of items) {
    fill(d, it.c)
    d.roundedRect(cx, y - 5, 7, 7, 1.5, 1.5, 'F')
    text(d, it.l, cx + 10, y + 1, { size: 6.5, c: C.sub })
    cx += 16 + d.getTextWidth(it.l) // fonte já está em 6.5 após text()
  }
}

export function seal(d: jsPDF, x: number, y: number, w: number, title: string, value: string, bg: string, ink: string) {
  card(d, x, y, w, 40, bg)
  text(d, title.toUpperCase(), x + 8, y + 14, { size: 6, c: ink, bold: true })
  text(d, value, x + 8, y + 30, { size: 9.5, c: ink, bold: true })
}

// ===================== elementos de motivação =====================

/** Anel de progresso (0–100) com o valor no centro — ex.: índice de intensidade. */
export function ring(d: jsPDF, cx: number, cy: number, r: number, value: number, c: string, label: string) {
  const v = Math.max(0, Math.min(100, value))
  stroke(d, C.grid)
  d.setLineWidth(5)
  d.circle(cx, cy, r, 'S')
  if (v > 0) {
    stroke(d, c)
    ;(d as unknown as { setLineCap?: (c: string) => void }).setLineCap?.('round')
    const steps = Math.max(2, Math.round(72 * (v / 100)))
    let px = cx, py = cy - r
    for (let i = 1; i <= steps; i++) {
      const a = -Math.PI / 2 + (2 * Math.PI * v * i) / (100 * steps)
      const nx = cx + r * Math.cos(a), ny = cy + r * Math.sin(a)
      d.line(px, py, nx, ny)
      px = nx
      py = ny
    }
    ;(d as unknown as { setLineCap?: (c: string) => void }).setLineCap?.('butt')
  }
  d.setLineWidth(0.5)
  text(d, String(Math.round(v)), cx, cy + 4, { size: r * 0.62, bold: true, c: C.ink, align: 'center' })
  text(d, label, cx, cy + r + 11, { size: 6, bold: true, c: C.sub, align: 'center' })
}

/** Pílula de variação: verde-petróleo quando sobe; neutra quando cai (nunca desmotivadora). */
export function deltaPill(d: jsPDF, x: number, y: number, pct: number | null, suffix = 'vs anterior') {
  if (pct == null || !isFinite(pct) || Math.abs(pct) < 0.5) return // sem variação: sem pílula
  const up = pct >= 0
  const label = `${up ? '+' : '-'}${Math.abs(Math.round(pct))}% ${suffix}`
  d.setFont('helvetica', 'bold')
  d.setFontSize(6.8)
  const w = d.getTextWidth(label) + 20
  fill(d, up ? C.heavy : C.grid)
  d.roundedRect(x, y, w, 14, 7, 7, 'F')
  iconTrend(d, x + 7, y + 7, 5, up, up ? '#ffffff' : C.sub)
  text(d, label, x + 13, y + 9.6, { size: 6.8, bold: true, c: up ? '#ffffff' : C.sub })
}

/** Selo de conquista (pílula com check). Retorna a largura usada. */
export function badge(d: jsPDF, x: number, y: number, label: string): number {
  d.setFont('helvetica', 'bold')
  d.setFontSize(6.8)
  const w = d.getTextWidth(label) + 24
  fill(d, mix(C.heavy, '#ffffff', 0.88))
  stroke(d, mix(C.heavy, '#ffffff', 0.6))
  d.setLineWidth(0.6)
  d.roundedRect(x, y, w, 16, 8, 8, 'FD')
  // check vetorial
  fill(d, C.heavy)
  d.circle(x + 9, y + 8, 4.2, 'F')
  stroke(d, '#ffffff')
  d.setLineWidth(1.1)
  d.line(x + 7, y + 8.2, x + 8.6, y + 9.8)
  d.line(x + 8.6, y + 9.8, x + 11.2, y + 6.4)
  d.setLineWidth(0.5)
  text(d, label, x + 16, y + 10.6, { size: 6.8, bold: true, c: C.heavy })
  return w
}

/** Linha de selos, quebrando quando não cabe. Retorna o y final. */
export function badgeRow(d: jsPDF, x: number, y: number, w: number, labels: string[]): number {
  let cx = x, cy = y
  for (const l of labels) {
    d.setFont('helvetica', 'bold')
    d.setFontSize(6.8)
    const bw = d.getTextWidth(l) + 24
    if (cx + bw > x + w && cx > x) { cx = x; cy += 20 }
    cx += badge(d, cx, cy, l) + 6
  }
  return labels.length ? cy + 22 : y
}

export interface MuscleRow {
  group: string; valid: number; heavy: number; prev?: number
  focus?: boolean // destaque FOCO (ênfase do plano); sem nenhum marcado, destaca o 1º
}

const shortGroup = (g: string) => g.replace('Perna - ', '')

/**
 * Ranking de grupamentos ("Foco muscular"): barras horizontais por volume, parte pesada
 * em destaque, líder marcado como FOCO. Com `prev`, mostra a barra fantasma do período anterior.
 */
export function muscleRanking(d: jsPDF, x: number, y: number, w: number, rows: MuscleRow[], rowH = 17): number {
  const list = rows.filter((r) => r.group !== 'Indefinido' && r.valid > 0)
  if (!list.length) return y
  const total = rows.reduce((a, r) => a + r.valid, 0) || 1
  const max = Math.max(...list.map((r) => Math.max(r.valid, r.prev ?? 0)), 1)
  const labelW = 98, rightW = 70, barW = w - labelW - rightW - 6
  list.forEach((r, i) => {
    const lead = rows.some((x) => x.focus) ? !!r.focus : i === 0
    if (lead) {
      fill(d, mix(C.heavy, '#ffffff', 0.9))
      d.roundedRect(x - 4, y - 1, w + 8, rowH, 5, 5, 'F')
    }
    const mid = y + rowH / 2
    text(d, shortGroup(r.group), x + 2, mid + 2.5, { size: 7.5, bold: true, c: lead ? C.heavy : C.ink })
    if (lead) {
      const tw = d.getTextWidth(shortGroup(r.group))
      fill(d, C.heavy)
      d.roundedRect(x + 6 + tw, mid - 4.5, 22, 9, 4.5, 4.5, 'F')
      text(d, 'FOCO', x + 17 + tw, mid + 1.8, { size: 5.2, bold: true, c: '#ffffff', align: 'center' })
    }
    const bx = x + labelW
    if (r.prev != null && r.prev > 0) {
      fill(d, C.grid)
      d.roundedRect(bx, mid - 4, (r.prev / max) * barW, 8, 3, 3, 'F')
    }
    const vw = Math.max(3, (r.valid / max) * barW)
    fill(d, lead ? C.heavy : C.volume)
    d.roundedRect(bx, mid - 4, vw, 8, 3, 3, 'F')
    if (r.heavy) {
      fill(d, lead ? mix(C.heavy, '#000000', 0.25) : C.heavy)
      d.roundedRect(bx, mid - 4, Math.max(3, (r.heavy / max) * barW), 8, 3, 3, 'F')
    }
    text(d, `${r.valid} séries · ${Math.round((r.valid / total) * 100)}%`, x + w, mid + 2.5, { size: 6.8, bold: true, c: lead ? C.heavy : C.sub, align: 'right' })
    y += rowH + 2
  })
  return y + 2
}
