import { useLiveQuery } from 'dexie-react-hooks'
import { NotebookPen } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getAnamnese, saveAnamnese } from '../../data/repo'
import { TRAINER_NOTES_KEY } from '../../consultoria/triage'
import type { Student } from '../../domain/types'

/**
 * Observações do treinador sobre o aluno (ex.: "aluna nova, tomando Monjaro").
 * Ficam junto da anamnese (sincronizam entre aparelhos) e entram na montagem:
 * remédios, condições, dores e exercícios citados viram lembretes e alertas no rascunho.
 */
export default function TrainerNotes({ student, compact }: { student: Student; compact?: boolean }) {
  const saved = useLiveQuery(() => getAnamnese(student.id), [student.id])
  const stored = saved?.answers?.[TRAINER_NOTES_KEY] ?? ''
  const [text, setText] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  useEffect(() => { setText(null) }, [student.id])
  const cur = text ?? stored
  async function doSave() {
    if (text == null || text === stored) return
    const latest = await getAnamnese(student.id)
    await saveAnamnese(student.id, { ...(latest?.answers ?? {}), [TRAINER_NOTES_KEY]: text.trim() })
    setText(null)
    setMsg('Salvo')
    setTimeout(() => setMsg(''), 2000)
  }
  return (
    <div className={compact ? 'grid' : 'card grid'} style={{ gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b><NotebookPen size={16} strokeWidth={1.8} style={{ verticalAlign: -3 }} /> Observações do treinador</b>
        {msg && <span className="tag ok">{msg}</span>}
      </div>
      <textarea rows={compact ? 2 : 3} value={cur} onChange={(e) => setText(e.target.value)} onBlur={doSave}
        placeholder="Ex.: aluna nova, está tomando Monjaro · sente o ombro no desenvolvimento · prefere treinos curtos" />
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
        <span className="muted">Só você vê. Entra na montagem automática: remédios, condições, dores e exercícios citados viram lembretes e alertas.</span>
        {text != null && text !== stored && <button className="btn sm primary" onClick={doSave}>Salvar observação</button>}
      </div>
    </div>
  )
}
