import { useLiveQuery } from 'dexie-react-hooks'
import { waLink, waProblem } from '../../domain/whatsapp'
import { Check, MessageCircle, UserX } from 'lucide-react'
import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { db, nowISO, save } from '../../data/db'
import { PERIOD_WEEKS } from '../../domain/plan'
import type { Student } from '../../domain/types'
import { addDays, fmtBR, toISODate, weekStart } from '../../engine/metrics'
import { titleCase } from '../format'

const first = (s: Student) => titleCase(s.full_name).split(' ')[0]
const daysBetween = (a: string, b: string) => Math.round((new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime()) / 86400000)

/**
 * Marcações de check-in feitas antes do formato atual ("aluno:data da troca" ou "aluno:semana", todas da
 * semana de 23/11/2026) viram "enviado na semana de 23/11" — assim ninguém que já recebeu volta para a lista.
 */
export function migrateFeedbackKeys(list: string[]): string[] {
  const out = new Set<string>()
  for (const k of list) {
    if (/:(f|q):\d{4}-\d{2}-\d{2}$/.test(k)) { out.add(k); continue }
    const id = k.split(':')[0]
    if (!id) continue
    out.add(`${id}:f:2026-11-23`); out.add(`${id}:q:2026-11-23`)
  }
  return [...out]
}

/** Marcações antigas guardadas só no aparelho (localStorage) → registros na nuvem (uma vez por aparelho). */
let importing: Promise<void> | null = null
function importLocalMarks() { return (importing ??= doImport()) }
async function doImport() {
  try {
    if (localStorage.getItem('mgt_followups_imported') === '1') return
    const fb = migrateFeedbackKeys(JSON.parse(localStorage.getItem('mgt_followup_feedback') ?? '[]') as string[])
    const ms = (JSON.parse(localStorage.getItem('mgt_followup_missing') ?? '[]') as string[]).map((k) => { const [id, ...r] = k.split(':'); return `${id}:missing:${r.join(':')}` })
    for (const k of [...fb, ...ms]) await markDone(k)
    localStorage.setItem('mgt_followups_imported', '1')
  } catch { /* sem armazenamento: segue só com a nuvem */ }
}

/** UUID determinístico (SHA-1 do texto, formato de uuid v5). */
async function stableId(text: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode('manu-followup:' + text))).slice(0, 16)
  h[6] = (h[6] & 0x0f) | 0x50; h[8] = (h[8] & 0x3f) | 0x80
  const x = [...h].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`
}

/** Grava "feito" (chave "aluno:tipo:data") como registro que sincroniza entre aparelhos. */
async function markDone(k: string) {
  const i = k.indexOf(':')
  const student_id = k.slice(0, i), key = k.slice(i + 1)
  if (!student_id || !key) return
  // id fixo por aluno + chave: dois aparelhos (ou dois cliques) gravam o MESMO registro, sem duplicar
  const id = await stableId(`${student_id}:${key}`)
  const has = await db.followups.get(id)
  if (has && !has._deleted) return
  await save(db.followups, { id, student_id, key, created_at: has?.created_at ?? nowISO(), updated_at: nowISO(), _deleted: 0 })
}

/** "Feito" de check-ins e alunos sumidos: vem da nuvem (mesmo controle no tablet, celular e PC). */
function useDone(_prefix?: string) {
  useEffect(() => { void importLocalMarks() }, [])
  const done = useLiveQuery(async () => (await db.followups.toArray()).filter((f) => !f._deleted).map((f) => `${f.student_id}:${f.key}`), []) ?? []
  const mark = (k: string) => { void markDone(k) }
  return { done, mark }
}

/**
 * ALUNOS SUMIDOS (envio manual até o disparo automático do WhatsApp):
 * presencial sem treino há 7 dias ou mais; consultoria sem treino novo salvo há mais de um período + 1 semana.
 */
export function MissingStudents({ students }: { students: Student[] }) {
  const today = toISODate(new Date())
  const last = useLiveQuery(async () => {
    const m: Record<string, string> = {}
    for (const s of await db.sessions.toArray()) if (!s._deleted && s.date > (m[s.student_id] ?? '')) m[s.student_id] = s.date
    return m
  }, []) ?? {}
  const { done, mark } = useDone('mgt_followup_missing')
  const list = students.flatMap((s) => {
    const l = last[s.id]
    if (!l) return []
    const days = daysBetween(l, today)
    const limit = s.modality === 'presencial' ? 7 : (PERIOD_WEEKS[s.plan_period ?? 'semanal'] ?? 1) * 7 + 7
    const key = `${s.id}:missing:${l}` // novo treino → volta a valer
    return days >= limit && !done.includes(key) ? [{ s, l, days, key }] : []
  }).sort((a, b) => b.days - a.days)
  if (!list.length) return null
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="card-head"><h2><UserX size={16} strokeWidth={1.8} /> Alunos sumidos</h2><span className="tag warn">{list.length}</span></div>
      <div className="list-compact">
        {list.map(({ s, l, days, key }) => {
          const msg = s.modality === 'presencial'
            ? `Oi, ${first(s)}! Tudo bem? Faz ${days} dias que você não aparece no treino. Aconteceu alguma coisa? Me fala qual dia fica bom para voltarmos.`
            : `Oi, ${first(s)}! Tudo bem? Como estão os treinos? Me conta como foi sua semana para eu montar o próximo treino.`
          return (
            <div key={s.id} className="li">
              <div style={{ minWidth: 0 }}>
                <Link to={`/alunos/${s.id}`}><b>{titleCase(s.full_name)}</b></Link>
                <div className="muted">{s.modality === 'presencial' ? 'Presencial' : 'Consultoria'} · último treino {fmtBR(l).slice(0, 5)} ({days} dias)</div>
              </div>
              <span className="row" style={{ gap: 6, flexWrap: 'nowrap', flexShrink: 0 }}>
                <a className="btn sm primary" href={waLink(s.phone, msg)} target="_blank" rel="noreferrer"><MessageCircle size={15} strokeWidth={1.8} /> Chamar</a>
                <button className="btn sm" aria-label="Marcar como feito" onClick={() => mark(key)}><Check size={15} /></button>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Palavras do check-in conforme o plano do aluno (semanal, quinzenal, mensal). */
const PERIOD_WORDS = {
  semanal: { title: 'da semana', when: 'nesta semana', next: 'na próxima semana' },
  quinzenal: { title: 'da quinzena', when: 'nessas duas semanas', next: 'no próximo treino' },
  mensal: { title: 'do mês', when: 'neste mês', next: 'no próximo treino' },
} as const
const wordsOf = (s: Student) => PERIOD_WORDS[s.plan_period ?? 'semanal'] ?? PERIOD_WORDS.semanal

export function feedbackMsg(s: Student): string {
  const w = wordsOf(s)
  return `Oi, ${first(s)}! Tudo certo? Hora do check-in ${w.title}:\n1) Quantos treinos você conseguiu fazer ${w.when}?\n2) De 0 a 10, quão puxados foram?\n3) Sentiu alguma dor ou dificuldade em algum exercício?\n4) Fez cardio? Quantas vezes e quantos minutos?\n5) Tem algo que você quer que eu ajuste ${w.next}?`
}

/** Check-in rápido (meio do ciclo de quinzenais e mensais): só acompanhar a semana. */
export function quickMsg(s: Student): string {
  return `Oi, ${first(s)}! Tudo certo? Passando para saber da sua semana:\n1) Quantos treinos você conseguiu fazer?\n2) Algum exercício incomodou ou ficou difícil?\n3) Fez cardio? Quantas vezes e quantos minutos?`
}

/** Semana do retorno (domingo ainda conta como a semana que terminou). */
function feedbackWeek(now = new Date()) {
  return weekStart(addDays(toISODate(now), now.getDay() === 0 ? -1 : 0))
}
/** Ciclo do aluno: o check-in vale uma vez por ciclo (até a próxima troca de treino). */
// um check-in por semana (aluno com troca atrasada continua recebendo toda semana)
const cycleKey = (s: Student, wk: string) => `${s.id}:f:${wk}`
/** Está no fim do ciclo? Troca de treino até o domingo da semana seguinte (semanal: toda semana). */
const dueNow = (s: Student, wk: string) => !s.next_change_date || s.next_change_date <= addDays(wk, 13)
/** Qual check-in vale nesta semana: completo no fim do ciclo (semanal sempre), rápido no meio do ciclo. */
export function checkinOf(s: Student, wk: string): { full: boolean; key: string; text: string; label: string } {
  const full = (s.plan_period ?? 'semanal') === 'semanal' || dueNow(s, wk)
  return full
    ? { full, key: cycleKey(s, wk), text: feedbackMsg(s), label: `check-in completo ${wordsOf(s).title}` }
    : { full, key: `${s.id}:q:${wk}`, text: quickMsg(s), label: 'check-in rápido' }
}

/**
 * RETORNO (consultoria): de sexta a domingo, lista quem está no fim do ciclo
 * (semanal toda semana; quinzenal e mensal na semana antes da troca). Manual por enquanto.
 */
export function WeeklyFeedback({ students }: { students: Student[] }) {
  const now = new Date()
  const dow = now.getDay() // 5 sexta, 6 sábado, 0 domingo
  const { done, mark } = useDone('mgt_followup_feedback')
  const wk = feedbackWeek(now)
  const early = ![5, 6, 0].includes(dow) // seg a qui: a lista aparece, mas o melhor dia é sexta
  const due = students.filter((s) => s.modality === 'online')
  const list = due.filter((s) => !done.includes(checkinOf(s, wk).key))
  const sentList = due.filter((s) => done.includes(checkinOf(s, wk).key))
  if (!due.length) return null
  const row = (s: Student, sent: boolean) => {
    const c = checkinOf(s, wk)
    return (
      <div key={s.id} className="li" style={sent ? { opacity: 0.6 } : undefined}>
        <Link to={`/alunos/${s.id}`} style={{ minWidth: 0 }}><b>{titleCase(s.full_name)}</b>
          <div className="muted">{c.label}{s.next_change_date ? ` · troca ${fmtBR(s.next_change_date).slice(0, 5)}` : ''}</div>
          {late(s) > 0 && <div style={{ fontSize: 12, color: 'var(--danger)', fontWeight: 600 }}>troca atrasada {late(s)} {late(s) === 1 ? 'dia' : 'dias'}</div>}
          <PhoneWarn phone={s.phone} />
        </Link>
        <span className="row" style={{ gap: 6, flexWrap: 'nowrap', flexShrink: 0 }}>
          <a className={`btn sm ${sent ? '' : 'primary'}`} href={waLink(s.phone, c.text)} target="_blank" rel="noreferrer" onClick={() => mark(c.key)}><MessageCircle size={15} strokeWidth={1.8} /> {sent ? 'Reenviar' : 'Enviar'}</a>
        </span>
      </div>
    )
  }
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="card-head"><h2><MessageCircle size={16} strokeWidth={1.8} /> Check-in dos alunos {early && <span className="muted" style={{ fontWeight: 500 }}>· envio na sexta</span>}</h2><span className="muted">{sentList.length} de {due.length} enviados</span></div>
      {!list.length && <div className="empty"><Check size={15} /> Todos os check-ins desta semana foram enviados.</div>}
      {GROUPS.map(([p, title]) => {
        const g = list.filter((s) => (s.plan_period ?? 'semanal') === p).sort((a, b) => late(b) - late(a))
        return g.length ? (
          <div key={p} style={{ marginTop: 8 }}>
            <div className="muted" style={{ fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.04em' }}>{title} ({g.length})</div>
            <div className="list-compact">{g.map((s) => row(s, false))}</div>
          </div>
        ) : null
      })}
      {sentList.length > 0 && (
        <details style={{ marginTop: 6 }}>
          <summary className="muted" style={{ cursor: 'pointer', fontWeight: 600 }}>Já enviados ({sentList.length}): reenviar se não abriu a conversa</summary>
          <div className="list-compact">{sentList.map((s) => row(s, true))}</div>
        </details>
      )}
    </div>
  )
}

const GROUPS = [['semanal', 'Semanais'], ['quinzenal', 'Quinzenais'], ['mensal', 'Mensais']] as const
/** Dias de atraso da troca de treino (0 = em dia). */
const late = (s: Student) => (s.next_change_date ? Math.max(0, daysBetween(s.next_change_date, toISODate(new Date()))) : 0)

/** Aviso quando o telefone da ficha não forma um número de WhatsApp (o WhatsApp abriria "Enviar para…"). */
export function PhoneWarn({ phone }: { phone?: string | null }) {
  if (!phone?.trim()) return <div style={{ fontSize: 12, color: "var(--danger)", fontWeight: 600 }}>sem telefone na ficha: o WhatsApp vai pedir a conversa</div>
  const p = waProblem(phone)
  return p ? <div style={{ fontSize: 12, color: "var(--danger)", fontWeight: 600 }}>número "{phone}" incompleto: coloque o DDD na ficha</div> : null
}

/** CHECK-IN no perfil do aluno (consultoria): mandar a qualquer dia; marca como enviado no ciclo (o Painel também vê). */
export function StudentFeedback({ student }: { student: Student }) {
  const { done, mark } = useDone('mgt_followup_feedback')
  const c = checkinOf(student, feedbackWeek())
  const key = c.key
  const sent = done.includes(key)
  const w = wordsOf(student)
  return (
    <div className="card grid">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <span><MessageCircle size={16} strokeWidth={1.8} style={{ verticalAlign: -3 }} /> <b>{c.full ? `Check-in completo ${w.title}` : 'Check-in rápido da semana'}</b> {sent ? <span className="tag ok">{c.full ? 'enviado neste ciclo' : 'enviado nesta semana'}</span> : <span className="muted">ainda não enviado{student.next_change_date ? ` · troca ${fmtBR(student.next_change_date).slice(0, 5)}` : ''}</span>}</span>
        <a className={`btn sm ${sent ? '' : 'primary'}`} href={waLink(student.phone, c.text)} target="_blank" rel="noreferrer" onClick={() => mark(key)}><MessageCircle size={15} strokeWidth={1.8} /> {sent ? 'Enviar de novo' : 'Enviar check-in'}</a>
      </div>
      <PhoneWarn phone={student.phone} />
      <div className="muted">{c.full ? `Treinos feitos, esforço de 0 a 10, dor ou dificuldade, cardio e o que ajustar ${w.next}.` : `Meio do ciclo: treinos feitos, se algo incomodou e cardio. O completo vai na semana antes da troca${student.next_change_date ? ` (${fmtBR(student.next_change_date).slice(0, 5)})` : ''}.`}</div>
    </div>
  )
}
