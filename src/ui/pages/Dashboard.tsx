import { useLiveQuery } from 'dexie-react-hooks'
import { Activity, AlertCircle, UserPlus, Bell, CircleCheck, FileText, MessageSquare, Dumbbell, Wallet } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { db } from '../../data/db'
import { divergenceAlert, fmtBR, toISODate, weekStart } from '../../engine/metrics'
import { useStudents } from '../components/common'
import { changeStatus } from '../../domain/plan'
import { SOURCE_LABEL, titleCase } from '../format'
import { MissingStudents, WeeklyFeedback } from '../components/FollowUps'

const PAY_LABEL: Record<string, { l: string; c: string }> = {
  em_dia: { l: 'Em dia', c: 'ok' },
  pendente: { l: 'Pendente', c: 'warn' },
  atrasado: { l: 'Atrasado', c: 'danger' },
}

export default function Dashboard() {
  const students = useStudents()
  const nav = useNavigate()
  const today = new Date()
  const day = today.getDate()
  const changes = students.flatMap((s) => { const st = changeStatus(s); return st ? [{ s, st }] : [] }).sort((a, b) => a.st.days - b.st.days)
  const late = students.filter((s) => s.payment_status === 'atrasado') // mensalidade atrasada (vermelho)
  const dueSoon = students.filter((s) => s.due_day && ((s.due_day - day + 31) % 31) <= 3)
  const data = useLiveQuery(async () => {
    const ratings = await db.ratings.toArray()
    const recent = (await db.sessions.orderBy('date').reverse().limit(30).toArray()).filter((s) => !s._deleted)
    const alerts = recent.flatMap((s) => {
      const r = ratings.find((x) => x.session_id === s.id)
      const a = r ? divergenceAlert(s.planned_microcycle ?? 'ordinaria', r.pse) : null
      return a ? [{ s, a, pse: r!.pse }] : []
    })
    return { recent: recent.slice(0, 8), alerts: alerts.slice(0, 4) }
  }, [])
  const name = (id: string) => titleCase(students.find((s) => s.id === id)?.full_name ?? '—')
  return (
    <>
      <div className="page-head">
        <div><h1>Painel do Treinador</h1><div className="muted">Semana de {fmtBR(weekStart(toISODate(today)))}</div></div>
        <div className="row">
          <Link className="btn primary" to="/presencial"><Dumbbell size={16} strokeWidth={1.8} /> Iniciar treino presencial</Link>
          <Link className="btn" to="/consultoria"><MessageSquare size={16} strokeWidth={1.8} /> Colar treinos do WhatsApp</Link>
          <Link className="btn" to="/alunos?novo=1"><UserPlus size={16} strokeWidth={1.8} /> Novo aluno</Link>
        </div>
      </div>

      {late.length > 0 && (
        <div className="alert danger pay-late-alert" style={{ marginBottom: 14 }}>
          <AlertCircle size={16} strokeWidth={2} />
          <div>
            <b>Mensalidade atrasada</b>{' · '}
            {late.map((s, i) => <span key={s.id}>{i ? ' · ' : ''}<Link to={`/alunos/${s.id}?aba=ficha`}>{titleCase(s.full_name)}</Link></span>)}
          </div>
        </div>
      )}
      {changes.length > 0 && (
        <div className="alert warn" style={{ marginBottom: 14 }}>
          <Bell size={16} strokeWidth={1.8} />
          <div>
            <b>Troca de treino</b>{' · '}
            {changes.map(({ s, st }, i) => (
              <span key={s.id}>{i ? ' · ' : ''}<Link to={`/consultoria?aluno=${s.id}`}>{titleCase(s.full_name)}</Link> ({st.label})</span>
            ))}
            {' · '}<Link to="/consultoria-alunos">ver consultoria</Link>
          </div>
        </div>
      )}

      <WeeklyFeedback students={students} />
      <MissingStudents students={students} />

      <div className="grid cols-2">
        <div className="card">
          <div className="card-head">
            <h2><Wallet size={16} strokeWidth={1.8} /> Vencimentos <span className="muted" style={{ fontWeight: 500 }}>próximos 3 dias</span></h2>
            {dueSoon.length === 0 && <span className="tag ok">Em dia</span>}
          </div>
          {dueSoon.length === 0 ? <div className="empty"><CircleCheck size={15} /> Nenhum vencimento nos próximos dias.</div> : (
            <div className="list-compact">
              {dueSoon.map((s) => (
                <div key={s.id} className="li">
                  <div style={{ minWidth: 0 }}>
                    <b>{titleCase(s.full_name)}</b>
                    <div className="muted">dia {s.due_day} · <span className={`tag ${PAY_LABEL[s.payment_status].c}`}>{PAY_LABEL[s.payment_status].l}</span></div>
                  </div>
                  <Link className="btn sm" to={`/relatorios?aluno=${s.id}&tpl=C`}><FileText size={15} strokeWidth={1.8} /> Resumão PDF</Link>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card">
          <div className="card-head">
            <h2><Activity size={16} strokeWidth={1.8} /> Prescrito × Percebido</h2>
            {data && data.alerts.length === 0 && <span className="tag ok">Tudo alinhado</span>}
            {data && data.alerts.length > 0 && <span className="tag warn">{data.alerts.length} atenção</span>}
          </div>
          {data?.alerts.length === 0 && <div className="empty"><CircleCheck size={15} /> Nenhuma divergência de PSE recente.</div>}
          <div className="list-compact">
            {data?.alerts.map(({ s, a, pse }) => (
              <div key={s.id} className="li" style={{ alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <b>{name(s.student_id)}</b> <span className="muted">· {s.label} · {fmtBR(s.date)}</span>
                  <div className="muted">Planejada Ordinária, PSE {pse}{a.reasons.length ? ` · ${a.reasons.join(', ')}` : ''}</div>
                </div>
                <span className="tag warn num">PSE {pse}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-head"><h2>Últimas sessões</h2><Link className="btn sm" to="/historico">Ver histórico</Link></div>
        <div className="m-list only-mobile">
          {data?.recent.map((s) => (
            <Link key={s.id} className="m-item" to={`/alunos/${s.student_id}?treino=${s.id}`}>
              <div className="m-top"><span>{name(s.student_id)}</span><span className={`tag src-${s.source}`}>{SOURCE_LABEL[s.source] ?? s.source}</span></div>
              <div className="m-sub"><span>{fmtBR(s.date)} · {s.label}</span><span>{s.exercises.reduce((a, e) => a + e.valid_sets, 0)} válidas · {s.exercises.reduce((a, e) => a + e.heavy_sets, 0)} pesadas</span></div>
            </Link>
          ))}
          {data && !data.recent.length && <div className="muted">Nenhuma sessão registrada ainda.</div>}
        </div>
        <div className="scroll-x only-desktop"><table className="t">
          <thead><tr><th>Data</th><th>Aluno</th><th>Treino</th><th>Origem</th><th className="n">Válidas</th><th className="n">Pesadas</th></tr></thead>
          <tbody>
            {data?.recent.map((s) => (
              <tr key={s.id} className="click" onClick={() => nav(`/alunos/${s.student_id}?treino=${s.id}`)}>
                <td className="num">{fmtBR(s.date)}</td>
                <td><b>{name(s.student_id)}</b></td>
                <td>{s.label}</td>
                <td><span className={`tag src-${s.source}`}>{SOURCE_LABEL[s.source] ?? s.source}</span></td>
                <td className="n">{s.exercises.reduce((a, e) => a + e.valid_sets, 0)}</td>
                <td className="n">{s.exercises.reduce((a, e) => a + e.heavy_sets, 0)}</td>
              </tr>
            ))}
            {data && !data.recent.length && <tr><td colSpan={6} className="muted">Nenhuma sessão registrada ainda.</td></tr>}
          </tbody>
        </table></div>
      </div>
    </>
  )
}
