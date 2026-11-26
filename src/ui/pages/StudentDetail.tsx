import { useLiveQuery } from 'dexie-react-hooks'
import { FileText, History as HistoryIcon } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { db } from '../../data/db'
import { resetTimeline } from '../../data/repo'
import { toISODate, weekStart } from '../../engine/metrics'
import Copilot from '../components/Copilot'
import { ChangeBadge, ConfirmButton, SleepCheckin, StudentForm, WeekContextEditor } from '../components/common'
import { ConsultancyBar } from '../components/ConsultancyBar'
import { WeeklyTable } from '../components/WeeklyTable'
import { SessionList } from '../components/SessionList'

type Tab = 'historico' | 'copiloto' | 'ficha'

export default function StudentDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const student = useLiveQuery(() => db.students.get(id!), [id])
  const [params] = useSearchParams()
  const [tab, setTab] = useState<Tab>(params.get('aba') === 'copiloto' ? 'copiloto' : params.get('aba') === 'ficha' ? 'ficha' : 'historico')
  const [emph, setEmph] = useState(false)
  if (!student) return <div className="muted">Carregando…</div>
  const today = toISODate(new Date())
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{student.full_name} <ChangeBadge student={student} /></h1>
          <div className="muted">{student.modality === 'online' ? `Consultoria Online${student.plan_period ? ` · ${student.plan_period}` : ''}` : `Personal Presencial · ${student.sex === 'F' ? 'Feminino' : 'Masculino'}`} · {student.plan_name || 'sem plano'}</div>
        </div>
        <div className="row">
          <Link className="btn" to={`/relatorios?aluno=${student.id}`}><FileText size={16} strokeWidth={1.8} /> Relatórios</Link>
        </div>
      </div>
      {student.modality === 'presencial' ? (
        <div className="grid">
          <div className="chips">
            <button className={`chip sm ${tab !== 'ficha' ? 'on' : ''}`} onClick={() => setTab('historico')}>Treinos</button>
            <button className={`chip sm ${tab === 'ficha' ? 'on' : ''}`} onClick={() => setTab('ficha')}>Ficha / financeiro</button>
          </div>
          {tab !== 'ficha' && <SessionList student={student} initialOpen={params.get('treino')} />}
          {tab === 'ficha' && <div className="card"><StudentForm key={student.id + student.modality} initial={student} onDeleted={() => nav('/alunos')} /></div>}
          {tab === 'ficha' && (
            <div className="card grid">
              <b>Recomeçar a linha do tempo</b>
              <div className="muted">Para quando o aluno volta depois de muito tempo: os treinos antigos deixam de entrar nos gráficos e comparações (não são apagados).</div>
              <div><ConfirmButton label="Novo Aluno (Zerar Base)" confirmLabel="Confirmar: zerar linha do tempo" onConfirm={() => resetTimeline(student)} /></div>
            </div>
          )}
          <div className="muted">O check-in do dia (sono) e o contexto da semana (dieta, ciclo menstrual, microciclo) são registrados ao <Link to="/presencial">iniciar o treino presencial</Link>. A evolução semanal fica no <Link to={`/historico?aluno=${student.id}`}>Histórico</Link>.</div>
        </div>
      ) : (<>
      <div className="chips" style={{ marginBottom: 14 }}>
        <button className={`chip sm ${tab === 'historico' ? 'on' : ''}`} onClick={() => setTab('historico')}>Histórico & semanas</button>
        <button className={`chip sm ${tab === 'copiloto' ? 'on' : ''}`} onClick={() => setTab('copiloto')}>Copiloto do próximo ciclo</button>
        <button className={`chip sm ${tab === 'ficha' ? 'on' : ''}`} onClick={() => setTab('ficha')}>Ficha / financeiro</button>
      </div>

      {tab === 'ficha' && (
        <div className="grid">
          <div className="card"><StudentForm key={student.id + student.modality} initial={student} onDeleted={() => nav('/alunos')} /></div>
          <div className="card grid">
            <b>Recomeçar a linha do tempo</b>
            <div className="muted">Para quando o aluno volta depois de muito tempo: os treinos antigos deixam de entrar nos gráficos e comparações (não são apagados).</div>
            <div><ConfirmButton label="Novo Aluno (Zerar Base)" confirmLabel="Confirmar: zerar linha do tempo" onConfirm={() => resetTimeline(student)} /></div>
          </div>
        </div>
      )}
      {tab === 'copiloto' && <Copilot student={student} />}
      {tab === 'historico' && (
        <div className="grid">
          {student.modality === 'online' ? <ConsultancyBar student={student} /> : (
            <div className="grid cols-2">
              <WeekContextEditor student={student} week={weekStart(today)} />
              <SleepCheckin student={student} />
            </div>
          )}
          <label className="row muted"><input type="checkbox" checked={emph} onChange={(e) => setEmph(e.target.checked)} /> Especificar musculatura com mais intensidade e volume</label>
          <WeeklyTable student={student} emph={emph} />
          <SessionList student={student} initialOpen={params.get('treino')} />
          <div><Link className="btn" to={`/historico?aluno=${student.id}`}><HistoryIcon size={16} strokeWidth={1.8} /> Histórico completo</Link></div>
        </div>
      )}
      </>)}
    </>
  )
}
