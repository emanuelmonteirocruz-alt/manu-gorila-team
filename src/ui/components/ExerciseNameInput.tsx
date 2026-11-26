import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { db } from '../../data/db'
import type { ExerciseProfile } from '../../domain/types'
import { phonetic } from '../../voice/autocorrect'

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** Pontua um exercício do cache para o que já foi digitado (prefixo > palavra > alias > fonética). */
function score(p: ExerciseProfile, q: string, qPh: string, groups: string[]): number {
  const name = norm(p.name)
  let s = 0
  if (name.startsWith(q)) s = 5
  else if (name.split(/\s+/).some((w) => w.startsWith(q))) s = 4
  else if (p.aliases.some((a) => a.startsWith(q) || a.split(' ').some((w) => w.startsWith(q)))) s = 3
  else if (q.length >= 3 && name.includes(q)) s = 2
  else if (qPh.length >= 3 && phonetic(p.name).startsWith(qPh)) s = 1.5
  if (!s) return 0
  return s + (groups.includes(p.muscle_group) ? 0.5 : 0) + (p.source === 'heuristic' ? -0.3 : 0)
}

/**
 * Campo de exercício com autocompletar: a partir de 2 letras ("ex") sugere os exercícios
 * do cache (priorizando os grupamentos ativos). Toque na sugestão para preencher.
 */
export function ExerciseNameInput({ id, value, onChange, groups = [], placeholder, className }: {
  id?: string; value: string; onChange: (v: string) => void; groups?: string[]; placeholder?: string; className?: string
}) {
  const cache = useLiveQuery(() => db.exerciseCache.toArray(), [])
  const [focus, setFocus] = useState(false)
  const q = norm(value)
  const list = useMemo(() => {
    if (q.length < 2) return []
    const qPh = phonetic(q)
    return (cache ?? [])
      .map((p) => ({ p, s: score(p, q, qPh, groups) }))
      .filter((x) => x.s > 0 && norm(x.p.name) !== q)
      .sort((a, b) => b.s - a.s || a.p.name.length - b.p.name.length)
      .slice(0, 6)
      .map((x) => x.p)
  }, [cache, q, groups])
  return (
    <div className="ac-wrap">
      <input id={id} className={className} value={value} placeholder={placeholder} autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)}
        onKeyDown={(e) => { if ((e.key === 'Tab' || e.key === 'Enter') && list[0] && focus) { e.preventDefault(); onChange(list[0].name) } }} />
      {focus && list.length > 0 && (
        <div className="ac-list" role="listbox">
          {list.map((p) => (
            <button key={p.key} type="button" role="option" className="ac-item" onMouseDown={(e) => e.preventDefault()} onClick={() => onChange(p.name)}>
              <b>{p.name}</b><span>{p.muscle_group.replace('Perna - ', '')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
