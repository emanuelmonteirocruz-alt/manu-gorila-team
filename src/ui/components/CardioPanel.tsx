import { useLiveQuery } from 'dexie-react-hooks'
import { Bike, ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { db, save, softDelete } from '../../data/db'
import { cardioOf, saveCardio, studentWeight } from '../../data/repo'
import { CARDIO_KINDS, DEFAULT_WEIGHT, INTENSITY_LABEL, cardioKcal, cardioMet, type CardioIntensity, type CardioKind } from '../../engine/cardio'
import { addDays, fmtBR, fmtNum, toISODate, weekStart } from '../../engine/metrics'
import type { Student } from '../../domain/types'

const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')))

/**
 * Cardio do aluno (consultoria e presencial): bicicleta, escada, esteira e elíptico com tempo e km.
 * Calorias por MET × peso × tempo (ACSM / Compendium). Resumo do dia, da semana e do mês (constância).
 */
export function CardioPanel({ student, date, compact }: { student: Student; date?: string; compact?: boolean }) {
  const today = date ?? toISODate(new Date())
  const [kind, setKind] = useState<CardioKind>('esteira')
  const [minutes, setMinutes] = useState('')
  const [km, setKm] = useState('')
  const [incline, setIncline] = useState('')
  const [intensity, setIntensity] = useState<CardioIntensity>('moderada')
  const [day, setDay] = useState(today)
  const [msg, setMsg] = useState('')
  const [weightEdit, setWeightEdit] = useState('')
  const [open, setOpen] = useState(false)
  const weight = useLiveQuery(() => studentWeight(student), [student.id, student.weight_kg, student.updated_at])
  const w = weight ?? DEFAULT_WEIGHT
  const month = today.slice(0, 7)
  const wk = weekStart(today)
  // do início do mês (ou da semana, se ela começou no mês anterior) até o fim do mês
  const list = useLiveQuery(() => cardioOf(student.id, [`${month}-01`, wk].sort()[0], addDays(today, 31)), [student.id, today]) ?? []
  // por enquanto o cardio é diário (como os treinos); semana e mês aparecem nos gráficos e PDFs
  const dayList = list.filter((c) => c.date === today)
  const dayKcal = Math.round(dayList.reduce((a, c) => a + (c.kcal ?? 0), 0))
  const input = { kind, minutes: num(minutes) ?? 0, km: num(km), incline: kind === 'esteira' ? num(incline) : null, intensity }
  const preview = input.minutes > 0 ? { ...cardioMet(input), kcal: cardioKcal(input, w) } : null
  const needsIntensity = !(input.km && (kind === 'esteira' || kind === 'bicicleta'))

  async function add() {
    if (!preview) return
    await saveCardio({ student_id: student.id, date: day, kind, minutes: input.minutes, km: input.km, incline: input.incline, intensity, met: preview.met, kcal: preview.kcal, notes: null })
    setMinutes(''); setKm(''); setIncline('')
    setMsg(`${CARDIO_KINDS.find((k) => k.id === kind)!.label}: ${preview.kcal} kcal registradas`)
    setTimeout(() => setMsg(''), 2500)
    setOpen(false)
  }

  return (
    <div className="card grid cardio-panel">
      <button type="button" className="cardio-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        <Bike size={18} strokeWidth={1.8} />
        <b>Cardio</b>
        <span className="muted">{dayList.length ? `${fmtBR(today).slice(0, 5)}: ${dayList.length} · ${fmtNum(dayKcal)} kcal` : 'nenhum hoje'}</span>
        <span className="btn sm" style={{ marginLeft: 'auto' }}>{open ? 'Fechar' : '+ Adicionar'}</span>
      </button>
      {msg && <span className="tag ok">{msg}</span>}
      {dayList.length > 0 && (
        <div className="cardio-list">
          {dayList.map((c) => (
            <div key={c.id} className="cardio-row">
              <span><b>{CARDIO_KINDS.find((k) => k.id === c.kind)?.label}</b> · {c.minutes} min{c.km ? ` · ${fmtNum(c.km, 1)} km` : ''}{c.incline ? ` · ${c.incline}%` : ''}</span>
              <span className="row" style={{ gap: 6 }}><b>{fmtNum(c.kcal ?? 0)} kcal</b>
                <button className="btn icon" aria-label="Excluir cardio" onClick={() => softDelete(db.cardio, c.id)}><Trash2 size={15} /></button></span>
            </div>
          ))}
        </div>
      )}
      {open && (<>
        <div className="chips">
          {CARDIO_KINDS.map((k) => <button key={k.id} type="button" className={`chip sm ${kind === k.id ? 'on' : ''}`} onClick={() => setKind(k.id)}>{k.label}</button>)}
        </div>
        <div className="cardio-form">
          <label className="f">Tempo (min)<input inputMode="decimal" value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="30" /></label>
          <label className="f">Distância (km)<input inputMode="decimal" value={km} onChange={(e) => setKm(e.target.value)} placeholder="opcional" /></label>
          {kind === 'esteira' && <label className="f">Inclinação (%)<input inputMode="decimal" value={incline} onChange={(e) => setIncline(e.target.value)} placeholder="0" /></label>}
          {!compact && <label className="f">Dia<input type="date" value={day} onChange={(e) => setDay(e.target.value || today)} /></label>}
        </div>
        {needsIntensity && (
          <div className="chips">
            {(['leve', 'moderada', 'intensa'] as CardioIntensity[]).map((i) => <button key={i} type="button" className={`chip sm ${intensity === i ? 'on' : ''}`} onClick={() => setIntensity(i)}>{INTENSITY_LABEL[i]}</button>)}
          </div>
        )}
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <span className="muted">{preview ? <>≈ <b>{preview.kcal} kcal</b> · {fmtNum(preview.met, 1)} MET · {preview.how}</> : 'Informe o tempo para calcular as calorias.'}</span>
          <button className="btn primary" disabled={!preview} onClick={add}>Registrar cardio</button>
        </div>
        <div className="muted">
          Peso usado: <b>{fmtNum(w, Number.isInteger(w) ? 0 : 1)} kg</b>{weight == null ? ' (padrão: informe o peso do aluno)' : student.weight_kg ? ' (ficha)' : ' (anamnese)'} ·{' '}
          <input className="weight-in" inputMode="decimal" placeholder="peso" value={weightEdit} onChange={(e) => setWeightEdit(e.target.value)} />{' '}
          <button className="btn sm" disabled={!num(weightEdit)} onClick={async () => { await save(db.students, { ...student, weight_kg: num(weightEdit) }); setWeightEdit('') }}>Salvar peso</button>
        </div>
        {!compact && <div className="muted">Calorias por MET (ACSM na esteira com km; Compendium of Physical Activities nos demais). O total da semana e do mês aparece na Evolução semanal e nos PDFs, somado ao gasto do treino.</div>}
      </>)}
    </div>
  )
}
