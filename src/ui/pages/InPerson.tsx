import { useLiveQuery } from 'dexie-react-hooks'
import { waLink, waNumber } from '../../domain/whatsapp'
import { Check, ChevronLeft, Link2, PencilLine, Circle, CircleDot, Download, Droplet, Flame, Mic, Send, Square, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { db, nowISO, save, uid } from '../../data/db'
import { deleteSession, getCheckin, getWeekContext, lastLoads, previousBests, treinoDoDiaExtras, type LastLoad, profileLookup, saveRating, studentSessions, upsertWeekContext } from '../../data/repo'
import { resolveProfiles } from '../../engine/classifier'
import { DIET_LABEL, MICRO_LABEL, MUSCLE_GROUPS, type Microcycle, type Session, type SessionExercise, type Student } from '../../domain/types'
import {
  addDays, aggregateSessions, setSessionDuration, classifySessionLevel, divergenceAlert, fmtBR, fmtNum, LEVEL_LABEL, toISODate, weekStart,
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
import { CardioPanel } from '../components/CardioPanel'
import { InlineSetsEditor } from '../components/SessionEditor'
import { topSetText } from '../format'
import { detectMuscleGroups } from '../../engine/sessionGroups'
import { normalizeKey } from '../../engine/exerciseSeed'

const LABELS = ['Treino A', 'Treino B', 'Treino C', 'Treino D', 'Treino E', 'Treino F']

export default function InPerson() {
  const students = useStudents('presencial')
  const [student, setStudent] = useState<Student | null>(null)
  const [label, setLabel] = useState<string | null>(null)
  const [groups, setGroups] = useState<string[]>([])
  const [session, setSession] = useState<Session | null>(null)
  const step = !student ? 1 : !label ? 2 : !session ? 3 : 4
  // atalho "Iniciar treino" da ficha do aluno: /presencial?aluno=ID já abre na escolha do treino
  const [qp] = useSearchParams()
  const preset = useRef(false)
  useEffect(() => {
    const id = qp.get('aluno')
    if (preset.current || !id || student || getActive()) return
    preset.current = true
    void db.students.get(id).then((st) => { if (st && !st._deleted) setStudent(st) })
  }, [qp, student])

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
  // treino anterior do mesmo rótulo, sem contar a sessão em andamento (ela vira a "última" assim que é criada)
  const previousOf = useLiveQuery(async () => {
    if (!student || !session) return undefined
    const all = await studentSessions(student)
    return all.filter((s) => s.label === session.label && s.id !== session.id && s.exercises.length && (s.date < session.date || (s.date === session.date && s.created_at < session.created_at))).pop()
  }, [student?.id, session?.id, session?.label])

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
            <button key={s.id} className="tile" onClick={() => setStudent(s)}>{s.full_name}{s.payment_status === 'atrasado' && <small className="pay-late-text">Mensalidade atrasada</small>}<small>{[s.weekly_frequency ? `${s.weekly_frequency}x/sem` : ''].filter(Boolean).join(' · ') || 'Presencial'}</small></button>
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
                {l}<small>{lastByLabel[l] ? `último: ${fmtBR(lastByLabel[l].date)} · ${lastByLabel[l].muscle_groups.map((g) => g.replace('Perna - ', '')).join(', ')}` : 'novo'}</small>
              </button>
            ))}
          </div>
          <div><button className="btn" onClick={reset}><ChevronLeft size={16} /> Trocar aluno</button></div>
        </div>
      )}

      {step === 3 && student && (
        <div className="grid">
          <DayCheckin student={student} />
          <details className="groups-opt">
            <summary className="muted" style={{ cursor: 'pointer', fontWeight: 600 }}>Grupamentos de hoje (opcional: o app detecta pelos exercícios registrados)</summary>
            <div className="chips" style={{ marginTop: 8 }}>
              {MUSCLE_GROUPS.map((g) => (
                <button key={g} className={`chip ${groups.includes(g) ? 'on' : ''}`} onClick={() => setGroups((x) => (x.includes(g) ? x.filter((y) => y !== g) : [...x, g]))}>{g}</button>
              ))}
            </div>
          </details>
          <div className="row">
            <button className="btn" onClick={() => setLabel(null)}><ChevronLeft size={16} /> Voltar</button>
            <button className="btn primary big" disabled={!todaySleep} onClick={start}>Iniciar sessão</button>
            {!todaySleep && <span className="muted">Registre o sono de hoje para iniciar.</span>}
          </div>
        </div>
      )}

      {step === 4 && session && student && (
        <LiveSession student={student} session={session} previous={previousOf}
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
/** Drops gravados nas observações ("S4 drop: 30 → 20 kg") → { série: cargas }. */
const DROP_NOTE = /S(\d+) drop(?:: ([^·]+?) kg)?(?=\s*(?:·|$))/g
function dropsOf(notes?: string | null): Record<number, string> {
  const out: Record<number, string> = {}
  for (const m of (notes ?? '').matchAll(DROP_NOTE)) out[Number(m[1])] = (m[2] ?? '').trim()
  return out
}
const notesWithoutDrops = (notes?: string | null) => (notes ?? '').replace(DROP_NOTE, '').split('·').map((x) => x.trim()).filter(Boolean).join(' · ')

/** Exercício já registrado → card editável. */
function exerciseToDraft(e: SessionExercise): Draft {
  const wu: SpokenSet[] = Array.from({ length: e.warmup_sets }, (_, i) => {
    const w = e.warmup_detail?.[i]
    return { kg: w?.kg ?? null, repsMin: w?.reps.min ?? null, repsMax: w?.reps.max ?? null, failure: false, heavy: false, warmup: true }
  })
  const n = e.valid_sets
  const drops = dropsOf(e.notes)
  const work: SpokenSet[] = Array.from({ length: n }, (_, i) => {
    const r = e.reps[i] ?? e.reps[e.reps.length - 1]
    return {
      kg: e.loads?.[i] ?? e.load_kg ?? null,
      repsMin: r?.failure ? null : r?.min ?? null,
      repsMax: r?.failure ? null : r?.max ?? null,
      failure: !!r?.failure,
      heavy: r?.heavy ?? null,
      ...(drops[i + 1] !== undefined ? { drop: true } : {}),
    }
  })
  const series = [...wu, ...work]
  return {
    key: uid(), name: e.display_name, sets: series.length, repsMin: null, repsMax: null, loadKg: e.load_kg ?? null, perSide: !!e.per_side,
    failure: false, series, warmup: false, drop: e.drop_set && !Object.keys(drops).length, notes: notesWithoutDrops(e.notes), needsReview: false,
  }
}

/**
 * Carga da última vez daquele exercício, ao lado do que está sendo registrado agora.
 * Abaixo da última vez fica em alerta (para não regredir sem querer); igual ou acima fica verde.
 */
const kgFmt = (k: number) => fmtNum(k, Number.isInteger(k) ? 0 : 1)
function LastLoadHint({ last, peak }: { last?: LastLoad; peak: number | null }) {
  if (!last) return null
  const diff = peak != null ? Math.round((peak - last.peak) * 10) / 10 : null
  const tone = diff == null ? '' : diff < 0 ? 'down' : diff > 0 ? 'up' : 'same'
  const top = topSetText(last.exercise.loads ?? last.sets.map((x) => x.kg), last.exercise.reps, last.perSide)
  return (
    <div className={`last-load ${tone}`}>
      <span><b>Última vez</b> ({fmtBR(last.date).slice(0, 5)}): {top}</span>
      {diff != null && <b className="ll-diff">{diff < 0 ? `▼ ${kgFmt(-diff)} kg abaixo` : diff > 0 ? `▲ +${kgFmt(diff)} kg` : '= mesma carga'}</b>}
    </div>
  )
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
  const [quickEdit, setQuickEdit] = useState<string | null>(null) // exercício sendo editado no próprio card
  const lastText = useRef('') // último texto ditado/digitado (contexto para classificar exercícios novos)
  /** Salva o treino com os grupamentos detectados pelos exercícios (músculo principal de cada um). */
  async function persist(exercises: SessionExercise[]) {
    const detected = detectMuscleGroups(exercises, await profileLookup())
    onChange(await save(db.sessions, { ...session, exercises, muscle_groups: detected.length ? detected : session.muscle_groups }))
  }
  const [manualOpen, setManualOpen] = useState(false)
  const [manual, setManual] = useState({ name: '', sets: '3', reps: '10', kg: '', perSide: false })
  const cache = useLiveQuery(() => db.exerciseCache.toArray(), []) ?? []
  // carga da última vez de cada exercício (qualquer treino anterior do aluno)
  const lastMap = useLiveQuery(() => lastLoads(student.id, session), [student.id, session.id]) ?? {}
  const lastFor = (name: string, key?: string): LastLoad | undefined => {
    if (key && lastMap[key]) return lastMap[key]
    const k = normalizeKey(name)
    const prof = cache.find((p) => p.key === k || p.aliases.some((a) => normalizeKey(a) === k))
    return (prof && lastMap[prof.key]) || lastMap[k] || Object.values(lastMap).find((l) => normalizeKey(l.display_name) === k)
  }
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

  /**
   * Uma caixa só para ditar OU digitar: corrige o texto (vocabulário de musculação) e ADICIONA os cards
   * (não apaga os que ainda não foram aprovados). Se nada for entendido, o texto fica na caixa para ajustar.
   */
  function correctAndBuild(text: string) {
    const r = ac(text)
    setChanges(r.changes)
    const fresh = parseSpoken(r.text).map((e) => ({ ...e, key: uid() }))
    if (!fresh.length) { setBox(r.text); return }
    lastText.current = r.text
    setDrafts((d) => mergeConsecutive([...d, ...fresh]))
    setBox('')
    sp.setFinalText('')
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
    await persist(session.exercises.map((x) => (x.id === e.id ? next : x)))
  }

  /** Bi-set: liga (ou desliga) o exercício ao seguinte; os grupos são refeitos pelas ligações em sequência. */
  async function toggleBiset(idx: number) {
    const ex = session.exercises.map((x) => ({ ...x }))
    if (!ex[idx + 1]) return
    const links = ex.slice(0, -1).map((x, i) => x.superset_group != null && x.superset_group === ex[i + 1].superset_group)
    links[idx] = !links[idx]
    let g = 0
    for (let i = 0; i < ex.length; i++) {
      const inRun = links[i - 1] || links[i]
      if (!inRun) { ex[i].superset_group = null; continue }
      if (!links[i - 1]) g++
      ex[i].superset_group = g
    }
    await persist(ex)
  }

  async function approve(list: Draft[]) {
    const ok = list.filter((d) => d.series.length && d.name.trim())
    if (!ok.length) return
    setBusy(true)
    try {
      const profiles = await resolveProfiles(ok.map((d) => d.name), session.muscle_groups, box || lastText.current || sp.finalText)
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
        // drop por série: fica nas observações ("S4 drop: 30 → 20 kg") e marca o exercício como intensificado
        // drop = alta intensidade: a carga cai ~20% três vezes (padrão para medir; sem digitar as cargas)
        const dropNotes = work.map((x, i) => (x.drop ? `S${i + 1} drop` : '')).filter(Boolean)
        const warmupDetail = wu.map((x) => ({ kg: x.kg, reps: { min: x.repsMin ?? 15, max: x.repsMax ?? x.repsMin ?? 15 } }))
        const ex: SessionExercise = {
          id: uid(), position: exercises.length, exercise_key: p.key, display_name: p.name,
          valid_sets: work.length, warmup_sets: wu.length,
          heavy_sets: reps.filter(isHeavy).length,
          reps, loads: hasLoads ? loads : undefined, per_side: d.perSide,
          warmup_detail: warmupDetail.length ? warmupDetail : undefined,
          load_kg: peakOf(all), drop_set: d.drop || dropNotes.length > 0, notes: [d.notes, ...dropNotes].filter(Boolean).join(' · ') || undefined,
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
      await persist(exercises)
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
    await persist(session.exercises.filter((x) => x.id !== e.id))
    setDrafts((d) => [...d, exerciseToDraft(e)])
  }

  async function removeExercise(id: string) {
    await persist(session.exercises.filter((e) => e.id !== id))
  }

  async function finish() {
    if (pse == null) return
    await saveRating(session.id, pse)
    const sleep = (await getCheckin(student.id, session.date))?.sleep ?? null
    const lookup = await profileLookup()
    setSessionDuration(session.id, (Date.now() - new Date(session.created_at).getTime()) / 60000) // duração real p/ calorias
    const agg = aggregateSessions([session], lookup, pse != null ? [{ id: 'x', session_id: session.id, pse, reported_by: 'trainer', created_at: '', updated_at: '' }] : [])
    const ctx = await getWeekContext(student.id, weekStart(session.date))
    const c = { sleep: sleep ?? undefined, diet: ctx?.diet, menstrual: student.sex === 'F' && !!ctx?.menstrual }
    setResult({ level: classifySessionLevel(pse, agg, c), alert: divergenceAlert(session.planned_microcycle, pse, c), kcal: agg.kcal, fatGrams: agg.fatGrams })
    // PDF do treino já pronto ao encerrar: o aluno está na sua frente
    const ex = await treinoDoDiaExtras(student, session)
    const o = { studentName: student.full_name, showName: true, showEmphasis: false, brand: await getBrand(), modality: 'presencial' as const, phase: ex.phase, challenge: ex.challenge, cardio: ex.cardio, prevSame: ex.prevSame, lastTop: ex.lastTop }
    const bests = await previousBests(student.id, session)
    const make = () => templateD(session, lookup, pse, o, bests, ex.last)
    setPdf({ doc: make(), make, name: `treino-${student.full_name.split(' ')[0].toLowerCase()}-${session.date}.pdf` })
  }

  const upd = (k: string, patch: Partial<Draft>) => setDrafts((d) => d.map((x) => (x.key === k ? { ...x, ...patch } : x)))

  if (result) {
    const phone = waNumber(student.phone)
    const wa = phone ? waLink(phone) : ''
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
    <div className="tablet single">
      <div className="left grid" style={{ alignContent: 'start' }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div><h1>{student.full_name.split(' ')[0]} · {session.label}</h1><div className="muted">{session.exercises.length ? `${session.muscle_groups.map((g) => g.replace('Perna - ', '')).join(', ')} · ` : ''}{totals.valid} válidas · {totals.heavy} pesadas</div></div>
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
            <button className={`btn ${ending ? '' : 'ok'}`} onClick={() => setEnding((v) => !v)}>{ending ? 'Continuar treino' : 'Encerrar treino'}</button>
          </div>
        </div>

        {/* PSE logo abaixo do Encerrar treino, só quando ele é tocado */}
        {ending && (
          <div className="card grid pse-card">
            <h2 style={{ margin: 0 }}>Como o aluno respondeu hoje? (PSE 0–10)</h2>
            <div className="pse">{Array.from({ length: 11 }, (_, i) => <button key={i} className={pse === i ? 'on' : ''} onClick={() => setPse(i)}>{i}</button>)}</div>
            <button className="btn primary big" disabled={pse == null} onClick={finish}>Salvar avaliação e encerrar</button>
          </div>
        )}

        <div className="card grid manual-entry">
          {(sp.recording || box.trim()) && (
            <div className="grid" style={{ gap: 6 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <b>{sp.recording ? 'Ouvindo…' : 'Não entendi tudo: corrija e tente de novo'}</b>
                {sp.recording && <span className="tag danger"><Mic size={12} /> gravando</span>}
              </div>
              <textarea id="voice-box" className="code voice-box" rows={1} value={box} readOnly={sp.recording} onChange={(e) => setBox(e.target.value)} />
              {sp.recording && sp.interim && <div className="muted">… {sp.interim}</div>}
              {!sp.recording && (
                <div className="row">
                  <button className="btn primary" disabled={!box.trim()} onClick={() => correctAndBuild(box)}>Tentar de novo</button>
                  <button className="btn" onClick={() => setBox('')}>Descartar</button>
                </div>
              )}
            </div>
          )}
          {changes.length > 0 && (
            <div className="chips">{changes.map((c, i) => <span key={i} className="tag ordinaria">{c.from} → {c.to}</span>)}</div>
          )}
          <button className={`btn hand-btn wide ${manualOpen ? 'open' : ''}`} onClick={() => setManualOpen((v) => !v)}><PencilLine size={18} strokeWidth={1.9} /> {manualOpen ? 'Fechar' : 'Montar à mão'}</button>
          {sp.error && <div className="alert warn">{sp.error}</div>}
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
                      return [nW ? `${nW} aquec.` : '', nV ? `${nV} ${nV === 1 ? 'série válida' : 'séries válidas'}` : '', nH ? `${nH} pesadas` : '', peak != null ? `Maior: ${topSetText(d.series.map((x) => (x.warmup ? null : x.kg)), d.series.map((x) => (x.warmup ? undefined : x.failure ? { min: 0, max: 0, failure: true } : x.repsMin != null ? { min: x.repsMin, max: x.repsMax ?? x.repsMin } : undefined)), d.perSide)}` : '']
                        .filter(Boolean).join(' • ')
                    })()}</span>
                    <label className="row muted" style={{ gap: 6 }}><input type="checkbox" checked={d.perSide} onChange={(e) => upd(d.key, { perSide: e.target.checked })} /> por lado</label>
                    <button className="btn danger icon" aria-label="Remover exercício" onClick={() => setDrafts((x) => x.filter((y) => y.key !== d.key))}><X size={16} /></button>
                  </div>
                  <LastLoadHint last={lastFor(d.name)} peak={peak} />
                  {joins && <div className="muted">Será adicionado ao card “{last.display_name}” (continua a partir da Série {last.valid_sets + 1})</div>}
                  <div className="set-rows">
                    {d.series.map((x, i) => {
                      const workIndex = d.series.slice(0, i + 1).filter((y) => !y.warmup).length
                      const warmIndex = d.series.slice(0, i + 1).filter((y) => y.warmup).length
                      const put = (patch: Partial<SpokenSet>) => setSeries(d.series.map((y, j) => (j === i ? { ...y, ...patch } : y)))
                      return (
                        <div key={i} className={`set-row ${x.warmup ? 'is-warmup' : ''}`}>
                          <span className="set-n">
                            {x.warmup ? `Aquec. ${warmIndex}` : `Série ${(joins ? last.valid_sets : 0) + workIndex}`}
                            {!x.warmup && <button type="button" className={`drop-chip ${x.drop ? 'on' : ''}`} aria-pressed={!!x.drop} title="Drop-set nesta série: alta intensidade (3 quedas de 20% na carga)" onClick={() => put({ drop: !x.drop })}>drop</button>}
                          </span>
                          <label className="f"><span>reps</span>
                            <input key={repsLabel(x)} defaultValue={repsLabel(x)} placeholder="10 ou Máx" onBlur={(e) => put(parseRepsInput(e.target.value))} />
                          </label>
                          <label className="f"><span>{unit}</span>
                            <input inputMode="decimal" value={x.kg ?? ''} onChange={(e) => put({ kg: e.target.value === '' ? null : Number(e.target.value.replace(',', '.')) })} />
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
          {session.exercises.map((e, idx) => {
            const unit = e.per_side ? 'kg/lado' : 'kg'
            const next = session.exercises[idx + 1]
            const prev = session.exercises[idx - 1]
            const withNext = !!next && e.superset_group != null && e.superset_group === next.superset_group
            const withPrev = !!prev && e.superset_group != null && e.superset_group === prev.superset_group
            return (
              <div key={e.id} className={`done-card ${withNext ? 'biset-top' : ''} ${withPrev ? 'biset-bottom' : ''}`}>
                <div className="set-head">
                  <b>{e.display_name}</b>
                  {(withNext || withPrev) && <span className="tag warn">Bi-set</span>}
                  <span className="set-sum">{[e.warmup_sets ? `${e.warmup_sets} aquec.` : '', e.valid_sets ? `${e.valid_sets} ${e.valid_sets === 1 ? 'série válida' : 'séries válidas'}` : '', e.load_kg ? `Maior: ${topSetText(Array.from({ length: e.valid_sets }, (_, i) => e.loads?.[i] ?? e.load_kg), e.reps, !!e.per_side)}` : ''].filter(Boolean).join(' • ')}</span>
                  {e.heavy_sets ? <span className="tag warn">{e.heavy_sets} pesadas</span> : null}
                  <span style={{ marginLeft: 'auto' }} className="row">
                    {e.valid_sets > 0 && <button className="btn" onClick={() => addSeriesToExercise(e)}>+ Série</button>}
                    <button className={`btn ${quickEdit === e.id ? 'primary' : ''}`} onClick={() => setQuickEdit(quickEdit === e.id ? null : e.id)}>Editar</button>
                    {next && <button className={`btn icon biset-btn ${withNext ? 'on' : ''}`} aria-label={withNext ? 'Desfazer bi-set com o próximo' : 'Bi-set com o próximo exercício'} title={withNext ? 'Desfazer bi-set com o próximo' : 'Bi-set com o próximo exercício'} onClick={() => toggleBiset(idx)}><Link2 size={16} /></button>}
                    <button className="btn icon" aria-label="Remover" onClick={() => removeExercise(e.id)}><X size={16} /></button>
                  </span>
                </div>
                <LastLoadHint last={lastFor(e.display_name, e.exercise_key)} peak={e.load_kg ?? null} />
                {quickEdit === e.id && (
                  <>
                    <InlineSetsEditor exercise={e} onCancel={() => setQuickEdit(null)} onSave={async (ne) => { await persist(session.exercises.map((x) => (x.id === e.id ? ne : x))); setQuickEdit(null) }} />
                    <button type="button" className="btn sm link-btn" onClick={() => { setQuickEdit(null); void editExercise(e) }}>Trocar exercício, aquecimento ou drop (edição completa)</button>
                  </>
                )}
                {quickEdit !== e.id && <div className="chips">
                  {(e.warmup_detail ?? []).map((w, i) => (
                    <span key={`w${i}`} className="tag">Aq{i + 1} · {w.reps.min === w.reps.max ? w.reps.min : `${w.reps.min}–${w.reps.max}`}{w.kg != null ? ` × ${kgFmt(w.kg)} ${unit}` : ''}</span>
                  ))}
                  {Array.from({ length: e.valid_sets }, (_, i) => {
                    const r = e.reps[i]
                    const kg = e.loads?.[i] ?? e.load_kg
                    const reps = !r ? '' : r.failure ? 'Máx' : r.min === r.max ? `${r.min}` : `${r.min}–${r.max}`
                    const dr = dropsOf(e.notes)[i + 1]
                    return <span key={i} className={`tag ${dr !== undefined ? 'drop-tag' : r && isHeavy(r) ? 'warn' : ''}`}>S{i + 1} · {reps ? `${reps} × ` : ''}{kg != null ? `${kgFmt(kg)} ${unit}` : '—'}{r && isHeavy(r) && dr === undefined ? ' · pesada' : ''}{dr !== undefined ? ' · drop' : ''}</span>
                  })}
                </div>}
              </div>
            )
          })}
          {!session.exercises.length && <div className="muted">Dite o primeiro exercício no microfone.</div>}
        </div>

        <CardioPanel student={student} date={session.date} compact />

        {previous && (
          <div className="card grid">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0 }}>Cargas do {previous.label} anterior ({fmtBR(previous.date).slice(0, 5)})</h2>
              <span className="muted">maior carga de cada exercício · Repetir cria o card com as mesmas séries para ajustar</span>
            </div>
            {previous.exercises.filter((e) => e.valid_sets > 0).map((e) => {
              const done = session.exercises.some((x) => x.exercise_key === e.exercise_key)
              const top = topSetText(Array.from({ length: e.valid_sets }, (_, i) => e.loads?.[i] ?? e.load_kg), e.reps, !!e.per_side)
              return (
                <div key={e.id} className={`prev-row ${done ? 'done' : ''}`}>
                  <div><b>{done ? '✓ ' : ''}{e.display_name}</b><div className="prev-top">{top}</div></div>
                  {!done && <button className="btn sm" onClick={() => setDrafts((d) => [...d, exerciseToDraft(e)])}>Repetir</button>}
                </div>
              )
            })}
          </div>
        )}

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
