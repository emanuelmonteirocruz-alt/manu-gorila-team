import { useLiveQuery } from 'dexie-react-hooks'
import { waLink } from '../../domain/whatsapp'
import { Check, MessageCircle, UserX } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { db } from '../../data/db'
import { PERIOD_WEEKS } from '../../domain/plan'
import type { Student } from '../../domain/types'
import { addDays, fmtBR, toISODate, weekStart } from '../../engine/metrics'
import { titleCase } from '../format'

const first = (s: Student) => titleCase(s.full_name).split(' ')[0]
const daysBetween = (a: string, b: string) => Math.round((new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime()) / 86400000)

/** "Feito" guardado no aparelho (por chave): some da lista até a situação mudar. */
function useDone(prefix: string) {
  const read = () => { try { return JSON.parse(localStorage.getItem(prefix) ?? '[]') as string[] } catch { return [] } }
  const [done, setDone] = useState<string[]>(read)
  const mark = (k: string) => { const n = [...new Set([...done, k])]; setDone(n); try { localStorage.setItem(prefix, JSON.stringify(n.slice(-300))) } catch { /* sem armazenamento */ } }
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
    const key = `${s.id}:${l}` // novo treino → volta a valer
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
  return `Oi, ${first(s)}! Tudo certo? Hora do check-in ${w.title}:\n1) Quantos treinos você conseguiu fazer ${w.when}?\n2) De 0 a 10, quão puxados foram?\n3) Sentiu alguma dor ou dificuldade em algum exercício?\n4) Tem algo que você quer que eu ajuste ${w.next}?`
}

/** Check-in rápido (meio do ciclo de quinzenais e mensais): só acompanhar a semana. */
export function quickMsg(s: Student): string {
  return `Oi, ${first(s)}! Tudo certo? Passando para saber da sua semana:\n1) Quantos treinos você conseguiu fazer?\n2) Algum exercício incomodou ou ficou difícil?`
}

/** Semana do retorno (domingo ainda conta como a semana que terminou). */
function feedbackWeek(now = new Date()) {
  return weekStart(addDays(toISODate(now), now.getDay() === 0 ? -1 : 0))
}
/** Ciclo do aluno: o check-in vale uma vez por ciclo (até a próxima troca de treino). */
const cycleKey = (s: Student, wk: string) => `${s.id}:${s.next_change_date ?? wk}`
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
  if (![5, 6, 0].includes(dow)) return null
  const wk = feedbackWeek(now)
  const due = students.filter((s) => s.modality === 'online')
  const list = due.filter((s) => !done.includes(checkinOf(s, wk).key))
  const sent = due.length - list.length
  if (!due.length) return null
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="card-head"><h2><MessageCircle size={16} strokeWidth={1.8} /> Check-in dos alunos</h2><span className="muted">{sent} de {due.length} enviados</span></div>
      {!list.length ? <div className="empty"><Check size={15} /> Todos os check-ins desta semana foram enviados.</div> : (
        <div className="list-compact">
          {list.map((s) => (
            <div key={s.id} className="li">
              <Link to={`/alunos/${s.id}`} style={{ minWidth: 0 }}><b>{titleCase(s.full_name)}</b><div className="muted">{checkinOf(s, wk).label}{s.next_change_date ? ` · troca ${fmtBR(s.next_change_date).slice(0, 5)}` : ''}{!s.phone ? ' · sem telefone na ficha' : ''}</div></Link>
              <span className="row" style={{ gap: 6, flexWrap: 'nowrap', flexShrink: 0 }}>
                <a className="btn sm primary" href={waLink(s.phone, checkinOf(s, wk).text)} target="_blank" rel="noreferrer" onClick={() => mark(checkinOf(s, wk).key)}><MessageCircle size={15} strokeWidth={1.8} /> Enviar</a>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
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
      <div className="muted">{c.full ? `Treinos feitos, esforço de 0 a 10, dor ou dificuldade e o que ajustar ${w.next}.` : `Meio do ciclo: treinos feitos e se algo incomodou. O completo vai na semana antes da troca${student.next_change_date ? ` (${fmtBR(student.next_change_date).slice(0, 5)})` : ''}.`}{!student.phone && ' Sem telefone na ficha: o WhatsApp pede para escolher a conversa.'}</div>
    </div>
  )
}
