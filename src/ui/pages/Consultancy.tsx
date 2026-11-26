import { useLiveQuery } from 'dexie-react-hooks'
import { Bell, ChartLine, FileText, MessageSquare, Sparkles, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { db } from '../../data/db'
import { changeStatus, PERIOD_LABEL } from '../../domain/plan'
import { fmtBR } from '../../engine/metrics'
import { deleteStudent } from '../../data/repo'
import { ChangeBadge, ConfirmButton, useStudents } from '../components/common'

/** Aba Consultoria: todos os alunos online, com prazo de troca de treino e atalhos. */
export default function Consultancy() {
  const students = useStudents('online')
  const [onlyDue, setOnlyDue] = useState(false)
  // último treino recebido por aluno (data da última mensagem colada)
  const lastByStudent = useLiveQuery(async () => {
    const m: Record<string, string> = {}
    for (const s of await db.sessions.toArray()) {
      if (s._deleted) continue
      if (!m[s.student_id] || s.date > m[s.student_id]) m[s.student_id] = s.date
    }
    return m
  }, []) ?? {}
  // mais urgentes primeiro
  const sorted = [...students].sort((a, b) => (changeStatus(a)?.days ?? 99) - (changeStatus(b)?.days ?? 99) || a.full_name.localeCompare(b.full_name))
  const shown = onlyDue ? sorted.filter((s) => changeStatus(s)) : sorted
  const due = students.filter((s) => changeStatus(s)).length
  // "rotina de domingo": gráfico até a semana anterior

  return (
    <>
      <div className="page-head">
        <div><h1>Consultoria Online</h1><div className="muted">{students.length} alunos · troca de treino, plano e atalhos</div></div>
        <div className="row">
          <button className={`chip sm ${onlyDue ? 'on' : ''}`} onClick={() => setOnlyDue((v) => !v)}><Bell size={14} /> Treinos a vencer ({due})</button>
          <Link className="btn primary" to="/alunos?novo=online">+ Novo aluno de consultoria</Link>
        </div>
      </div>
      <div className="consult-grid">
        {shown.map((s) => {
          const st = changeStatus(s)
          return (
            <div key={s.id} className={`card grid consult-tile ${st ? `alert-${st.level}` : ''}`}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <Link to={`/alunos/${s.id}`} className="tile-name">{s.full_name}</Link>
                <ChangeBadge student={s} />
              </div>
              <div className="consult-meta">
                <span><small>Plano</small>{s.plan_period ? PERIOD_LABEL[s.plan_period] : '—'}</span>
                <span><small>Troca</small>{s.next_change_date ? fmtBR(s.next_change_date) : '—'}</span>
                <span><small>Vencimento</small>{s.due_date ? fmtBR(s.due_date) : s.due_day ? `dia ${s.due_day}` : '—'}</span>
                <span><small>Último treino</small>{lastByStudent[s.id] ? fmtBR(lastByStudent[s.id]) : '—'}</span>
              </div>
              <div className="row">
                <Link className="btn primary" to={`/consultoria?aluno=${s.id}`}><MessageSquare size={16} strokeWidth={1.8} /> Colar treinos</Link>
                <Link className="btn" to={`/alunos/${s.id}?aba=copiloto`}><Sparkles size={16} strokeWidth={1.8} /> Próximo ciclo</Link>
                <Link className="btn" to={`/relatorios?aluno=${s.id}&tpl=W`} title="Semana anterior × semana nova"><ChartLine size={16} strokeWidth={1.8} /> Comparar semanas</Link>
                <Link className="btn" to={`/relatorios?aluno=${s.id}`}><FileText size={16} strokeWidth={1.8} /> PDF</Link>
                <span style={{ marginLeft: 'auto' }}>
                  <ConfirmButton label={<Trash2 size={16} strokeWidth={1.8} />} confirmLabel="Deseja realmente excluir este aluno?" className="btn danger trash-btn" onConfirm={() => deleteStudent(s.id)} />
                </span>
              </div>
            </div>
          )
        })}
        {!shown.length && <div className="card muted">{onlyDue ? 'Nenhuma troca de treino pendente.' : 'Nenhum aluno de consultoria ainda.'}</div>}
      </div>
    </>
  )
}
