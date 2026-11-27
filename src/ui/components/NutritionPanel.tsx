import { useLiveQuery } from 'dexie-react-hooks'
import { Apple, ChevronDown, ChevronRight, FileText, Paperclip, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { db, softDelete } from '../../data/db'
import { nutritionOf, saveNutrition } from '../../data/repo'
import { signedFileUrl } from '../../data/sync'
import { fileText, parseNutritionText, type NutritionData } from '../../nutrition/extract'
import { fmtBR, fmtNum, toISODate } from '../../engine/metrics'
import type { NutritionEntry, Student } from '../../domain/types'

const EMPTY: NutritionData = { weight_kg: null, height_m: null, age: null, body_fat: null, lean_mass_kg: null }
const toNum = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')))
const str = (v: number | null | undefined) => (v == null ? '' : String(v).replace('.', ','))

/** Anexar foto/PDF da avaliação do nutricionista e conferir os dados lidos. Usado no cadastro e na ficha. */
export function NutritionUpload({ value, onChange }: { value: { file: File | null; data: NutritionData; raw: string }; onChange: (v: { file: File | null; data: NutritionData; raw: string }) => void }) {
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const d = value.data
  // o que está sendo digitado fica como texto (aceita "68," enquanto digita); o número vai para os dados
  const [txt, setTxt] = useState<Partial<Record<keyof NutritionData, string>>>({})
  const field = (k: keyof NutritionData) => ({
    value: txt[k] ?? str(d[k]),
    onChange: (e: { target: { value: string } }) => {
      const v = e.target.value.replace(/[^\d.,]/g, '')
      setTxt((t) => ({ ...t, [k]: v }))
      let nv = toNum(v)
      if (nv != null && Number.isNaN(nv)) nv = null
      if (k === 'height_m' && nv != null && nv > 3) nv = Math.round(nv) / 100 // 168 → 1,68 m
      onChange({ ...value, data: { ...d, [k]: nv } })
    },
  })
  async function pick(file: File | null) {
    if (!file) return
    onChange({ file, data: EMPTY, raw: '' })
    setTxt({})
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
        <Paperclip size={16} strokeWidth={1.8} /> <span className="nutri-fname">{value.file ? (/^[0-9a-f-]{20,}/i.test(value.file.name) ? 'Foto anexada' : value.file.name) : 'Anexar foto ou PDF da avaliação'}</span>
        <input type="file" accept="image/*,application/pdf" hidden onChange={(e) => pick(e.target.files?.[0] ?? null)} />
      </label>
      {(busy || msg) && <span className={busy ? 'muted' : msg.startsWith('Não') ? 'tag warn' : 'tag ok'} style={{ alignSelf: 'start' }}>{msg || 'Lendo…'}</span>}
      {value.file && !busy && (
        <div className="nutri-fields">
          <label className="f">Peso (kg)<input inputMode="decimal" {...field('weight_kg')} placeholder="68,4" /></label>
          <label className="f">Altura (m)<input inputMode="decimal" {...field('height_m')} placeholder="1,68" /></label>
          <label className="f">Idade<input inputMode="numeric" {...field('age')} /></label>
          <label className="f">Gordura (%)<input inputMode="decimal" {...field('body_fat')} placeholder="22,5" /></label>
          <label className="f">Massa magra (kg)<input inputMode="decimal" {...field('lean_mass_kg')} placeholder="50,2" /></label>
        </div>
      )}
    </div>
  )
}

/** Resumo de uma avaliação em uma linha. */
export function nutritionLine(x: NutritionEntry): string {
  const kg = (v: number) => fmtNum(v, Number.isInteger(v) ? 0 : 1)
  return [x.weight_kg ? `${kg(x.weight_kg)} kg` : '', x.height_m ? `${fmtNum(x.height_m, 2)} m` : '', x.age ? `${x.age} anos` : '', x.body_fat ? `${fmtNum(x.body_fat, 1)}% gordura` : '', x.lean_mass_kg ? `${kg(x.lean_mass_kg)} kg massa magra` : ''].filter(Boolean).join(' · ') || 'sem dados lidos'
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
          <div className="muted">Só dados corporais (peso, altura, idade, % de gordura e massa magra). O peso passa a ser usado no cálculo do cardio.</div>
        </>
      )}
    </div>
  )
}
