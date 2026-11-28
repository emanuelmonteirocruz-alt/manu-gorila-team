import { useLiveQuery } from 'dexie-react-hooks'
import { Check, ChevronDown, ChevronRight, Copy, FileText, MessageSquare, Play, Send, TrendingUp, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { anamneseTemplateText, getAnamnese, lastLoads, latestNutrition, studentSessions } from '../../data/repo'
import { listWeeks, weekLabel } from '../../data/reportData'
import { usePastedWeeks, consultState } from './ConsultancyBar'
import { parseTemplate } from '../../consultoria/anamneseTemplate'
import { buildTriage } from '../../consultoria/triage'
import { levelFor } from '../../consultoria/levels'
import { sessionsToWhatsApp } from '../../consultoria/generator'
import { changeStatus } from '../../domain/plan'
import type { Student } from '../../domain/types'
import { addDays, fmtBR, fmtNum, toISODate } from '../../engine/metrics'
import { SessionList } from './SessionList'
import { SendByTraining } from './NextCycle'
import { CopyWeek } from './CopyWeek'

const short = (g: string) => g.replace('Perna - ', '')
const COND: Record<string, string> = { hipertensao: 'pressão alta', diabetes: 'diabetes', gestante: 'gestante', labirintite: 'labirintite', cirurgia: 'cirurgia', asma: 'asma', endometriose: 'endometriose', hernia: 'hérnia', cardiaco: 'condição cardíaca' }

function Check1({ ok, label }: { ok: boolean; label: string }) {
  return <span className={`chk ${ok ? 'ok' : 'no'}`}>{ok ? <Check size={14} /> : <X size={14} />} {label}</span>
}

/** RESUMO da consultoria: situação do aluno numa olhada e o próximo passo. */
export function ConsultSummary({ student }: { student: Student; goAluno?: () => void }) {
  const weeks = useLiveQuery(() => listWeeks(student), [student.id]) ?? []
  const tplText = useLiveQuery(anamneseTemplateText, []) ?? ''
  const anam = useLiveQuery(() => getAnamnese(student.id), [student.id])
  const nutri = useLiveQuery(() => latestNutrition(student.id), [student.id])
  const triage = useMemo(() => (anam && Object.values(anam.answers ?? {}).some((v) => v?.trim()) ? buildTriage(parseTemplate(tplText), anam.answers) : null), [anam, tplText])
  const st = changeStatus(student)
  const level = levelFor(student.training_level, triage?.experiencia)
  const emph = student.emphasis?.length ? student.emphasis : triage?.enfases ?? []
  const attention = triage ? [
    triage.evitarExercicios.length ? `não pode ${triage.evitarExercicios.join(', ')}` : '',
    ...triage.restricoes.map((r) => r.label.toLowerCase()),
    ...triage.condicoes.map((c) => COND[c] ?? c),
    triage.glp1 ? 'Monjaro/Ozempic' : '',
  ].filter(Boolean) : []
  const days = student.next_change_date ? Math.round((new Date(student.next_change_date + 'T12:00:00').getTime() - new Date(toISODate(new Date()) + 'T12:00:00').getTime()) / 86400000) : null

  return (
    <div className="card grid summary-card">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
        <span><b>Próxima troca:</b> {student.next_change_date ? `${fmtBR(student.next_change_date).slice(0, 5)}${days != null ? ` (${days < 0 ? `${-days} dias atrasada` : days === 0 ? 'hoje' : `em ${days} ${days === 1 ? 'dia' : 'dias'}`})` : ''}` : 'não definida'}</span>
        {st && <span className={`tag ${st.level === 'proximo' ? 'warn' : 'danger'}`}>{st.label}</span>}
      </div>
      <div className="chk-row">
        <Check1 ok={!!triage} label="Anamnese" />
        <Check1 ok={weeks.length > 0} label={weeks.length ? `Semana ${fmtBR(weeks[0].wk).slice(0, 5)} colada` : 'Nenhuma semana colada'} />
        <Check1 ok={!!nutri} label="Nutricionista" />
      </div>
      {attention.length > 0 && <div className="alert warn"><span><b>Atenção (anamnese):</b> {attention.join(' · ')}</span></div>}
      <div className="muted"><b>Nível:</b> {level.label} · <b>Ênfase:</b> {emph.length ? emph.map(short).join(', ') : 'não definida'}</div>
    </div>
  )
}

/** Botão "Colar treino do WhatsApp" para a próxima semana do aluno (Treinos e Montar). */
export function PasteWeekButton({ student, big = true }: { student: Student; big?: boolean }) {
  const pasted = usePastedWeeks()[student.id]
  const { next } = consultState(student, pasted)
  return <Link className={`btn primary ${big ? 'big' : ''}`} to={`/consultoria?aluno=${student.id}&semana=${next}`}><MessageSquare size={16} strokeWidth={1.8} /> Colar treino do WhatsApp (semana de {fmtBR(next).slice(0, 5)})</Link>
}

/** TREINOS da consultoria: uma linha por semana, com enviar por mensagem, copiar para outros alunos e PDF. */
export function WeeksPanel({ student }: { student: Student }) {
  const weeks = useLiveQuery(() => listWeeks(student), [student.id]) ?? []
  const [open, setOpen] = useState<string | null>(null)
  const [panel, setPanel] = useState<'send' | 'copy' | null>(null)
  if (!weeks.length) return <div className="grid"><div className="row stack-sm"><PasteWeekButton student={student} /></div><div className="card muted">Nenhum treino cadastrado ainda. Cole o treino do WhatsApp acima ou gere em Montar.</div></div>
  return (
    <div className="grid">
      <div className="row stack-sm"><PasteWeekButton student={student} /></div>
      {weeks.map((w, i) => {
        const isOpen = open === w.wk || (open == null && i === 0)
        return (
          <div key={w.wk} className="card grid week-card">
            <button type="button" className="cardio-head" onClick={() => { setOpen(isOpen ? '' : w.wk); setPanel(null) }} aria-expanded={isOpen}>
              {isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
              <b>{weekLabel(w)}</b>
            </button>
            {isOpen && (
              <>
                <div className="week-actions">
                  <button className={`btn sm ${panel === 'send' ? 'primary' : ''}`} onClick={() => setPanel(panel === 'send' ? null : 'send')}><Send size={15} strokeWidth={1.8} /> Enviar por mensagem</button>
                  <button className={`btn sm ${panel === 'copy' ? 'primary' : ''}`} onClick={() => setPanel(panel === 'copy' ? null : 'copy')}><Copy size={15} strokeWidth={1.8} /> Copiar para outros alunos</button>
                  <Link className="btn sm" to={`/relatorios?aluno=${student.id}&tpl=E&semana=${w.wk}`}><FileText size={15} strokeWidth={1.8} /> PDF da semana</Link>
                </div>
                {panel === 'send' && <WeekSend student={student} week={w.wk} />}
                {panel === 'copy' && <CopyWeek student={student} fixedWeek={w.wk} embedded />}
                <SessionList student={student} from={w.wk} to={addDays(w.wk, 6)} bare limit={20} />
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

function WeekSend({ student, week }: { student: Student; week: string }) {
  const text = useLiveQuery(async () => sessionsToWhatsApp(await studentSessions(student, week, addDays(week, 6))), [student.id, week]) ?? ''
  return text ? <SendByTraining text={text} phone={student.phone ?? ''} /> : null
}

/** RESUMO do presencial: último treino, próximo, maior evolução recente e atalhos. */
export function PresencialSummary({ student, goTreinos }: { student: Student; goTreinos: (sessionId?: string) => void }) {
  const data = useLiveQuery(async () => {
    const all = await studentSessions(student)
    const last = all[all.length - 1]
    if (!last) return null
    const labels = [...new Set(all.map((s) => s.label))].sort()
    const idx = labels.indexOf(last.label)
    const nextLabel = labels.length > 1 ? labels[(idx + 1) % labels.length] : null
    // maior evolução: maior carga do último treino × a vez anterior no mesmo exercício
    const prev = await lastLoads(student.id, last)
    let best: { name: string; diff: number } | null = null
    for (const e of last.exercises) {
      const peak = Math.max(0, ...Array.from({ length: e.valid_sets }, (_, i) => e.loads?.[i] ?? e.load_kg ?? 0))
      const p = prev[e.exercise_key]?.peak
      if (p && peak > p && (!best || peak - p > best.diff)) best = { name: e.display_name, diff: peak - p }
    }
    return { last, nextLabel, best, series: last.exercises.reduce((a, e) => a + e.valid_sets, 0) }
  }, [student.id])
  return (
    <div className="card grid summary-card">
      {data ? (
        <>
          <div><b>Último treino:</b> {data.last.label} · {fmtBR(data.last.date).slice(0, 5)} · {data.series} séries{data.last.muscle_groups.length ? ` · ${data.last.muscle_groups.map(short).join(', ')}` : ''}</div>
          {data.nextLabel && <div><b>Próximo:</b> {data.nextLabel}</div>}
          {data.best && <div className="muted"><TrendingUp size={14} style={{ verticalAlign: -2 }} /> Maior evolução recente: <b>{data.best.name} +{fmtNum(data.best.diff, Number.isInteger(data.best.diff) ? 0 : 1)} kg</b></div>}
        </>
      ) : <div className="muted">Nenhum treino registrado ainda.</div>}
      <div className="row stack-sm">
        <Link className="btn primary big" to={`/presencial?aluno=${student.id}`}><Play size={16} strokeWidth={1.8} /> Iniciar treino</Link>
        {data && <button className="btn big" onClick={() => goTreinos(data.last.id)}><FileText size={16} strokeWidth={1.8} /> PDF do último treino</button>}
      </div>
    </div>
  )
}

/** Um botão de relatórios com as opções dentro (substitui os botões do topo). */
export function ReportsMenu({ student }: { student: Student }) {
  // continua aberto ao voltar do relatório (não precisa abrir de novo)
  const key = `mgt_reports_open_${student.id}`
  const [open, setOpenState] = useState(() => { try { return sessionStorage.getItem(key) === '1' } catch { return false } })
  const setOpen = (f: (v: boolean) => boolean) => setOpenState((v) => { const n = f(v); try { sessionStorage.setItem(key, n ? '1' : '0') } catch { /* sem armazenamento */ } return n })
  const pres = student.modality === 'presencial'
  const items: [string, string][] = [
    ...(pres ? [['Progressão da semana', 'tpl=L&modo=semana'], ['Progressão do mês', 'tpl=L&modo=mes']] as [string, string][] : []),
    ['Treino do dia', 'tpl=D'], ['Uma semana', 'tpl=E'], ['Comparar semanas', 'tpl=W'], ['Resumo do mês', 'tpl=C'], ['Mês × mês', 'tpl=A'],
  ]
  return (
    <div className="card grid">
      <button type="button" className="cardio-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        <FileText size={18} strokeWidth={1.8} /><b>Relatórios em PDF</b>
        <span className="btn sm" style={{ marginLeft: 'auto' }}>{open ? 'Fechar' : 'Abrir'}</span>
      </button>
      {open && <div className="chips">{items.map(([l, q]) => <Link key={q} className="chip sm" to={`/relatorios?aluno=${student.id}&${q}`}>{l}</Link>)}</div>}
    </div>
  )
}
