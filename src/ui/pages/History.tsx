import { topSetText } from '../format'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronDown, ChevronRight, FileText } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { db, softDelete } from '../../data/db'
import { getBrand } from '../../data/brand'
import { previousBests, treinoDoDiaExtras, profileLookup } from '../../data/repo'
import type { Session, SessionExercise } from '../../domain/types'
import { addDays, aggregateSessions, fmtBR, fmtNum, tonnage, toISODate } from '../../engine/metrics'
import { isHeavy } from '../../engine/prescription'
import { sharePdf, templateD } from '../../pdf/templates'
import { ConfirmButton, StudentSelect, useStudents } from '../components/common'
import { WeeklyTable } from '../components/WeeklyTable'

const SOURCE: Record<Session['source'], string> = { presencial: 'Presencial', whatsapp: 'WhatsApp', copiloto: 'Copiloto' }

/** Histórico de todos os treinos: filtros por aluno/período, detalhe série a série, PDF e exclusão. */
export default function History() {
  const [params] = useSearchParams()
  const [studentId, setStudentId] = useState(params.get('aluno') ?? '')
  const [from, setFrom] = useState(addDays(toISODate(new Date()), -60))
  const [to, setTo] = useState(toISODate(new Date()))
  const [open, setOpen] = useState<string | null>(null)
  const students = useStudents()
  const [emph, setEmph] = useState(false)
  const student = students.find((s) => s.id === studentId)
  const hideKg = student?.modality === 'online' // consultoria: nada de carga em kg
  const name = (id: string) => students.find((s) => s.id === id)?.full_name ?? '—'

  const data = useLiveQuery(async () => {
    const lookup = await profileLookup()
    const ratings = (await db.ratings.toArray()).filter((r) => !r._deleted)
    const all = (await db.sessions.where('date').between(from, to, true, true).toArray())
      .filter((s) => !s._deleted && (!studentId || s.student_id === studentId))
      .sort((a, b) => (b.date + b.created_at).localeCompare(a.date + a.created_at))
    return all.map((s) => {
      const rs = ratings.filter((r) => r.session_id === s.id)
      const pse = (rs.find((r) => r.reported_by === 'student') ?? rs[0])?.pse ?? null
      return { s, agg: aggregateSessions([s], lookup), pse }
    })
  }, [studentId, from, to])

  const totals = useMemo(() => {
    const rows = data ?? []
    return {
      n: rows.length,
      valid: rows.reduce((a, r) => a + r.agg.validSets, 0),
      heavy: rows.reduce((a, r) => a + r.agg.heavySets, 0),
      ton: rows.reduce((a, r) => a + r.agg.tonnageKg, 0),
      idx: rows.length ? Math.round(rows.reduce((a, r) => a + r.agg.intensityPrescribed, 0) / rows.length) : 0,
      kcal: rows.reduce((a, r) => a + r.agg.kcal, 0),
    }
  }, [data])

  return (
    <>
      <div className="page-head">
        <div><h1>Histórico de treinos</h1><div className="muted">Todos os treinos registrados, com séries, intensidade e (no presencial) cargas e tonelagem</div></div>
      </div>
      <div className="card grid cols-3" style={{ marginBottom: 14 }}>
        <StudentSelect value={studentId} onChange={setStudentId} placeholder="Todos os alunos" />
        <label className="f">De<input id="hist-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="f">Até<input id="hist-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <div className="card kpi"><div className="v">{totals.n}</div><div className="l">treinos no período</div></div>
        <div className="card kpi"><div className="v">{totals.valid} <small className="muted">/ {totals.heavy} pes.</small></div><div className="l">séries válidas / pesadas</div></div>
        {hideKg
          ? <div className="card kpi"><div className="v">{totals.idx}/100</div><div className="l">intensidade prescrita média</div></div>
          : <div className="card kpi"><div className="v">{fmtNum(totals.ton)} kg</div><div className="l">tonelagem total</div></div>}
        <div className="card kpi"><div className="v">{fmtNum(totals.kcal)}</div><div className="l">kcal estimadas</div></div>
      </div>
      {student && <div style={{ marginBottom: 14 }}><WeeklyTable student={student} emph={emph} /></div>}
      {student && <label className="row muted" style={{ marginBottom: 14 }}><input type="checkbox" checked={emph} onChange={(e) => setEmph(e.target.checked)} /> Especificar musculatura com mais intensidade e volume</label>}
      <div className="card scroll-x">
        <h2>Treinos</h2>
        <table className="t">
          <thead><tr><th>Data</th>{!studentId && <th>Aluno</th>}<th>Treino</th><th>Origem</th><th>Válidas</th><th>Pesadas</th><th>Intensidade</th>{!hideKg && <th>Tonelagem</th>}<th>kcal</th><th>PSE</th><th></th></tr></thead>
          <tbody>
            {data?.map(({ s, agg, pse }) => (
              <HistoryRow key={s.id} s={s} agg={agg} pse={pse} showStudent={!studentId} student={name(s.student_id)} hideKg={hideKg}
                online={students.find((x) => x.id === s.student_id)?.modality === 'online'}
                open={open === s.id} onToggle={() => setOpen(open === s.id ? null : s.id)} />
            ))}
            {data && !data.length && <tr><td colSpan={11} className="muted">Nenhum treino neste período.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}

function HistoryRow({ s, agg, pse, showStudent, student, open, onToggle, hideKg, online }: {
  s: Session; agg: ReturnType<typeof aggregateSessions>; pse: number | null; showStudent: boolean; student: string; open: boolean; onToggle: () => void
  hideKg: boolean; online: boolean
}) {
  return (
    <>
      <tr className="click" onClick={onToggle}>
        <td><span className="row" style={{ gap: 6 }}>{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}{fmtBR(s.date)}</span></td>
        {showStudent && <td><Link to={`/alunos/${s.student_id}`} onClick={(e) => e.stopPropagation()}>{student}</Link></td>}
        <td>{s.label}</td>
        <td><span className={`tag src-${s.source}`}>{SOURCE[s.source]}</span></td>
        <td><b>{agg.validSets}</b></td>
        <td>{agg.heavySets}</td>
        <td><b>{online ? agg.intensityPrescribed : agg.intensityReal}</b></td>
        {!hideKg && <td>{!online && agg.tonnageKg ? `${fmtNum(agg.tonnageKg)} kg` : ''}</td>}
        <td>{fmtNum(agg.kcal)}</td>
        <td>{pse ?? '—'}</td>
        <td className="muted">{s.exercises.length ? `${s.exercises.length} exerc.` : 'vazio'}</td>
      </tr>
      {open && (
        <tr><td colSpan={11}>
          <div className="grid" style={{ padding: '6px 0' }}>
            {s.exercises.map((e) => <ExerciseLine key={e.id} e={e} />)}
            {!s.exercises.length && <div className="muted">Treino sem exercícios registrados.</div>}
            <div className="row">
              <button className="btn" onClick={async () => {
                const st = await db.students.get(s.student_id)
                const lookup = await profileLookup()
                const ex = st ? await treinoDoDiaExtras(st, s) : { phase: null, challenge: undefined, last: {}, cardio: null, prevSame: null, lastTop: {} }
                const d = templateD(s, lookup, pse, { studentName: st?.full_name, showName: true, showEmphasis: false, brand: await getBrand(), modality: st?.modality, phase: ex.phase, challenge: ex.challenge, cardio: ex.cardio, prevSame: ex.prevSame, lastTop: ex.lastTop }, await previousBests(s.student_id, s), ex.last)
                await sharePdf(d, `treino-${(st?.full_name ?? 'aluno').split(' ')[0].toLowerCase()}-${s.date}.pdf`)
              }}><FileText size={16} strokeWidth={1.8} /> PDF do treino</button>
              <ConfirmButton label="Excluir treino" confirmLabel="Confirmar exclusão do treino" onConfirm={() => softDelete(db.sessions, s.id)} />
            </div>
          </div>
        </td></tr>
      )}
    </>
  )
}

export function ExerciseLine({ e }: { e: SessionExercise }) {
  const unit = e.per_side ? 'kg/lado' : 'kg'
  const t = tonnage(e)
  return (
    <div className="done-card">
      <div className="set-head">
        <b>{e.display_name}</b>
        <span className="set-sum">
          {[e.warmup_sets ? `${e.warmup_sets} aquec.` : '', e.valid_sets ? `${e.valid_sets} válidas` : ''].filter(Boolean).join(' + ')}
          {e.heavy_sets ? ` • ${e.heavy_sets} pesadas` : ''}
          {e.load_kg ? ` • Maior: ${topSetText(Array.from({ length: e.valid_sets }, (_, i) => e.loads?.[i] ?? e.load_kg), e.reps, !!e.per_side)}` : ''}
          {t ? ` • ${fmtNum(t)} kg total` : ''}
        </span>
      </div>
      <div className="chips">
        {(e.warmup_detail ?? []).map((w, i) => (
          <span key={`w${i}`} className="tag">Aq{i + 1} · {w.reps.min === w.reps.max ? w.reps.min : `${w.reps.min}–${w.reps.max}`}{w.kg != null ? ` × ${fmtNum(w.kg, Number.isInteger(w.kg) ? 0 : 1)} ${unit}` : ''}</span>
        ))}
        {Array.from({ length: e.valid_sets }, (_, i) => {
          const r = e.reps[i]
          const kg = e.loads?.[i] ?? e.load_kg
          const reps = !r ? '' : r.failure ? 'Máx' : r.min === r.max ? `${r.min}` : `${r.min}–${r.max}`
          const heavy = !!r && isHeavy(r)
          return <span key={i} className={`tag ${heavy ? 'warn' : ''}`}>S{i + 1} · {reps ? `${reps} × ` : ''}{kg != null ? `${fmtNum(kg, Number.isInteger(kg) ? 0 : 1)} ${unit}` : '—'}{heavy ? ' · pesada' : ''}</span>
        })}
      </div>
    </div>
  )
}
