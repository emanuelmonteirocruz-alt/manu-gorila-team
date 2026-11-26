/**
 * Resumo de triagem da anamnese: transforma as respostas em pontos-chave
 * (objetivo, ênfases, restrições, preferências, rotina, contexto).
 * Regras simples por palavras-chave — vamos calibrando com as anamneses reais.
 */
import type { TemplateSection } from './anamneseTemplate'
import { SEED_PROFILES, normalizeKey } from '../engine/exerciseSeed'

export interface Restriction {
  area: string // chave da regra de lembretes (ombro, joelho, lombar…)
  label: string
  source: string // trecho da resposta que gerou a restrição
}

export interface Triage {
  objetivo: string | null
  objetivoTipo: 'hipertrofia' | 'emagrecimento' | 'forca' | 'saude' | 'condicionamento' | null
  postura: boolean // "melhorar a postura" no objetivo
  perfil: { idade: string | null; altura: string | null; peso: string | null }
  diasTexto: string | null // como o aluno escreveu ("de 3 a 4")
  atividade: string | null // outra atividade física
  dificuldades: string[]
  evitarExercicios: string[] // exercícios que o aluno não pode/não consegue fazer
  medicamentos: string[]
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
  [/endometriose/, 'endometriose'],
  [/hernia/, 'hernia'],
  [/cardiac|coracao|arritmia/, 'cardiaco'],
]

const firstNumber = (s: string) => {
  const m = s.match(/(\d+)/)
  return m ? Number(m[1]) : null
}

export function buildTriage(sections: TemplateSection[], answers: Record<string, string>): Triage {
  const t: Triage = {
    objetivo: null, objetivoTipo: null, postura: false, perfil: { idade: null, altura: null, peso: null }, diasTexto: null, atividade: null,
    dificuldades: [], evitarExercicios: [], medicamentos: [],
    enfases: [], restricoes: [], condicoes: [], preferencias: [], naoGosta: [],
    dias: null, tempoMin: null, local: null, experiencia: null, dieta: null, sono: null, ciclo: null, observacoes: [],
  }
  const byField = (f: string) => sections.flatMap((s) => s.questions).filter((q) => q.field === f).map((q) => (answers[q.id] ?? '').trim()).filter((a) => a && !NONE.test(n(a)))

  const obj = byField('objetivo')
  if (obj.length) {
    t.objetivo = obj.join(' · ')
    const o = n(t.objetivo)
    t.postura = /postura/.test(o)
    t.objetivoTipo = /hipertrof|massa|crescer|ganhar|volume/.test(o) ? 'hipertrofia' : /emagrec|perder|gordura|secar|defini/.test(o) ? 'emagrecimento' : /forca|powerlift|levantamento/.test(o) ? 'forca' : /condicion|resistencia|corrida|cardio/.test(o) ? 'condicionamento' : /saude|qualidade|dor|postura/.test(o) ? 'saude' : null
  }
  // ênfase: pergunta própria ou músculos citados no objetivo ("ganhar bumbum")
  for (const a of [...byField('enfase'), ...byField('objetivo')]) {
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
    t.medicamentos.push(a)
  }
  t.preferencias = byField('preferencias')
  t.naoGosta = byField('nao_gosta')
  // exercícios que o aluno não pode/não consegue fazer (citados nas dores, restrições e "não consegue")
  for (const a of [...byField('nao_consegue'), ...byField('dores'), ...byField('restricoes'), ...byField('nao_gosta')]) {
    for (const name of exercisesIn(a)) if (!t.evitarExercicios.includes(name)) t.evitarExercicios.push(name)
  }
  t.perfil = { idade: byField('idade')[0] ?? null, altura: byField('altura')[0] ?? null, peso: byField('peso')[0] ?? null }
  t.atividade = byField('atividade')[0] ?? null
  t.dificuldades = byField('dificuldades')
  const dias = byField('dias')[0]
  if (dias) { t.dias = firstNumber(dias); t.diasTexto = dias }
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
    // tempo de treino em meses: até 6 = iniciante · até 24 = intermediário · mais = avançado
    const ym = x.match(/(\d+(?:[.,]\d+)?)\s*(ano|mes)/)
    const months = ym ? Number(ym[1].replace(',', '.')) * (ym[2] === 'ano' ? 12 : 1) : null
    t.experiencia = /nunca|iniciante|comecando/.test(x) ? 'iniciante'
      : months != null ? (months <= 6 ? 'iniciante' : months <= 24 ? 'intermediario' : 'avancado')
      : /avancad|muitos anos/.test(x) ? 'avancado' : 'intermediario'
    if (/sem (muita )?disciplina|parad|irregular|voltando/.test(x)) t.observacoes.push(`Experiência: ${exp}`)
  }
  t.dieta = byField('dieta').join(' · ') || null
  t.sono = byField('sono').join(' · ') || null
  t.ciclo = byField('ciclo').join(' · ') || null
  t.observacoes.push(...byField('rotina').map((r) => `Rotina: ${r}`), ...byField('observacoes'))
  return t
}

/** Nomes de exercício citados num texto (pelo banco de exercícios do app). */
export function exercisesIn(text: string): string[] {
  const x = ' ' + normalizeKey(text) + ' '
  const out: string[] = []
  for (const p of SEED_PROFILES) {
    for (const k of [p.key, ...p.aliases]) {
      if (k.length >= 5 && x.includes(' ' + k + ' ')) { if (!out.includes(p.name)) out.push(p.name); break }
    }
  }
  // fica o nome mais específico ("Elevação pélvica" e não "Elevação" genérico)
  return out.filter((a) => !out.some((b) => b !== a && normalizeKey(b).includes(normalizeKey(a))))
}
