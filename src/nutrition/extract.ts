/**
 * Leitura da avaliação do nutricionista (foto ou PDF), tudo no aparelho e sem custo:
 *  - PDF com texto: pdf.js extrai o texto direto;
 *  - foto (ou PDF escaneado): reconhecimento de texto (OCR, Tesseract, português).
 * Depois, regras simples encontram peso, calorias/dia, fase (déficit, manutenção, superávit),
 * proteína e % de gordura. O treinador SEMPRE confere antes de salvar.
 */
export interface NutritionData {
  weight_kg: number | null
  kcal: number | null
  phase: 'deficit' | 'manutencao' | 'superavit' | null
  protein_g: number | null
  body_fat: number | null
}

const n = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const num = (s: string) => Number(s.replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'))

export function parseNutritionText(text: string): NutritionData {
  const t = n(text).replace(/\s+/g, ' ')
  const pick = (re: RegExp, ok: (v: number) => boolean) => {
    for (const m of t.matchAll(re)) { const v = num(m[1]); if (ok(v)) return v }
    return null
  }
  const weight_kg = pick(/(?:peso(?: atual| corporal)?|massa corporal)\D{0,12}(\d{2,3}(?:[.,]\d{1,2})?)\s*kg?/g, (v) => v >= 30 && v <= 250)
  const kcal = pick(/(\d{1,2}[.,]?\d{3})\s*(?:kcal|calorias)/g, (v) => v >= 900 && v <= 6000)
    ?? pick(/(?:valor energetico|vet|calorias(?: totais| diarias)?|meta calorica|get)\D{0,15}(\d{1,2}[.,]?\d{3})/g, (v) => v >= 900 && v <= 6000)
  const protein_g = pick(/proteinas?\D{0,15}(\d{2,3}(?:[.,]\d)?)\s*g/g, (v) => v >= 30 && v <= 400)
  const body_fat = pick(/(?:% ?(?:de )?gordura|gordura corporal|percentual de gordura|bf)\D{0,12}(\d{1,2}(?:[.,]\d{1,2})?)\s*%?/g, (v) => v >= 3 && v <= 60)
  const phase = /deficit|cutting|emagrec|perda de (?:peso|gordura)|restricao calorica|hipocalor/.test(t) ? 'deficit'
    : /superavit|bulking|hipercalor|ganho de massa|ganho de peso/.test(t) ? 'superavit'
    : /manutencao|normocalor|manter o peso/.test(t) ? 'manutencao' : null
  return { weight_kg, kcal, phase, protein_g, body_fat }
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
