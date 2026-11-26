import { useState } from 'react'
import { Bell, Trash2 } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { changeStatus, PERIOD_LABEL } from '../../domain/plan'
import { fmtBR } from '../../engine/metrics'
import { deleteStudent, newStudent } from '../../data/repo'
import { ChangeBadge, ConfirmButton, StudentForm, useStudents } from '../components/common'

export default function Students() {
  const students = useStudents()
  const [params0] = useSearchParams()
  const [creating, setCreating] = useState(!!params0.get('novo'))
  const [params] = useSearchParams()
  const [filter, setFilter] = useState<'todos' | 'online' | 'presencial' | 'vencer'>((params.get('filtro') as 'vencer') ?? 'todos')
  const due = students.filter((s) => changeStatus(s))
  const shown = students.filter((s) => filter === 'todos' || (filter === 'vencer' ? changeStatus(s) : s.modality === filter))
  const nav = useNavigate()
  return (
    <>
      <div className="page-head">
        <div><h1>Alunos</h1><div className="muted">Cadastro nominal, financeiro e modalidade</div></div>
        <button className="btn primary big" onClick={() => setCreating((c) => !c)}>{creating ? 'Fechar' : '+ Novo aluno'}</button>
      </div>
      {creating && <div className="card" style={{ marginBottom: 14 }}><StudentForm initial={newStudent(params0.get('novo') === 'online' ? { modality: 'online' } : params0.get('novo') === 'presencial' ? { modality: 'presencial' } : {})} onSaved={(s) => nav(`/alunos/${s.id}`)} /></div>}
      <div className="chips" style={{ marginBottom: 12 }}>
        {([['todos', 'Todos'], ['online', 'Consultoria'], ['presencial', 'Presencial']] as const).map(([k, l]) => (
          <button key={k} className={`chip sm ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{l}</button>
        ))}
        <button className={`chip sm ${filter === 'vencer' ? 'on' : ''}`} onClick={() => setFilter('vencer')}><Bell size={14} /> Treinos a vencer ({due.length})</button>
      </div>
      <div className="card scroll-x">
        <table className="t">
          <thead><tr><th>Nome</th><th>Modalidade</th><th>Plano</th><th>Freq.</th><th>Venc.</th><th>Troca de treino</th><th>Valor</th><th>Hora/aula</th><th>Pagamento</th><th></th></tr></thead>
          <tbody>
            {shown.map((s) => (
              <tr key={s.id} className="click" onClick={() => nav(`/alunos/${s.id}`)}>
                <td><b>{s.full_name}</b> <ChangeBadge student={s} /></td>
                <td>{s.modality === 'online' ? 'Consultoria' : 'Presencial'}</td>
                <td>{s.plan_name || '—'}</td>
                <td>{s.modality === 'online' ? (s.plan_period ? PERIOD_LABEL[s.plan_period] : '—') : `${s.weekly_frequency ?? '—'}x/sem`}</td>
                <td>{s.due_date ? fmtBR(s.due_date) : s.due_day ? `dia ${s.due_day}` : '—'}</td>
                <td>{s.modality === 'online' && s.next_change_date ? fmtBR(s.next_change_date) : '—'}</td>
                <td>{s.plan_value ? `R$ ${s.plan_value.toFixed(2).replace(".", ",")}` : '—'}</td>
                <td>{s.hourly_rate ? `R$ ${s.hourly_rate.toFixed(2).replace(".", ",")}` : '—'}</td>
                <td><span className={`tag ${s.payment_status === 'em_dia' ? 'regenerativa' : s.payment_status === 'atrasado' ? 'choque' : 'warn'}`}>{s.payment_status.replace('_', ' ')}</span></td>
                <td onClick={(e) => e.stopPropagation()}>
                  <ConfirmButton label={<Trash2 size={16} strokeWidth={1.8} />} confirmLabel="Deseja realmente excluir este aluno?" className="btn danger trash-btn" onConfirm={() => deleteStudent(s.id)} />
                </td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={10} className="muted">Nenhum aluno neste filtro.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
