/**
 * Resumo de triagem da anamnese: transforma as respostas em pontos-chave
 * (objetivo, ênfases, restrições, preferências, rotina, contexto).
 * Regras simples por palavras-chave — vamos calibrando com as anamneses reais.
 */
import type { TemplateSection } from './anamneseTemplate'

export interface Restriction {
  area: string // chave da regra de lembretes (ombro, joelho, lombar…)
  label: string
  source: string // trecho da resposta que gerou a restrição
}

export interface Triage {
  objetivo: string | null
  objetivoTipo: 'hipertrofia' | 'emagrecimento' | 'forca' | 'saude' | 'condicionamento' | null
  enfases: string[] // grupos do app (Glúteo, Perna - Quadríceps…)
  restricoes: Restriction[]
  condicoes: string[] // hipertensao, diabetes, gestante…
  preferencias: string[]
  naoGosta: string[]
  dias: number | null
  tempoMin: number | null
  local: string | null
  experiencia: 'iniciante' | 'intermediario' | 'avancado' | null
  dieta: string | null
  sono: string | null
  ciclo: string | null
  observacoes: string[]
}

const n = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const NONE = /^\s*(nao|não|nenhum[a]?|nada|sem|n|nunca tive|nao tenho)\b[.!\s]*$/i

const MUSCLES: [RegExp, string][] = [
  [/glute|bumbum|bunda/, 'Glúteo'],
  [/quadricep|coxa da frente|frente da coxa/, 'Perna - Quadríceps'],
  [/posterior|isquio|parte de tras da coxa/, 'Perna - Posterior'],
  [/adutor|parte interna/, 'Adutores'],
  [/panturrilha|batata da perna/, 'Panturrilha'],
  [/costas|dorsal|largura/, 'Costas'],
  [/peito|peitoral/, 'Peito'],
  [/ombro|deltoide/, 'Ombro'],
  [/bicep/, 'Bíceps'],
  [/tricep|tchauzinho/, 'Tríceps'],
  [/abdom|barriga|abdomen|cintura/, 'Abdômen'],
]
// "perna" e "braço" genéricos
const GENERIC: [RegExp, string[]][] = [
  [/\bpernas?\b|inferiores/, ['Perna - Quadríceps', 'Glúteo']],
  [/\bbracos?\b/, ['Bíceps', 'Tríceps']],
]

/** Regiões de dor/lesão → chave das regras de lembretes. */
export const AREAS: [RegExp, string, string][] = [
  [/ombro|manguito|supra ?espinhal|protus[aã]o de ombro|bursite/, 'ombro', 'Ombro'],
  [/joelho|menisco|patela|condromal|ligamento cruzado|lca/, 'joelho', 'Joelho'],
  [/lombar|hernia|protus[aã]o discal|lombalgia|ciatic|coluna|escoliose|bico de papagaio/, 'lombar', 'Lombar / coluna'],
  [/cervical|pescoco/, 'cervical', 'Cervical'],
  [/quadril|bursite trocanter|impacto femoro/, 'quadril', 'Quadril'],
  [/punho|tunel do carpo|mao/, 'punho', 'Punho'],
  [/cotovelo|epicondil|tendinite/, 'cotovelo', 'Cotovelo'],
  [/tornozelo|entorse|fascite|pe\b/, 'tornozelo', 'Tornozelo / pé'],
]
const CONDITIONS: [RegExp, string][] = [
  [/pressao alta|hipertens/, 'hipertensao'],
  [/diabet/, 'diabetes'],
  [/gravid|gestante|gestacao/, 'gestante'],
  [/labirint|tontura/, 'labirintite'],
  [/cirurgia/, 'cirurgia'],
  [/asma|bronqu/, 'asma'],
]

const firstNumber = (s: string) => {
  const m = s.match(/(\d+)/)
  return m ? Number(m[1]) : null
}

export function buildTriage(sections: TemplateSection[], answers: Record<string, string>): Triage {
  const t: Triage = {
    objetivo: null, objetivoTipo: null, enfases: [], restricoes: [], condicoes: [], preferencias: [], naoGosta: [],
    dias: null, tempoMin: null, local: null, experiencia: null, dieta: null, sono: null, ciclo: null, observacoes: [],
  }
  const byField = (f: string) => sections.flatMap((s) => s.questions).filter((q) => q.field === f).map((q) => (answers[q.id] ?? '').trim()).filter((a) => a && !NONE.test(n(a)))

  const obj = byField('objetivo')
  if (obj.length) {
    t.objetivo = obj.join(' · ')
    const o = n(t.objetivo)
    t.objetivoTipo = /hipertrof|massa|crescer|ganhar|volume/.test(o) ? 'hipertrofia' : /emagrec|perder|gordura|secar|defini/.test(o) ? 'emagrecimento' : /forca|powerlift|levantamento/.test(o) ? 'forca' : /condicion|resistencia|corrida|cardio/.test(o) ? 'condicionamento' : /saude|qualidade|dor|postura/.test(o) ? 'saude' : null
  }
  for (const a of byField('enfase')) {
    const x = n(a)
    for (const [re, g] of MUSCLES) if (re.test(x) && !t.enfases.includes(g)) t.enfases.push(g)
    for (const [re, gs] of GENERIC) if (re.test(x)) for (const g of gs) if (!t.enfases.includes(g)) t.enfases.push(g)
  }
  for (const a of [...byField('lesoes'), ...byField('dores'), ...byField('restricoes'), ...byField('saude')]) {
    const x = n(a)
    for (const [re, key, label] of AREAS) if (re.test(x) && !t.restricoes.some((r) => r.area === key)) t.restricoes.push({ area: key, label, source: a })
    for (const [re, key] of CONDITIONS) if (re.test(x) && !t.condicoes.includes(key)) t.condicoes.push(key)
  }
  for (const a of byField('medicacao')) {
    const x = n(a)
    for (const [re, key] of CONDITIONS) if (re.test(x) && !t.condicoes.includes(key)) t.condicoes.push(key)
    t.observacoes.push(`Medicação: ${a}`)
  }
  t.preferencias = byField('preferencias')
  t.naoGosta = byField('nao_gosta')
  const dias = byField('dias')[0]
  if (dias) t.dias = firstNumber(dias)
  const tempo = byField('tempo')[0]
  if (tempo) {
    const x = n(tempo)
    const h = x.match(/(\d+)\s*h(?:ora)?s?\s*(\d+)?/)
    t.tempoMin = h ? Number(h[1]) * 60 + Number(h[2] ?? 0) : /hora/.test(x) ? 60 : firstNumber(x)
  }
  t.local = byField('local')[0] ?? null
  const eq = byField('equipamentos')[0]
  if (eq) t.local = [t.local, `equipamentos: ${eq}`].filter(Boolean).join(' · ')
  const exp = byField('experiencia')[0]
  if (exp) {
    const x = n(exp)
    t.experiencia = /nunca|iniciante|comecando|menos de 6|1 mes|2 mes|3 mes/.test(x) ? 'iniciante' : /mais de 2|anos|avancad|3 anos|4 anos|5 anos/.test(x) ? 'avancado' : 'intermediario'
  }
  t.dieta = byField('dieta').join(' · ') || null
  t.sono = byField('sono').join(' · ') || null
  t.ciclo = byField('ciclo').join(' · ') || null
  t.observacoes.push(...byField('rotina').map((r) => `Rotina: ${r}`), ...byField('observacoes'))
  return t
}
