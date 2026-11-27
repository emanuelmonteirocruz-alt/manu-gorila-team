import { useLiveQuery } from 'dexie-react-hooks'
import { History as HistoryIcon } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { db } from '../../data/db'
import { resetTimeline } from '../../data/repo'
import Copilot from '../components/Copilot'
import NextCycle from '../components/NextCycle'
import { CardioPanel } from '../components/CardioPanel'
import { NutritionPanel } from '../components/NutritionPanel'
import { ChangeBadge, ConfirmButton, PayBadge, StudentForm } from '../components/common'
import { ConsultancyBar } from '../components/ConsultancyBar'
import { WeeklyTable } from '../components/WeeklyTable'
import { SessionList } from '../components/SessionList'
import { FocusCheck } from '../components/FocusCheck'
import { AnamnesePanel } from '../components/AnamnesePanel'
import { ConsultSummary, PresencialSummary, ReportsMenu, WeeksPanel } from '../components/StudentTabs'

type Tab = 'resumo' | 'treinos' | 'montar' | 'evolucao' | 'aluno'

/** Abas antigas (links já salvos) → abas novas. */
function tabFrom(aba: string | null, treino: string | null): Tab {
  if (treino) return 'treinos'
  switch (aba) {
    case 'copiloto': case 'montar': return 'montar'
    case 'anamnese': case 'ficha': case 'aluno': return 'aluno'
    case 'historico': case 'treinos': return 'treinos'
    case 'evolucao': return 'evolucao'
    default: return 'resumo'
  }
}

export default function StudentDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const student = useLiveQuery(() => db.students.get(id!), [id])
  const [params] = useSearchParams()
  const [tab, setTab] = useState<Tab>(tabFrom(params.get('aba'), params.get('treino')))
  const [openSession, setOpenSession] = useState<string | null>(params.get('treino'))
  if (!student) return <div className="muted">Carregando…</div>
  const online = student.modality === 'online'
  const go = (t: Tab) => { setTab(t); window.scrollTo({ top: 0 }) }
  const tabs: [Tab, string][] = online
    ? [['resumo', 'Resumo'], ['treinos', 'Treinos'], ['montar', 'Montar'], ['evolucao', 'Evolução'], ['aluno', 'Aluno']]
    : [['resumo', 'Resumo'], ['treinos', 'Treinos'], ['evolucao', 'Evolução'], ['aluno', 'Aluno']]
  const resetCard = (
    <div className="card grid">
      <b>Recomeçar a linha do tempo</b>
      <div className="muted">Para quando o aluno volta depois de muito tempo: os treinos antigos deixam de entrar nos gráficos e comparações (não são apagados).</div>
      <div><ConfirmButton label="Novo Aluno (Zerar Base)" confirmLabel="Confirmar: zerar linha do tempo" onConfirm={() => resetTimeline(student)} /></div>
    </div>
  )
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{student.full_name} <ChangeBadge student={student} /> <PayBadge student={student} /></h1>
          <div className="muted">{online ? `Consultoria Online${student.plan_period ? ` · ${student.plan_period}` : ''}` : `Personal Presencial · ${student.sex === 'F' ? 'Feminino' : 'Masculino'} · Mensal`}</div>
        </div>
      </div>
      <div className="tabs-bar" role="tablist">
        {tabs.map(([t, l]) => <button key={t} role="tab" aria-selected={tab === t} className={`tab-btn ${tab === t ? 'on' : ''}`} onClick={() => go(t)}>{l}</button>)}
      </div>

      {tab === 'resumo' && (
        <div className="grid">
          {online
            ? <><ConsultSummary student={student} goMontar={() => go('montar')} goAluno={() => go('aluno')} /><ConsultancyBar student={student} showPaste={false} hideName /></>
            : <PresencialSummary student={student} goTreinos={(sid) => { setOpenSession(sid ?? null); go('treinos') }} />}
        </div>
      )}

      {tab === 'treinos' && (online ? <WeeksPanel student={student} /> : <SessionList key={openSession ?? ''} student={student} initialOpen={openSession} />)}

      {tab === 'montar' && online && (
        <div className="grid">
          <NextCycle student={student} onOpenAnamnese={() => go('aluno')} />
          <details className="card">
            <summary className="muted" style={{ cursor: 'pointer', fontWeight: 600 }}>Gerador antigo (tempo disponível e IA)</summary>
            <div style={{ marginTop: 10 }}><Copilot student={student} /></div>
          </details>
        </div>
      )}

      {tab === 'evolucao' && (
        <div className="grid">
          <ReportsMenu student={student} />
          <FocusCheck student={student} />
          <CardioPanel student={student} />
          <WeeklyTable student={student} />
          <div><Link className="btn" to={`/historico?aluno=${student.id}`}><HistoryIcon size={16} strokeWidth={1.8} /> Histórico completo</Link></div>
        </div>
      )}

      {tab === 'aluno' && (
        <div className="grid">
          {online && <AnamnesePanel student={student} onGoCycle={() => go('montar')} />}
          <NutritionPanel student={student} />
          <div className="card"><StudentForm key={student.id + student.modality} initial={student} onDeleted={() => nav('/alunos')} /></div>
          {resetCard}
        </div>
      )}
    </>
  )
}
