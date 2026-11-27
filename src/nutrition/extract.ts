/**
 * Leitura da avaliação do nutricionista (foto ou PDF), tudo no aparelho e sem custo:
 *  - PDF com texto: pdf.js extrai o texto direto;
 *  - foto (ou PDF escaneado): reconhecimento de texto (OCR, Tesseract, português).
 * Só dados corporais que o nutricionista realmente informa: peso, altura, idade, % de gordura e massa magra.
 * (Nada de fase/déficit ou calorias: não costuma vir na avaliação.) O treinador SEMPRE confere antes de salvar.
 */
export interface NutritionData {
  weight_kg: number | null
  height_m: number | null
  age: number | null
  body_fat: number | null
  lean_mass_kg: number | null
}

const n = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const num = (s: string) => Number(s.replace(',', '.'))

export function parseNutritionText(text: string): NutritionData {
  const t = n(text).replace(/\s+/g, ' ')
  const pick = (re: RegExp, ok: (v: number) => boolean) => {
    for (const m of t.matchAll(re)) { const v = num(m[1]); if (ok(v)) return v }
    return null
  }
  const weight_kg = pick(/(?:peso(?: atual| corporal)?|massa corporal(?: total)?)\D{0,12}(\d{2,3}(?:[.,]\d{1,2})?)\s*(?:kg)?/g, (v) => v >= 30 && v <= 250)
  let height_m = pick(/(?:altura|estatura)\D{0,10}(\d{3}|\d[.,]\d{1,2})\s*(?:m|cm)?/g, (v) => (v >= 1.2 && v <= 2.3) || (v >= 120 && v <= 230))
  if (height_m && height_m > 3) height_m = Math.round(height_m) / 100
  const age = pick(/(?:idade)\D{0,6}(\d{1,2})\s*(?:anos)?/g, (v) => v >= 10 && v <= 99) ?? pick(/(\d{1,2})\s*anos/g, (v) => v >= 10 && v <= 99)
  const body_fat = pick(/(?:% ?(?:de )?gordura|gordura corporal|percentual de gordura|massa gorda ?%|bf)\D{0,12}(\d{1,2}(?:[.,]\d{1,2})?)\s*%?/g, (v) => v >= 3 && v <= 60)
  const lean_mass_kg = pick(/(?:massa magra|massa livre de gordura|mlg)\D{0,12}(\d{2,3}(?:[.,]\d{1,2})?)\s*(?:kg)?/g, (v) => v >= 20 && v <= 150)
  return { weight_kg, height_m, age, body_fat, lean_mass_kg }
}

/** Texto do arquivo (PDF ou imagem). */
export async function fileText(file: Blob, onProgress?: (msg: string) => void): Promise<string> {
  if (file.type === 'application/pdf') {
    onProgress?.('Lendo o PDF…')
    const pdfjs = await import('pdfjs-dist')
    const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
    pdfjs.GlobalWorkerOptions.workerSrc = worker
    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
    let out = ''
    for (let i = 1; i <= Math.min(doc.numPages, 10); i++) {
      const page = await doc.getPage(i)
      const c = await page.getTextContent()
      out += c.items.map((it) => ('str' in it ? it.str : '')).join(' ') + '\n'
    }
    if (out.trim().length > 40) return out
    // PDF escaneado (só imagem): passa a 1ª página pelo OCR
    onProgress?.('PDF sem texto: lendo a imagem…')
    const page = await doc.getPage(1)
    const vp = page.getViewport({ scale: 2 })
    const canvas = document.createElement('canvas')
    canvas.width = vp.width; canvas.height = vp.height
    await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise
    const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), 'image/png'))
    return ocr(blob, onProgress)
  }
  return ocr(file, onProgress)
}

async function ocr(img: Blob, onProgress?: (msg: string) => void): Promise<string> {
  onProgress?.('Lendo a foto (pode levar alguns segundos)…')
  const { createWorker } = await import('tesseract.js')
  const w = await createWorker('por', 1, { logger: (m: { status: string; progress: number }) => { if (m.status === 'recognizing text') onProgress?.(`Lendo a foto… ${Math.round(m.progress * 100)}%`) } })
  try {
    const { data } = await w.recognize(img)
    return data.text
  } finally {
    await w.terminate()
  }
}
