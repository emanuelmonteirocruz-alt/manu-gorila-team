import { Plus, Save, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { db, save, uid } from '../../data/db'
import { profileLookup, saveRating } from '../../data/repo'
import { resolveProfiles } from '../../engine/classifier'
import { isHeavy } from '../../engine/prescription'
import { detectMuscleGroups } from '../../engine/sessionGroups'
import type { RepRange, Session, SessionExercise } from '../../domain/types'
import { ExerciseNameInput } from './ExerciseNameInput'

interface Row { reps: string; kg: string; heavy?: boolean; orig?: string }
interface ExEdit { id: string; name: string; original: SessionExercise; perSide: boolean; rows: Row[] }

const repsTxt = (r?: RepRange) => (!r ? '' : r.failure ? 'Máx' : r.min === r.max ? String(r.min) : `${r.min}-${r.max}`)
const kgTxt = (k: number | null | undefined) => (k == null ? '' : String(k).replace('.', ','))
function parseReps(v: string, heavy?: boolean): RepRange {
  const t = v.trim().toLowerCase()
  if (/^(m[aá]x|falha|f)/.test(t)) return { min: 10, max: 12, failure: true, ...(heavy !== undefined ? { heavy } : {}) }
  const m = t.match(/(\d+)\s*(?:-|a|até|–)?\s*(\d+)?/)
  const min = m ? Number(m[1]) : 10
  const max = m ? Number(m[2] ?? m[1]) : min
  return { min, max: Math.max(min, max), ...(heavy !== undefined ? { heavy } : {}) }
}
const toEdit = (e: SessionExercise): ExEdit => ({
  id: e.id, name: e.display_name, original: e, perSide: !!e.per_side,
  rows: Array.from({ length: e.valid_sets }, (_, i) => {
    const r = e.reps[i] ?? e.reps[e.reps.length - 1]
    return { reps: repsTxt(r), kg: kgTxt(e.loads?.[i] ?? e.load_kg), heavy: r?.heavy, orig: repsTxt(r) }
  }),
})

/**
 * Editar um treino já encerrado (presencial): corrigir carga/reps digitadas errado, apagar ou somar séries,
 * trocar o exercício e a PSE. Volume, quilos levantados, recordes e progressão de carga são recalculados.
 */
export function SessionEditor({ session, pse, onClose }: { session: Session; pse: number | null; onClose: () => void }) {
  const [list, setList] = useState<ExEdit[]>(() => session.exercises.map(toEdit))
  const [pseV, setPse] = useState<number | null>(pse)
  const [busy, setBusy] = useState(false)
  const upd = (id: string, patch: Partial<ExEdit>) => setList((l) => l.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  const updRow = (id: string, i: number, patch: Partial<Row>) => setList((l) => l.map((x) => (x.id === id ? { ...x, rows: x.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) } : x)))

  async function doSave() {
    setBusy(true)
    try {
      const renamed = list.filter((x) => x.name.trim() && x.name.trim() !== x.original.display_name).map((x) => x.name.trim())
      const profiles = renamed.length ? await resolveProfiles(renamed, session.muscle_groups, renamed.join('; ')) : new Map()
      const exercises: SessionExercise[] = list.filter((x) => x.rows.length || x.original.warmup_sets).map((x, position) => {
        // marcação manual de "pesada" só vale se as reps não mudaram
        const reps = x.rows.map((r) => parseReps(r.reps, r.reps === r.orig ? r.heavy : undefined))
        const loads = x.rows.map((r) => (r.kg.trim() === '' ? null : Number(r.kg.replace(',', '.'))))
        const hasLoads = loads.some((k) => k != null && !Number.isNaN(k))
        const work = loads.filter((k): k is number => k != null && !Number.isNaN(k))
        const p = profiles.get(x.name.trim())
        return {
          ...x.original,
          position,
          exercise_key: p?.key ?? x.original.exercise_key,
          display_name: p?.name ?? x.original.display_name,
          valid_sets: x.rows.length,
          heavy_sets: reps.filter(isHeavy).length,
          reps,
          loads: hasLoads ? loads.map((k) => (k == null || Number.isNaN(k) ? null : k)) : undefined,
          load_kg: work.length ? Math.max(...work) : null,
          per_side: x.perSide,
        }
      })
      const detected = detectMuscleGroups(exercises, await profileLookup())
      await save(db.sessions, { ...session, exercises, muscle_groups: detected.length ? detected : session.muscle_groups })
      if (pseV != null && pseV !== pse) await saveRating(session.id, pseV)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid session-editor">
      <div className="muted">Corrija o que precisar e toque em <b>Salvar alterações</b>. Volume, quilos levantados, recordes e progressão de carga são recalculados.</div>
      {list.map((x) => (
        <div key={x.id} className="set-card">
          <div className="set-head">
            <ExerciseNameInput className="set-name" value={x.name} onChange={(v) => upd(x.id, { name: v })} groups={session.muscle_groups} />
            <label className="row muted" style={{ gap: 6 }}><input type="checkbox" checked={x.perSide} onChange={(e) => upd(x.id, { perSide: e.target.checked })} /> por lado</label>
            <button className="btn danger icon" aria-label="Remover exercício" onClick={() => setList((l) => l.filter((y) => y.id !== x.id))}><Trash2 size={16} /></button>
          </div>
          {x.original.warmup_sets > 0 && <div className="muted">{x.original.warmup_sets} {x.original.warmup_sets === 1 ? 'série' : 'séries'} de aquecimento (não entram no volume)</div>}
          <div className="edit-rows">
            {x.rows.map((r, i) => (
              <div key={i} className="edit-row">
                <span className="set-n">Série {i + 1}</span>
                <label className="f"><span>reps</span><input value={r.reps} onChange={(e) => updRow(x.id, i, { reps: e.target.value })} placeholder="10 ou Máx" /></label>
                <label className="f"><span>{x.perSide ? 'kg/lado' : 'kg'}</span><input inputMode="decimal" value={r.kg} onChange={(e) => updRow(x.id, i, { kg: e.target.value })} /></label>
                <button className="btn icon" aria-label={`Remover série ${i + 1}`} onClick={() => upd(x.id, { rows: x.rows.filter((_, j) => j !== i) })}><X size={16} /></button>
              </div>
            ))}
          </div>
          <div><button className="btn sm" onClick={() => upd(x.id, { rows: [...x.rows, { ...(x.rows[x.rows.length - 1] ?? { reps: '10', kg: '' }) }] })}><Plus size={14} /> Série</button></div>
        </div>
      ))}
      <button className="btn" onClick={() => setList((l) => [...l, { id: uid(), name: '', perSide: false, rows: [{ reps: '10', kg: '' }], original: { id: uid(), position: l.length, exercise_key: '', display_name: '', valid_sets: 0, warmup_sets: 0, heavy_sets: 0, reps: [], drop_set: false } }])}>
        <Plus size={16} /> Adicionar exercício
      </button>
      <div className="grid" style={{ gap: 6 }}>
        <span className="muted" style={{ fontWeight: 600 }}>PSE do treino</span>
        <div className="pse">{Array.from({ length: 11 }, (_, i) => <button key={i} className={pseV === i ? 'on' : ''} onClick={() => setPse(i)}>{i}</button>)}</div>
      </div>
      <div className="row">
        <button className="btn primary" disabled={busy || list.some((x) => !x.name.trim())} onClick={doSave}><Save size={16} strokeWidth={1.8} /> Salvar alterações</button>
        <button className="btn" onClick={onClose}>Cancelar</button>
      </div>
    </div>
  )
}

/**
 * Edição rápida das séries de UM exercício, no próprio card (sem tirar o exercício do lugar):
 * reps e carga de cada série, apagar ou somar série. Nome, aquecimento, observações e drop ficam como estão.
 */
export function InlineSetsEditor({ exercise, onSave, onCancel }: { exercise: SessionExercise; onSave: (e: SessionExercise) => void | Promise<void>; onCancel: () => void }) {
  const [rows, setRows] = useState<Row[]>(() => toEdit(exercise).rows)
  const unit = exercise.per_side ? 'kg/lado' : 'kg'
  const put = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  function save() {
    const reps = rows.map((r) => parseReps(r.reps, r.reps === r.orig ? r.heavy : undefined))
    const loads = rows.map((r) => (r.kg.trim() === '' ? null : Number(r.kg.replace(',', '.'))))
    const work = loads.filter((k): k is number => k != null && !Number.isNaN(k))
    return onSave({
      ...exercise,
      valid_sets: rows.length,
      heavy_sets: reps.filter(isHeavy).length,
      reps,
      loads: work.length ? loads.map((k) => (k == null || Number.isNaN(k) ? null : k)) : undefined,
      load_kg: work.length ? Math.max(...work) : exercise.load_kg ?? null,
    })
  }
  return (
    <div className="grid inline-edit" style={{ gap: 6 }}>
      {rows.map((r, i) => (
        <div key={i} className="edit-row">
          <span className="set-n">S{i + 1}</span>
          <label className="f"><span>reps</span><input value={r.reps} onChange={(e) => put(i, { reps: e.target.value })} placeholder="10 ou Máx" /></label>
          <label className="f"><span>{unit}</span><input inputMode="decimal" value={r.kg} onChange={(e) => put(i, { kg: e.target.value })} /></label>
          <button className="btn icon" aria-label={`Remover série ${i + 1}`} onClick={() => setRows((x) => x.filter((_, j) => j !== i))}><X size={16} /></button>
        </div>
      ))}
      <div className="row">
        <button className="btn sm" onClick={() => setRows((x) => [...x, { ...(x[x.length - 1] ?? { reps: '10', kg: '' }), orig: undefined }])}><Plus size={14} /> Série</button>
        <button className="btn primary sm" disabled={!rows.length} onClick={save}><Save size={14} /> Salvar</button>
        <button className="btn sm" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  )
}
