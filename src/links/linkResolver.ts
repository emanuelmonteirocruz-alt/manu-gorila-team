/**
 * Links de execução — cache local de URLs verificadas + busca em cascata sob demanda.
 * Regra de segurança: nunca gera URL. Sem cache e sem verificação → "[pendente de link]".
 */
import { db, nowISO } from '../data/db'
import { getSupabase } from '../data/sync'
import { normalizeKey } from '../engine/exerciseSeed'
import { findCached } from '../engine/classifier'
import { parsePrescriptionLine } from '../engine/prescription'

export const PENDING = '[pendente de link]'

export async function cachedLink(exerciseName: string): Promise<string | null> {
  const p = await findCached(exerciseName)
  const key = p?.key ?? normalizeKey(exerciseName)
  const links = await db.links.where('exercise_key').equals(key).toArray()
  // link do treinador tem prioridade; depois a ordem da cascata
  const order = ['trainer', 'musclewiki', 'exrx', 'jefit']
  links.sort((a, b) => order.indexOf(a.provider) - order.indexOf(b.provider))
  return links[0]?.url ?? null
}

export async function searchAndCache(exerciseName: string): Promise<string | null> {
  const sb = await getSupabase()
  if (!sb || !navigator.onLine) return null
  const { data, error } = await sb.functions.invoke('verify-link', { body: { exercise: exerciseName } })
  if (error || !data?.url) return null
  const p = await findCached(exerciseName)
  const key = p?.key ?? normalizeKey(exerciseName)
  await db.links.put({ id: `${key}|${data.provider}`, exercise_key: key, provider: data.provider, url: data.url, verified_at: nowISO(), _dirty: 1 })
  return data.url as string
}

/** Preenchimento único pelo treinador para um movimento pendente. */
export async function setTrainerLink(exerciseName: string, url: string) {
  if (!/^https:\/\//.test(url)) throw new Error('Use uma URL https completa.')
  const p = await findCached(exerciseName)
  const key = p?.key ?? normalizeKey(exerciseName)
  await db.links.put({ id: `${key}|trainer`, exercise_key: key, provider: 'trainer', url, verified_at: nowISO(), _dirty: 1 })
}

/** Ficha para WhatsApp com links ao lado de cada exercício. */
export async function withLinks(text: string, opts: { search: boolean }): Promise<{ text: string; pending: string[] }> {
  const pending: string[] = []
  const lines: string[] = []
  for (const line of text.split('\n')) {
    const p = parsePrescriptionLine(line)
    if (!p) {
      lines.push(line)
      continue
    }
    const urls: string[] = []
    for (const n of p.names) {
      let u = await cachedLink(n)
      if (!u && opts.search) u = await searchAndCache(n)
      if (!u) pending.push(n)
      urls.push(u ?? PENDING)
    }
    lines.push(`${line}\n▶ ${urls.join(' | ')}`)
  }
  return { text: lines.join('\n'), pending: [...new Set(pending)] }
}
