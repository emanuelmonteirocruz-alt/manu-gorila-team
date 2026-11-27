import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { db } from '../../data/db'
import type { Student } from '../../domain/types'
import { titleCase } from '../format'

const brl = (v: number) => `R$ ${v.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`
const STATUS: Record<Student['payment_status'], string> = { em_dia: 'Em dia', pendente: 'Pendente', atrasado: 'Atrasado' }

/**
 * FECHAMENTO (caixa do mês): soma o valor mensal dos alunos ATIVOS (inativos ficam de fora),
 * separado em consultoria, presencial e geral, e quanto está em dia × a receber pelo status de pagamento.
 */
export default function Closing() {
  const students = useLiveQuery(async () => (await db.students.toArray()).filter((s) => !s._deleted && !s.archived), []) ?? []
  const [show, setShow] = useState<'online' | 'presencial' | null>(null)
  const group = (m: 'online' | 'presencial') => {
    const list = students.filter((s) => s.modality === m)
    const total = list.reduce((a, s) => a + (s.plan_value ?? 0), 0)
    const ok = list.filter((s) => s.payment_status === 'em_dia').reduce((a, s) => a + (s.plan_value ?? 0), 0)
    return { list, total, ok, open: total - ok, semValor: list.filter((s) => !s.plan_value).length }
  }
  const on = group('online'), pr = group('presencial')
  const total = on.total + pr.total, ok = on.ok + pr.ok
  const month = new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })

  const Box = ({ title, g, k }: { title: string; g: ReturnType<typeof group>; k: 'online' | 'presencial' }) => (
    <div className="card grid close-card">
      <div className="row" style={{ justifyContent: 'space-between' }}><b>{title}</b><span className="muted">{g.list.length} {g.list.length === 1 ? 'aluno ativo' : 'alunos ativos'}</span></div>
      <div className="close-total">{brl(g.total)}</div>
      <div className="close-split"><span className="ok">Em dia {brl(g.ok)}</span><span className="open">A receber {brl(g.open)}</span></div>
      {g.semValor > 0 && <div className="muted">{g.semValor} sem valor cadastrado na ficha</div>}
      <button className="btn sm" onClick={() => setShow(show === k ? null : k)}>{show === k ? 'Esconder alunos' : 'Ver alunos'}</button>
      {show === k && (
        <div className="cardio-list">
          {[...g.list].sort((a, b) => a.full_name.localeCompare(b.full_name)).map((s) => (
            <Link key={s.id} to={`/alunos/${s.id}?aba=aluno`} className="cardio-row">
              <span>{titleCase(s.full_name)}</span>
              <span className="row" style={{ gap: 6 }}><b>{s.plan_value ? brl(s.plan_value) : '—'}</b><span className={`tag ${s.payment_status === 'em_dia' ? 'regenerativa' : s.payment_status === 'atrasado' ? 'pay-late' : 'warn'}`}>{STATUS[s.payment_status]}</span></span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )

  return (
    <>
      <div className="page-head">
        <div><h1>Fechamento</h1><div className="muted">Valores mensais dos alunos ativos · {month}</div></div>
      </div>
      <div className="grid">
        <div className="card grid close-card close-main">
          <b>Faturamento geral</b>
          <div className="close-total">{brl(total)}</div>
          <div className="close-split"><span className="ok">Em dia {brl(ok)}</span><span className="open">A receber {brl(total - ok)}</span></div>
          <div className="muted">Consultoria {brl(on.total)} · Presencial {brl(pr.total)}</div>
        </div>
        <div className="grid cols-2">
          <Box title="Consultoria" g={on} k="online" />
          <Box title="Presencial" g={pr} k="presencial" />
        </div>
        <div className="muted">Usa o valor do plano de cada ficha e o status de pagamento (Em dia = recebido; Pendente e Atrasado = a receber). Alunos inativos não entram.</div>
      </div>
    </>
  )
}
