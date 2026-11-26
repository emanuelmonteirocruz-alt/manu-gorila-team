/**
 * ANAMNESE DA CONSULTORIA — modelo editável.
 *
 * Cole aqui (ou em Config. → "Modelo da anamnese", dentro do app) as suas perguntas reais.
 * Formato, uma linha por item:
 *
 *   # Nome da seção
 *   Texto da pergunta? [campo]
 *   Pergunta com opções? [campo] | Opção 1 | Opção 2 | Opção 3
 *
 * [campo] diz ao app o que a resposta significa (para o resumo de triagem e os lembretes).
 * Campos reconhecidos:
 *   objetivo · enfase · restricoes · lesoes · dores · medicacao · saude · preferencias · nao_gosta
 *   dias · tempo · local · equipamentos · experiencia · dieta · sono · ciclo · rotina · observacoes
 * Pergunta sem [campo] é guardada normalmente, só não entra no resumo automático.
 */
export const ANAMNESE_TEMPLATE = `# Objetivo
Qual é o seu principal objetivo com o treino? [objetivo] | Hipertrofia (ganhar massa) | Emagrecimento / definição | Força | Saúde e qualidade de vida | Condicionamento
Quais músculos você mais quer desenvolver ou destacar? [enfase]
Tem alguma meta ou prazo (evento, viagem, competição)? [objetivo]

# Saúde e restrições
Tem ou já teve alguma lesão? Qual e quando? [lesoes]
Sente dor em alguma articulação ou região ao treinar (ombro, joelho, lombar...)? [dores]
Tem alguma condição de saúde (pressão alta, diabetes, hérnia, cirurgia recente)? [saude]
Usa algum medicamento contínuo? [medicacao]
Algum exercício que o médico ou fisioterapeuta pediu para evitar? [restricoes]

# Experiência e rotina
Há quanto tempo treina musculação? [experiencia] | Nunca treinei | Menos de 6 meses | 6 meses a 2 anos | Mais de 2 anos
Quantos dias por semana pode treinar? [dias] | 2 | 3 | 4 | 5 | 6
Quanto tempo tem por treino? [tempo] | 40 min | 1 hora | 1h30 | Mais de 1h30
Onde vai treinar? [local] | Academia completa | Academia de condomínio | Em casa
Que equipamentos tem disponíveis (se não for academia completa)? [equipamentos]
Como é a sua rotina de trabalho e horários? [rotina]

# Preferências
Quais exercícios você gosta de fazer? [preferencias]
Algum exercício que você não gosta ou não se adapta? [nao_gosta]
Faz outra atividade física (corrida, luta, esporte)? [rotina]

# Contexto
Como está a sua alimentação hoje (dieta, acompanhamento com nutricionista)? [dieta]
Como é o seu sono (horas por noite, qualidade)? [sono]
Ciclo menstrual: regular, irregular, usa anticoncepcional? [ciclo]
Algo mais que eu precise saber? [observacoes]
`

export interface TemplateQuestion {
  id: string
  label: string
  field?: string
  options?: string[]
}
export interface TemplateSection {
  title: string
  questions: TemplateQuestion[]
}

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)

/** Lê o modelo em texto (formato acima) e devolve seções e perguntas. */
export function parseTemplate(text: string): TemplateSection[] {
  const out: TemplateSection[] = []
  let cur: TemplateSection | null = null
  const ids = new Set<string>()
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('#')) {
      cur = { title: line.replace(/^#+\s*/, ''), questions: [] }
      out.push(cur)
      continue
    }
    if (!cur) {
      cur = { title: 'Anamnese', questions: [] }
      out.push(cur)
    }
    const [q, ...opts] = line.split('|').map((x) => x.trim())
    const m = q.match(/\[([a-z_]+)\]\s*$/i)
    const label = q.replace(/\[[a-z_]+\]\s*$/i, '').trim()
    let id = slug(label) || `p${ids.size + 1}`
    while (ids.has(id)) id += '-2'
    ids.add(id)
    cur.questions.push({ id, label, field: m?.[1].toLowerCase(), options: opts.filter(Boolean).length ? opts.filter(Boolean) : undefined })
  }
  return out.filter((s) => s.questions.length)
}

/**
 * Anamnese respondida colada (WhatsApp, Google Forms, texto livre): procura cada pergunta do modelo
 * no texto e pega a resposta que vem depois dela (na mesma linha após ":" ou nas linhas seguintes).
 */
export function answersFromPasted(text: string, sections: TemplateSection[]): Record<string, string> {
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
  const lines = text.replace(/\r/g, '').split('\n')
  const qs = sections.flatMap((s) => s.questions)
  const keyOf = (q: TemplateQuestion) => norm(q.label).split(' ').filter((w) => w.length > 3).slice(0, 6)
  // linha que "é" a pergunta: contém a maior parte das palavras-chave dela
  const hits: { q: TemplateQuestion; line: number; after: string }[] = []
  lines.forEach((l, i) => {
    const n = norm(l)
    for (const q of qs) {
      const k = keyOf(q)
      if (!k.length) continue
      const score = k.filter((w) => n.includes(w)).length / k.length
      if (score >= 0.6 && !hits.some((h) => h.q.id === q.id)) {
        const idx = l.search(/[:?]\s*/)
        hits.push({ q, line: i, after: idx >= 0 ? l.slice(idx + 1).replace(/^[\s:?-]+/, '').trim() : '' })
        break
      }
    }
  })
  hits.sort((a, b) => a.line - b.line)
  const out: Record<string, string> = {}
  hits.forEach((h, k) => {
    const end = k + 1 < hits.length ? hits[k + 1].line : lines.length
    const rest = lines.slice(h.line + 1, end).map((x) => x.replace(/^\s*(r|resp|resposta)\s*[:.-]\s*/i, '').trim()).filter(Boolean)
    const ans = [h.after, ...rest].filter(Boolean).join('\n').trim()
    if (ans) out[h.q.id] = ans
  })
  return out
}
