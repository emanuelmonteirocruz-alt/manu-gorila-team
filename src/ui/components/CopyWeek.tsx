import { useLiveQuery } from 'dexie-react-hooks'
import { ClipboardCopy, Copy } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { anamneseTemplateText, getAnamnese, studentSessions } from '../../data/repo'
import { listWeeks, weekLabel } from '../../data/reportData'
import { parseTemplate } from '../../consultoria/anamneseTemplate'
import { buildTriage } from '../../consultoria/triage'
import { exerciseAlert, sessionsToWhatsApp } from '../../consultoria/generator'
import { nextWeekToPaste } from '../../domain/plan'
import type { Student } from '../../domain/types'
import { addDays, fmtBR } from '../../engine/metrics'
import { useStudents } from './common'
import { SendByTraining } from './NextCycle'

/**
 * Copiar a semana de treino de um aluno da consultoria para outro: o texto vai para o "Colar semana"
 * do aluno de destino (você confere e salva lá) e o app avisa o que não combina com a anamnese dele.
 */
export function CopyWeek({ student }: { student: Student }) {
  const nav = useNavigate()
  const weeks = useLiveQuery(() => listWeeks(student), [student.id]) ?? []
  const others = (useStudents('online') ?? []).filter((s) => s.id !== student.id)
  const [wk, setWk] = useState('')
  const [to, setTo] = useState('')
  const [copied, setCopied] = useState(false)
  const week = wk || weeks[0]?.wk || ''
  const target = others.find((s) => s.id === to)
  const data = useLiveQuery(async () => {
    if (!week) return { text: '', names: [] as string[] }
    const ss = await studentSessions(student, week, addDays(week, 6))
    return { text: sessionsToWhatsApp(ss), names: [...new Set(ss.flatMap((x) => x.exercises.map((e) => e.display_name)))] }
  }, [student.id, week]) ?? { text: '', names: [] as string[] }
  const text = data.text
  const tplText = useLiveQuery(anamneseTemplateText, []) ?? ''
  const targetAnam = useLiveQuery(() => (to ? getAnamnese(to) : undefined), [to])
  const targetWeeks = useLiveQuery(() => (target ? listWeeks(target) : []), [target?.id]) ?? []
  const alerts = useMemo(() => {
    if (!targetAnam || !text) return []
    const triage = buildTriage(parseTemplate(tplText), targetAnam.answers)
    return data.names.map((n) => ({ n, a: exerciseAlert([n], triage) })).filter((x) => x.a)
  }, [targetAnam, data, tplText])
  if (!weeks.length) return null
  const nextWk = target ? nextWeekToPaste(target.plan_period, targetWeeks[0]?.wk ?? null) : ''

  return (
    <details className="card copy-week">
      <summary style={{ cursor: 'pointer', fontWeight: 700 }}><Copy size={16} strokeWidth={1.8} style={{ verticalAlign: -3 }} /> Copiar treino para outro aluno</summary>
      <div className="grid" style={{ marginTop: 10 }}>
        <div className="grid cols-2">
          <label className="f">Semana de {student.full_name.split(' ')[0]}
            <select value={week} onChange={(e) => setWk(e.target.value)}>
              {weeks.map((w) => <option key={w.wk} value={w.wk}>{weekLabel(w)}</option>)}
            </select>
          </label>
          <label className="f">Para o aluno
            <select value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">Escolha…</option>
              {others.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
          </label>
        </div>
        {target && (alerts.length ? (
          <div className="alert warn">
            <b>Pela anamnese de {target.full_name.split(' ')[0]}:</b>
            <ul style={{ margin: '4px 0 0' }}>{alerts.map((x) => <li key={x.n}>{x.n}: {x.a}</li>)}</ul>
          </div>
        ) : <div className="muted">{targetAnam ? `Nada na anamnese de ${target.full_name.split(' ')[0]} contra esses exercícios.` : `${target.full_name.split(' ')[0]} ainda não tem anamnese salva: confira restrições antes de mandar.`}</div>)}
        <textarea className="code" readOnly value={text} style={{ minHeight: 140 }} />
        <div className="row stack-sm">
          <button className="btn primary" disabled={!target || !text} onClick={() => {
            try { sessionStorage.setItem('mgt_paste_prefill', text) } catch { /* sem armazenamento */ }
            nav(`/consultoria?aluno=${target!.id}&semana=${nextWk}`)
          }}>{target ? `Colar como semana de ${fmtBR(nextWk).slice(0, 5)} de ${target.full_name.split(' ')[0]}` : 'Escolha o aluno'}</button>
          <button className="btn" disabled={!text} onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* sem permissão */ } }}>
            <ClipboardCopy size={16} strokeWidth={1.8} /> {copied ? 'Copiado!' : 'Copiar texto'}
          </button>
        </div>
        <div className="muted">"Colar como semana" abre o Colar semana do aluno escolhido com o treino já preenchido: ajuste o que quiser, confira e salve.</div>
        {target && <SendByTraining text={text} phone={target.phone ?? ''} />}
      </div>
    </details>
  )
}
