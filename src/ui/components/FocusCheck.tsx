import { useLiveQuery } from 'dexie-react-hooks'
import { Target } from 'lucide-react'
import { Link } from 'react-router-dom'
import { profileLookup, studentSessions } from '../../data/repo'
import type { Student } from '../../domain/types'
import { addDays, aggregateSessions, toISODate } from '../../engine/metrics'

const short = (g: string) => g.replace('Perna - ', '')

/**
 * Só para o treinador: foco MEDIDO no que foi prescrito (últimas 4 semanas, séries fracionadas)
 * × a ênfase desejada da ficha. Se a ênfase não lidera, é sinal para rever a estratégia.
 */
export function FocusCheck({ student }: { student: Student }) {
  const data = useLiveQuery(async () => {
    const today = toISODate(new Date())
    const list = await studentSessions(student, addDays(today, -27), today)
    if (!list.length) return null
    const a = aggregateSessions(list, await profileLookup())
    const rows = Object.entries(a.byGroup).filter(([g, v]) => g !== 'Indefinido' && v.valid > 0).sort((x, z) => z[1].valid - x[1].valid)
    const total = rows.reduce((s, [, v]) => s + v.valid, 0) || 1
    return { rows: rows.map(([g, v]) => ({ g, n: Math.round(v.valid), pct: Math.round((v.valid / total) * 100) })), sessions: a.sessions }
  }, [student.id]) ?? null
  const want = student.emphasis ?? []
  if (!data) return null
  const top = data.rows.slice(0, 5)
  const rankOf = (g: string) => data.rows.findIndex((r) => r.g === g)
  const leader = data.rows[0]
  const verdict = want.length
    ? want.map((g) => {
        const i = rankOf(g)
        const r = data.rows[i]
        if (i === 0) return { ok: true, text: `${short(g)} lidera (${r.pct}% do volume)` }
        if (i < 0) return { ok: false, text: `${short(g)} não aparece nas últimas 4 semanas` }
        return { ok: i <= 1 && leader.pct - r.pct <= 3, text: `${short(g)} está em ${i + 1}º (${r.pct}%); ${short(leader.g)} lidera (${leader.pct}%)` }
      })
    : []
  return (
    <div className="card grid focus-check">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b className="row" style={{ gap: 8 }}><Target size={16} strokeWidth={1.8} /> Foco medido × ênfase desejada</b>
        <span className="muted">últimas 4 semanas · {data.sessions} treinos · só você vê</span>
      </div>
      {verdict.map((v) => <div key={v.text} className={`alert ${v.ok ? 'ok' : 'warn'}`}>{v.ok ? '✓ ' : ''}{v.text}{!v.ok ? '. Para priorizar, ajuste o volume na próxima montagem.' : ''}</div>)}
      {!want.length && <div className="muted">Defina a <Link to={`/alunos/${student.id}?aba=ficha`}>ênfase desejada</Link> na ficha para o app comparar com o que você está prescrevendo.</div>}
      <div className="focus-bars">
        {top.map((r) => (
          <div key={r.g} className={`fb ${want.includes(r.g) ? 'want' : ''}`}>
            <span>{short(r.g)}{want.includes(r.g) ? ' ★' : ''}</span>
            <i style={{ width: `${Math.max(4, (r.n / top[0].n) * 100)}%` }} />
            <small>{r.n} séries · {r.pct}%</small>
          </div>
        ))}
      </div>
    </div>
  )
}
