import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { jsPDF } from 'jspdf'
import { db } from '../../data/db'
import { getBrand } from '../../data/brand'
import { previousBests, keyLifts, profileLookup, studentSessions, weekPoints, weeksBetween } from '../../data/repo'
import { addDays, fmtBR, toISODate, weekStart } from '../../engine/metrics'
import { sharePdf, templateA, templateC, templateD, templateE } from '../../pdf/templates'
import { buildBeforeAfter, buildWeek, buildWeeksCompare, listWeeks, monthRange, prevMonth, weekLabel } from '../../data/reportData'
import { drawPreview } from '../../pdf/charts'
import { useLiveQuery } from 'dexie-react-hooks'
import { StudentSelect } from '../components/common'

type Tpl = 'A' | 'C' | 'D' | 'E' | 'W'

export default function Reports() {
  const [params] = useSearchParams()
  const [studentId, setStudentId] = useState(params.get('aluno') ?? '')
  const [tpl, setTpl] = useState<Tpl>(((t) => (t === 'A' || t === 'C' || t === 'D' || t === 'E' || t === 'W' ? t : 'W'))(params.get('tpl')))
  const [showName, setShowName] = useState(true)
  const [showEmphasis, setShowEmphasis] = useState(false)
  const [weekRef, setWeekRef] = useState(params.get('semana') ?? toISODate(new Date()))
  const [month, setMonth] = useState(params.get('mes') ?? toISODate(new Date()).slice(0, 7))
  const [sessionId, setSessionId] = useState('')
  // semanas salvas do aluno (mais recente primeiro) — para escolher o que comparar
  const weeks = useLiveQuery(async () => {
    const st = studentId ? await db.students.get(studentId) : undefined
    return st ? listWeeks(st) : []
  }, [studentId]) ?? []
  const [wkA, setWkA] = useState(params.get('semana1') ?? '') // antes
  const [wkB, setWkB] = useState(params.get('semana2') ?? '') // depois
  const has = (wk: string) => weeks.some((w) => w.wk === wk)
  // padrão: a semana mais recente × a anterior a ela
  const after = has(wkB) ? wkB : weeks[0]?.wk ?? ''
  const before = has(wkA) ? wkA : weeks.find((w) => w.wk < after)?.wk ?? weeks[1]?.wk ?? ''
  const single = has(weekStart(weekRef)) ? weekStart(weekRef) : weeks[0]?.wk ?? weekStart(weekRef)
  const sessions = useLiveQuery(async () => {
    const st = studentId ? await db.students.get(studentId) : undefined
    return st ? (await studentSessions(st)).reverse().slice(0, 40) : []
  }, [studentId]) ?? []
  const [doc, setDoc] = useState<{ d: jsPDF; name: string; draw: () => unknown } | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  // prévia desenhada em canvas (PDF em iframe fica em branco no visualizador e no Chrome Android)
  useEffect(() => {
    if (doc && canvasRef.current) drawPreview(canvasRef.current, doc.draw)
  }, [doc])

  async function buildReport() {
    const s = await db.students.get(studentId)
    if (!s) return
    const o = { studentName: s.full_name, showName, showEmphasis, brand: await getBrand(), modality: s.modality }
    let make: () => jsPDF
    let name: string
    const first = s.full_name.split(' ')[0].toLowerCase()
    if (tpl === 'A') {
      // Mês 1 (anterior) × Mês 2 (escolhido)
      const { before, after } = await buildBeforeAfter(s, month)
      make = () => templateA(before, after, o)
      name = `antes-depois-${first}-${month}.pdf`
    } else if (tpl === 'W') {
      if (!before || !after) return
      const [b, a] = before <= after ? [before, after] : [after, before]
      const c = await buildWeeksCompare(s, b, a)
      make = () => templateA(c.before, c.after, o, c.perTraining)
      name = `semanas-${first}-${b}-x-${a}.pdf`
    } else if (tpl === 'E') {
      const w = await buildWeek(s, single)
      make = () => templateE(w.wk, w.items, w.cur, w.prev, o)
      name = `semana-${first}-${w.wk}.pdf`
    } else if (tpl === 'D') {
      const sess = sessions.find((x) => x.id === sessionId) ?? sessions[0]
      if (!sess) return
      const rs = await db.ratings.where('session_id').equals(sess.id).toArray()
      const pse = (rs.find((r) => r.reported_by === 'student') ?? rs[0])?.pse ?? null
      const lookup = await profileLookup()
      const bests = await previousBests(s.id, sess)
      make = () => templateD(sess, lookup, pse, o, bests)
      name = `treino-${first}-${sess.date}.pdf`
    } else {
      // Mês de referência; para presencial com vencimento, o ciclo vai do vencimento anterior até o atual
      const [y, m] = month.split('-').map(Number)
      let from = `${month}-01`
      let to = toISODate(new Date(y, m, 0))
      if (s.due_day) {
        to = toISODate(new Date(y, m - 1, s.due_day))
        from = toISODate(new Date(y, m - 2, s.due_day + 1))
      }
      const pts = await weekPoints(s, weeksBetween(from, to))
      const lifts = await keyLifts(s, from, to)
      const label = new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
      make = () => templateC(`${label} · ${fmtBR(from)} a ${fmtBR(to)}`, lifts, pts.filter((p) => p.agg.sessions > 0), o)
      name = `resumo-mensal-${first}-${month}.pdf`
    }
    setDoc({ d: make(), name, draw: make })
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Relatórios em PDF vetorial</h1><div className="muted">Formato celular 9:16, modo limpo para acompanhar seu áudio no WhatsApp</div></div>
      </div>
      <div className="grid cols-2">
        <div className="card grid" style={{ alignContent: 'start' }}>
          <StudentSelect value={studentId} onChange={setStudentId} />
          <div className="muted">Template</div>
          <div className="chips">
            <button className={`chip sm ${tpl === 'W' ? 'on' : ''}`} onClick={() => setTpl('W')}>Comparar semanas</button>
            <button className={`chip sm ${tpl === 'E' ? 'on' : ''}`} onClick={() => setTpl('E')}>Uma semana</button>
            <button className={`chip sm ${tpl === 'A' ? 'on' : ''}`} onClick={() => setTpl('A')}>Mês × Mês</button>
            <button className={`chip sm ${tpl === 'C' ? 'on' : ''}`} onClick={() => setTpl('C')}>Resumo do mês</button>
            <button className={`chip sm ${tpl === 'D' ? 'on' : ''}`} onClick={() => setTpl('D')}>Treino do dia</button>
          </div>
          {tpl === 'A' && <label className="f">Mês "depois"<input id="report-month-a" type="month" value={month} onChange={(e) => setMonth(e.target.value)} /><span className="muted">Compara {monthRange(prevMonth(month)).label} (antes) com {monthRange(month).label} (depois)</span></label>}
          {tpl === 'W' && (weeks.length < 2 ? <div className="muted">{studentId ? 'Este aluno precisa de pelo menos 2 semanas salvas para comparar.' : 'Escolha o aluno.'}</div> : <>
            <label className="f">Semana anterior
              <select id="report-week-a" value={before} onChange={(e) => setWkA(e.target.value)}>
                {weeks.map((w) => <option key={w.wk} value={w.wk}>{weekLabel(w)}</option>)}
              </select>
            </label>
            <label className="f">Semana nova
              <select id="report-week-b" value={after} onChange={(e) => setWkB(e.target.value)}>
                {weeks.map((w) => <option key={w.wk} value={w.wk}>{weekLabel(w)}</option>)}
              </select>
            </label>
            {before === after && <span className="muted">Escolha duas semanas diferentes.</span>}
          </>)}
          {tpl === 'E' && (weeks.length ? (
            <label className="f">Semana
              <select id="report-week" value={single} onChange={(e) => setWeekRef(e.target.value)}>
                {weeks.map((w) => <option key={w.wk} value={w.wk}>{weekLabel(w)}</option>)}
              </select>
            </label>
          ) : <label className="f">Semana (qualquer dia dela)<input id="report-week" type="date" value={weekRef} onChange={(e) => setWeekRef(e.target.value || toISODate(new Date()))} /><span className="muted">Semana de {fmtBR(weekStart(weekRef))} a {fmtBR(addDays(weekStart(weekRef), 6))}</span></label>)}
          {tpl === 'D' && (
            <label className="f">Treino
              <select id="report-session" value={sessionId || sessions[0]?.id || ''} onChange={(e) => setSessionId(e.target.value)}>
                {sessions.map((x) => <option key={x.id} value={x.id}>{fmtBR(x.date)} · {x.label}</option>)}
              </select>
            </label>
          )}
          {tpl === 'C' && <label className="f">Mês (até o vencimento)<input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label>}
          <label className="row"><input type="checkbox" checked={showName} onChange={(e) => setShowName(e.target.checked)} /> Incluir nome do aluno no cabeçalho</label>
          <label className="row"><input type="checkbox" checked={showEmphasis} onChange={(e) => setShowEmphasis(e.target.checked)} /> Especificar musculatura com mais intensidade e volume</label>
          <div className="row">
            <button className="btn primary big" disabled={!studentId || (tpl === 'W' && (!before || !after || before === after))} onClick={buildReport}>Gerar prévia</button>
            <button className="btn ok big" disabled={!doc} onClick={() => doc && sharePdf(doc.d, doc.name)}>Enviar / baixar PDF</button>
          </div>
        </div>
        <div className="card" style={{ minHeight: 600 }}>
          {doc ? <canvas ref={canvasRef} className="pdf-preview" aria-label="Prévia do relatório" /> : <div className="muted">A prévia do PDF aparece aqui.</div>}
        </div>
      </div>
    </>
  )
}
