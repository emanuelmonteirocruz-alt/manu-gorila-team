import { useLiveQuery } from 'dexie-react-hooks'
import { Check, ClipboardCopy, ClipboardPaste, MessageSquare, Save, Send, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getKV } from '../../data/db'
import { anamneseTemplateText, getAnamnese, profileLookup, saveAnamnese, studentSessions } from '../../data/repo'
import { listWeeks, weekLabel } from '../../data/reportData'
import { answersFromPasted, parseTemplate } from '../../consultoria/anamneseTemplate'
import { buildTriage } from '../../consultoria/triage'
import { remindersFor } from '../../consultoria/reminders'
import { generateWeek, splitForWhatsApp, weekToWhatsApp, type Intensity } from '../../consultoria/generator'
import { MICRO_LABEL, type Microcycle, type Student } from '../../domain/types'
import { addDays, fmtBR } from '../../engine/metrics'
import { nextWeekToPaste } from '../../domain/plan'

const short = (g: string) => g.replace('Perna - ', '')

/**
 * Anamnese da consultoria (acréscimo): ficha de perguntas do modelo editável, resumo de triagem,
 * lembretes de processos/exercícios e rascunho da próxima semana no padrão do WhatsApp.
 */
export function AnamnesePanel({ student }: { student: Student }) {
  const tplText = useLiveQuery(anamneseTemplateText, []) ?? ''
  const trainerName = useLiveQuery(() => getKV('trainer_name', 'Emanuel Monteiro'), []) ?? 'Emanuel Monteiro'
  const sections = useMemo(() => parseTemplate(tplText), [tplText])
  const saved = useLiveQuery(() => getAnamnese(student.id), [student.id])
  const [answers, setAnswers] = useState<Record<string, string> | null>(null)
  const [paste, setPaste] = useState('')
  const [open, setOpen] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const cur = answers ?? saved?.answers ?? {}
  const filled = Object.values(cur).filter((v) => v.trim()).length
  const total = sections.reduce((a, s) => a + s.questions.length, 0)
  const triage = useMemo(() => buildTriage(sections, cur), [sections, cur])
  const enfases = student.emphasis?.length ? student.emphasis : triage.enfases
  const rem = useMemo(() => remindersFor(triage, enfases), [triage, enfases])
  useEffect(() => { if (saved && answers == null && !filled) setOpen(false) }, [saved, answers, filled])

  async function doSave() {
    await saveAnamnese(student.id, cur, paste.trim() || undefined)
    setAnswers(null)
    setMsg('Anamnese salva.')
    setTimeout(() => setMsg(null), 2500)
  }

  return (
    <div className="grid">
      {/* 1) Anamnese */}
      <div className="card grid">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Anamnese</h2>
          <span className="muted">{filled} de {total} respondidas{saved ? ` · salva em ${fmtBR(saved.updated_at.slice(0, 10))}` : ''}</span>
        </div>
        <details>
          <summary className="btn sm"><ClipboardPaste size={15} strokeWidth={1.8} /> Colar anamnese respondida</summary>
          <div className="grid" style={{ marginTop: 8 }}>
            <textarea className="code" style={{ minHeight: 160 }} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Cole aqui as respostas (WhatsApp, formulário…). O app encontra cada pergunta do seu modelo e preenche as respostas." />
            <div className="row">
              <button className="btn primary" disabled={!paste.trim()} onClick={() => {
                const found = answersFromPasted(paste, sections, trainerName)
                setAnswers({ ...cur, ...found })
                setOpen(true)
                setMsg(`${Object.keys(found).length} respostas encontradas no texto. Confira abaixo e salve.`)
              }}>Ler respostas</button>
            </div>
          </div>
        </details>
        <button className="btn" onClick={() => setOpen((v) => !v)}>{open ? 'Esconder perguntas' : 'Preencher / editar respostas'}</button>
        {open && sections.map((sec) => (
          <div key={sec.title} className="grid anam-sec">
            <b>{sec.title}</b>
            {sec.questions.map((q) => (
              <label key={q.id} className="f">{q.label}
                {q.options && (
                  <div className="chips">
                    {q.options.map((op) => (
                      <button key={op} type="button" className={`chip sm ${cur[q.id] === op ? 'on' : ''}`} onClick={() => setAnswers({ ...cur, [q.id]: cur[q.id] === op ? '' : op })}>{op}</button>
                    ))}
                  </div>
                )}
                <textarea rows={q.options ? 1 : 2} value={cur[q.id] ?? ''} onChange={(e) => setAnswers({ ...cur, [q.id]: e.target.value })} placeholder={q.options ? 'ou escreva' : ''} />
              </label>
            ))}
          </div>
        ))}
        <div className="row">
          <button className="btn primary" disabled={answers == null} onClick={doSave}><Save size={16} strokeWidth={1.8} /> Salvar anamnese</button>
          {msg && <span className="tag ok">{msg}</span>}
        </div>
      </div>

      {/* 2) Resumo de triagem */}
      {filled > 0 && <TriageCard triage={triage} enfases={enfases} fromFicha={!!student.emphasis?.length} />}

      {/* 3) Lembretes */}
      {filled > 0 && (
        <div className="card grid">
          <h2 style={{ margin: 0 }}>Lembretes antes de fechar o treino</h2>
          <RemList title="Processos recomendados" items={rem.processos} />
          <RemList title="Exercícios indicados" items={rem.preferir} />
          <RemList title="Evitar ou revisar" items={rem.evitar} tone="warn" />
          <RemList title="Pontos de atenção" items={rem.atencao} tone="warn" />
          {!rem.processos.length && !rem.preferir.length && !rem.evitar.length && !rem.atencao.length && <div className="muted">Sem lembretes específicos para as respostas atuais.</div>}
          <div className="muted">Guia de consulta rápida (não substitui avaliação médica ou fisioterapêutica). As regras ficam em src/consultoria/reminders.ts e vamos calibrando juntos.</div>
        </div>
      )}

      {/* 4) Rascunho da próxima semana */}
      <WeekDraft student={student} triage={filled ? triage : null} enfases={enfases} />
    </div>
  )
}

function RemList({ title, items, tone }: { title: string; items: string[]; tone?: 'warn' }) {
  if (!items.length) return null
  return (
    <div className="grid" style={{ gap: 4 }}>
      <span className={`muted ${tone === 'warn' ? 'rem-warn' : ''}`} style={{ fontWeight: 700 }}>{title}</span>
      <ul className="rem-list">{items.map((x) => <li key={x}>{x}</li>)}</ul>
    </div>
  )
}

function TriageCard({ triage: t, enfases, fromFicha }: { triage: ReturnType<typeof buildTriage>; enfases: string[]; fromFicha: boolean }) {
  const COND: Record<string, string> = { hipertensao: 'pressão alta', diabetes: 'diabetes', gestante: 'gestante', labirintite: 'labirintite', cirurgia: 'cirurgia', asma: 'asma', endometriose: 'endometriose', hernia: 'hérnia', cardiaco: 'condição cardíaca' }
  const perfil = [t.perfil.idade && `${t.perfil.idade.replace(/\s*anos?/i, '')} anos`, t.perfil.altura && `${t.perfil.altura} m`, t.perfil.peso].filter(Boolean).join(' · ')
  const rows: [string, string | null, boolean?][] = [
    ['Objetivo', t.objetivo],
    ['Perfil', perfil || null],
    ['Ênfase', enfases.length ? `${enfases.map(short).join(', ')}${fromFicha ? ' (da ficha)' : ''}` : null],
    ['Não pode / não consegue', t.evitarExercicios.length ? t.evitarExercicios.join(', ') : null, true],
    ['Dores / lesões / restrições', t.restricoes.length ? t.restricoes.map((r) => `${r.label}: ${r.source}`).join(' · ') : null, true],
    ['Condições de saúde', t.condicoes.length ? t.condicoes.map((c) => COND[c] ?? c).join(', ') : null, true],
    ['Medicamentos', t.medicamentos.join(' · ') || null],
    ['Dificuldades', t.dificuldades.join(' · ') || null],
    ['Preferências', [...t.preferencias, ...t.naoGosta.map((x) => `não gosta: ${x}`)].join(' · ') || null],
    ['Rotina', [t.diasTexto ? `${t.diasTexto.replace(/\s*dias?.*$/i, '')} dias por semana` : t.dias ? `${t.dias}x por semana` : '', t.tempoMin ? `${t.tempoMin} min por treino` : '', t.local ?? '', t.atividade ? `outra atividade: ${t.atividade}` : ''].filter(Boolean).join(' · ') || null],
    ['Experiência', t.experiencia ? ({ iniciante: 'Iniciante', intermediario: 'Intermediário', avancado: 'Avançado' } as const)[t.experiencia] : null],
    ['Dieta', t.dieta],
    ['Sono', t.sono],
    ['Ciclo', t.ciclo],
    ['Observações', t.observacoes.join(' · ') || null],
  ]
  return (
    <div className="card grid">
      <h2 style={{ margin: 0 }}>Resumo de triagem</h2>
      <div className="triage">
        {rows.filter(([, v]) => v).map(([k, v, alert]) => (
          <div key={k} className={alert ? 'tr-row tr-alert' : 'tr-row'}><span>{k}</span><b>{v}</b></div>
        ))}
      </div>
    </div>
  )
}

function WeekDraft({ student, triage, enfases }: { student: Student; triage: ReturnType<typeof buildTriage> | null; enfases: string[] }) {
  const nav = useNavigate()
  const weeks = useLiveQuery(() => listWeeks(student), [student.id]) ?? []
  const [wk, setWk] = useState('')
  const base = wk || weeks[0]?.wk || ''
  const [phase, setPhase] = useState<Microcycle>('ordinaria')
  const [intensity, setIntensity] = useState<Intensity>(0)
  const [alerts, setAlerts] = useState(true)
  const [text, setText] = useState('')
  const [copied, setCopied] = useState(false)
  const [summary, setSummary] = useState<string[]>([])

  async function generate() {
    if (!base) return
    const sessions = await studentSessions(student, base, addDays(base, 6))
    const lookup = await profileLookup()
    const week = generateWeek({ base: sessions, phase, intensity, enfases, triage, lookup })
    setText(weekToWhatsApp(week, alerts))
    setSummary(week.flatMap((t) => t.exercises.filter((e) => e.changes.length || e.alert).map((e) => `${t.label.replace('Treino ', '')} · ${e.names.join(' + ')}: ${[...e.changes, e.alert].filter(Boolean).join(', ')}`)))
  }
  const digits = (student.phone ?? '').replace(/\D/g, '')
  const wa = `https://wa.me/${digits ? (digits.length <= 11 ? '55' + digits : digits) : ''}?text=${encodeURIComponent(text)}`
  const nextWk = nextWeekToPaste(student.plan_period, weeks[0]?.wk ?? null)

  return (
    <div className="card grid">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}><Sparkles size={16} strokeWidth={1.8} /> Rascunho da próxima semana</h2>
        <span className="muted">no seu padrão do WhatsApp</span>
      </div>
      {!weeks.length ? <div className="muted">Cole pelo menos uma semana de treino deste aluno: o rascunho parte da última semana e evolui a partir dela.</div> : (<>
        <label className="f">Semana de referência
          <select value={base} onChange={(e) => setWk(e.target.value)}>
            {weeks.map((w) => <option key={w.wk} value={w.wk}>{weekLabel(w)}</option>)}
          </select>
        </label>
        <div className="grid" style={{ gap: 6 }}>
          <span className="muted" style={{ fontWeight: 600 }}>Protocolo</span>
          <div className="chips">
            {(['ordinaria', 'choque', 'regenerativa'] as Microcycle[]).map((p) => (
              <button key={p} className={`chip sm ${phase === p ? 'on' : ''}`} onClick={() => setPhase(p)}>{MICRO_LABEL[p]}</button>
            ))}
          </div>
          <span className="muted" style={{ fontWeight: 600 }}>Intensidade</span>
          <div className="chips">
            {([[-1, 'Diminuir'], [0, 'Manter'], [1, 'Aumentar']] as [Intensity, string][]).map(([v, l]) => (
              <button key={v} className={`chip sm ${intensity === v ? 'on' : ''}`} onClick={() => setIntensity(v)}>{l}</button>
            ))}
          </div>
          <div className="muted">Ênfase: {enfases.length ? enfases.map(short).join(', ') : 'nenhuma definida (ficha ou anamnese)'}{triage?.restricoes.length ? ` · restrições: ${triage.restricoes.map((r) => r.label).join(', ')}` : ''}</div>
          <label className="row"><input type="checkbox" checked={alerts} onChange={(e) => setAlerts(e.target.checked)} /> Mostrar "(revisar)" nos exercícios que pedem atenção pelas restrições</label>
        </div>
        <button className="btn primary big" onClick={generate}><Sparkles size={16} strokeWidth={1.8} /> Gerar rascunho</button>
      </>)}
      {text && (<>
        {summary.length > 0 && (
          <details>
            <summary className="muted" style={{ cursor: 'pointer', fontWeight: 600 }}>O que mudou ({summary.length})</summary>
            <ul className="rem-list">{summary.map((x) => <li key={x}>{x}</li>)}</ul>
          </details>
        )}
        <textarea className="code" style={{ minHeight: 320 }} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="muted">Revise e ajuste à vontade antes de mandar. Apague as linhas "(revisar…)" depois de conferir.</div>
        <SendByTraining text={text} phone={student.phone ?? ''} />
        <div className="row stack-sm">
          <a className="btn primary" href={wa} target="_blank" rel="noreferrer"><Send size={16} strokeWidth={1.8} /> Enviar no WhatsApp</a>
          <button className="btn" onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2500) } catch { /* sem permissão */ } }}><ClipboardCopy size={16} strokeWidth={1.8} /> {copied ? 'Copiado!' : 'Copiar'}</button>
          <button className="btn" onClick={() => {
            try { sessionStorage.setItem('mgt_paste_prefill', text.replace(/^\(revisar[^)]*\)\s*$/gm, '').replace(/\n{3,}/g, '\n\n')) } catch { /* sem armazenamento */ }
            nav(`/consultoria?aluno=${student.id}&semana=${nextWk}`)
          }}><MessageSquare size={16} strokeWidth={1.8} /> Salvar como semana de {fmtBR(nextWk).slice(0, 5)}</button>
        </div>
      </>)}
    </div>
  )
}

/**
 * Uma mensagem por treino: cada botão abre o WhatsApp do aluno já com aquele treino escrito
 * (ou copia só ele). Fica marcado o que já foi enviado, para seguir A → B → C sem se perder.
 */
function SendByTraining({ text, phone }: { text: string; phone: string }) {
  const msgs = useMemo(() => splitForWhatsApp(text), [text])
  const [sent, setSent] = useState<Record<string, boolean>>({})
  const [copied, setCopied] = useState('')
  useEffect(() => setSent({}), [msgs.length])
  if (msgs.length < 2) return null
  const digits = phone.replace(/\D/g, '')
  const waOf = (t: string) => `https://wa.me/${digits ? (digits.length <= 11 ? '55' + digits : digits) : ''}?text=${encodeURIComponent(t)}`
  const mark = (label: string) => setSent((s) => ({ ...s, [label]: true }))
  const next = msgs.find((m) => !sent[m.label])
  return (
    <div className="card grid send-by" style={{ gap: 8 }}>
      <b>Mandar um treino por mensagem</b>
      <div className="muted">
        Toque em <b>Enviar</b>: o WhatsApp abre {digits ? 'na conversa do aluno ' : ''}já com aquele treino escrito, é só mandar e voltar para o próximo.
        {!digits && ' Sem telefone na ficha, o WhatsApp pede para escolher a conversa.'} As linhas "(revisar…)" não vão para o aluno.
      </div>
      {msgs.map((m) => (
        <div key={m.label} className={`row send-row ${sent[m.label] ? 'done' : ''}`} style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
          <span style={{ fontWeight: 600 }}>
            {sent[m.label] ? <Check size={16} strokeWidth={2.2} style={{ verticalAlign: -3, color: 'var(--ok, #16a34a)' }} /> : null} {m.label}
            <span className="muted" style={{ fontWeight: 400 }}> · {m.text.split(/\n\s*\n/).length} exercícios</span>
          </span>
          <span className="row" style={{ gap: 6 }}>
            <a className={`btn ${next?.label === m.label ? 'primary' : ''}`} href={waOf(m.text)} target="_blank" rel="noreferrer" onClick={() => mark(m.label)}>
              <Send size={16} strokeWidth={1.8} /> Enviar {m.label.replace('Treino ', '')}
            </a>
            <button className="btn" onClick={async () => {
              try { await navigator.clipboard.writeText(m.text); setCopied(m.label); mark(m.label); setTimeout(() => setCopied(''), 2500) } catch { /* sem permissão */ }
            }}><ClipboardCopy size={16} strokeWidth={1.8} /> {copied === m.label ? 'Copiado!' : 'Copiar'}</button>
          </span>
        </div>
      ))}
      {!next && <div className="muted">Todos os treinos enviados.</div>}
    </div>
  )
}
