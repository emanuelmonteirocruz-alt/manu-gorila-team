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

/**
 * RETORNO DA SEMANA (consultoria): de sexta a domingo, lista dos alunos para mandar a pergunta da semana.
 * Manual por enquanto; depois vira disparo automático toda sexta.
 */
export function WeeklyFeedback({ students }: { students: Student[] }) {
  const now = new Date()
  const dow = now.getDay() // 5 sexta, 6 sábado, 0 domingo
  const { done, mark } = useDone('mgt_followup_feedback')
  if (![5, 6, 0].includes(dow)) return null
  const wk = weekStart(addDays(toISODate(now), dow === 0 ? -1 : 0))
  const list = students.filter((s) => s.modality === 'online' && !done.includes(`${s.id}:${wk}`))
  const sent = students.filter((s) => s.modality === 'online').length - list.length
  if (!list.length && !sent) return null
  const msg = (s: Student) => `Oi, ${first(s)}! Retorno da semana:\n1) Quantos treinos você fez?\n2) Esforço da semana de 0 a 10?\n3) Sentiu alguma dor ou dificuldade em algum exercício?\n4) Peso de hoje (se tiver)?`
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="card-head"><h2><MessageCircle size={16} strokeWidth={1.8} /> Retorno da semana</h2><span className="muted">{sent} de {sent + list.length} enviados</span></div>
      {!list.length ? <div className="empty"><Check size={15} /> Todos os alunos da consultoria receberam.</div> : (
        <div className="list-compact">
          {list.map((s) => (
            <div key={s.id} className="li">
              <Link to={`/alunos/${s.id}`} style={{ minWidth: 0 }}><b>{titleCase(s.full_name)}</b>{!s.phone && <div className="muted">sem telefone na ficha</div>}</Link>
              <span className="row" style={{ gap: 6, flexWrap: 'nowrap', flexShrink: 0 }}>
                <a className="btn sm primary" href={waLink(s.phone, msg(s))} target="_blank" rel="noreferrer" onClick={() => mark(`${s.id}:${wk}`)}><MessageCircle size={15} strokeWidth={1.8} /> Enviar</a>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
