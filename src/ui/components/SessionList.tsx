import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronDown, ChevronRight, Download, FileText, Send, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { jsPDF } from 'jspdf'
import { db } from '../../data/db'
import { getBrand } from '../../data/brand'
import { deleteSession, previousBests, treinoDoDiaExtras, profileLookup, studentSessions } from '../../data/repo'
import { ConfirmButton } from './common'
import { saveFile } from '../../artifact/claude'
import { challengeBase } from '../../data/reportData'
import { drawPreview } from '../../pdf/charts'
import { sharePdf, templateD } from '../../pdf/templates'
import type { Session, Student } from '../../domain/types'
import { fmtBR } from '../../engine/metrics'
import { SOURCE_LABEL } from '../format'
import { ExerciseLine } from '../pages/History'

const WEEKDAY = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

/**
 * Treinos do aluno, mais recente primeiro. Tocar abre o treino (exercícios e séries)
 * com o PDF pronto para enviar pelo WhatsApp ou baixar — a qualquer momento depois da aula.
 */
export function SessionList({ student, limit = 30, initialOpen = null }: { student: Student; limit?: number; initialOpen?: string | null }) {
  const [open, setOpen] = useState<string | null>(initialOpen)
  const [all, setAll] = useState(false)
  const data = useLiveQuery(async () => {
    const list = (await studentSessions(student)).reverse()
    const ratings = (await db.ratings.toArray()).filter((r) => !r._deleted)
    const pseOf = (id: string) => {
      const rs = ratings.filter((r) => r.session_id === id)
      return (rs.find((r) => r.reported_by === 'student') ?? rs[0])?.pse ?? null
    }
    return list.map((s) => ({ s, pse: pseOf(s.id) }))
  }, [student.id]) ?? []
  const shown = all ? data : data.slice(0, limit)
  return (
    <div className="card grid">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Treinos feitos</h2>
        <span className="muted">{data.length} {data.length === 1 ? 'treino' : 'treinos'}</span>
      </div>
      {!data.length && <div className="muted">Nenhum treino ainda. Os treinos encerrados no Presencial aparecem aqui.</div>}
      <div className="session-list">
        {shown.map(({ s, pse }) => {
          const valid = s.exercises.reduce((a, e) => a + e.valid_sets, 0)
          const heavy = s.exercises.reduce((a, e) => a + e.heavy_sets, 0)
          const isOpen = open === s.id
          const day = WEEKDAY[new Date(s.date + 'T12:00:00').getDay()]
          return (
            <div key={s.id} className={`session-item ${isOpen ? 'open' : ''}`}>
              <button className="session-head" onClick={() => setOpen(isOpen ? null : s.id)} aria-expanded={isOpen}>
                {isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                <span className="session-title">
                  <b>{s.label}</b> <span className="muted">· {day} {fmtBR(s.date).slice(0, 5)}</span>
                  <small>{s.exercises.length} exercícios · {valid} válidas · {heavy} pesadas{pse != null ? ` · PSE ${pse}` : ''}</small>
                </span>
                <span className={`tag src-${s.source}`}>{SOURCE_LABEL[s.source] ?? s.source}</span>
              </button>
              {isOpen && <SessionDetail student={student} session={s} pse={pse} />}
            </div>
          )
        })}
      </div>
      {data.length > limit && !all && <button className="btn" onClick={() => setAll(true)}>Ver todos os {data.length} treinos</button>}
    </div>
  )
}

function SessionDetail({ student, session, pse }: { student: Student; session: Session; pse: number | null }) {
  const [pdf, setPdf] = useState<{ doc: jsPDF; make: () => jsPDF; name: string } | null>(null)
  const [preview, setPreview] = useState(false)
  const canvas = useRef<HTMLCanvasElement | null>(null)
  // o PDF fica pronto ao abrir o treino: o botão de enviar abre o WhatsApp na hora (sem espera)
  useEffect(() => {
    let alive = true
    ;(async () => {
      const lookup = await profileLookup()
      const o = { studentName: student.full_name, showName: true, showEmphasis: false, brand: await getBrand(), modality: student.modality, challenge: student.modality === 'online' ? await challengeBase(student) : undefined }
      const bests = await previousBests(student.id, session)
      const ex = await treinoDoDiaExtras(student, session)
      const o2 = student.modality === 'online' ? o : { ...o, phase: ex.phase, challenge: ex.challenge }
      const make = () => templateD(session, lookup, pse, o2, bests, ex.last)
      if (alive) setPdf({ doc: make(), make, name: `treino-${student.full_name.split(' ')[0].toLowerCase()}-${session.date}.pdf` })
    })()
    return () => { alive = false }
  }, [student, session, pse])
  useEffect(() => {
    if (preview && pdf && canvas.current) drawPreview(canvas.current, pdf.make)
  }, [preview, pdf])
  const phone = (student.phone ?? '').replace(/\D/g, '')
  const wa = phone ? `https://wa.me/${phone.length <= 11 ? '55' + phone : phone}` : ''
  return (
    <div className="session-body grid">
      <div className="row stack-sm">
        <button className="btn primary" disabled={!pdf} onClick={() => pdf && sharePdf(pdf.doc, pdf.name)}><Send size={16} strokeWidth={1.8} /> Enviar PDF pelo WhatsApp</button>
        <button className="btn" disabled={!pdf} onClick={() => pdf && saveFile(pdf.name, pdf.doc.output('blob'))}><Download size={16} strokeWidth={1.8} /> Baixar PDF</button>
        <button className="btn" disabled={!pdf} onClick={() => setPreview((v) => !v)}><FileText size={16} strokeWidth={1.8} /> {preview ? 'Esconder gráfico' : 'Ver gráfico'}</button>
        {wa && <a className="btn" href={wa} target="_blank" rel="noreferrer">Abrir conversa</a>}
      </div>
      {preview && <canvas ref={canvas} className="pdf-preview" aria-label="Gráfico do treino" />}
      {session.muscle_groups.length > 0 && <div className="muted">{session.muscle_groups.join(' + ')}</div>}
      {session.exercises.map((e) => <ExerciseLine key={e.id} e={e} />)}
      {!session.exercises.length && <div className="muted">Treino sem exercícios registrados.</div>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <ConfirmButton label={<><Trash2 size={16} strokeWidth={1.8} /> Excluir treino</>} confirmLabel="Toque de novo para excluir este treino" onConfirm={() => deleteSession(session.id)} />
      </div>
    </div>
  )
}
