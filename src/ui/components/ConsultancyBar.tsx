import { useLiveQuery } from 'dexie-react-hooks'
import { Bell, Check, ChevronRight, MessageSquare } from 'lucide-react'
import { Link } from 'react-router-dom'
import { db } from '../../data/db'
import { saveStudent } from '../../data/repo'
import { PERIOD_LABEL, PERIOD_WEEKS, changeStatus, nextChangeAfter, nextWeekToPaste, recentWeeks, suggestNextChange, type PlanPeriod } from '../../domain/plan'
import type { Student } from '../../domain/types'
import { fmtBR, toISODate, weekStart } from '../../engine/metrics'

/** Semanas (segundas) que já têm treino colado do WhatsApp, por aluno. */
export function usePastedWeeks(): Record<string, Set<string>> {
  return useLiveQuery(async () => {
    const m: Record<string, Set<string>> = {}
    for (const s of await db.sessions.toArray()) {
      if (s._deleted || s.source !== 'whatsapp') continue
      ;(m[s.student_id] ??= new Set()).add(weekStart(s.date))
    }
    return m
  }, []) ?? {}
}

/** Situação do aluno de consultoria: próxima semana a colar e se a semana atual já está coberta. */
export function consultState(student: Student, pasted: Set<string> | undefined, today = toISODate(new Date())) {
  const weeks = [...(pasted ?? [])].sort()
  const last = weeks[weeks.length - 1] ?? null
  const next = nextWeekToPaste(student.plan_period, last, today)
  // semana atual coberta pelo último treino colado (quinzenal/mensal cobrem várias semanas)
  const span = PERIOD_WEEKS[student.plan_period ?? 'semanal']
  const cur = weekStart(today)
  const covered = !!last && cur >= last && cur < nextWeekToPaste(student.plan_period, last, last)
  return { last, next, covered, span, weeks }
}

/** Linha de semanas: ✓ = treino colado, • = semana sem treino; a última é a próxima a colar. */
export function WeekStrip({ pasted, next, span }: { pasted: Set<string> | undefined; next: string; span: number }) {
  const list = recentWeeks(next, 4)
  // semanas cobertas por um treino quinzenal/mensal também contam como enviadas
  const done = (w: string) => [...(pasted ?? [])].some((p) => w >= p && w < addWeeks(p, span))
  return (
    <div className="week-strip" aria-label="Semanas enviadas">
      {list.map((w) => {
        const isNext = w === next
        const ok = !isNext && done(w)
        return (
          <span key={w} className={`wk ${ok ? 'ok' : ''} ${isNext ? 'next' : ''}`} title={isNext ? 'Próxima semana a colar' : ok ? 'Treino enviado' : 'Sem treino colado'}>
            {ok ? <Check size={12} strokeWidth={2.4} /> : isNext ? <ChevronRight size={12} strokeWidth={2.4} /> : null}
            {fmtBR(w).slice(0, 5)}
          </span>
        )
      })}
    </div>
  )
}
const addWeeks = (wk: string, n: number) => {
  const d = new Date(wk + 'T12:00:00')
  d.setDate(d.getDate() + 7 * n)
  return toISODate(d)
}

/**
 * Barra de contexto da consultoria: periodicidade (troca rápida), semanas enviadas, próxima troca
 * e o atalho principal "Colar semana de dd/mm" (abre o colar já com o aluno e a semana).
 */
export function ConsultancyBar({ student, showPaste = true, hideName = false }: { student: Student; showPaste?: boolean; hideName?: boolean }) {
  const st = changeStatus(student)
  const pastedAll = usePastedWeeks()
  const pasted = pastedAll[student.id]
  const { next, span } = consultState(student, pasted)
  const upd = (patch: Partial<Student>) => saveStudent({ ...student, ...patch })
  return (
    <div className={`card grid consult-bar ${st ? `alert-${st.level}` : ''}`}>
      <div className="grid" style={{ gap: 8 }}>
        {!hideName && <div className="row" style={{ justifyContent: 'space-between' }}>
          <div style={{ minWidth: 0 }}>
            <b style={{ fontSize: 17 }}>{student.full_name}</b>
            <div className="muted">{student.plan_name || 'Consultoria Online'}{student.phone ? ` · ${student.phone}` : ''}</div>
          </div>
          {st && <span className={`tag ${st.level === 'proximo' ? 'warn' : 'danger'}`}><Bell size={12} /> {st.label}</span>}
        </div>}
        <div className="chips">
          {(Object.keys(PERIOD_LABEL) as PlanPeriod[]).map((p) => (
            <button key={p} type="button" className={`chip sm ${student.plan_period === p ? 'on' : ''}`}
              onClick={() => upd({ plan_period: p, next_change_date: student.next_change_date ?? suggestNextChange(p) })}>{PERIOD_LABEL[p]}</button>
          ))}
        </div>
      </div>

      <WeekStrip pasted={pasted} next={next} span={span} />

      {showPaste && (
        <Link className="btn primary big wide" to={`/consultoria?aluno=${student.id}&semana=${next}`}>
          <MessageSquare size={18} strokeWidth={1.8} /> Colar semana de {fmtBR(next).slice(0, 5)}
        </Link>
      )}

      <div className="consult-facts">
        <div><span className="muted">Valor</span><b>{student.plan_value ? `R$ ${student.plan_value.toFixed(2).replace('.', ',')}` : '—'}</b></div>
        <div><span className="muted">Vencimento</span><b>{student.due_date ? fmtBR(student.due_date) : student.due_day ? `dia ${student.due_day}` : '—'}</b></div>
        <label className="f"><span>Próxima troca de treino</span>
          <input id="consult-change" type="date" value={student.next_change_date ?? ''} onChange={(e) => upd({ next_change_date: e.target.value || null })} />
        </label>
      </div>
      {student.plan_period && (
        <button type="button" className="btn sm link-btn" onClick={() => upd({ next_change_date: nextChangeAfter(student.plan_period!, next) })}>
          Enviei por fora do app · próxima troca {fmtBR(nextChangeAfter(student.plan_period, next)).slice(0, 5)}
        </button>
      )}
      {!student.plan_period && <div className="alert warn">Defina a periodicidade (Mensal, Quinzenal ou Semanal) para o app calcular a próxima semana e avisar a troca de treino.</div>}
    </div>
  )
}
