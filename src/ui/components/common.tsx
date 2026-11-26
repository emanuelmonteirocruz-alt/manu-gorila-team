import { useLiveQuery } from 'dexie-react-hooks'
import { AlertCircle, Bell, Check, Lock } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { db } from '../../data/db'
import { clearCheckin, deleteStudent, getCheckin, getWeekContext, saveCheckin, saveStudent, upsertWeekContext } from '../../data/repo'
import { changeStatus } from '../../domain/plan'
import { titleCase } from '../format'
import {
  DIET_LABEL, MICRO_LABEL, MUSCLE_GROUPS, SLEEP_LABEL, type SleepQuality, type DietPhase, type Microcycle, type Modality, type Student, type WeekContext,
} from '../../domain/types'
import { addDays, computeHourlyRate, fmtBR, toISODate } from '../../engine/metrics'
import { PERIOD_LABEL, suggestNextChange, type PlanPeriod } from '../../domain/plan'

export function MicroTag({ m, blocked }: { m?: Microcycle | null; blocked?: boolean }) {
  if (!m) return <span className="tag">—</span>
  return <span className={`tag ${m}`}>{MICRO_LABEL[m]}{blocked ? <Lock size={11} /> : null}</span>
}

export function useStudents(modality?: Modality) {
  return useLiveQuery(async () => {
    const all = await db.students.toArray()
    return all
      .filter((s) => !s._deleted && !s.archived && (!modality || s.modality === modality))
      .map((s) => ({ ...s, full_name: titleCase(s.full_name) })) // exibição sempre com maiúscula
      .sort((a, b) => a.full_name.localeCompare(b.full_name))
  }, [modality]) ?? []
}

export function StudentSelect({ value, onChange, modality, placeholder = 'Selecione…' }: { value?: string; onChange: (id: string) => void; modality?: Modality; placeholder?: string }) {
  const list = useStudents(modality)
  return (
    <label className="f">
      Aluno
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">{placeholder}</option>
        {list.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
      </select>
    </label>
  )
}

export function StudentForm({ initial, onSaved, onDeleted }: { initial: Student; onSaved?: (s: Student) => void; onDeleted?: () => void }) {
  // Estado local do formulário; o pai usa key={student.id} para reiniciar ao trocar de aluno.
  const [s, setS] = useState(initial)
  const latest = useRef(s)
  latest.current = s
  const [status, setStatus] = useState<string | null>(null)
  const set = <K extends keyof Student>(k: K, v: Student[K]) => {
    setStatus(null)
    setS((x) => ({ ...x, [k]: v }))
  }
  const auto = computeHourlyRate(s.plan_value, s.weekly_frequency)
  const num = (v: string) => (v === '' ? undefined : Number(v))
  return (
    <form
      className="grid"
      onSubmit={async (e) => {
        e.preventDefault()
        const cur = latest.current
        if (!cur.full_name.trim()) return setStatus('Informe o nome do aluno.')
        if (cur.modality === 'online' && !cur.plan_period) return setStatus('Escolha o tipo do plano: Mensal, Quinzenal ou Semanal.')
        try {
          const saved = await saveStudent(cur)
          setStatus('Alterações salvas com sucesso!')
          onSaved?.(saved)
        } catch (err) {
          setStatus(`Não foi possível salvar: ${(err as Error).message}`)
        }
      }}
    >
      <label className="f" style={{ maxWidth: 360 }}>Modalidade
        <select id="st-modality" value={s.modality} onChange={(e) => set('modality', e.target.value as Modality)}>
          <option value="online">Consultoria Online</option><option value="presencial">Personal Presencial</option>
        </select>
      </label>
      <div className="grid cols-3">
        <label className="f">Nome completo<input id="st-name" required value={s.full_name} onChange={(e) => set('full_name', e.target.value)} /></label>
        <label className="f">WhatsApp<input id="st-phone" inputMode="tel" value={s.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></label>
        {s.modality === 'presencial' && (
          <label className="f">Sexo biológico
            <select id="st-sex" value={s.sex} onChange={(e) => set('sex', e.target.value as Student['sex'])}>
              <option value="F">Feminino</option><option value="M">Masculino</option>
            </select>
          </label>
        )}
        <label className="f">{s.modality === 'online' ? 'Nome do plano' : 'Plano'}<input id="st-plan" value={s.plan_name ?? ''} onChange={(e) => set('plan_name', e.target.value)} /></label>
        {s.modality === 'online' ? (
          <label className="f">Tipo / frequência do plano *
            <select id="st-period" value={s.plan_period ?? ''} onChange={(e) => {
              const p = (e.target.value || null) as PlanPeriod | null
              setStatus(null)
              // sugere a próxima troca pela periodicidade (pode ajustar à mão)
              setS((x) => ({ ...x, plan_period: p, next_change_date: p ? suggestNextChange(p) : x.next_change_date }))
            }}>
              <option value="">Selecione…</option>
              {(Object.keys(PERIOD_LABEL) as PlanPeriod[]).map((p) => <option key={p} value={p}>{PERIOD_LABEL[p]}</option>)}
            </select>
          </label>
        ) : (
          <label className="f">Frequência semanal<input id="st-freq" type="number" min={1} max={7} value={s.weekly_frequency ?? ''} onChange={(e) => set('weekly_frequency', num(e.target.value))} /></label>
        )}
        <label className="f">Valor do plano (R$)<input id="st-value" type="number" step="0.01" value={s.plan_value ?? ''} onChange={(e) => set('plan_value', num(e.target.value))} /></label>
        {s.modality === 'presencial' && (
          <label className="f">Valor hora/aula (R$)
            <input
              id="st-hourly" type="number" step="0.01"
              value={s.hourly_rate_manual ? s.hourly_rate ?? '' : auto ?? ''}
              placeholder="automático"
              onChange={(e) => setS((x) => ({ ...x, hourly_rate: num(e.target.value) ?? null, hourly_rate_manual: e.target.value !== '' }))}
            />
            <span className="muted">{s.hourly_rate_manual ? 'Editado manualmente' : 'Calculado: plano ÷ sessões no mês'}</span>
          </label>
        )}
        <label className="f">Data de vencimento<input id="st-due" type="date" value={s.due_date ?? ''} onChange={(e) => set('due_date', e.target.value || null)} /></label>
        {s.modality === 'online' && (
          <label className="f">Data de troca de treino
            <input id="st-change" type="date" value={s.next_change_date ?? ''} onChange={(e) => set('next_change_date', e.target.value || null)} />
            <span className="muted">{s.plan_period ? `Sugestão (${PERIOD_LABEL[s.plan_period]}): ${fmtBR(suggestNextChange(s.plan_period))} — ajuste se quiser` : 'Escolha a frequência para sugerir a data'}</span>
          </label>
        )}
        <label className="f">Status de pagamento
          <select id="st-pay" value={s.payment_status} onChange={(e) => set('payment_status', e.target.value as Student['payment_status'])}>
            <option value="em_dia">Em dia</option><option value="pendente">Pendente</option><option value="atrasado">Atrasado</option>
          </select>
        </label>
      </div>
      <div className="grid" style={{ gap: 6 }}>
        <span className="muted" style={{ fontWeight: 600 }}>Ênfase desejada (opcional): o foco que você quer para este aluno</span>
        <div className="chips">
          {MUSCLE_GROUPS.map((g) => {
            const on = (s.emphasis ?? []).includes(g)
            return <button key={g} type="button" className={`chip sm ${on ? 'on' : ''}`} onClick={() => setS((x) => ({ ...x, emphasis: on ? (x.emphasis ?? []).filter((y) => y !== g) : [...(x.emphasis ?? []), g] }))}>{g.replace('Perna - ', '')}</button>
          })}
        </div>
        <span className="muted">Só para você: a ficha compara com o foco medido no que você prescreveu. Na montagem automática de treinos, é esta ênfase que será seguida. Os relatórios do aluno mostram sempre o foco medido.</span>
      </div>
      <div className="row">
        <button className="btn primary big" type="submit">Salvar aluno</button>
        {status && <span className={status.startsWith('Alterações salvas') ? 'tag regenerativa' : 'tag choque'}>{status}</span>}
        {onDeleted && (
          <span style={{ marginLeft: 'auto' }}>
            <ConfirmButton label="Excluir aluno" confirmLabel="Deseja realmente excluir este aluno? Toque para confirmar" onConfirm={async () => {
              await deleteStudent(initial.id)
              onDeleted()
            }} />
          </span>
        )}
      </div>
    </form>
  )
}

/** Contexto fisiológico da semana: dieta, ciclo menstrual (só F), microciclo planejado com trava. */
export function WeekContextEditor({ student, week }: { student: Student; week: string }) {
  const ctx = useLiveQuery(() => getWeekContext(student.id, week), [student.id, week])
  // sem contexto nesta semana: mostra a dieta da semana anterior (é a que será herdada)
  const prev = useLiveQuery(() => getWeekContext(student.id, addDays(week, -7)), [student.id, week])
  const diet = ctx?.diet ?? prev?.diet ?? 'manutencao'
  const upd = (patch: Partial<WeekContext>) => upsertWeekContext(student.id, week, patch)
  const blocked = student.sex === 'F' && ctx?.menstrual
  return (
    <div className="card grid">
      <h2>Contexto da semana {fmtBR(week)}</h2>
      <div className="muted">Fase da dieta</div>
      <div className="chips">
        {(Object.keys(DIET_LABEL) as DietPhase[]).map((d) => (
          <button key={d} type="button" className={`chip sm ${diet === d ? 'on' : ''}`} onClick={() => upd({ diet: d })}>{DIET_LABEL[d]}</button>
        ))}
      </div>
      {student.sex === 'F' && (
        <>
          <div className="muted">Ciclo menstrual</div>
          <div className="chips">
            <button type="button" className={`chip sm ${ctx?.menstrual ? 'on' : ''}`} onClick={() => upd({
              menstrual: !ctx?.menstrual,
              ...(ctx?.menstrual ? {} : { planned_microcycle: ctx?.planned_microcycle === 'choque' ? 'regenerativa' : ctx?.planned_microcycle, justification: 'Semana menstrual — queda prevista de rendimento' }),
            })}>
              {ctx?.menstrual ? <><Check size={14} /> Semana menstrual</> : 'Marcar semana menstrual'}
            </button>
          </div>
        </>
      )}
      <div className="muted">Microciclo planejado</div>
      <div className="chips">
        {(['regenerativa', 'ordinaria', 'choque'] as Microcycle[]).map((m) => (
          <button key={m} type="button" disabled={m === 'choque' && !!blocked}
            className={`chip sm ${ctx?.planned_microcycle === m ? 'on' : ''}`} onClick={() => upd({ planned_microcycle: m })}>
            {MICRO_LABEL[m]}{m === 'choque' && blocked ? <Lock size={13} /> : null}
          </button>
        ))}
      </div>
      {blocked && <div className="alert warn">Semana menstrual: Choque bloqueado. Direcionado para Regenerativa / controle de carga — justificativa registrada nos gráficos.</div>}
    </div>
  )
}

/** Confirmação em dois toques (sem diálogos nativos — funciona em qualquer navegador/iframe). */
export function ConfirmButton({ label, confirmLabel = 'Toque de novo para confirmar', onConfirm, disabled, className = 'btn danger' }: {
  label: ReactNode; confirmLabel?: string; onConfirm: () => void | Promise<unknown>; disabled?: boolean; className?: string
}) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(t)
  }, [armed])
  return (
    <button type="button" className={className} disabled={disabled} onClick={async () => {
      if (!armed) return setArmed(true)
      setArmed(false)
      await onConfirm()
    }}>{armed ? confirmLabel : label}</button>
  )
}

/** Check-in de sono do dia (marca, troca e desmarca). */
export function SleepCheckin({ student }: { student: Student }) {
  const today = toISODate(new Date())
  const cur = useLiveQuery(() => getCheckin(student.id, today), [student.id, today])
  return (
    <div className="card grid">
      <h2>Qualidade do sono — hoje</h2>
      <div className="muted">{cur ? `Registrado: ${SLEEP_LABEL[cur.sleep]} (toque de novo para desmarcar)` : 'Toque em uma opção para registrar.'}</div>
      <div className="chips">
        {(Object.keys(SLEEP_LABEL) as SleepQuality[]).map((q) => (
          <button key={q} type="button" aria-pressed={cur?.sleep === q} className={`chip ${cur?.sleep === q ? 'on' : ''}`}
            onClick={() => (cur?.sleep === q ? clearCheckin(student.id, today) : saveCheckin(student.id, today, q))}>
            {cur?.sleep === q ? <Check size={15} /> : null}{SLEEP_LABEL[q]}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Sino de troca de treino (consultoria). */
/** Mensalidade atrasada: selo vermelho bem visível (usa o status de pagamento já existente). */
export function PayBadge({ student }: { student: Pick<Student, 'payment_status'> }) {
  if (student.payment_status !== 'atrasado') return null
  return <span className="tag pay-late" title="Mensalidade atrasada"><AlertCircle size={12} strokeWidth={2.2} /> Atrasado</span>
}

export function ChangeBadge({ student }: { student: Student }) {
  const st = changeStatus(student)
  if (!st) return null
  return <span className={`tag ${st.level === 'proximo' ? 'warn' : 'danger'}`} title="Troca de treino"><Bell size={11} /> {st.label}</span>
}
