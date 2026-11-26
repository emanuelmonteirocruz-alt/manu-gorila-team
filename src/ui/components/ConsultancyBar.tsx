import { saveStudent } from '../../data/repo'
import { Bell, Check } from 'lucide-react'
import { PERIOD_LABEL, changeStatus, suggestNextChange, type PlanPeriod } from '../../domain/plan'
import type { Student } from '../../domain/types'
import { fmtBR } from '../../engine/metrics'

/**
 * Barra de contexto da consultoria: periodicidade (troca rápida), valor, vencimento
 * e data de troca de treino com alerta. "Treino enviado" agenda a próxima troca.
 */
export function ConsultancyBar({ student }: { student: Student }) {
  const st = changeStatus(student)
  const upd = (patch: Partial<Student>) => saveStudent({ ...student, ...patch })
  return (
    <div className={`card grid consult-bar ${st ? `alert-${st.level}` : ''}`}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <b style={{ fontSize: 17 }}>{student.full_name}</b>
          <div className="muted">{student.plan_name || 'Consultoria Online'}{student.phone ? ` · ${student.phone}` : ''}</div>
        </div>
        <div className="chips">
          {(Object.keys(PERIOD_LABEL) as PlanPeriod[]).map((p) => (
            <button key={p} type="button" className={`chip sm ${student.plan_period === p ? 'on' : ''}`}
              onClick={() => upd({ plan_period: p, next_change_date: suggestNextChange(p) })}>{PERIOD_LABEL[p]}</button>
          ))}
        </div>
      </div>
      <div className="consult-facts">
        <div><span className="muted">Valor</span><b>{student.plan_value ? `R$ ${student.plan_value.toFixed(2).replace('.', ',')}` : '—'}</b></div>
        <div><span className="muted">Vencimento</span><b>{student.due_date ? fmtBR(student.due_date) : student.due_day ? `dia ${student.due_day}` : '—'}</b></div>
        <label className="f"><span>Troca de treino</span>
          <input id="consult-change" type="date" value={student.next_change_date ?? ''} onChange={(e) => upd({ next_change_date: e.target.value || null })} />
        </label>
        <div className="row" style={{ alignSelf: 'end', gap: 8 }}>
          {st && <span className={`tag ${st.level === 'proximo' ? 'warn' : 'danger'}`}><Bell size={12} /> {st.label}</span>}
          {student.plan_period && (
            <button type="button" className="btn ok" onClick={() => upd({ next_change_date: suggestNextChange(student.plan_period!) })}>
              <Check size={16} /> Treino enviado · próxima {fmtBR(suggestNextChange(student.plan_period))}
            </button>
          )}
        </div>
      </div>
      {!student.plan_period && <div className="alert warn">Defina a periodicidade (Mensal, Quinzenal ou Semanal) para receber o aviso de troca de treino.</div>}
    </div>
  )
}
