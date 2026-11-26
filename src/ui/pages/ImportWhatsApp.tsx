import { useLiveQuery } from 'dexie-react-hooks'
import { BookOpen, ClipboardCopy, Download, History as HistoryIcon, Save, Send } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { db, getKV, setKV } from '../../data/db'
import { importWhatsApp, resetTimeline, saveStudent, whatsappInWeeks } from '../../data/repo'
import { nextChangeAfter } from '../../domain/plan'
import { effortMessage, itemPoints, techniquesOf, TECHNIQUES, ZONE_LABEL, zoneOf } from '../../engine/effortGuide'
import { getBrand, type Brand } from '../../data/brand'
import { drawPreview } from '../../pdf/charts'
import { sharePdf, templateA, templateE } from '../../pdf/templates'
import type { jsPDF } from 'jspdf'
import { buildWeek, buildWeeksCompare, challengeBase, listWeeks, suggestWeekFor } from '../../data/reportData'
import { addDays, fmtBR, toISODate, weekStart } from '../../engine/metrics'
import { SendByTraining } from '../components/NextCycle'
import { hasWhatsAppHeaders, parsePlainTrainings, parseWhatsAppTrainings, regroupByDate } from '../../parser/whatsapp'
import { ConfirmButton, StudentSelect } from '../components/common'
import { ConsultancyBar } from '../components/ConsultancyBar'

const PLACEHOLDER = `Cole aqui as mensagens do WhatsApp (pode colar várias semanas de uma vez):

[08/11, 21:44] Emanuel Monteiro: *Treino A*
Leg45 2x15 aquecimento + 4x8 Carga alta
Extensora 3x12
*Treino B*
Supino reto 4x8
...
[22/11, 20:10] Emanuel Monteiro: *Treino A* ...

Também aceita texto sem cabeçalho (Treino A / Treino B ou linha em branco).`

export default function ImportWhatsApp() {
  const [params] = useSearchParams()
  const [studentId, setStudentId] = useState(params.get('aluno') ?? '')
  // rascunho vindo de "Anamnese & montagem → Salvar como semana": já entra colado
  const [raw, setRaw] = useState(() => {
    try { const t = sessionStorage.getItem('mgt_paste_prefill'); if (t) { sessionStorage.removeItem('mgt_paste_prefill'); return t } } catch { /* sem armazenamento */ }
    return ''
  })
  const [readText, setReadText] = useState('') // texto lido no "Ler Treinos" (passo 2 → passo 3)
  const student = useLiveQuery(() => (studentId ? db.students.get(studentId) : undefined), [studentId])
  const trainerName = useLiveQuery(() => getKV('trainer_name', 'Emanuel Monteiro'), []) ?? 'Emanuel Monteiro'
  const [msg, setMsg] = useState<string | null>(null)
  const today = toISODate(new Date())
  const headers = useMemo(() => hasWhatsAppHeaders(readText || raw), [readText, raw])
  // cada bloco colado (uma mensagem = A, B, C, D) vai para UMA semana. Padrão: mandado no domingo = semana seguinte.
  const [blockWeek, setBlockWeek] = useState<Record<string, string>>({})
  const [skip, setSkip] = useState<Record<string, boolean>>({}) // blocos desmarcados (não salvar)
  const [guideSaved, setGuideSaved] = useState<string | null>(null) // orientação do último treino salvo
  const [copied, setCopied] = useState(false)
  const [imported, setImported] = useState<{ n: number; wk: string; text?: string } | null>(null)
  const [graph, setGraph] = useState<{ title: string; name: string; make: () => jsPDF } | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    if (graph && canvasRef.current) drawPreview(canvasRef.current, graph.make)
  }, [graph])
  const parsed = useMemo(() => {
    if (!readText) return []
    return headers ? parseWhatsAppTrainings(readText, { trainerName }) : parsePlainTrainings(readText, today)
  }, [readText, trainerName, headers, today])
  // blocos = data da mensagem (texto sem cabeçalho = um bloco só)
  const blocks = useMemo(() => {
    const m = new Map<string, typeof parsed>()
    for (const t of parsed) m.set(t.date, [...(m.get(t.date) ?? []), t])
    const entries = [...m.entries()]
    // veio do atalho "Colar semana de dd/mm": vale só para texto SEM data; com data do WhatsApp, manda a data da mensagem
    const preset = params.get('semana')
    return entries
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([msgDate, trainings]) => ({ msgDate, trainings, week: blockWeek[msgDate] ?? (preset && !headers ? weekStart(preset) : suggestWeekFor(msgDate)), on: !skip[msgDate] }))
  }, [parsed, blockWeek, params, headers, skip])
  // todos os treinos do bloco ficam na segunda-feira da semana escolhida, na ordem A, B, C, D;
  // mensagens de dias diferentes na mesma semana continuam a sequência (A, B na seg + C, D na qua)
  const flat = useMemo(() => {
    const used: Record<string, number> = {}
    return blocks.filter((b) => b.on).flatMap((b) => b.trainings.map((t) => {
      const n = used[b.week] ?? 0
      used[b.week] = n + 1
      return { ...t, date: b.week, week: b.week, label: `Treino ${'ABCDEFGHIJ'[n] ?? n + 1}` }
    }))
  }, [blocks])
  const weeks = useMemo(() => regroupByDate(flat), [flat])
  // orientação de esforço só do que aparece nos treinos marcados (última semana colada)
  const guide = useMemo(() => {
    if (!flat.length) return null
    const lastWk = flat.map((t) => t.week).sort().pop()
    const items = flat.filter((t) => t.week === lastWk).flatMap((t) => t.exercises.map((e) => ({ names: e.names, reps: e.reps, notes: e.notes, dropSet: e.dropSet })))
    return effortMessage(items, student?.full_name.split(' ')[0])
  }, [flat, student])
  const total = flat.length
  const weekKey = weeks.map((w) => w.week).join(',')
  const existing = useLiveQuery(async () => {
    const st = studentId ? await db.students.get(studentId) : undefined
    return st && weekKey ? (await whatsappInWeeks(st, weekKey.split(','))).length : 0
  }, [studentId, weekKey]) ?? 0

  async function doImport() {
    const fresh = await db.students.get(studentId)
    if (!fresh) return setMsg('Selecione o aluno.')
    const n = await importWhatsApp(fresh, weeks, true)
    const wk = weeks[weeks.length - 1].week
    // treino colado = treino enviado: agenda a próxima troca pelo plano, a partir da semana MAIS RECENTE do aluno
    // (colar semanas antigas não joga a troca para o passado)
    const latest = (await listWeeks(fresh))[0]?.wk ?? wk
    if (fresh.plan_period) {
      const nextChange = nextChangeAfter(fresh.plan_period, latest)
      await saveStudent({ ...(await db.students.get(fresh.id))!, next_change_date: nextChange })
    }
    // na hora: semana nova × semana anterior salva (ou só a semana, se for a primeira)
    const brand: Brand = await getBrand()
    const o = { studentName: fresh.full_name, showName: true, showEmphasis: false, brand, modality: fresh.modality, challenge: fresh.modality === 'online' ? await challengeBase(fresh) : undefined }
    const prevWk = (await listWeeks(fresh)).find((w) => w.wk < wk)?.wk
    if (prevWk) {
      const c = await buildWeeksCompare(fresh, prevWk, wk)
      setGraph({ title: `Semana de ${fmtBR(prevWk)} × semana de ${fmtBR(wk)}`, name: `semanas-${fresh.full_name.split(' ')[0].toLowerCase()}-${prevWk}-x-${wk}.pdf`, make: () => templateA(c.before, c.after, o, c.perTraining) })
    } else {
      const w = await buildWeek(fresh, wk)
      setGraph({ title: `Semana de ${fmtBR(wk)}`, name: `semana-${fresh.full_name.split(' ')[0].toLowerCase()}-${wk}.pdf`, make: () => templateE(w.wk, w.items, w.cur, w.prev, o) })
    }
    setImported({ n, wk, text: flat.filter((t) => t.week === wk).map((t) => `*${t.label}*\n${t.rawText.trim()}`).join('\n\n') })
    setMsg(`${n} treinos salvos${weeks.length === 1 ? ` na semana de ${fmtBR(wk)}` : ` em ${weeks.length} semanas (${weeks.map((w) => fmtBR(w.week).slice(0, 5)).join(', ')})`}.${fresh.plan_period ? ` Próxima troca: ${fmtBR(nextChangeAfter(fresh.plan_period, latest))}.` : ''}`)
    setGuideSaved(guide)
    setRaw('')
    setReadText('')
    setBlockWeek({})
    setSkip({})
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Consultoria Online — colar do WhatsApp</h1><div className="muted">1 · selecione o aluno → 2 · cole e leia os treinos → 3 · confira a semana e salve (a comparação com a semana anterior sai na hora)</div></div>
      </div>
      <section className="step card grid">
        <div className="step-head"><span className="step-n">1</span>Selecionar aluno</div>
        <div className="grid cols-2">
          <StudentSelect value={studentId} onChange={(id) => { setStudentId(id); setMsg(null); setGraph(null); setImported(null) }} modality="online" />
          <label className="f">Remetente do treinador (opcional)
            <input defaultValue={trainerName} onBlur={(e) => setKV('trainer_name', e.target.value)} />
          </label>
        </div>
        {student && <ConsultancyBar student={student} showPaste={false} />}
        {student && (
          <div className="row">
            <ConfirmButton label="Novo Aluno (Zerar Base)" confirmLabel="Confirmar: começar a linha do tempo do zero" onConfirm={async () => { await resetTimeline(student); setMsg('Base zerada: os próximos treinos salvos começam uma linha do tempo nova.') }} />
          </div>
        )}
      </section>

      <section className="step card grid">
        <div className="step-head"><span className="step-n">2</span>Colar a mensagem do WhatsApp</div>
        <textarea className="code" style={{ minHeight: 300 }} placeholder={PLACEHOLDER} value={raw} onChange={(e) => setRaw(e.target.value)} />
        <div className="row">
          <button className="btn primary big" disabled={!raw.trim()} onClick={() => { setReadText(raw); setBlockWeek({}); setSkip({}); setMsg(null) }}><BookOpen size={16} strokeWidth={1.8} /> Ler Treinos</button>
          {readText && raw !== readText && <span className="muted">O texto mudou — toque em Ler Treinos de novo.</span>}
        </div>
        <div className="muted">Retroativo: no WhatsApp, toque e segure a 1ª mensagem do treino, toque nas outras (pode pegar várias semanas) e em <b>Copiar</b>. Assim vem a data de cada mensagem e o app separa as semanas sozinho. Mensagem copiada sozinha vem sem data: aí você escolhe a semana no passo 3.</div>
        {readText && !total && !blocks.length && <div className="alert warn">Nenhum treino reconhecido no texto colado. Confira se há séries (ex.: 4x10, 3x8 a 12, 15/12/10).</div>}
      </section>

      <section className="step card grid">
        <div className="step-head"><span className="step-n">3</span>Conferir e salvar</div>
        {!total && !graph && <div className="muted">Os treinos lidos aparecem aqui, organizados por bloco (data).</div>}
        <div className="grid">
          {blocks.length > 1 && (
            <div className="alert ok">
              Identifiquei <b>{new Set(blocks.map((b) => b.week)).size} semanas</b> pelas datas do WhatsApp: {[...new Set(blocks.map((b) => b.week))].map((w) => fmtBR(w).slice(0, 5)).join(', ')}. Confira cada uma abaixo e desmarque o que não quiser salvar.
            </div>
          )}
          {blocks.map((b, bi) => (
            <div key={b.msgDate} className={`card grid wa-block ${b.on ? '' : 'off'}`} style={{ background: 'var(--panel-2)' }}>
              <label className="row" style={{ justifyContent: 'space-between' }}>
                <span className="row" style={{ gap: 10 }}>
                  <input type="checkbox" checked={b.on} onChange={(e) => setSkip((o) => ({ ...o, [b.msgDate]: !e.target.checked }))} />
                  <b style={{ fontSize: 16 }}>{blocks.length > 1 ? `Bloco ${bi + 1}: ` : ''}Semana de {fmtBR(b.week).slice(0, 5)}</b>
                </span>
                <span className="muted">{b.trainings.length} treinos{headers ? ` · mensagem de ${fmtBR(b.msgDate).slice(0, 5)}` : ' · texto sem data'}</span>
              </label>
              {b.on && (
                <div className="grid" style={{ gap: 8 }}>
                  <div className="chips">
                    {(headers ? [suggestWeekFor(b.msgDate)] : []).concat([0, 1, 2, 3, 4, 5].map((k) => addDays(weekStart(today), -7 * k))).filter((w, i, a) => a.indexOf(w) === i).slice(0, 6).map((w) => (
                      <button key={w} type="button" className={`chip sm ${b.week === w ? 'on' : ''}`} onClick={() => setBlockWeek((o) => ({ ...o, [b.msgDate]: w }))}>
                        {headers && w === suggestWeekFor(b.msgDate) ? `${fmtBR(w).slice(0, 5)} (pela data)` : w === weekStart(today) ? `${fmtBR(w).slice(0, 5)} (atual)` : fmtBR(w).slice(0, 5)}
                      </button>
                    ))}
                  </div>
                  <label className="f">Outra semana (qualquer dia dela)
                    <input type="date" className="wa-week" value={b.week} onChange={(e) => e.target.value && setBlockWeek((o) => ({ ...o, [b.msgDate]: weekStart(e.target.value) }))} />
                    <span className="muted">Semana de {fmtBR(b.week)} a {fmtBR(addDays(b.week, 6))}</span>
                  </label>
                </div>
              )}
              {b.on && <div className="wa-cards">
                {b.trainings.map((t, ti) => {
                  const valid = t.exercises.reduce((a, e) => a + e.validSets * e.names.length, 0)
                  const warm = t.exercises.reduce((a, e) => a + e.warmupSets * e.names.length, 0)
                  return (
                    <div key={ti} className="wa-card">
                      <div className="row" style={{ justifyContent: 'space-between' }}><b>{t.label}</b><span className="tag">desafio {Math.round(t.exercises.reduce((a, e) => a + itemPoints({ names: e.names, reps: e.reps, notes: e.notes, dropSet: e.dropSet }), 0))} pts</span></div>
                      <div className="set-sum">{valid} séries válidas{warm ? ` • ${warm} aquec. fora da conta` : ''}</div>
                      <table className="t"><tbody>
                        {t.exercises.map((e, i) => (
                          <tr key={i}>
                            <td>
                              {e.names.join(' + ')}
                              {e.notes ? <div className="muted">{e.notes}</div> : null}
                              {/* conferência: o que o app entendeu */}
                              <div className="wa-read">
                                {repsText(e.reps) && <span className="tag">{repsText(e.reps)}</span>}
                                {techniquesOf({ names: e.names, reps: e.reps, notes: e.notes, dropSet: e.dropSet }).map((k) => <span key={k} className={`tag ${k === 'cadencia' ? '' : 'warn'}`}>{TECHNIQUES.find((t) => t.key === k)?.label}</span>)}
                              </div>
                            </td>
                            <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>{e.validSets * e.names.length} válidas{e.warmupSets ? <span className="muted"> · {e.warmupSets * e.names.length} aquec.</span> : ''}<div className="muted">{itemPoints({ names: e.names, reps: e.reps, notes: e.notes, dropSet: e.dropSet })} pts</div></td>
                          </tr>
                        ))}
                      </tbody></table>
                      {t.ignoredLines.length > 0 && <div className="muted">Ignorado: {t.ignoredLines.join(' · ')}</div>}
                    </div>
                  )
                })}
              </div>}
            </div>
          ))}
        </div>
        {(guide || guideSaved) && <EffortGuideBox text={(total ? guide : guideSaved) ?? ''} phone={student?.phone} copied={copied} onCopied={() => { setCopied(true); setTimeout(() => setCopied(false), 2500) }} />}
        {total > 0 && existing > 0 && <div className="alert warn">Já existem {existing} treinos colados {weeks.length > 1 ? 'nessas semanas' : 'nessa semana'} para este aluno. Ao salvar, eles serão substituídos por estes.</div>}
        {total > 0 && (
          <div className="row">
            <button className="btn primary big" disabled={!studentId} onClick={doImport}><Save size={16} strokeWidth={1.8} /> {existing ? 'Substituir e salvar' : 'Salvar no histórico'} ({total} treinos{weeks.length > 1 ? ` · ${weeks.length} semanas` : ''})</button>
            {!studentId && <span className="muted">Selecione o aluno no passo 1.</span>}
          </div>
        )}
        {msg && <div className="alert ok">{msg}</div>}
        {imported?.text && student && <SendByTraining text={imported.text} phone={student.phone ?? ''} />}
        {graph && (
          <div className="card grid">
            <b>{graph.title}</b>
            <canvas ref={canvasRef} className="pdf-preview" aria-label="Comparação semanal" />
            <div className="row">
              <button className="btn ok" onClick={() => sharePdf(graph.make(), graph.name)}><Download size={16} strokeWidth={1.8} /> Enviar / baixar PDF</button>
              {imported && student && <>
                <Link className="btn" to={`/relatorios?aluno=${student.id}&tpl=W&semana2=${imported.wk}`}>Escolher outras semanas</Link>
                <Link className="btn" to={`/historico?aluno=${student.id}`}><HistoryIcon size={16} strokeWidth={1.8} /> Ver no histórico</Link>
              </>}
            </div>
          </div>
        )}
      </section>
    </>
  )
}

/** "6–8 reps · força alta" a partir das séries lidas. */
function repsText(reps: { min: number; max: number; failure?: boolean }[]): string {
  if (!reps.length) return ''
  const fmt = (r: { min: number; max: number; failure?: boolean }) => (r.failure && !r.min ? 'Máx' : r.min === r.max ? `${r.min}` : `${r.min}–${r.max}`)
  const uniq = [...new Set(reps.map(fmt))]
  const z0 = zoneOf(reps[0])
  const z = zoneOf(reps[reps.length - 1])
  const zl = z0 && z && z0 !== z ? `${ZONE_LABEL[z0]} → ${ZONE_LABEL[z]}` : z ? ZONE_LABEL[z] : ''
  return `${uniq.length > 1 ? uniq.join('/') : uniq[0]}${uniq[0] === 'Máx' ? '' : ' reps'}${zl ? ` · ${zl}` : ''}`
}

/** Mensagem pronta para o aluno: que esforço cada faixa e cada técnica do treino pedem. */
function EffortGuideBox({ text, phone, copied, onCopied }: { text: string; phone?: string; copied: boolean; onCopied: () => void }) {
  const digits = (phone ?? '').replace(/\D/g, '')
  const wa = `https://wa.me/${digits ? (digits.length <= 11 ? '55' + digits : digits) : ''}?text=${encodeURIComponent(text)}`
  return (
    <div className="card grid">
      <b>Orientação de esforço para o aluno</b>
      <div className="muted">Só o que aparece neste treino. Mande junto com o treino para ele saber que esforço sentir em cada série.</div>
      <pre className="guide-text">{text}</pre>
      <div className="row stack-sm">
        <a className="btn primary" href={wa} target="_blank" rel="noreferrer"><Send size={16} strokeWidth={1.8} /> Enviar no WhatsApp</a>
        <button className="btn" onClick={async () => { try { await navigator.clipboard.writeText(text); onCopied() } catch { /* sem permissão */ } }}><ClipboardCopy size={16} strokeWidth={1.8} /> {copied ? 'Copiado!' : 'Copiar texto'}</button>
      </div>
    </div>
  )
}
