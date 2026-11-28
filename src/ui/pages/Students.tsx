import { useState } from 'react'
import { Bell, Check, Trash2 } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { changeStatus, dueOverdue, paidUpdate, PERIOD_LABEL } from '../../domain/plan'
import type { Student } from '../../domain/types'
import { addDays, fmtBR, toISODate } from '../../engine/metrics'
import { deleteStudent, newStudent } from '../../data/repo'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, save } from '../../data/db'
import { titleCase } from '../format'
import { ChangeBadge, ConfirmButton, StudentForm, useStudents } from '../components/common'

/** "Pagou" aparece para quem tem pagamento pendente, atrasado, vencido ou vencendo em até 7 dias. */
const showPaid = (s: Student) => s.payment_status !== 'em_dia' || dueOverdue(s) || (!!s.due_date && s.due_date <= addDays(toISODate(new Date()), 7))

export default function Students() {
  const students = useStudents()
  const [params0] = useSearchParams()
  const [creating, setCreating] = useState(!!params0.get('novo'))
  const [params] = useSearchParams()
  const [filter, setFilter] = useState<'todos' | 'online' | 'presencial' | 'vencer'>((params.get('filtro') as 'vencer') ?? 'todos')
  const inactive = useLiveQuery(async () => (await db.students.toArray()).filter((s) => !s._deleted && s.archived).sort((a, b) => a.full_name.localeCompare(b.full_name)), []) ?? []
  const due = students.filter((s) => changeStatus(s))
  const shown = students.filter((s) => filter === 'todos' || (filter === 'vencer' ? changeStatus(s) : s.modality === filter))
  const nav = useNavigate()
  const [showInactive, setShowInactive] = useState(false)
  return (
    <>
      <div className="page-head">
        <div><h1>Alunos</h1><div className="muted">Cadastro nominal, financeiro e modalidade</div></div>
        <button className="btn primary big" onClick={() => setCreating((c) => !c)}>{creating ? 'Fechar' : '+ Novo aluno'}</button>
      </div>
      {creating && <div className="card" style={{ marginBottom: 14 }}><StudentForm initial={newStudent(params0.get('novo') === 'online' ? { modality: 'online' } : params0.get('novo') === 'presencial' ? { modality: 'presencial' } : {})} withAnamnese onSaved={(s, anam) => nav(`/alunos/${s.id}${anam ? '?aba=anamnese' : ''}`)} /></div>}
      <div className="chips" style={{ marginBottom: 12 }}>
        {([['todos', 'Todos'], ['online', 'Consultoria'], ['presencial', 'Presencial']] as const).map(([k, l]) => (
          <button key={k} className={`chip sm ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{l}</button>
        ))}
        <button className={`chip sm ${filter === 'vencer' ? 'on' : ''}`} onClick={() => setFilter('vencer')}><Bell size={14} /> Treinos a vencer ({due.length})</button>
        {inactive.length > 0 && <button className={`chip sm ${showInactive ? 'on' : ''}`} onClick={() => setShowInactive((v) => !v)}>Inativos ({inactive.length})</button>}
      </div>
      {showInactive && (
        <div className="card grid" style={{ marginBottom: 12 }}>
          <b>Alunos inativos</b>
          <div className="muted">Histórico guardado: não aparecem nas listas, no fechamento nem nos avisos. Reative quando o aluno voltar.</div>
          <div className="cardio-list">
            {inactive.map((s) => (
              <div key={s.id} className="cardio-row">
                <Link to={`/alunos/${s.id}`}>{titleCase(s.full_name)} <span className="muted">· {s.modality === 'online' ? 'Consultoria' : 'Presencial'}</span></Link>
                <button className="btn sm" onClick={() => save(db.students, { ...s, archived: false })}>Reativar</button>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="m-list only-mobile">
        {shown.map((s) => (
          <Link key={s.id} className={`m-item ${s.payment_status === 'atrasado' ? 'is-late' : ''}`} to={`/alunos/${s.id}`}>
            <div className="m-top"><span>{s.full_name} <ChangeBadge student={s} /></span><span className={`tag ${s.payment_status === 'em_dia' ? 'regenerativa' : s.payment_status === 'atrasado' ? 'pay-late' : 'warn'}`}>{s.payment_status === 'atrasado' ? 'Atrasado' : s.payment_status.replace('_', ' ')}</span></div>
            <div className="m-sub">
              <span>{s.modality === 'online' ? 'Consultoria' : 'Presencial'}{s.modality === 'online' ? (s.plan_period ? ` · ${PERIOD_LABEL[s.plan_period]}` : '') : s.weekly_frequency ? ` · ${s.weekly_frequency}x/sem` : ''}</span>
              {(s.due_date || s.due_day) && <span>Venc. {s.due_date ? fmtBR(s.due_date) : `dia ${s.due_day}`}</span>}
              {s.modality === 'online' && s.next_change_date && <span>Troca {fmtBR(s.next_change_date)}</span>}
              {s.plan_value ? <span>R$ {s.plan_value.toFixed(2).replace('.', ',')}</span> : null}
            </div>
          </Link>
        ))}
        {!shown.length && <div className="muted">Nenhum aluno neste filtro.</div>}
      </div>
      <div className="card scroll-x only-desktop">
        <table className="t">
          <thead><tr><th>Nome</th><th>Modalidade</th><th>Plano</th><th>Venc.</th><th>Troca de treino</th><th>Valor</th><th>Hora/aula</th><th>Pagamento</th><th></th></tr></thead>
          <tbody>
            {shown.map((s) => (
              <tr key={s.id} className="click" onClick={() => nav(`/alunos/${s.id}`)}>
                <td><b>{s.full_name}</b> <ChangeBadge student={s} /></td>
                <td>{s.modality === 'online' ? 'Consultoria' : 'Presencial'}</td>
                <td>{s.modality === 'online' ? (s.plan_period ? PERIOD_LABEL[s.plan_period] : '—') : s.weekly_frequency ? `${s.weekly_frequency}x/semana` : '—'}</td>
                <td>{s.due_date ? <span className={dueOverdue(s) ? 'late-txt' : ''}>{fmtBR(s.due_date)}{dueOverdue(s) ? ' · venceu' : ''}</span> : s.due_day ? `dia ${s.due_day}` : '—'}</td>
                <td>{s.modality === 'online' ? (s.next_change_date ? fmtBR(s.next_change_date) : '—') : ''}</td>
                <td>{s.plan_value ? `R$ ${s.plan_value.toFixed(2).replace(".", ",")}` : '—'}</td>
                <td>{s.modality === 'presencial' ? (s.hourly_rate ? `R$ ${s.hourly_rate.toFixed(2).replace(".", ",")}` : '—') : ''}</td>
                <td><span className={`tag ${s.payment_status === 'em_dia' ? 'regenerativa' : s.payment_status === 'atrasado' ? 'pay-late' : 'warn'}`}>{s.payment_status === 'atrasado' ? 'Atrasado' : s.payment_status.replace('_', ' ')}</span></td>
                <td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                  {showPaid(s) && <button className="btn sm" style={{ marginRight: 6 }} title="Vencimento vai para o mês seguinte e o status fica Em dia" onClick={() => save(db.students, { ...s, ...paidUpdate(s) })}><Check size={14} /> Pagou</button>}
                  <ConfirmButton label={<Trash2 size={16} strokeWidth={1.8} />} confirmLabel="Deseja realmente excluir este aluno?" className="btn danger trash-btn" onConfirm={() => deleteStudent(s.id)} />
                </td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={9} className="muted">Nenhum aluno neste filtro.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
