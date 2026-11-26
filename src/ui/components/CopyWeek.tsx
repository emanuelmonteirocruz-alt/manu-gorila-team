import { useLiveQuery } from 'dexie-react-hooks'
import { Check, ClipboardCopy, Copy, Send } from 'lucide-react'
import { useMemo, useState } from 'react'
import { anamneseTemplateText, copyWeekTo, getAnamnese, studentSessions } from '../../data/repo'
import { listWeeks, weekLabel } from '../../data/reportData'
import { db } from '../../data/db'
import { parseTemplate } from '../../consultoria/anamneseTemplate'
import { buildTriage } from '../../consultoria/triage'
import { exerciseAlert, sessionsToWhatsApp } from '../../consultoria/generator'
import { nextWeekToPaste } from '../../domain/plan'
import type { Student } from '../../domain/types'
import { addDays, fmtBR } from '../../engine/metrics'
import { useStudents } from './common'
import { SendByTraining } from './NextCycle'

const first = (s: Student) => s.full_name.split(' ')[0]

/** Semana salva do aluno → texto do WhatsApp e nomes dos exercícios. */
function useWeekText(student: Student, week: string) {
  return useLiveQuery(async () => {
    if (!week) return { text: '', names: [] as string[] }
    const ss = await studentSessions(student, week, addDays(week, 6))
    return { text: sessionsToWhatsApp(ss), names: [...new Set(ss.flatMap((x) => x.exercises.map((e) => e.display_name)))] }
  }, [student.id, week]) ?? { text: '', names: [] as string[] }
}

/**
 * MANDAR PELO WHATSAPP, UM TREINO POR MENSAGEM — qualquer semana já salva do aluno
 * (colada, gerada no Próximo ciclo ou copiada de outro aluno). Sempre visível no Histórico.
 */
export function SendWeek({ student }: { student: Student }) {
  const weeks = useLiveQuery(() => listWeeks(student), [student.id]) ?? []
  const [wk, setWk] = useState('')
  const week = wk || weeks[0]?.wk || ''
  const { text } = useWeekText(student, week)
  if (!weeks.length) return null
  return (
    <div className="card grid">
      <b><Send size={16} strokeWidth={1.8} style={{ verticalAlign: -3 }} /> Mandar treino pelo WhatsApp (um treino por mensagem)</b>
      <label className="f">Semana
        <select value={week} onChange={(e) => setWk(e.target.value)}>
          {weeks.map((w) => <option key={w.wk} value={w.wk}>{weekLabel(w)}</option>)}
        </select>
      </label>
      {text ? <SendByTraining text={text} phone={student.phone ?? ''} /> : <div className="muted">Semana sem treinos.</div>}
    </div>
  )
}

/**
 * COPIAR A SEMANA PARA OUTROS ALUNOS (vários de uma vez): salva como a próxima semana de cada aluno escolhido,
 * avisa o que não combina com a anamnese de cada um e já mostra o envio por mensagem para cada aluno.
 */
export function CopyWeek({ student }: { student: Student }) {
  const weeks = useLiveQuery(() => listWeeks(student), [student.id]) ?? []
  const others = (useStudents('online') ?? []).filter((s) => s.id !== student.id)
  const [wk, setWk] = useState('')
  const [sel, setSel] = useState<string[]>([])
  const [filter, setFilter] = useState('')
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ id: string; week: string; n: number }[]>([])
  const week = wk || weeks[0]?.wk || ''
  const { text, names } = useWeekText(student, week)
  const tplText = useLiveQuery(anamneseTemplateText, []) ?? ''
  const targets = others.filter((s) => sel.includes(s.id))
  // anamnese e próxima semana de cada aluno escolhido
  const info = useLiveQuery(async () => Promise.all(targets.map(async (t) => {
    const an = await getAnamnese(t.id)
    const tw = await listWeeks(t)
    const triage = an ? buildTriage(parseTemplate(tplText), an.answers) : null
    return {
      id: t.id,
      next: nextWeekToPaste(t.plan_period, tw[0]?.wk ?? null),
      hasAnam: !!an,
      alerts: triage ? names.map((n) => ({ n, a: exerciseAlert([n], triage) })).filter((x) => x.a) : [],
    }
  })), [sel.join(','), names.join('|'), tplText]) ?? []
  const shown = useMemo(() => others.filter((s) => !filter || s.full_name.toLowerCase().includes(filter.toLowerCase())), [others, filter])
  if (!weeks.length) return null
  const toggle = (id: string) => { setSel((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id])); setDone([]) }

  async function doCopy() {
    setBusy(true)
    try {
      const out: { id: string; week: string; n: number }[] = []
      for (const t of targets) {
        const fresh = await db.students.get(t.id)
        const i = info.find((x) => x.id === t.id)
        if (!fresh || !i) continue
        out.push({ id: t.id, week: i.next, n: await copyWeekTo(fresh, text, i.next) })
      }
      setDone(out)
    } finally {
      setBusy(false)
    }
  }

  return (
    <details className="card copy-week">
      <summary style={{ cursor: 'pointer', fontWeight: 700 }}><Copy size={16} strokeWidth={1.8} style={{ verticalAlign: -3 }} /> Copiar treino para outros alunos</summary>
      <div className="grid" style={{ marginTop: 10 }}>
        <label className="f">Semana de {first(student)}
          <select value={week} onChange={(e) => { setWk(e.target.value); setDone([]) }}>
            {weeks.map((w) => <option key={w.wk} value={w.wk}>{weekLabel(w)}</option>)}
          </select>
        </label>
        <div className="grid" style={{ gap: 6 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="muted" style={{ fontWeight: 600 }}>Para quais alunos ({sel.length} {sel.length === 1 ? 'escolhido' : 'escolhidos'})</span>
            {others.length > 0 && <button type="button" className="btn sm link-btn" onClick={() => { setSel(sel.length === others.length ? [] : others.map((s) => s.id)); setDone([]) }}>{sel.length === others.length ? 'Limpar' : 'Marcar todos'}</button>}
          </div>
          {others.length > 8 && <input className="set-note" placeholder="Buscar aluno" value={filter} onChange={(e) => setFilter(e.target.value)} />}
          <div className="chips">
            {shown.map((s) => <button key={s.id} type="button" className={`chip sm ${sel.includes(s.id) ? 'on' : ''}`} onClick={() => toggle(s.id)}>{s.full_name}</button>)}
            {!others.length && <span className="muted">Nenhum outro aluno de consultoria.</span>}
          </div>
        </div>

        {targets.map((t) => {
          const i = info.find((x) => x.id === t.id)
          if (!i) return null
          return (
            <div key={t.id} className={i.alerts.length ? 'alert warn' : 'muted'}>
              <b>{first(t)}</b> · vai como semana de {fmtBR(i.next).slice(0, 5)}
              {i.alerts.length ? <ul style={{ margin: '4px 0 0' }}>{i.alerts.map((x) => <li key={x.n}>{x.n}: {x.a}</li>)}</ul>
                : i.hasAnam ? ' · nada na anamnese contra esses exercícios' : ' · sem anamnese salva: confira restrições'}
            </div>
          )
        })}

        <textarea className="code" readOnly value={text} style={{ minHeight: 120 }} />
        <div className="row stack-sm">
          <button className="btn primary" disabled={!targets.length || !text || busy} onClick={doCopy}>
            {busy ? 'Salvando…' : targets.length ? `Salvar para ${targets.length} ${targets.length === 1 ? 'aluno' : 'alunos'}` : 'Escolha os alunos'}
          </button>
          <button className="btn" disabled={!text} onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* sem permissão */ } }}>
            <ClipboardCopy size={16} strokeWidth={1.8} /> {copied ? 'Copiado!' : 'Copiar texto'}
          </button>
        </div>
        <div className="muted">Salva como a próxima semana de cada aluno (histórico, PDFs e próxima troca atualizados). Se precisar mudar algo para alguém, ajuste depois no Colar semana ou no Próximo ciclo dele.</div>

        {done.length > 0 && (
          <div className="grid">
            <div className="alert ok"><Check size={16} /> Salvo para {done.filter((d) => d.n).map((d) => first(others.find((o) => o.id === d.id)!)).join(', ')}. Agora mande para cada um:</div>
            {done.filter((d) => d.n).map((d) => {
              const t = others.find((o) => o.id === d.id)!
              return (
                <div key={d.id} className="grid" style={{ gap: 4 }}>
                  <b>{t.full_name}{t.phone ? '' : ' (sem telefone na ficha: o WhatsApp pede a conversa)'}</b>
                  <SendByTraining text={text} phone={t.phone ?? ''} />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </details>
  )
}
