import { useLiveQuery } from 'dexie-react-hooks'
import { History as HistoryIcon } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { db, save } from '../../data/db'
import { resetTimeline } from '../../data/repo'
import NextCycle from '../components/NextCycle'
import { CardioPanel } from '../components/CardioPanel'
import { NutritionPanel } from '../components/NutritionPanel'
import { ChangeBadge, ConfirmButton, PayBadge, StudentForm } from '../components/common'
import { ConsultancyBar } from '../components/ConsultancyBar'
import { StudentFeedback } from '../components/FollowUps'
import { WeeklyTable } from '../components/WeeklyTable'
import { SessionList } from '../components/SessionList'
import { FocusCheck } from '../components/FocusCheck'
import { AnamnesePanel } from '../components/AnamnesePanel'
import TrainerNotes from '../components/TrainerNotes'
import { ConsultSummary, PasteWeekButton, PresencialSummary, ReportsMenu, WeeksPanel } from '../components/StudentTabs'

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
  const [params, setParams] = useSearchParams()
  const [tab0, setTab] = useState<Tab>(tabFrom(params.get('aba'), params.get('treino')))
  const [build, setBuild] = useState<'ia' | 'colar'>('ia') // Montar: gerar automático ou colar do WhatsApp
  const [openSession, setOpenSession] = useState<string | null>(params.get('treino'))
  if (!student) return <div className="muted">Carregando…</div>
  const online = student.modality === 'online'
  // consultoria: a ficha (antiga aba Aluno) agora fica no Resumo
  const tab: Tab = online && tab0 === 'aluno' ? 'resumo' : tab0
  // a aba fica no endereço: ao voltar de um relatório, a página reabre na mesma aba
  const go = (t: Tab) => { setTab(t); setParams((p) => { const n = new URLSearchParams(p); n.set('aba', t); n.delete('treino'); return n }, { replace: true }); window.scrollTo({ top: 0 }) }
  const tabs: [Tab, string][] = online
    ? [['resumo', 'Resumo'], ['treinos', 'Treinos'], ['montar', 'Montar'], ['evolucao', 'Evolução']]
    : [['resumo', 'Resumo'], ['treinos', 'Treinos'], ['evolucao', 'Evolução'], ['aluno', 'Aluno']]
  const inactiveCard = (
    <div className="card grid">
      <b>{student.archived ? 'Aluno inativo' : 'Aluno parou?'}</b>
      <div className="muted">{student.archived ? 'Não aparece nas listas, no fechamento nem nos avisos. O histórico está guardado.' : 'Inative em vez de excluir: o histórico fica guardado e você reativa quando ele voltar.'}</div>
      <div>{student.archived
        ? <button className="btn primary" onClick={() => save(db.students, { ...student, archived: false })}>Reativar aluno</button>
        : <ConfirmButton label="Inativar aluno" confirmLabel="Confirmar: inativar (o histórico fica guardado)" onConfirm={() => save(db.students, { ...student, archived: true })} />}</div>
    </div>
  )
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
      {student.archived && <div className="alert warn" style={{ marginBottom: 10 }}><span><b>Aluno inativo.</b> O histórico está guardado. <button className="btn sm link-btn" onClick={() => save(db.students, { ...student, archived: false })}>Reativar</button></span></div>}
      <div className="tabs-bar" role="tablist">
        {tabs.map(([t, l]) => <button key={t} role="tab" aria-selected={tab === t} className={`tab-btn ${tab === t ? 'on' : ''}`} onClick={() => go(t)}>{l}</button>)}
      </div>

      {tab === 'resumo' && (
        <div className="grid">
          {online
            ? <>
                <ConsultSummary student={student} goAluno={() => document.getElementById('anamnese-panel')?.scrollIntoView({ behavior: 'smooth' })} />
                <ConsultancyBar student={student} showPaste={false} hideName />
                <StudentFeedback student={student} />
                <div id="anamnese-panel"><AnamnesePanel student={student} onGoCycle={() => go('montar')} /></div>
                <NutritionPanel student={student} />
                <div className="card"><StudentForm key={student.id + student.modality + String(student.archived)} initial={student} onDeleted={() => nav('/alunos')} /></div>
                {inactiveCard}
                {resetCard}
              </>
            : <><PresencialSummary student={student} goTreinos={(sid) => { setOpenSession(sid ?? null); go('treinos') }} /><TrainerNotes student={student} /></>}
        </div>
      )}

      {tab === 'treinos' && (online ? <WeeksPanel student={student} /> : <SessionList key={openSession ?? ''} student={student} initialOpen={openSession} />)}

      {tab === 'montar' && online && (
        <div className="grid">
          <div className="chips build-choice">
            <button type="button" className={`chip ${build === 'ia' ? 'on' : ''}`} onClick={() => setBuild('ia')}>Gerar automático</button>
            <button type="button" className={`chip ${build === 'colar' ? 'on' : ''}`} onClick={() => setBuild('colar')}>Colar do WhatsApp</button>
          </div>
          {build === 'colar' ? (
            <div className="card grid">
              <b>Colar o treino que você montou no WhatsApp</b>
              <div className="muted">Cole o texto (Treino A, Treino B…). O app lê, confere com a anamnese e salva como a próxima semana.</div>
              <div className="row stack-sm"><PasteWeekButton student={student} /></div>
            </div>
          ) : (<>
            <NextCycle student={student} onOpenAnamnese={() => go('resumo')} />
          </>)}
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

      {tab === 'aluno' && !online && (
        <div className="grid">
          <NutritionPanel student={student} />
          <div className="card"><StudentForm key={student.id + student.modality + String(student.archived)} initial={student} onDeleted={() => nav('/alunos')} /></div>
          {inactiveCard}
          {resetCard}
        </div>
      )}
    </>
  )
}
