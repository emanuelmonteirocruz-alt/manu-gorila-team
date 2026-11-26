import { useLiveQuery } from 'dexie-react-hooks'
import { cardioSummary, lastNWeeks, weekPoints } from '../../data/repo'
import { addDays } from '../../engine/metrics'
import type { Student } from '../../domain/types'
import { dominantGroup, fmtBR, fmtNum, fmtPct } from '../../engine/metrics'
import { MicroTag } from './common'

/** Recálculo semanal do aluno (volume, intensidade, tonelagem, kcal, PSE, microciclo). */
export function WeeklyTable({ student, emph = false, weeks = 8 }: { student: Student; emph?: boolean; weeks?: number }) {
  // só as semanas que têm treino (sem linhas zeradas de antes do histórico)
  const points = useLiveQuery(async () => {
    const all = await weekPoints(student, lastNWeeks(weeks))
    const withCardio = await Promise.all(all.map(async (p) => ({ ...p, cardio: await cardioSummary(student.id, p.week, addDays(p.week, 6)) })))
    return withCardio.filter((p) => p.agg.sessions > 0 || p.cardio.sessions > 0)
  }, [student.id, student.updated_at, weeks])
  const online = student.modality === 'online'
  return (
    <div className="card scroll-x">
      <h2>Evolução semanal</h2>
      {points && !points.length ? <div className="muted">Ainda sem treinos nas últimas {weeks} semanas.</div> : (
      <table className="t">
        <thead><tr><th>Semana</th><th>Sessões</th><th>Válidas</th><th>Pesadas</th><th>% pesadas</th><th>Índice de intensidade</th><th>Multi/Mono</th><th>Livre/Máq</th>{!online && <th>Tonelagem</th>}<th>kcal</th><th>kcal/treino</th><th>Gordura eq.</th><th>Cardio</th><th>PSE</th><th>Microciclo</th>{emph && <th>Ênfase</th>}</tr></thead>
        <tbody>
          {points?.map((p) => (
            <tr key={p.week}>
              <td>{fmtBR(p.week)}{p.ctx?.menstrual ? <span className="tag danger" style={{ marginLeft: 6 }}>ciclo</span> : null}</td><td>{p.agg.sessions}</td><td><b>{p.agg.validSets}</b></td>
              <td>{p.agg.heavySets}</td><td>{fmtPct(p.agg.heavyPct)}</td><td><b>{p.agg.sessions ? (online ? p.agg.intensityPrescribed : p.agg.intensityReal) : '—'}</b></td>
              <td>{p.agg.multiSets}/{p.agg.monoSets}</td><td>{p.agg.freeSets}/{p.agg.machineSets}</td>
              {!online && <td>{p.agg.tonnageKg ? `${fmtNum(p.agg.tonnageKg)} kg` : '—'}</td>}<td>{fmtNum(p.agg.kcal)}</td><td>{p.agg.sessions ? fmtNum(p.agg.kcal / p.agg.sessions) : '—'}</td><td>{fmtNum(p.agg.fatGrams)} g</td><td>{p.cardio.sessions ? `${fmtNum(p.cardio.kcal)} kcal · ${p.cardio.days}d` : '—'}</td>
              <td>{p.agg.avgPse?.toFixed(1) ?? '—'}</td>
              <td>{p.agg.sessions ? <MicroTag m={p.verdict.final} blocked={p.verdict.blocked} /> : <span className="muted">—</span>}</td>
              {emph && <td>{dominantGroup(p.agg)?.group ?? '—'}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      )}
      {points?.flatMap((p) => p.verdict.justification.map((j) => <div key={p.week + j} className="muted">• {fmtBR(p.week)}: {j}</div>))}
    </div>
  )
}
