/**
 * Travas técnicas de prescrição (Módulo 2, item 7) — validam QUALQUER rascunho
 * (gerado localmente, pela IA ou editado à mão) antes de copiar para o WhatsApp.
 */
import { parsePrescriptionBlock } from '../engine/prescription'
import type { ExerciseProfile } from '../domain/types'

export interface RuleViolation {
  rule: 'aquecimento' | 'series_picadas' | 'renovacao'
  training: string
  message: string
}

type Lookup = (name: string) => ExerciseProfile | undefined

export function validateTraining(label: string, text: string, lookup: Lookup): RuleViolation[] {
  const v: RuleViolation[] = []
  const { exercises } = parsePrescriptionBlock(text)
  const first = exercises[0]
  if (first) {
    const p = lookup(first.names[0])
    if (p?.mechanic === 'multiarticular' && first.heavySets > 0 && first.warmupSets === 0) {
      v.push({ rule: 'aquecimento', training: label, message: `${label}: abre com ${first.names[0]} pesado sem aquecimento / adaptação neuromuscular.` })
    }
  }
  for (const ex of exercises) {
    for (const n of ex.names) {
      const p = lookup(n)
      if (p?.disputed && ex.validSets > 0 && ex.validSets <= 2) {
        v.push({ rule: 'series_picadas', training: label, message: `${label}: ${n} com ${ex.validSets} séries picadas em aparelho disputado — consolidar em movimento com carga real.` })
      }
    }
  }
  return v
}

/** Renovação real: ordem das divisões, sequência e repertório não podem ser cópia. */
export function validateRenewal(prev: { label: string; names: string[]; mainGroup: string }[], next: { label: string; names: string[]; mainGroup: string }[]): RuleViolation[] {
  const v: RuleViolation[] = []
  if (!prev.length || !next.length) return v
  const prevOrder = prev.map((t) => t.mainGroup).join('>')
  const nextOrder = next.map((t) => t.mainGroup).join('>')
  if (prev.length > 1 && prevOrder === nextOrder) {
    v.push({ rule: 'renovacao', training: 'Semana', message: 'Ordem das divisões na semana igual à anterior.' })
  }
  const prevSet = new Set(prev.flatMap((t) => t.names.map((n) => n.toLowerCase())))
  const all = next.flatMap((t) => t.names.map((n) => n.toLowerCase()))
  const novel = all.filter((n) => !prevSet.has(n)).length
  if (all.length && novel / all.length < 0.25) {
    v.push({ rule: 'renovacao', training: 'Semana', message: `Repertório só ${Math.round((novel / all.length) * 100)}% novo (mín. 25%).` })
  }
  for (const t of next) {
    const twin = prev.find((p) => p.names.join('|').toLowerCase() === t.names.join('|').toLowerCase())
    if (twin) v.push({ rule: 'renovacao', training: t.label, message: `${t.label}: mesma sequência de exercícios do ${twin.label} anterior.` })
  }
  return v
}
