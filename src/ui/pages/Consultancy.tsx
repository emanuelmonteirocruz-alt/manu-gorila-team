import { Bell, ChartLine, MessageSquare, Sparkles, Trash2, UserRound } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { changeStatus, PERIOD_LABEL } from '../../domain/plan'
import { fmtBR } from '../../engine/metrics'
import { deleteStudent } from '../../data/repo'
import { ChangeBadge, ConfirmButton, PayBadge, useStudents } from '../components/common'
import { consultState, usePastedWeeks, WeekStrip } from '../components/ConsultancyBar'

/** Aba Consultoria: todos os alunos online, com as semanas enviadas, a próxima a colar e atalhos. */
export default function Consultancy() {
  const students = useStudents('online')
  const pasted = usePastedWeeks()
  const [onlyDue, setOnlyDue] = useState(false)
  const rows = students.map((s) => ({ s, st: changeStatus(s), c: consultState(s, pasted[s.id]) }))
  // mais urgentes primeiro: troca atrasada/hoje/próxima, depois quem está sem o treino da semana atual
  const rank = (r: (typeof rows)[number]) => r.st?.days ?? (r.c.covered ? 99 : 50)
  const sorted = rows.sort((a, b) => rank(a) - rank(b) || a.s.full_name.localeCompare(b.s.full_name))
  const pending = rows.filter((r) => r.st || !r.c.covered)
  const shown = onlyDue ? pending : sorted

  return (
    <>
      <div className="page-head">
        <div><h1>Consultoria Online</h1><div className="muted">{students.length} {students.length === 1 ? 'aluno' : 'alunos'} · {pending.length ? `${pending.length} para enviar` : 'todos em dia'}</div></div>
        <div className="row">
          <button className={`chip sm ${onlyDue ? 'on' : ''}`} onClick={() => setOnlyDue((v) => !v)}><Bell size={14} /> Para enviar ({pending.length})</button>
          <Link className="btn" to="/alunos?novo=online">+ Novo aluno</Link>
        </div>
      </div>
      <div className="consult-grid">
        {shown.map(({ s, st, c }) => (
          <div key={s.id} className={`card grid consult-tile ${st ? `alert-${st.level}` : ''}`}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="row" style={{ gap: 6 }}><Link to={`/alunos/${s.id}`} className="tile-name">{s.full_name}</Link><PayBadge student={s} /></span>
              {st ? <ChangeBadge student={s} /> : <span className={`tag ${c.covered ? 'regenerativa' : 'warn'}`}>{c.covered ? 'semana enviada' : 'sem treino desta semana'}</span>}
            </div>
            <div className="consult-meta">
              <span><small>Plano</small>{s.plan_period ? PERIOD_LABEL[s.plan_period] : '—'}</span>
              <span><small>Próxima troca</small>{s.next_change_date ? fmtBR(s.next_change_date).slice(0, 5) : '—'}</span>
              <span><small>Vencimento</small>{s.due_date ? fmtBR(s.due_date).slice(0, 5) : s.due_day ? `dia ${s.due_day}` : '—'}</span>
              <span><small>Última semana</small>{c.last ? fmtBR(c.last).slice(0, 5) : '—'}</span>
            </div>
            <WeekStrip pasted={pasted[s.id]} next={c.next} span={c.span} />
            <Link className="btn primary big wide" to={`/consultoria?aluno=${s.id}&semana=${c.next}`}>
              <MessageSquare size={18} strokeWidth={1.8} /> Colar semana de {fmtBR(c.next).slice(0, 5)}
            </Link>
            <div className="tile-actions">
              <Link className="btn sm" to={`/relatorios?aluno=${s.id}&tpl=W`} title="Semana anterior × semana nova"><ChartLine size={15} strokeWidth={1.8} /> Comparar</Link>
              <Link className="btn sm" to={`/alunos/${s.id}?aba=copiloto`}><Sparkles size={15} strokeWidth={1.8} /> Próximo ciclo</Link>
              <Link className="btn sm" to={`/alunos/${s.id}`}><UserRound size={15} strokeWidth={1.8} /> Ficha</Link>
              <ConfirmButton label={<Trash2 size={16} strokeWidth={1.8} />} confirmLabel="Excluir este aluno?" className="btn danger trash-btn" onConfirm={() => deleteStudent(s.id)} />
            </div>
          </div>
        ))}
        {!shown.length && <div className="card muted">{onlyDue ? 'Tudo em dia: nenhum treino para enviar.' : 'Nenhum aluno de consultoria ainda.'}</div>}
      </div>
    </>
  )
}
