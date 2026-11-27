import { useLiveQuery } from 'dexie-react-hooks'
import { Apple, ChevronDown, ChevronRight, FileText, Paperclip, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { db, softDelete } from '../../data/db'
import { nutritionOf, saveNutrition } from '../../data/repo'
import { signedFileUrl } from '../../data/sync'
import { fileText, parseNutritionText, type NutritionData } from '../../nutrition/extract'
import { fmtBR, fmtNum, toISODate } from '../../engine/metrics'
import type { NutritionEntry, Student } from '../../domain/types'

export const PHASE_NUTRI: Record<NonNullable<NutritionEntry['phase']>, string> = { deficit: 'Déficit calórico', manutencao: 'Manutenção', superavit: 'Superávit calórico' }
const EMPTY: NutritionData = { weight_kg: null, kcal: null, phase: null, protein_g: null, body_fat: null }
const toNum = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')))
const str = (v: number | null | undefined) => (v == null ? '' : String(v).replace('.', ','))

/** Anexar foto/PDF da avaliação do nutricionista e conferir os dados lidos. Usado no cadastro e na ficha. */
export function NutritionUpload({ value, onChange }: { value: { file: File | null; data: NutritionData; raw: string }; onChange: (v: { file: File | null; data: NutritionData; raw: string }) => void }) {
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const d = value.data
  const set = (patch: Partial<NutritionData>) => onChange({ ...value, data: { ...d, ...patch } })
  async function pick(file: File | null) {
    if (!file) return
    onChange({ file, data: EMPTY, raw: '' })
    setBusy(true)
    try {
      const raw = await fileText(file, setMsg)
      const data = parseNutritionText(raw)
      const found = Object.values(data).filter((x) => x != null).length
      onChange({ file, data, raw })
      setMsg(found ? `Encontrei ${found} ${found === 1 ? 'dado' : 'dados'}: confira abaixo.` : 'Não encontrei dados automaticamente: preencha o que souber (o arquivo fica anexado).')
    } catch {
      setMsg('Não consegui ler o arquivo aqui (sem internet ou formato diferente). Preencha o que souber: o arquivo fica anexado.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="grid nutri-upload" style={{ gap: 8 }}>
      <label className="btn nutri-file">
        <Paperclip size={16} strokeWidth={1.8} /> {value.file ? value.file.name : 'Anexar foto ou PDF da avaliação'}
        <input type="file" accept="image/*,application/pdf" hidden onChange={(e) => pick(e.target.files?.[0] ?? null)} />
      </label>
      {(busy || msg) && <span className={busy ? 'muted' : 'tag ok'} style={{ alignSelf: 'start' }}>{msg || 'Lendo…'}</span>}
      {value.file && !busy && (
        <div className="nutri-fields">
          <label className="f">Peso (kg)<input inputMode="decimal" value={str(d.weight_kg)} onChange={(e) => set({ weight_kg: toNum(e.target.value) })} /></label>
          <label className="f">Calorias/dia<input inputMode="numeric" value={str(d.kcal)} onChange={(e) => set({ kcal: toNum(e.target.value) })} /></label>
          <label className="f">Fase
            <select value={d.phase ?? ''} onChange={(e) => set({ phase: (e.target.value || null) as NutritionData['phase'] })}>
              <option value="">—</option>
              {Object.entries(PHASE_NUTRI).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label className="f">Proteína (g)<input inputMode="numeric" value={str(d.protein_g)} onChange={(e) => set({ protein_g: toNum(e.target.value) })} /></label>
          <label className="f">Gordura (%)<input inputMode="decimal" value={str(d.body_fat)} onChange={(e) => set({ body_fat: toNum(e.target.value) })} /></label>
        </div>
      )}
    </div>
  )
}

/** Resumo de uma avaliação em uma linha. */
export function nutritionLine(x: NutritionEntry): string {
  return [x.phase ? PHASE_NUTRI[x.phase] : '', x.kcal ? `${fmtNum(x.kcal)} kcal/dia` : '', x.weight_kg ? `${fmtNum(x.weight_kg, Number.isInteger(x.weight_kg) ? 0 : 1)} kg` : '', x.protein_g ? `${fmtNum(x.protein_g)} g proteína` : '', x.body_fat ? `${fmtNum(x.body_fat, 1)}% gordura` : ''].filter(Boolean).join(' · ') || 'sem dados lidos'
}

/** Quadro na ficha do aluno: avaliações anexadas (abrir arquivo, excluir) e anexar nova. Recolhido por padrão. */
export function NutritionPanel({ student }: { student: Student }) {
  const list = useLiveQuery(() => nutritionOf(student.id), [student.id]) ?? []
  const [open, setOpen] = useState(false)
  const [up, setUp] = useState<{ file: File | null; data: NutritionData; raw: string }>({ file: null, data: EMPTY, raw: '' })
  const last = list[0]

  async function openFile(x: NutritionEntry) {
    const local = await db.files.get(x.id)
    const url = local ? URL.createObjectURL(local.blob) : x.file_path ? await signedFileUrl(x.file_path) : null
    if (url) window.open(url, '_blank')
    else alert('Arquivo ainda não disponível neste aparelho (sincronize com a nuvem).')
  }
  async function add() {
    if (!up.file) return
    await saveNutrition({ student_id: student.id, date: toISODate(new Date()), ...up.data, raw_text: up.raw.slice(0, 20000) || null, notes: null }, up.file, up.file.name)
    setUp({ file: null, data: EMPTY, raw: '' })
    setOpen(false)
  }

  return (
    <div className="card grid">
      <button type="button" className="cardio-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        <Apple size={18} strokeWidth={1.8} />
        <b>Nutricionista</b>
        <span className="muted">{last ? nutritionLine(last) : 'nenhuma avaliação'}</span>
        <span className="btn sm" style={{ marginLeft: 'auto' }}>{open ? 'Fechar' : '+ Anexar'}</span>
      </button>
      {list.length > 0 && (
        <div className="cardio-list">
          {list.slice(0, open ? 10 : 1).map((x) => (
            <div key={x.id} className="cardio-row">
              <span><b>{fmtBR(x.date).slice(0, 5)}</b> · {nutritionLine(x)}</span>
              <span className="row" style={{ gap: 6 }}>
                {(x.file_path || x.file_name) && <button className="btn icon" aria-label="Abrir arquivo" onClick={() => openFile(x)}><FileText size={15} /></button>}
                {open && <button className="btn icon" aria-label="Excluir avaliação" onClick={() => softDelete(db.nutrition, x.id)}><Trash2 size={15} /></button>}
              </span>
            </div>
          ))}
        </div>
      )}
      {open && (
        <>
          <NutritionUpload value={up} onChange={setUp} />
          <div><button className="btn primary" disabled={!up.file} onClick={add}>Salvar avaliação</button></div>
          <div className="muted">O peso passa a ser usado no cardio; a fase (déficit, manutenção ou superávit) aparece na montagem do próximo ciclo.</div>
        </>
      )}
    </div>
  )
}
