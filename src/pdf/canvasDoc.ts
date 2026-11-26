/**
 * Prévia na tela: implementa o subconjunto da API do jsPDF usado pelos gráficos
 * desenhando num <canvas>. Os templates rodam igual nos dois alvos, então a prévia
 * mostra exatamente o que vai no PDF (que continua 100% vetorial no download).
 * Necessário porque PDF dentro de iframe fica em branco no visualizador e no Chrome Android.
 */
type RGB = [number, number, number]
const GAP = 14 // espaço entre páginas na prévia
/** Páginas usadas pelo último documento desenhado (para a prévia dimensionar o canvas). */
export let lastPageCount = 1
type Style = 'F' | 'S' | 'FD' | 'DF' | undefined

export class CanvasDoc {
  private ctx: CanvasRenderingContext2D
  private fillC = 'rgb(0,0,0)'
  private drawC = 'rgb(0,0,0)'
  private textC = 'rgb(0,0,0)'
  private size = 16
  private bold = false

  private oy = 0 // deslocamento vertical da página atual
  private h: number
  private scale: number
  constructor(canvas: HTMLCanvasElement, w: number, h: number, scale = 2, pages = 1) {
    this.h = h
    this.scale = scale
    const total = h * pages + GAP * (pages - 1)
    canvas.width = w * scale
    canvas.height = total * scale
    canvas.style.aspectRatio = `${w} / ${total}`
    this.ctx = canvas.getContext('2d')!
    this.ctx.setTransform(scale, 0, 0, scale, 0, 0)
    this.ctx.fillStyle = '#E2E8F0'
    this.ctx.fillRect(0, 0, w, total)
    for (let i = 0; i < pages; i++) { this.ctx.fillStyle = '#ffffff'; this.ctx.fillRect(0, i * (h + GAP), w, h) }
    lastPageCount = 1
  }
  /** Nova página: na prévia, desenha logo abaixo da anterior. */
  addPage() {
    this.oy += this.h + GAP
    lastPageCount++
    this.ctx.setTransform(this.scale, 0, 0, this.scale, 0, this.oy * this.scale)
    return this
  }

  private rgb = (c: RGB) => `rgb(${c[0]},${c[1]},${c[2]})`
  setFillColor(...c: RGB) { this.fillC = this.rgb(c) }
  setDrawColor(...c: RGB) { this.drawC = this.rgb(c) }
  setTextColor(...c: RGB) { this.textC = this.rgb(c) }
  setLineWidth(w: number) { this.ctx.lineWidth = w }
  setLineCap(c: CanvasLineCap) { this.ctx.lineCap = c }
  setLineDashPattern(p: number[], phase: number) { this.ctx.setLineDash(p); this.ctx.lineDashOffset = phase }
  setFont(_family: string, style: string) { this.bold = style === 'bold' }
  setFontSize(n: number) { this.size = n }
  getFontSize() { return this.size }
  private font() { this.ctx.font = `${this.bold ? 'bold ' : ''}${this.size}px Helvetica, Arial, sans-serif` }
  getTextWidth(s: string) { this.font(); return this.ctx.measureText(s).width }

  private paint(style: Style) {
    const fill = style === 'F' || style === 'FD' || style === 'DF'
    const draw = style === 'S' || style === 'FD' || style === 'DF' || style === undefined
    if (fill) { this.ctx.fillStyle = this.fillC; this.ctx.fill() }
    if (draw) { this.ctx.strokeStyle = this.drawC; this.ctx.stroke() }
  }

  rect(x: number, y: number, w: number, h: number, style?: Style) {
    this.ctx.beginPath(); this.ctx.rect(x, y, w, h); this.paint(style)
  }
  roundedRect(x: number, y: number, w: number, h: number, rx: number, _ry: number, style?: Style) {
    this.ctx.beginPath(); this.ctx.roundRect(x, y, w, h, Math.min(rx, w / 2, h / 2)); this.paint(style)
  }
  circle(x: number, y: number, r: number, style?: Style) {
    this.ctx.beginPath(); this.ctx.arc(x, y, r, 0, Math.PI * 2); this.paint(style)
  }
  triangle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, style?: Style) {
    this.ctx.beginPath(); this.ctx.moveTo(x1, y1); this.ctx.lineTo(x2, y2); this.ctx.lineTo(x3, y3); this.ctx.closePath(); this.paint(style)
  }
  line(x1: number, y1: number, x2: number, y2: number) {
    this.ctx.beginPath(); this.ctx.moveTo(x1, y1); this.ctx.lineTo(x2, y2); this.ctx.strokeStyle = this.drawC; this.ctx.stroke()
  }
  text(s: string, x: number, y: number, o: { align?: CanvasTextAlign } = {}) {
    this.font()
    this.ctx.fillStyle = this.textC
    this.ctx.textAlign = o.align ?? 'left'
    this.ctx.textBaseline = 'alphabetic'
    this.ctx.fillText(s, x, y)
  }
  addImage(src: string, _fmt: string, x: number, y: number, w: number, h: number) {
    const img = new Image()
    const oy = this.oy
    img.onload = () => {
      this.ctx.save()
      this.ctx.setTransform(this.scale, 0, 0, this.scale, 0, oy * this.scale)
      this.ctx.drawImage(img, x, y, w, h)
      this.ctx.restore()
    }
    img.src = src
  }
  output(): Blob { throw new Error('Prévia em canvas não gera arquivo') }
}
