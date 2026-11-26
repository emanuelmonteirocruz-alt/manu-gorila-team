import { useLiveQuery } from 'dexie-react-hooks'
import { Check, ChevronLeft, Circle, CircleDot, Download, Droplet, Flame, Mic, Send, Square, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { db, nowISO, save, uid } from '../../data/db'
import { deleteSession, getCheckin, getWeekContext, previousBests, profileLookup, saveRating, studentSessions, upsertWeekContext } from '../../data/repo'
import { resolveProfiles } from '../../engine/classifier'
import { DIET_LABEL, MICRO_LABEL, MUSCLE_GROUPS, type Microcycle, type Session, type SessionExercise, type Student } from '../../domain/types'
import {
  addDays, aggregateSessions, classifySessionLevel, divergenceAlert, fmtBR, fmtNum, LEVEL_LABEL, toISODate, weekStart,
  type DivergenceAlert, type SessionLevel,
} from '../../engine/metrics'
import { isHeavy } from '../../engine/prescription'
import { parseSpoken, type SpokenEntry, type SpokenSet } from '../../voice/spokenParser'
import { autocorrect, type Correction } from '../../voice/autocorrect'
import { getBrand } from '../../data/brand'
import { sharePdf, templateD } from '../../pdf/templates'
import { drawPreview } from '../../pdf/charts'
import { saveFile } from '../../artifact/claude'
import type { jsPDF } from 'jspdf'
import { useSpeech } from '../../voice/useSpeech'
import { ConfirmButton, SleepCheckin, useStudents, WeekContextEditor } from '../components/common'
import { ExerciseNameInput } from '../components/ExerciseNameInput'

const LABELS = ['Treino A', 'Treino B', 'Treino C', 'Treino D', 'Treino E', 'Treino F']

export default function InPerson() {
  const students = useStudents('presencial')
  const [student, setStudent] = useState<Student | null>(null)
  const [label, setLabel] = useState<string | null>(null)
  const [groups, setGroups] = useState<string[]>([])
  const [session, setSession] = useState<Session | null>(null)
  const step = !student ? 1 : !label ? 2 : !session ? 3 : 4

  // treinos presenciais abertos (sem PSE) dos últimos 3 dias: dá para continuar de onde parou
  const open = useLiveQuery(async () => {
    const since = toISODate(new Date(Date.now() - 3 * 86400000))
    const rated = new Set((await db.ratings.toArray()).filter((r) => !r._deleted).map((r) => r.session_id))
    const list = (await db.sessions.where('date').aboveOrEqual(since).toArray())
      .filter((x) => !x._deleted && x.source === 'presencial' && !rated.has(x.id))
    return list.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  }, []) ?? []
  async function resume(x: Session) {
    const st = await db.students.get(x.student_id)
    if (!st || st._deleted) return
    setStudent(st); setLabel(x.label); setGroups(x.muscle_groups); setSession(x)
    setActive(x.id)
  }
  // voltou para a tela (ou reabriu o app) no meio de um treino: continua direto nele
  const resumed = useRef(false)
  useEffect(() => {
    if (resumed.current || session) return
    const id = getActive()
    const x = id ? open.find((o) => o.id === id) : undefined
    if (x) { resumed.current = true; void resume(x) }
  }, [open, session])

  const lastByLabel = useLiveQuery(async () => {
    if (!student) return {} as Record<string, Session>
    const all = await studentSessions(student)
    const m: Record<string, Session> = {}
    for (const s of all) m[s.label] = s
    return m
  }, [student?.id]) ?? {}

  const todaySleep = useLiveQuery(async () => (student ? (await getCheckin(student.id, toISODate(new Date())))?.sleep ?? null : null), [student?.id])

  async function start() {
    if (!student || !label) return
    const date = toISODate(new Date())
    // garante o contexto da semana (herda a dieta da semana anterior se não foi alterado)
    const ctx = (await getWeekContext(student.id, weekStart(date))) ?? (await upsertWeekContext(student.id, weekStart(date), {}))
    const s: Session = {
      id: uid(), student_id: student.id, date, label, source: 'presencial', muscle_groups: groups,
      planned_microcycle: ctx?.planned_microcycle ?? 'ordinaria', exercises: [], created_at: nowISO(), updated_at: nowISO(),
    }
    setSession(await save(db.sessions, s))
    setActive(s.id)
  }

  function reset() {
    setActive(null)
    setStudent(null); setLabel(null); setGroups([]); setSession(null)
  }

  return (
    <>
      <div className="steps">
        <span className={step === 1 ? 'on' : ''}>1 · Aluno<em>{student ? `: ${student.full_name.split(' ')[0]}` : ''}</em></span>
        <span className={step === 2 ? 'on' : ''}>2 · Treino<em>{label ? `: ${label.slice(-1)}` : ''}</em></span>
        <span className={step === 3 ? 'on' : ''}>3 · Check-in<em> do dia</em></span>
        <span className={step === 4 ? 'on' : ''}>Sessão</span>
      </div>

      {step === 1 && open.length > 0 && (
        <div className="card grid" style={{ marginBottom: 12, borderColor: 'var(--accent)' }}>
          <b>Treino em andamento</b>
          {open.map((x) => (
            <div key={x.id} className="row" style={{ justifyContent: 'space-between' }}>
              <span>{titleCaseName(students.find((st) => st.id === x.student_id)?.full_name)} · {x.label} · {fmtBR(x.date)} <span className="muted">({x.exercises.length} exercícios{loadDrafts(x.id).length ? ` + ${loadDrafts(x.id).length} no rascunho` : ''})</span></span>
              <span className="row" style={{ gap: 8 }}>
                <ConfirmButton label="Descartar" confirmLabel="Toque de novo para descartar" className="btn danger sm" onConfirm={async () => { await deleteSession(x.id); if (getActive() === x.id) setActive(null) }} />
                <button className="btn primary" onClick={() => resume(x)}>Continuar</button>
              </span>
            </div>
          ))}
        </div>
      )}
      {step === 1 && (
        <div className="big-tiles">
          {students.map((s) => (
            <button key={s.id} className="tile" onClick={() => setStudent(s)}>{s.full_name}{s.payment_status === 'atrasado' && <small className="pay-late-text">Mensalidade atrasada</small>}<small>{[s.plan_name, s.weekly_frequency ? `${s.weekly_frequency}x/sem` : ''].filter(Boolean).join(' · ') || 'Presencial'}</small></button>
          ))}
          {!students.length && <div className="muted">Cadastre alunos com modalidade Presencial.</div>}
        </div>
      )}

      {step === 2 && (
        <div className="grid">
          <div className="big-tiles">
            {LABELS.map((l) => (
              <button key={l} className="tile" onClick={() => {
                setLabel(l)
                const last = lastByLabel[l]
                if (last?.muscle_groups.length) setGroups(last.muscle_groups)
              }}>
                {l}<small>{lastByLabel[l] ? `último: ${fmtBR(lastByLabel[l].date)} · ${lastByLabel[l].muscle_groups.join(', ')}` : 'novo'}</small>
              </button>
            ))}
          </div>
          <div><button className="btn" onClick={reset}><ChevronLeft size={16} /> Trocar aluno</button></div>
        </div>
      )}

      {step === 3 && student && (
        <div className="grid">
          <DayCheckin student={student} />
          <h2 style={{ margin: '4px 0 0' }}>Grupamentos de hoje</h2>
          <div className="chips">
            {MUSCLE_GROUPS.map((g) => (
              <button key={g} className={`chip ${groups.includes(g) ? 'on' : ''}`} onClick={() => setGroups((x) => (x.includes(g) ? x.filter((y) => y !== g) : [...x, g]))}>{g}</button>
            ))}
          </div>
          <div className="row">
            <button className="btn" onClick={() => setLabel(null)}><ChevronLeft size={16} /> Voltar</button>
            <button className="btn primary big" disabled={!groups.length || !todaySleep} onClick={start}>Iniciar sessão ({groups.join(' + ') || 'selecione'})</button>
            {!todaySleep && <span className="muted">Registre o sono de hoje para iniciar.</span>}
          </div>
        </div>
      )}

      {step === 4 && session && student && (
        <LiveSession student={student} session={session} previous={lastByLabel[session.label]?.id !== session.id ? lastByLabel[session.label] : undefined}
          onChange={setSession} onDone={reset} />
      )}
    </>
  )
}

interface Draft extends SpokenEntry { key: string }

// ---- treino em andamento: guardado no aparelho para continuar depois ----
const ACTIVE_KEY = 'mgt_inperson_active'
const DRAFT_KEY = (id: string) => `mgt_inperson_drafts_${id}`
function loadDrafts(id: string): Draft[] {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY(id)) ?? '[]') as Draft[] } catch { return [] }
}
function saveDrafts(id: string, d: Draft[]) {
  try { if (d.length) localStorage.setItem(DRAFT_KEY(id), JSON.stringify(d)); else localStorage.removeItem(DRAFT_KEY(id)) } catch { /* sem armazenamento */ }
}
function setActive(id: string | null) {
  try { if (id) localStorage.setItem(ACTIVE_KEY, id); else localStorage.removeItem(ACTIVE_KEY) } catch { /* sem armazenamento */ }
}
function getActive(): string | null {
  try { return localStorage.getItem(ACTIVE_KEY) } catch { return null }
}

const titleCaseName = (n?: string) => n ?? 'Aluno'
const normName = (n: string) => n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
const repsLabel = (x: { repsMin: number | null; repsMax: number | null; failure: boolean }) =>
  x.failure ? 'Máx' : x.repsMin == null ? '' : x.repsMax != null && x.repsMax !== x.repsMin ? `${x.repsMin}-${x.repsMax}` : String(x.repsMin)
/** "Máx" / "falha" → failure; "8-10" / "8 a 10" → faixa; "10" → fixo. */
function parseRepsInput(v: string): { repsMin: number | null; repsMax: number | null; failure: boolean } {
  const t = v.trim().toLowerCase()
  if (/^(m[aá]x|falha|f)/.test(t)) return { repsMin: null, repsMax: null, failure: true }
  const m = t.match(/(\d+)\s*(?:-|a|até|–)?\s*(\d+)?/)
  if (!m) return { repsMin: null, repsMax: null, failure: false }
  return { repsMin: Number(m[1]), repsMax: Number(m[2] ?? m[1]), failure: false }
}
/** Pesada efetiva da série: marcação do treinador ou regra automática pela faixa de reps. */
const heavyOf = (x: SpokenSet) =>
  !x.warmup && x.heavy !== false &&
  (x.heavy ?? (!x.failure && x.repsMin != null && isHeavy({ min: x.repsMin, max: x.repsMax ?? x.repsMin })))
const peakOf = (series: SpokenSet[]) => {
  const kgs = series.filter((x) => !x.warmup).map((x) => x.kg).filter((k): k is number => k != null)
  return kgs.length ? Math.max(...kgs) : null
}
/** Junta ditados consecutivos do mesmo exercício (modo série a série) em um único card. */
function mergeConsecutive(list: Draft[]): Draft[] {
  const out: Draft[] = []
  for (const d of list) {
    const last = out[out.length - 1]
    if (last && normName(last.name) === normName(d.name)) {
      last.series = [...last.series, ...d.series]
      last.perSide = last.perSide || d.perSide
      last.drop = last.drop || d.drop
      last.needsReview = last.series.length === 0
    } else out.push({ ...d, series: [...d.series] })
  }
  return out
}
/** Exercício já registrado → card editável. */
function exerciseToDraft(e: SessionExercise): Draft {
  const wu: SpokenSet[] = Array.from({ length: e.warmup_sets }, (_, i) => {
    const w = e.warmup_detail?.[i]
    return { kg: w?.kg ?? null, repsMin: w?.reps.min ?? null, repsMax: w?.reps.max ?? null, failure: false, heavy: false, warmup: true }
  })
  const n = e.valid_sets
  const work: SpokenSet[] = Array.from({ length: n }, (_, i) => {
    const r = e.reps[i] ?? e.reps[e.reps.length - 1]
    return {
      kg: e.loads?.[i] ?? e.load_kg ?? null,
      repsMin: r?.failure ? null : r?.min ?? null,
      repsMax: r?.failure ? null : r?.max ?? null,
      failure: !!r?.failure,
      heavy: r?.heavy ?? null,
    }
  })
  const series = [...wu, ...work]
  return {
    key: uid(), name: e.display_name, sets: series.length, repsMin: null, repsMax: null, loadKg: e.load_kg ?? null, perSide: !!e.per_side,
    failure: false, series, warmup: false, drop: e.drop_set, notes: e.notes ?? '', needsReview: false,
  }
}

function LiveSession({ student, session, previous, onChange, onDone }: {
  student: Student; session: Session; previous?: Session; onChange: (s: Session) => void; onDone: () => void
}) {
  const sp = useSpeech()
  // rascunho do ditado guardado no aparelho: sair da tela, tocar num aviso ou fechar o app não perde nada
  const [drafts, setDrafts] = useState<Draft[]>(() => loadDrafts(session.id))
  useEffect(() => { saveDrafts(session.id, drafts) }, [session.id, drafts])
  const [box, setBox] = useState('') // transcrição já corrigida (editável)
  const [changes, setChanges] = useState<Correction[]>([])
  const [typed, setTyped] = useState('') // digitação rápida (mesmo motor da voz)
  const [manualOpen, setManualOpen] = useState(false)
  const [manual, setManual] = useState({ name: '', sets: '3', reps: '10', kg: '', perSide: false })
  const cache = useLiveQuery(() => db.exerciseCache.toArray(), []) ?? []
  const [busy, setBusy] = useState(false)
  const [ending, setEnding] = useState(false)
  const [pse, setPse] = useState<number | null>(null)
  const [result, setResult] = useState<{ level: SessionLevel; alert: DivergenceAlert | null; kcal: number; fatGrams: number } | null>(null)
  const [pdf, setPdf] = useState<{ doc: jsPDF; make: () => jsPDF; name: string } | null>(null)
  const pdfCanvas = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    if (pdf && pdfCanvas.current) drawPreview(pdfCanvas.current, pdf.make)
  }, [pdf])
  const pendingParse = useRef(false)
  const ac = (t: string) => autocorrect(t, { activeGroups: session.muscle_groups, cache })
  // durante a gravação a caixa mostra o texto já corrigido; ao parar, gera os cards
  useEffect(() => {
    if (sp.recording && sp.finalText) {
      const r = ac(sp.finalText)
      setBox(r.text)
      setChanges(r.changes)
    }
    if (!sp.recording && pendingParse.current && sp.finalText) {
      pendingParse.current = false
      correctAndBuild(sp.finalText)
    }
  }, [sp.recording, sp.finalText])

  const totals = useMemo(() => ({
    valid: session.exercises.reduce((a, e) => a + e.valid_sets, 0),
    heavy: session.exercises.reduce((a, e) => a + e.heavy_sets, 0),
  }), [session])

  /** Corrige o texto (vocabulário de musculação), mostra na caixa e (re)gera os cards pendentes. */
  function correctAndBuild(text: string) {
    const r = ac(text)
    setBox(r.text)
    setChanges(r.changes)
    setDrafts(mergeConsecutive(parseSpoken(r.text).map((e) => ({ ...e, key: uid() }))))
  }

  /** Digitação rápida: mesmo motor do microfone (autocorreção + séries progressivas), ADICIONA cards. */
  function addTyped() {
    const r = ac(typed)
    const fresh = parseSpoken(r.text).map((e) => ({ ...e, key: uid() }))
    if (!fresh.length) return
    setChanges(r.changes)
    setDrafts((d) => mergeConsecutive([...d, ...fresh]))
    setTyped('')
  }

  /** Card montado à mão: exercício, séries, reps (número, faixa ou Máx) e carga. */
  function addManualCard() {
    const n = Math.max(1, Math.min(12, Number(manual.sets) || 1))
    const reps = parseRepsInput(manual.reps)
    const kg = manual.kg === '' ? null : Number(manual.kg.replace(',', '.'))
    const name = ac(manual.name).text || manual.name
    const series: SpokenSet[] = Array.from({ length: n }, () => ({ kg, ...reps, heavy: null }))
    setDrafts((d) => mergeConsecutive([...d, {
      key: uid(), name, sets: n, repsMin: reps.repsMin, repsMax: reps.repsMax, loadKg: kg, perSide: manual.perSide,
      failure: reps.failure, series, warmup: false, drop: false, notes: '', needsReview: false,
    }]))
    setManual({ name: '', sets: manual.sets, reps: manual.reps, kg: '', perSide: manual.perSide })
    setManualOpen(false)
  }

  /** "+ Série" num exercício já registrado: repete a última série (ajuste em Editar se precisar). */
  async function addSeriesToExercise(e: SessionExercise) {
    const lastRep = e.reps[e.reps.length - 1] ?? { min: 10, max: 10 }
    const lastKg = e.loads?.[e.loads.length - 1] ?? e.load_kg ?? null
    const loads = e.loads ?? (e.load_kg != null ? Array.from({ length: e.valid_sets }, () => e.load_kg ?? null) : undefined)
    const next: SessionExercise = {
      ...e,
      valid_sets: e.valid_sets + 1,
      heavy_sets: e.heavy_sets + (isHeavy(lastRep) ? 1 : 0),
      reps: [...e.reps, { ...lastRep }],
      loads: loads ? [...loads, lastKg] : undefined,
    }
    onChange(await save(db.sessions, { ...session, exercises: session.exercises.map((x) => (x.id === e.id ? next : x)) }))
  }

  async function approve(list: Draft[]) {
    const ok = list.filter((d) => d.series.length && d.name.trim())
    if (!ok.length) return
    setBusy(true)
    try {
      const profiles = await resolveProfiles(ok.map((d) => d.name), session.muscle_groups, box || sp.finalText)
      const exercises = [...session.exercises]
      for (const d of ok) {
        const p = profiles.get(d.name)!
        // blocos: aquecimento (fora do volume) + séries de trabalho (cada uma guarda se foi pesada)
        const all = d.warmup ? d.series.map((x) => ({ ...x, warmup: true })) : d.series
        const work = all.filter((x) => !x.warmup)
        const wu = all.filter((x) => x.warmup)
        const reps = work.map((x) => ({
          ...(x.failure ? { min: 10, max: 12, failure: true } : { min: x.repsMin ?? 10, max: x.repsMax ?? x.repsMin ?? 10 }),
          heavy: heavyOf(x),
        }))
        const loads = work.map((x) => x.kg)
        const hasLoads = loads.some((k) => k != null)
        const warmupDetail = wu.map((x) => ({ kg: x.kg, reps: { min: x.repsMin ?? 15, max: x.repsMax ?? x.repsMin ?? 15 } }))
        const ex: SessionExercise = {
          id: uid(), position: exercises.length, exercise_key: p.key, display_name: p.name,
          valid_sets: work.length, warmup_sets: wu.length,
          heavy_sets: reps.filter(isHeavy).length,
          reps, loads: hasLoads ? loads : undefined, per_side: d.perSide,
          warmup_detail: warmupDetail.length ? warmupDetail : undefined,
          load_kg: peakOf(all), drop_set: d.drop, notes: d.notes || undefined,
        }
        // modo série a série: mesmo exercício logo em seguida → vira Série 2, 3… do mesmo card
        const last = exercises[exercises.length - 1]
        if (last && last.exercise_key === ex.exercise_key) {
          const lastLoads = last.loads ?? Array.from({ length: last.valid_sets }, () => last.load_kg ?? null)
          const wd = [...(last.warmup_detail ?? []), ...(ex.warmup_detail ?? [])]
          exercises[exercises.length - 1] = {
            ...last,
            valid_sets: last.valid_sets + ex.valid_sets,
            warmup_sets: last.warmup_sets + ex.warmup_sets,
            warmup_detail: wd.length ? wd : undefined,
            heavy_sets: last.heavy_sets + ex.heavy_sets,
            reps: [...last.reps, ...ex.reps],
            loads: hasLoads || last.loads ? [...lastLoads, ...loads] : undefined,
            per_side: !!(last.per_side || ex.per_side),
            load_kg: Math.max(last.load_kg ?? 0, ex.load_kg ?? 0) || null,
            drop_set: last.drop_set || ex.drop_set,
            notes: [last.notes, ex.notes].filter(Boolean).join(' · ') || undefined,
          }
        } else exercises.push(ex)
      }
      onChange(await save(db.sessions, { ...session, exercises }))
      setDrafts((d) => d.filter((x) => !ok.includes(x)))
      sp.setFinalText('')
      setBox('')
      setChanges([])
    } finally {
      setBusy(false)
    }
  }

  /** Abre um exercício registrado para edição série a série. */
  async function editExercise(e: SessionExercise) {
    onChange(await save(db.sessions, { ...session, exercises: session.exercises.filter((x) => x.id !== e.id) }))
    setDrafts((d) => [...d, exerciseToDraft(e)])
  }

  async function removeExercise(id: string) {
    onChange(await save(db.sessions, { ...session, exercises: session.exercises.filter((e) => e.id !== id) }))
  }

  async function finish() {
    if (pse == null) return
    await saveRating(session.id, pse)
    const sleep = (await getCheckin(student.id, session.date))?.sleep ?? null
    const lookup = await profileLookup()
    const agg = aggregateSessions([session], lookup)
    const ctx = await getWeekContext(student.id, weekStart(session.date))
    const c = { sleep: sleep ?? undefined, diet: ctx?.diet, menstrual: student.sex === 'F' && !!ctx?.menstrual }
    setResult({ level: classifySessionLevel(pse, agg, c), alert: divergenceAlert(session.planned_microcycle, pse, c), kcal: agg.kcal, fatGrams: agg.fatGrams })
    // PDF do treino já pronto ao encerrar: o aluno está na sua frente
    const o = { studentName: student.full_name, showName: true, showEmphasis: false, brand: await getBrand(), modality: 'presencial' as const }
    const bests = await previousBests(student.id, session)
    const make = () => templateD(session, lookup, pse, o, bests)
    setPdf({ doc: make(), make, name: `treino-${student.full_name.split(' ')[0].toLowerCase()}-${session.date}.pdf` })
  }

  const upd = (k: string, patch: Partial<Draft>) => setDrafts((d) => d.map((x) => (x.key === k ? { ...x, ...patch } : x)))

  if (result) {
    const phone = (student.phone ?? '').replace(/\D/g, '')
    const wa = phone ? `https://wa.me/${phone.length <= 11 ? '55' + phone : phone}` : ''
    return (
      <div className="card grid" style={{ maxWidth: 720 }}>
        <h1>Sessão encerrada</h1>
        <div className="row"><span className={`tag ${result.level === 'leve' ? 'regenerativa' : result.level === 'moderada' ? 'ordinaria' : 'choque'}`}>{LEVEL_LABEL[result.level]}</span>
          <span className="muted">PSE {pse} · {totals.valid} válidas · {totals.heavy} pesadas · planejada {MICRO_LABEL[(session.planned_microcycle ?? 'ordinaria') as Microcycle]}</span></div>
        <div className="grid cols-2">
          <div className="card kpi"><div className="v row" style={{ gap: 8 }}><Flame size={22} strokeWidth={1.8} color="var(--accent)" />{fmtNum(result.kcal)} kcal</div><div className="l">gasto estimado neste treino</div></div>
          <div className="card kpi"><div className="v row" style={{ gap: 8 }}><Droplet size={22} strokeWidth={1.8} color="var(--sub)" />{fmtNum(result.fatGrams)} g</div><div className="l">equivalente em gordura</div></div>
        </div>
        {result.alert && <div className="alert danger"><b>Alerta de divergência</b><br />{result.alert.message}<br /><span className="muted">Contexto: {result.alert.reasons.join(', ')}</span></div>}
        {pdf ? (
          <>
            <div className="row stack-sm">
              {/* compartilha na hora (sem espera), senão o celular bloqueia a janela de envio */}
              <button className="btn primary big" onClick={() => sharePdf(pdf.doc, pdf.name)}><Send size={16} strokeWidth={1.8} /> Enviar PDF pelo WhatsApp</button>
              {wa && <a className="btn big" href={wa} target="_blank" rel="noreferrer">Abrir conversa com {student.full_name.split(' ')[0]}</a>}
            </div>
            <div className="muted">No celular abre a janela de compartilhar: escolha o WhatsApp e o contato do aluno. No computador o PDF é baixado{wa ? ' e você anexa na conversa' : ''}.</div>
            <canvas ref={pdfCanvas} className="pdf-preview" aria-label="Prévia do PDF do treino" />
          </>
        ) : <div className="muted">Gerando o PDF do treino…</div>}
        <div className="row stack-sm">
          {pdf && <button className="btn big" onClick={() => saveFile(pdf.name, pdf.doc.output('blob'))}><Download size={16} strokeWidth={1.8} /> Baixar PDF</button>}
          <button className="btn big" onClick={onDone}>Próximo aluno</button>
        </div>
      </div>
    )
  }

  return (
    <div className="tablet">
      <div className="left grid" style={{ alignContent: 'start' }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div><h1>{student.full_name.split(' ')[0]} · {session.label}</h1><div className="muted">{session.muscle_groups.join(' + ')} · {totals.valid} válidas · {totals.heavy} pesadas</div></div>
          <div className="row">
            <button className={`mic-btn ${sp.recording ? 'rec' : ''}`} aria-pressed={sp.recording} onClick={() => {
              if (sp.recording) {
                pendingParse.current = true
                sp.stop()
              } else {
                pendingParse.current = true // também estrutura se o Stop do Claude encerrar o ditado
                sp.start()
              }
            }}>
              {sp.recording ? <Square size={16} fill="currentColor" /> : <Mic size={18} strokeWidth={1.8} />}{sp.recording ? 'Parar' : 'Gravar'}
            </button>
            <button className="btn ok" onClick={() => setEnding(true)}>Encerrar treino</button>
          </div>
        </div>

        <div className="card grid manual-entry">
          <div className="row">
            <input id="typed-entry" className="set-note" value={typed} onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && typed.trim()) addTyped() }}
              placeholder="Digite como fala: Supino máquina, 4 séries do máximo, 20, 30, 40, 50 kg de cada lado  ·  Extensora 4x15 30kg" />
            <button className="btn primary" disabled={!typed.trim()} onClick={addTyped}>Adicionar</button>
          </div>
          <div className="row">
            <button className="btn" onClick={() => setManualOpen((v) => !v)}>{manualOpen ? 'Fechar' : '+ Adicionar Exercício Manual'}</button>
            <span className="muted">Passa pela mesma leitura do microfone (autocorreção, séries progressivas, kg/lado, Máx).</span>
          </div>
          {manualOpen && (
            <div className="manual-form">
              <label className="f">Exercício<ExerciseNameInput id="manual-name" value={manual.name} onChange={(v) => setManual({ ...manual, name: v })} groups={session.muscle_groups} placeholder="Comece a digitar: ex → Extensora" /></label>
              <label className="f">Séries<input id="manual-sets" inputMode="numeric" value={manual.sets} onChange={(e) => setManual({ ...manual, sets: e.target.value })} /></label>
              <label className="f">Repetições<input id="manual-reps" value={manual.reps} onChange={(e) => setManual({ ...manual, reps: e.target.value })} placeholder="10, 8-10 ou Máx" /></label>
              <label className="f">Carga (kg)<input id="manual-kg" inputMode="decimal" value={manual.kg} onChange={(e) => setManual({ ...manual, kg: e.target.value })} /></label>
              <label className="row muted" style={{ gap: 6, alignSelf: 'end', minHeight: 44 }}><input type="checkbox" checked={manual.perSide} onChange={(e) => setManual({ ...manual, perSide: e.target.checked })} /> por lado</label>
              <button className="btn ok" style={{ alignSelf: 'end' }} disabled={!manual.name.trim()} onClick={addManualCard}>Criar card</button>
            </div>
          )}
        </div>

        {drafts.length > 0 && (
          <div className="card grid">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0 }}>Confirmar ditado</h2>
              <button className="btn ok big" disabled={busy || drafts.some((d) => !d.series.length || !d.name.trim())} onClick={() => approve(drafts)}><Check size={16} /> Aprovar bloco inteiro</button>
            </div>
            {drafts.map((d, di) => {
              const peak = peakOf(d.series)
              const unit = d.perSide ? 'kg/lado' : 'kg'
              const last = session.exercises[session.exercises.length - 1]
              const joins = di === 0 && last && normName(last.display_name) === normName(d.name)
              const setSeries = (series: SpokenSet[]) => upd(d.key, { series, needsReview: series.length === 0 })
              return (
                <div key={d.key} className="set-card" style={d.needsReview ? { outline: '2px solid var(--warn)' } : undefined}>
                  <div className="set-head">
                    <ExerciseNameInput className="set-name" value={d.name} onChange={(v) => upd(d.key, { name: v })} groups={session.muscle_groups} />
                    <span className="set-sum">{(() => {
                      const nW = d.series.filter((x) => x.warmup).length
                      const nV = d.series.length - nW
                      const nH = d.series.filter(heavyOf).length
                      return [nW ? `${nW} aquec.` : '', nV ? `${nV} ${nV === 1 ? 'série válida' : 'séries válidas'}` : '', nH ? `${nH} pesadas` : '', peak != null ? `Pico: ${fmtNum(peak, 1)} ${unit}` : '']
                        .filter(Boolean).join(' • ')
                    })()}</span>
                    <label className="row muted" style={{ gap: 6 }}><input type="checkbox" checked={d.perSide} onChange={(e) => upd(d.key, { perSide: e.target.checked })} /> por lado</label>
                    <button className="btn danger icon" aria-label="Remover exercício" onClick={() => setDrafts((x) => x.filter((y) => y.key !== d.key))}><X size={16} /></button>
                  </div>
                  {joins && <div className="muted">Será adicionado ao card “{last.display_name}” (continua a partir da Série {last.valid_sets + 1})</div>}
                  <div className="set-rows">
                    {d.series.map((x, i) => {
                      const workIndex = d.series.slice(0, i + 1).filter((y) => !y.warmup).length
                      const warmIndex = d.series.slice(0, i + 1).filter((y) => y.warmup).length
                      const put = (patch: Partial<SpokenSet>) => setSeries(d.series.map((y, j) => (j === i ? { ...y, ...patch } : y)))
                      return (
                        <div key={i} className={`set-row ${x.warmup ? 'is-warmup' : ''}`}>
                          <span className="set-n">{x.warmup ? `Aquec. ${warmIndex}` : `Série ${(joins ? last.valid_sets : 0) + workIndex}`}</span>
                          <label className="f"><span>{unit}</span>
                            <input inputMode="decimal" value={x.kg ?? ''} onChange={(e) => put({ kg: e.target.value === '' ? null : Number(e.target.value.replace(',', '.')) })} />
                          </label>
                          <label className="f"><span>reps</span>
                            <input key={repsLabel(x)} defaultValue={repsLabel(x)} placeholder="10 ou Máx" onBlur={(e) => put(parseRepsInput(e.target.value))} />
                          </label>
                          <button type="button" className={`warm-toggle ${x.warmup ? 'on' : ''}`} aria-pressed={!!x.warmup}
                            title="Aquecimento não conta como série válida" onClick={() => put({ warmup: !x.warmup, heavy: x.warmup ? null : false })}>
                            {x.warmup ? <CircleDot size={14} /> : <Circle size={14} />} Aquec.
                          </button>
                          {x.warmup ? <span /> : (
                            <button type="button" className={`heavy-toggle ${heavyOf(x) ? 'on' : ''}`} aria-pressed={heavyOf(x)}
                              title={x.heavy == null ? 'Automático pela faixa de reps — toque para marcar' : 'Marcado por você'}
                              onClick={() => put({ heavy: !heavyOf(x) })}>
                              {heavyOf(x) ? <CircleDot size={14} /> : <Circle size={14} />} Pesada
                            </button>
                          )}
                          <button className="btn icon" aria-label={`Remover série ${i + 1}`} onClick={() => setSeries(d.series.filter((_, j) => j !== i))}><X size={16} /></button>
                        </div>
                      )
                    })}
                  </div>
                  <div className="row">
                    <button className="btn" onClick={() => {
                      const lastWork = [...d.series].reverse().find((y) => !y.warmup)
                      setSeries([...d.series, lastWork ? { ...lastWork } : { kg: null, repsMin: null, repsMax: null, failure: false, heavy: null }])
                    }}>+ Série</button>
                    <input className="set-note" aria-label="Observação" value={d.notes} onChange={(e) => upd(d.key, { notes: e.target.value })} placeholder={d.warmup ? 'aquecimento' : 'Observação'} />
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div className="card grid">
          <h2>Registrado nesta sessão</h2>
          {session.exercises.map((e) => {
            const unit = e.per_side ? 'kg/lado' : 'kg'
            return (
              <div key={e.id} className="done-card">
                <div className="set-head">
                  <b>{e.display_name}</b>
                  <span className="set-sum">{[e.warmup_sets ? `${e.warmup_sets} aquec.` : '', e.valid_sets ? `${e.valid_sets} ${e.valid_sets === 1 ? 'série válida' : 'séries válidas'}` : '', e.load_kg ? `Pico: ${fmtNum(e.load_kg, 1)} ${unit}` : ''].filter(Boolean).join(' • ')}</span>
                  {e.heavy_sets ? <span className="tag warn">{e.heavy_sets} pesadas</span> : null}
                  <span style={{ marginLeft: 'auto' }} className="row">
                    {e.valid_sets > 0 && <button className="btn" onClick={() => addSeriesToExercise(e)}>+ Série</button>}
                    <button className="btn" onClick={() => editExercise(e)}>Editar</button>
                    <button className="btn icon" aria-label="Remover" onClick={() => removeExercise(e.id)}><X size={16} /></button>
                  </span>
                </div>
                <div className="chips">
                  {(e.warmup_detail ?? []).map((w, i) => (
                    <span key={`w${i}`} className="tag">Aq{i + 1}{w.kg != null ? ` · ${fmtNum(w.kg, 1)} ${unit}` : ''} × {w.reps.min === w.reps.max ? w.reps.min : `${w.reps.min}–${w.reps.max}`}</span>
                  ))}
                  {Array.from({ length: e.valid_sets }, (_, i) => {
                    const r = e.reps[i]
                    const kg = e.loads?.[i] ?? e.load_kg
                    const reps = !r ? '' : r.failure ? 'Máx' : r.min === r.max ? `${r.min}` : `${r.min}–${r.max}`
                    return <span key={i} className={`tag ${r && isHeavy(r) ? 'warn' : ''}`}>S{i + 1} · {kg != null ? `${fmtNum(kg, 1)} ${unit}` : '—'}{reps ? ` × ${reps}` : ''}{r && isHeavy(r) ? ' · pesada' : ''}</span>
                  })}
                </div>
              </div>
            )
          })}
          {!session.exercises.length && <div className="muted">Dite o primeiro exercício no microfone.</div>}
        </div>

        {previous && (
          <div className="card">
            <h2>Última vez ({fmtBR(previous.date)})</h2>
            <div className="muted">{previous.exercises.map((e) => `${e.display_name} ${e.valid_sets}x${e.reps[0]?.max ?? ''}${e.load_kg ? ` ${e.load_kg}kg` : ''}`).join(' · ')}</div>
          </div>
        )}

        {ending && (
          <div className="card grid">
            <h2>Como o aluno respondeu hoje? (PSE 0–10)</h2>
            <div className="pse">{Array.from({ length: 11 }, (_, i) => <button key={i} className={pse === i ? 'on' : ''} onClick={() => setPse(i)}>{i}</button>)}</div>
            <button className="btn primary big" disabled={pse == null} onClick={finish}>Salvar avaliação e encerrar</button>
          </div>
        )}
      </div>

      <div className="right">
        <div className="card grid">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <b>Transcrição corrigida</b>
            {sp.recording && <span className="tag danger"><Mic size={12} /> gravando</span>}
          </div>
          <textarea id="voice-box" className="code" style={{ minHeight: 140 }} value={box} readOnly={sp.recording}
            placeholder="Toque em Gravar e dite, ou digite aqui: extensora 4 séries de 15 com 20 kg; leg press 45 com 200 kg"
            onChange={(e) => setBox(e.target.value)} />
          {sp.recording && sp.interim && <div className="muted">… {sp.interim}</div>}
          {changes.length > 0 && (
            <div className="chips">{changes.map((c, i) => <span key={i} className="tag ordinaria">{c.from} → {c.to}</span>)}</div>
          )}
          <button className="btn primary" disabled={sp.recording || !box.trim()} onClick={() => correctAndBuild(box)}>
            {drafts.length ? 'Atualizar cards' : 'Gerar cards'}
          </button>
          {sp.error && <div className="alert warn">{sp.error}</div>}
        </div>
      </div>
    </div>
  )
}

/**
 * Check-in do dia (após escolher o Treino):
 *  - Sono: todo treino.
 *  - Contexto da semana (dieta, ciclo menstrual, microciclo): só no 1º treino da semana;
 *    nos seguintes aparece resumido, com opção de alterar.
 */
function DayCheckin({ student }: { student: Student }) {
  const date = toISODate(new Date())
  const wk = weekStart(date)
  const [editWeek, setEditWeek] = useState(false)
  const info = useLiveQuery(async () => {
    const ctx = await getWeekContext(student.id, wk)
    const trained = (await studentSessions(student, wk, addDays(wk, 6))).some((x) => x.exercises.length > 0)
    return { ctx, trained }
  }, [student.id, wk])
  if (!info) return null
  const firstOfWeek = !info.trained
  const c = info.ctx
  return (
    <div className="grid cols-2" style={{ alignItems: 'start' }}>
      <SleepCheckin student={student} />
      {firstOfWeek || editWeek ? (
        <div className="grid">
          {firstOfWeek && <div className="alert warn">Primeiro treino da semana: confirme o contexto da semana.</div>}
          <WeekContextEditor student={student} week={wk} />
        </div>
      ) : (
        <div className="card grid">
          <h2>Contexto da semana {fmtBR(wk)}</h2>
          <div className="chips">
            <span className="tag ordinaria">{DIET_LABEL[c?.diet ?? 'manutencao']}</span>
            {student.sex === 'F' && <span className={`tag ${c?.menstrual ? 'choque' : ''}`}>{c?.menstrual ? 'Semana menstrual' : 'Sem ciclo menstrual'}</span>}
            {c?.planned_microcycle && <span className={`tag ${c.planned_microcycle}`}>{MICRO_LABEL[c.planned_microcycle]}</span>}
          </div>
          <div className="muted">Já confirmado no primeiro treino desta semana.</div>
          <button className="btn" onClick={() => setEditWeek(true)}>Alterar contexto da semana</button>
        </div>
      )}
    </div>
  )
}
