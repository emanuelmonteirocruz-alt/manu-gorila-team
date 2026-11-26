import { useLiveQuery } from 'dexie-react-hooks'
import { ClipboardPaste, Save, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { getKV } from '../../data/db'
import { anamneseTemplateText, getAnamnese, saveAnamnese } from '../../data/repo'
import { answersFromPasted, parseTemplate } from '../../consultoria/anamneseTemplate'
import { buildTriage } from '../../consultoria/triage'
import { remindersFor } from '../../consultoria/reminders'
import type { Student } from '../../domain/types'
import { fmtBR } from '../../engine/metrics'
import TrainerNotes from './TrainerNotes'

const short = (g: string) => g.replace('Perna - ', '')

/**
 * Anamnese da consultoria (acréscimo): ficha de perguntas do modelo editável, resumo de triagem,
 * lembretes de processos/exercícios e rascunho da próxima semana no padrão do WhatsApp.
 */
export function AnamnesePanel({ student, onGoCycle }: { student: Student; onGoCycle?: () => void }) {
  const tplText = useLiveQuery(anamneseTemplateText, []) ?? ''
  const trainerName = useLiveQuery(() => getKV('trainer_name', 'Emanuel Monteiro'), []) ?? 'Emanuel Monteiro'
  const sections = useMemo(() => parseTemplate(tplText), [tplText])
  const saved = useLiveQuery(() => getAnamnese(student.id), [student.id])
  const [answers, setAnswers] = useState<Record<string, string> | null>(null)
  const [paste, setPaste] = useState('')
  const [open, setOpen] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const cur = answers ?? saved?.answers ?? {}
  const filled = Object.entries(cur).filter(([k, v]) => !k.startsWith('_') && v.trim()).length
  const total = sections.reduce((a, s) => a + s.questions.length, 0)
  const triage = useMemo(() => buildTriage(sections, cur), [sections, cur])
  const enfases = student.emphasis?.length ? student.emphasis : triage.enfases
  const rem = useMemo(() => remindersFor(triage, enfases), [triage, enfases])
  useEffect(() => { if (saved && answers == null && !filled) setOpen(false) }, [saved, answers, filled])

  async function doSave() {
    const latest = await getAnamnese(student.id) // não perde as observações do treinador salvas à parte
    const extras = Object.fromEntries(Object.entries(latest?.answers ?? {}).filter(([k]) => k.startsWith('_')))
    await saveAnamnese(student.id, { ...cur, ...extras }, paste.trim() || undefined)
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

      {/* Observações do treinador (entram na triagem e na montagem) */}
      <TrainerNotes student={student} />

      {/* 2) Resumo de triagem */}
      {(filled > 0 || !!triage.notasTreinador) && <TriageCard triage={triage} enfases={enfases} fromFicha={!!student.emphasis?.length} />}

      {/* 3) Lembretes */}
      {(filled > 0 || !!triage.notasTreinador) && (
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

      {/* 4) A montagem do treino fica no Próximo ciclo (usa esta anamnese automaticamente) */}
      {filled > 0 && (
        <div className="card row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <span className="muted">Para montar o treino, use <b>Próximo ciclo</b>: lá você escolhe intensidade e ênfase, e o app já considera estas restrições e lembretes.</span>
          {onGoCycle && <button className="btn primary" onClick={onGoCycle}><Sparkles size={16} strokeWidth={1.8} /> Ir para o Próximo ciclo</button>}
        </div>
      )}
    </div>
  )
}

export function RemList({ title, items, tone }: { title: string; items: string[]; tone?: 'warn' }) {
  if (!items.length) return null
  return (
    <div className="grid" style={{ gap: 4 }}>
      <span className={`muted ${tone === 'warn' ? 'rem-warn' : ''}`} style={{ fontWeight: 700 }}>{title}</span>
      <ul className="rem-list">{items.map((x) => <li key={x}>{x}</li>)}</ul>
    </div>
  )
}

export function TriageCard({ triage: t, enfases, fromFicha }: { triage: ReturnType<typeof buildTriage>; enfases: string[]; fromFicha: boolean }) {
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
    ['Suas observações', t.notasTreinador, t.glp1],
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
