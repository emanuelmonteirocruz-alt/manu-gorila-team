/**
 * LEMBRETES DE PROCESSOS E EXERCÍCIOS — regras editáveis.
 * Guia de consulta rápida antes de fechar o treino (não substitui avaliação médica/fisioterapêutica).
 * `evitarRe` marca, no rascunho gerado, os exercícios que pedem atenção para aquela restrição.
 */
import type { Triage } from './triage'

export interface ReminderRule {
  titulo: string
  processos: string[]
  preferir: string[]
  atencao: string[]
  evitarRe?: RegExp // nomes de exercício que pedem revisão nessa restrição
  evitarTexto?: string
}

export const RESTRICTION_RULES: Record<string, ReminderRule> = {
  ombro: {
    titulo: 'Ombro',
    processos: ['Aquecer manguito rotador (rotação externa/interna com elástico) antes de empurrar', 'Mobilidade torácica e escapular no aquecimento'],
    preferir: ['Supino com halteres pegada neutra', 'Elevação lateral no cabo (carga moderada)', 'Face pull / crucifixo inverso', 'Máquinas com trajetória guiada'],
    atencao: ['Amplitude controlada nos empurrares, sem dor', 'Evitar carga alta acima da cabeça nas primeiras semanas'],
    evitarRe: /atras da nuca|nuca|paralela|mergulho|supino reto barra|desenvolvimento barra|militar|remada alta/,
    evitarTexto: 'empurrar acima da cabeça, atrás da nuca, paralelas e remada alta',
  },
  joelho: {
    titulo: 'Joelho',
    processos: ['Ativar glúteo médio e quadríceps (isometria, mini band) no aquecimento', 'Progressão de amplitude no agachamento/leg conforme tolerância'],
    preferir: ['Leg press com amplitude controlada', 'Cadeira flexora', 'Elevação pélvica / abdutora', 'Extensora em amplitude parcial (se condromalácia)'],
    atencao: ['Controlar valgo dinâmico (joelho para dentro)', 'Sem dor durante ou no dia seguinte'],
    evitarRe: /salto|jump|pistol|sissy|afundo|passada|bulgaro|agachamento livre profundo/,
    evitarTexto: 'saltos, sissy, pistol e afundos com dor',
  },
  lombar: {
    titulo: 'Lombar / coluna',
    processos: ['Ativação de core (dead bug, prancha) antes dos multiarticulares', 'Mobilidade de quadril e torácica'],
    preferir: ['Leg press / hack (coluna apoiada)', 'Remada apoiada no banco / máquina', 'Elevação pélvica', 'Cadeira flexora em vez de stiff pesado'],
    atencao: ['Coluna neutra e carga progressiva nos movimentos de quadril', 'Evitar flexão de tronco com carga'],
    evitarRe: /stiff|terra|good morning|remada curvada|agachamento livre|bom dia|hiperextens/,
    evitarTexto: 'stiff/terra pesados, good morning, remada curvada sem apoio e agachamento livre pesado',
  },
  cervical: {
    titulo: 'Cervical',
    processos: ['Mobilidade cervical leve e escapular'],
    preferir: ['Exercícios com apoio de tronco', 'Encolhimento leve ou retirar'],
    atencao: ['Não tensionar o pescoço nos puxares e abdominais'],
    evitarRe: /encolhimento|atras da nuca|abdominal supra/,
    evitarTexto: 'encolhimento pesado e puxada atrás da nuca',
  },
  quadril: {
    titulo: 'Quadril',
    processos: ['Mobilidade de quadril e ativação de glúteo médio'],
    preferir: ['Abdutora', 'Elevação pélvica', 'Leg press amplitude confortável'],
    atencao: ['Respeitar amplitude no agachamento profundo e no sumô'],
    evitarRe: /sumo|agachamento profundo|afundo lateral|avanco lateral/,
    evitarTexto: 'sumô e amplitudes extremas com dor',
  },
  punho: {
    titulo: 'Punho',
    processos: ['Aquecer punho e antebraço'],
    preferir: ['Pegada neutra', 'Cabos e máquinas', 'Straps nos puxares'],
    atencao: ['Evitar extensão de punho com carga'],
    evitarRe: /flexao de braco|supino reto barra|rosca de punho|rosca direta barra/,
    evitarTexto: 'flexão de braço e barra reta com dor',
  },
  cotovelo: {
    titulo: 'Cotovelo',
    processos: ['Aquecer flexores e extensores do cotovelo com carga leve'],
    preferir: ['Pegada neutra (martelo)', 'Tríceps na polia com corda'],
    atencao: ['Reduzir carga em tríceps testa/francês'],
    evitarRe: /testa|frances|skull/,
    evitarTexto: 'tríceps testa/francês pesados',
  },
  tornozelo: {
    titulo: 'Tornozelo / pé',
    processos: ['Mobilidade de tornozelo no aquecimento'],
    preferir: ['Exercícios em máquina', 'Panturrilha sentado'],
    atencao: ['Cuidado com instabilidade e impacto'],
    evitarRe: /salto|jump|burpee|corrida/,
    evitarTexto: 'saltos e impacto',
  },
}

export const CONDITION_RULES: Record<string, string> = {
  hipertensao: 'Pressão alta: evitar segurar o ar (Valsalva) e isometrias longas; descanso um pouco maior.',
  diabetes: 'Diabetes: atenção à alimentação antes do treino e a sinais de hipoglicemia.',
  gestante: 'Gestante: só com liberação médica; evitar deitar de barriga para cima por muito tempo e alto impacto.',
  labirintite: 'Labirintite: evitar mudanças bruscas de posição (deitar/levantar rápido).',
  cirurgia: 'Cirurgia recente: confirmar liberação e tempo de recuperação.',
  asma: 'Asma: aquecimento progressivo; cuidado com alta densidade.',
}

export const GOAL_RULES: Record<NonNullable<Triage['objetivoTipo']>, string[]> = {
  hipertrofia: ['Volume semanal de 10 a 20 séries por músculo da ênfase', 'Faixa principal de 6 a 12 repetições com progressão de carga'],
  emagrecimento: ['Densidade: bi-set/super série para mais trabalho em menos tempo', 'Manter carga para preservar massa magra'],
  forca: ['Multiarticulares no início do treino em 4 a 6 repetições', 'Descanso maior entre séries pesadas'],
  saude: ['Priorizar técnica e regularidade', 'Volume moderado e progressão gradual'],
  condicionamento: ['Circuitos e descanso curto', 'Combinar com o cardio da rotina'],
}

export const EXPERIENCE_RULES: Record<NonNullable<Triage['experiencia']>, string[]> = {
  iniciante: ['Adaptação neuromuscular de 2 a 4 semanas (12 a 15 reps, técnica)', 'Sem técnicas avançadas no início'],
  intermediario: ['Periodizar ordinária → choque → regenerativa', 'Técnicas avançadas pontuais'],
  avancado: ['Mais variação de estímulo e técnicas avançadas', 'Microciclos de choque bem definidos e recuperação planejada'],
}

export interface Reminders {
  processos: string[]
  preferir: string[]
  atencao: string[]
  evitar: string[]
}

/** Lembretes do caso do aluno, a partir do resumo da triagem e da ênfase. */
export function remindersFor(t: Triage, enfases: string[]): Reminders {
  const r: Reminders = { processos: [], preferir: [], atencao: [], evitar: [] }
  for (const x of t.restricoes) {
    const rule = RESTRICTION_RULES[x.area]
    if (!rule) continue
    r.processos.push(...rule.processos)
    r.preferir.push(...rule.preferir.map((p) => `${p} (${rule.titulo.toLowerCase()})`))
    r.atencao.push(...rule.atencao)
    if (rule.evitarTexto) r.evitar.push(`${rule.titulo}: ${rule.evitarTexto}`)
  }
  for (const c of t.condicoes) if (CONDITION_RULES[c]) r.atencao.push(CONDITION_RULES[c])
  if (t.experiencia) r.processos.push(...EXPERIENCE_RULES[t.experiencia])
  if (t.objetivoTipo) r.processos.push(...GOAL_RULES[t.objetivoTipo])
  if (enfases.length) r.processos.push(`Ênfase em ${enfases.map((g) => g.replace('Perna - ', '')).join(' + ')}: começar o treino por ela e treinar 2x por semana`)
  if (t.naoGosta.length) r.atencao.push(`Não gosta: ${t.naoGosta.join(' · ')}`)
  if (t.preferencias.length) r.preferir.push(`Gosta: ${t.preferencias.join(' · ')}`)
  const uniq = (a: string[]) => [...new Set(a)]
  return { processos: uniq(r.processos), preferir: uniq(r.preferir), atencao: uniq(r.atencao), evitar: uniq(r.evitar) }
}
