import { useLiveQuery } from 'dexie-react-hooks'
import { Check, ClipboardCopy, MessageSquare, Send, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { anamneseTemplateText, getAnamnese, profileLookup, studentSessions } from '../../data/repo'
import { listWeeks, weekLabel } from '../../data/reportData'
import { parseTemplate } from '../../consultoria/anamneseTemplate'
import { buildTriage, type Triage } from '../../consultoria/triage'
import { remindersFor } from '../../consultoria/reminders'
import { generateWeek, missingEmphasis, splitForWhatsApp, weekToWhatsApp, type Intensity } from '../../consultoria/generator'
import { MICRO_LABEL, MUSCLE_GROUPS, type Microcycle, type Student } from '../../domain/types'
import { addDays, fmtBR } from '../../engine/metrics'
import { nextWeekToPaste } from '../../domain/plan'
import { RemList } from './AnamnesePanel'
import TrainerNotes from './TrainerNotes'
import { generateFirstWeek } from '../../consultoria/firstWeek'

const short = (g: string) => g.replace('Perna - ', '')

/**
 * PRÓXIMO CICLO (único lugar de montar o treino da consultoria):
 * você escolhe protocolo, intensidade e ênfase; o app parte da semana colada e aplica
 * as restrições e lembretes da anamnese do aluno automaticamente.
 */
export default function NextCycle({ student, onOpenAnamnese }: { student: Student; onOpenAnamnese?: () => void }) {
  const nav = useNavigate()
  const weeks = useLiveQuery(() => listWeeks(student), [student.id]) ?? []
  const tplText = useLiveQuery(anamneseTemplateText, []) ?? ''
  const anam = useLiveQuery(() => getAnamnese(student.id), [student.id])
  const triage: Triage | null = useMemo(() => {
    if (!anam || !Object.values(anam.answers ?? {}).some((v) => v?.trim())) return null
    return buildTriage(parseTemplate(tplText), anam.answers)
  }, [anam, tplText])
  const suggested = student.emphasis?.length ? student.emphasis : triage?.enfases ?? []

  const [wk, setWk] = useState('')
  const base = wk || weeks[0]?.wk || ''
  const [phase, setPhase] = useState<Microcycle>('ordinaria')
  const [intensity, setIntensity] = useState<Intensity>(0)
  const [enfases, setEnfases] = useState<string[] | null>(null)
  const emph = enfases ?? suggested
  const [alerts, setAlerts] = useState(true)
  const [text, setText] = useState('')
  const [copied, setCopied] = useState(false)
  const [summary, setSummary] = useState<string[]>([])
  const [notice, setNotice] = useState<string[]>([])
  const [days, setDays] = useState<number | null>(null)
  const [minutes, setMinutes] = useState<number | ''>('')
  const isNew = !weeks.length
  const daysV = days ?? Math.max(1, Math.min(5, triage?.dias ?? 3))
  const minutesV = minutes || triage?.tempoMin || 60
  const rem = useMemo(() => (triage ? remindersFor(triage, emph) : null), [triage, emph])

  async function generate() {
    if (isNew) {
      // aluno novo: 1ª semana montada pela anamnese (dias, tempo, ênfase, restrições, experiência)
      const week = generateFirstWeek({ triage, enfases: emph, days: daysV, minutes: minutesV })
      setText(weekToWhatsApp(week, alerts))
      setSummary([])
      setNotice([
        ...(triage?.glp1 ? ['Monjaro/Ozempic nas observações ou na anamnese: volume moderado, foco em força e progressão de carga para preservar massa magra; vá ajustando pela resposta dela.'] : []),
        ...(!triage ? ['Sem anamnese salva: montei só pelos dias, tempo e ênfase escolhidos.'] : []),
      ])
      return
    }
    if (!base) return
    const sessions = await studentSessions(student, base, addDays(base, 6))
    const lookup = await profileLookup()
    const history = (await studentSessions(student)).filter((x) => x.date < base).slice(-40) // ~últimas semanas: o choque evita repetir variável
    const week = generateWeek({ base: sessions, phase, intensity, enfases: emph, triage, lookup, history })
    setText(weekToWhatsApp(week, alerts))
    const moved = week.filter((t) => t.movedFrom).map((t) => `${t.label}: era o ${t.movedFrom} (veio para a frente pela ênfase)`)
    setSummary([...moved, ...week.flatMap((t) => t.exercises.filter((e) => e.changes.length || e.alert).map((e) => `${t.label.replace('Treino ', '')} · ${e.names.join(' + ')}: ${[...e.changes, e.alert].filter(Boolean).join(', ')}`))])
    const miss = missingEmphasis(sessions, emph, lookup)
    setNotice([
      ...(miss.length ? [`${miss.map(short).join(' e ')} não aparece${miss.length > 1 ? 'm' : ''} em nenhum exercício da semana de referência: inclua um exercício no texto antes de mandar.`] : []),
      ...(triage?.glp1 ? ['Monjaro/Ozempic: o rascunho segurou as técnicas (no máximo uma variável por treino, sem FST-7, falha ou parciais). Volume moderado e foco em força para preservar massa magra.'] : []),
    ])
  }
  const toggle = (g: string) => setEnfases(emph.includes(g) ? emph.filter((x) => x !== g) : [...emph, g])
  const digits = (student.phone ?? '').replace(/\D/g, '')
  const wa = `https://wa.me/${digits ? (digits.length <= 11 ? '55' + digits : digits) : ''}?text=${encodeURIComponent(text)}`
  const nextWk = nextWeekToPaste(student.plan_period, weeks[0]?.wk ?? null)
  const COND: Record<string, string> = { hipertensao: 'pressão alta', diabetes: 'diabetes', gestante: 'gestante', labirintite: 'labirintite', cirurgia: 'cirurgia', asma: 'asma', endometriose: 'endometriose', hernia: 'hérnia', cardiaco: 'condição cardíaca' }

  return (
    <div className="grid">
      <div className="card grid">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}><Sparkles size={16} strokeWidth={1.8} /> Gerar próximo ciclo</h2>
          <span className="muted">no seu padrão do WhatsApp</span>
        </div>
        <>
          {isNew ? (<>
            <div className="muted">Aluno novo, sem semana colada: o app monta a <b>1ª semana</b> pela anamnese e pelas suas observações (dias, tempo, ênfase, experiência, restrições e o que ele não pode fazer). Depois de colar as semanas, o próximo ciclo parte do que você mandou.</div>
            <div className="grid cols-2">
              <label className="f">Dias por semana
                <select value={daysV} onChange={(e) => setDays(Number(e.target.value))}>
                  {[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>{d}{triage?.diasTexto && d === Math.min(5, triage.dias ?? 0) ? ` (anamnese: ${triage.diasTexto})` : ''}</option>)}
                </select>
              </label>
              <label className="f">Minutos por treino<input type="number" inputMode="numeric" value={minutes === '' ? minutesV : minutes} onChange={(e) => setMinutes(e.target.value ? Number(e.target.value) : '')} /></label>
            </div>
          </>) : (<>
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
              {([[-1, 'Regredir'], [0, 'Manter'], [1, 'Progredir']] as [Intensity, string][]).map(([v, l]) => (
                <button key={v} className={`chip sm ${intensity === v ? 'on' : ''}`} onClick={() => setIntensity(v)}>{l}</button>
              ))}
            </div>
          </div>
          </>)}
          <div className="grid" style={{ gap: 6 }}>
            <span className="muted" style={{ fontWeight: 600 }}>Ênfase (toque para escolher)</span>
            <div className="chips">
              {MUSCLE_GROUPS.map((g) => (
                <button key={g} type="button" className={`chip sm ${emph.includes(g) ? 'on' : ''}`} onClick={() => toggle(g)}>{short(g)}</button>
              ))}
            </div>
            <div className="muted">
              {enfases == null && suggested.length ? `Já marcado ${student.emphasis?.length ? 'pela ficha' : 'pela anamnese'}; mude à vontade. ` : ''}
              O treino com mais ênfase vira o Treino A e os exercícios da ênfase ganham volume.
            </div>
            <label className="row"><input type="checkbox" checked={alerts} onChange={(e) => setAlerts(e.target.checked)} /> Mostrar "(revisar)" nos exercícios que pedem atenção pela anamnese</label>
          </div>

          {/* o que a anamnese pede para este treino */}
          {triage ? (
            <details className="anam-mini">
              <summary className="muted" style={{ cursor: 'pointer', fontWeight: 600 }}>
                Considerando a anamnese{[
                  triage.evitarExercicios.length ? `não pode: ${triage.evitarExercicios.join(', ')}` : '',
                  triage.restricoes.length ? triage.restricoes.map((r) => r.label).join(', ') : '',
                  triage.condicoes.length ? triage.condicoes.map((c) => COND[c] ?? c).join(', ') : '',
                ].filter(Boolean).map((x) => ` · ${x}`).join('')}
              </summary>
              {rem && (
                <div className="grid" style={{ marginTop: 8 }}>
                  <RemList title="Evitar ou revisar" items={rem.evitar} tone="warn" />
                  <RemList title="Pontos de atenção" items={rem.atencao} tone="warn" />
                  <RemList title="Processos recomendados" items={rem.processos} />
                </div>
              )}
            </details>
          ) : (
            <div className="muted">Sem anamnese nem observações para este aluno{onOpenAnamnese ? <> · <button className="link-btn" onClick={onOpenAnamnese}>colar anamnese</button></> : ''}.</div>
          )}
          <TrainerNotes student={student} compact />
          <button className="btn primary big" onClick={generate}><Sparkles size={16} strokeWidth={1.8} /> {text ? 'Gerar outra variação' : isNew ? 'Montar 1ª semana' : 'Gerar treino'}</button>
          {!isNew && phase === 'choque' && <div className="muted">No choque, os exercícios que recebem estímulo novo e a variável de cada um (drop, rest-pause, cluster, carga alta, pirâmide, excêntrica, isometria, parciais, FST-7, falha, série a mais) são sorteados a cada geração, conforme o tipo do exercício e sem repetir o que o aluno já fez nele.</div>}
        </>
      </div>

      {text && (
        <div className="card grid">
          {notice.map((x) => <div key={x} className="alert warn">{x}</div>)}
          {summary.length > 0 && (
            <details>
              <summary className="muted" style={{ cursor: 'pointer', fontWeight: 600 }}>O que mudou ({summary.length})</summary>
              <ul className="rem-list">{summary.map((x) => <li key={x}>{x}</li>)}</ul>
            </details>
          )}
          <textarea className="code" style={{ minHeight: 320 }} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="muted">Revise e ajuste à vontade antes de mandar. As linhas "(revisar…)" são só para você.</div>
          <SendByTraining text={text} phone={student.phone ?? ''} />
          <div className="row stack-sm">
            <a className="btn" href={wa} target="_blank" rel="noreferrer"><Send size={16} strokeWidth={1.8} /> Enviar tudo junto</a>
            <button className="btn" onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2500) } catch { /* sem permissão */ } }}><ClipboardCopy size={16} strokeWidth={1.8} /> {copied ? 'Copiado!' : 'Copiar tudo'}</button>
            <button className="btn" onClick={() => {
              try { sessionStorage.setItem('mgt_paste_prefill', text.replace(/^\((revisar|trocar)[^)]*\)?.*$/gm, '').replace(/\n{3,}/g, '\n\n')) } catch { /* sem armazenamento */ }
              nav(`/consultoria?aluno=${student.id}&semana=${nextWk}`)
            }}><MessageSquare size={16} strokeWidth={1.8} /> Salvar como semana de {fmtBR(nextWk).slice(0, 5)}</button>
          </div>
        </div>
      )}
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
