/**
 * ANAMNESE DA CONSULTORIA — modelo editável.
 *
 * Cole aqui (ou em Config. → "Modelo da anamnese", dentro do app) as suas perguntas reais.
 * Formato, uma linha por item:
 *
 *   # Nome da seção
 *   1. Texto da pergunta? [campo]
 *   > linha de exemplo/explicação que vai na mensagem (o app ignora ao ler a resposta)
 *   2. Pergunta com opções? [campo] | Opção 1 | Opção 2 | Opção 3
 *
 * A numeração (1., 2., 3.…) é a que o aluno usa para responder ("1. Ganho de massa").
 *
 * [campo] diz ao app o que a resposta significa (para o resumo de triagem e os lembretes).
 * Campos reconhecidos:
 *   objetivo · enfase · idade · altura · peso · experiencia · dias · tempo · atividade · dores · lesoes
 *   saude · medicacao · dificuldades · local · equipamentos · nao_consegue · nao_gosta · preferencias
 *   restricoes · dieta · sono · ciclo · rotina · observacoes
 * Pergunta sem [campo] é guardada normalmente, só não entra no resumo automático.
 */
export const ANAMNESE_TEMPLATE = `# Objetivo
1. Qual é o seu principal objetivo? [objetivo]
> (Ex.: emagrecimento, ganho de massa muscular, definição, condicionamento físico, saúde, performance etc.)

# Perfil
2. Idade: [idade]
3. Altura: [altura]
4. Peso atual: [peso]

# Experiência e rotina
5. Há quanto tempo você treina? [experiencia]
> (Se já treinou antes e ficou um tempo parado, informe também.)
6. Quantos dias por semana você pretende treinar? [dias]
7. Quanto tempo você tem disponível para cada treino? [tempo]
8. Você pratica alguma outra atividade física além da musculação? [atividade]
> Se sim, qual e com que frequência?

# Saúde
9. Possui alguma dor ou limitação? [dores]
> (Ex.: joelho, ombro, coluna, quadril, tornozelo, cotovelo etc.)
10. Já sofreu alguma lesão ou passou por alguma cirurgia? [lesoes]
11. Possui alguma doença ou condição de saúde que eu deva saber? [saude]
> (Ex.: hipertensão, diabetes, hérnia, problemas cardíacos, entre outros.)
12. Faz uso de algum medicamento de forma contínua? [medicacao]

# Rotina e preferências
13. Quais são as suas maiores dificuldades hoje? [dificuldades]
> (Ex.: falta de tempo, alimentação, motivação, dores, dificuldade para ganhar massa, emagrecer etc.)
14. Em qual academia você treina? [local]
> Caso seja uma academia de bairro, se possível envie algumas fotos dos equipamentos.
15. Existe algum exercício que você não consegue fazer ou sente desconforto ao executar? [nao_consegue]
16. Tem preferência por algum tipo de treino ou algum exercício que goste mais? [preferencias]
17. Tem alguma observação ou informação que considere importante para o planejamento? [observacoes]
`

export interface TemplateQuestion {
  id: string
  label: string
  field?: string
  options?: string[]
  number: number // ordem da pergunta (1, 2, 3…): o aluno pode responder só pelo número
  hints: string[] // linhas de exemplo ("> (Ex.: …)") — ignoradas ao ler a resposta
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
  let number = 0
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
    if (line.startsWith('>')) {
      const last = cur.questions[cur.questions.length - 1]
      if (last) last.hints.push(line.replace(/^>\s*/, ''))
      continue
    }
    const [q, ...opts] = line.split('|').map((x) => x.trim())
    const m = q.match(/\[([a-z_]+)\]\s*$/i)
    const label = q.replace(/\[[a-z_]+\]\s*$/i, '').replace(/^\s*\d{1,2}\s*[.)\-–]\s*/, '').trim()
    let id = slug(label) || `p${ids.size + 1}`
    while (ids.has(id)) id += '-2'
    ids.add(id)
    number++
    cur.questions.push({ id, label, field: m?.[1].toLowerCase(), options: opts.filter(Boolean).length ? opts.filter(Boolean) : undefined, number, hints: [] })
  }
  return out.filter((s) => s.questions.length)
}

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
const keyWords = (label: string) => norm(label).split(' ').filter((w) => w.length > 3).slice(0, 6)
const looksLike = (text: string, label: string) => {
  const k = keyWords(label)
  if (!k.length) return norm(text).startsWith(norm(label))
  const n = norm(text)
  return k.filter((w) => n.includes(w)).length / k.length >= 0.6
}
// cabeçalho do WhatsApp: [03/08, 16:42] Nome: …  |  03/08/2026 16:42 - Nome: …  |  [16:42, 03/08] Nome: …
const WA_HEADER = /^\u200e?\[?(?:\d{1,2}\/\d{1,2}(?:\/\d{2,4})?,?\s+\d{1,2}:\d{2}(?::\d{2})?|\d{1,2}:\d{2}(?::\d{2})?,?\s+\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\]?\s*(?:-\s*)?([^:]{1,40}):\s?(.*)$/
const FILLER = /^(ola|oi|bom dia|boa tarde|boa noite|obrigad|para que eu consiga|responda as perguntas|assim que receber)/

/** Só o que o ALUNO escreveu: separa as mensagens do WhatsApp e descarta as do treinador. */
export function studentText(text: string, trainerName = ''): string {
  const lines = text.replace(/\r/g, '').split('\n')
  const msgs: { sender: string; lines: string[] }[] = []
  for (const l of lines) {
    const m = l.match(WA_HEADER)
    if (m) msgs.push({ sender: m[1].trim(), lines: [m[2]] })
    else if (msgs.length) msgs[msgs.length - 1].lines.push(l)
    else msgs.push({ sender: '', lines: [l] })
  }
  if (msgs.length <= 1) return msgs.flatMap((m) => m.lines).join('\n')
  const t = norm(trainerName)
  const fromStudent = msgs.filter((m) => m.sender && !(t && norm(m.sender).includes(t.split(' ')[0])))
  return (fromStudent.length ? fromStudent : msgs.slice(-1)).flatMap((m) => m.lines).join('\n')
}

/**
 * Anamnese respondida colada (WhatsApp, formulário, texto livre). Aceita:
 *  - resposta pelo número:            "1. Ganho de massa"   "2) 32"   "3 - 1,68"
 *  - o questionário copiado e respondido por cima:  "1. Qual é o seu principal objetivo? Ganho de massa"
 * Linhas de exemplo ("(Ex.: …)", "Se sim, qual…"), saudações e o "Obrigado!" são ignorados.
 */
export function answersFromPasted(text: string, sections: TemplateSection[], trainerName = ''): Record<string, string> {
  const qs = sections.flatMap((s) => s.questions)
  const byNumber = new Map(qs.map((q) => [q.number, q]))
  const lines = studentText(text, trainerName).split('\n')
  const NUM = /^\s*\*?(\d{1,2})\s*(?:[.)\-–:]|º|ª)\s*\*?\s*(.*)$/
  const isHint = (l: string, q?: TemplateQuestion) => {
    const n = norm(l)
    if (!n) return true
    if (/^\(?\s*ex\b/.test(n) || (l.trim().startsWith('(') && /\bex\b|exemplo/.test(n))) return true
    if (FILLER.test(n)) return true
    return !!q && q.hints.some((h) => { const hn = norm(h); return hn && (n === hn || hn.startsWith(n) || n.startsWith(hn.slice(0, 24))) })
  }
  // 1) pelo número
  const found = new Map<number, { q: TemplateQuestion; parts: string[] }>()
  let cur: { q: TemplateQuestion; parts: string[] } | null = null
  for (const l of lines) {
    const m = l.match(NUM)
    const q = m ? byNumber.get(Number(m[1])) : undefined
    if (m && q) {
      let rest = m[2].trim()
      // copiou a pergunta e respondeu por cima: tira o texto da pergunta
      if (looksLike(rest, q.label)) {
        const lab = norm(q.label)
        const cut = rest.search(/[?:]/)
        if (cut >= 0 && norm(rest.slice(0, cut)).length <= lab.length + 12) rest = rest.slice(cut + 1).trim()
        else if (norm(rest) === lab) rest = ''
      }
      cur = { q, parts: rest ? [rest] : [] }
      // número repetido (pergunta e depois a resposta): fica a versão com resposta
      const prev = found.get(q.number)
      if (!prev || cur.parts.length || !prev.parts.length) found.set(q.number, cur)
      continue
    }
    if (cur && !isHint(l, cur.q)) cur.parts.push(l.trim())
  }
  const out: Record<string, string> = {}
  for (const { q, parts } of found.values()) {
    const ans = parts.join('\n').trim()
    if (ans) out[q.id] = ans
  }
  if (found.size >= 3) return out
  return answersByLabel(lines, qs)
}

/** Sem numeração: procura o texto de cada pergunta e pega o que vem depois. */
function answersByLabel(lines: string[], qs: TemplateQuestion[]): Record<string, string> {
  const hits: { q: TemplateQuestion; line: number; after: string }[] = []
  lines.forEach((l, i) => {
    for (const q of qs) {
      if (looksLike(l, q.label) && !hits.some((h) => h.q.id === q.id)) {
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
    const rest = lines.slice(h.line + 1, end).map((x) => x.replace(/^\s*(r|resp|resposta)\s*[:.-]\s*/i, '').trim()).filter((x) => x && !/^\(?\s*ex/i.test(norm(x)))
    const ans = [h.after, ...rest].filter(Boolean).join('\n').trim()
    if (ans) out[h.q.id] = ans
  })
  return out
}
