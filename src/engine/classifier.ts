/**
 * Classificação dinâmica: Cache → IA (Edge Function) → heurística offline.
 * Resultado da IA é salvo no cache para reuso instantâneo.
 */
import { db, nowISO } from '../data/db'
import { getSupabase } from '../data/sync'
import type { ExerciseProfile } from '../domain/types'
import { heuristicProfile, normalizeKey } from './exerciseSeed'

export async function findCached(name: string): Promise<ExerciseProfile | undefined> {
  const k = normalizeKey(name)
  return (await db.exerciseCache.get(k)) ?? (await db.exerciseCache.where('aliases').equals(k).first())
}

interface AiResult {
  nome_padronizado: string
  grupo_muscular: string
  sub_regiao?: string
  mecanica: 'multiarticular' | 'monoarticular'
  implemento: 'livre' | 'maquina_cabo'
  aparelho_disputado?: boolean
}

async function classifyWithAI(names: string[], activeGroups: string[], transcript?: string): Promise<Record<string, AiResult>> {
  const sb = await getSupabase()
  if (!sb || !navigator.onLine) return {}
  const known = (await db.exerciseCache.toArray()).slice(0, 300).map((p) => p.name)
  const { data, error } = await sb.functions.invoke('classify-exercise', {
    body: { exercises: names, active_groups: activeGroups, transcript, known_cache: known },
  })
  if (error || !data?.results) return {}
  return data.results as Record<string, AiResult>
}

/**
 * Resolve perfis para uma lista de nomes. Inéditos vão em LOTE para a IA (uma chamada).
 * Retorna mapa nome-original → perfil.
 */
export async function resolveProfiles(names: string[], activeGroups: string[], transcript?: string): Promise<Map<string, ExerciseProfile>> {
  const out = new Map<string, ExerciseProfile>()
  const missing: string[] = []
  for (const n of names) {
    const c = await findCached(n)
    if (c && c.source !== 'heuristic') out.set(n, c)
    else missing.push(n)
  }
  if (!missing.length) return out

  const ai = await classifyWithAI(missing, activeGroups, transcript)
  for (const n of missing) {
    const r = ai[n]
    let p: ExerciseProfile
    if (r) {
      p = {
        key: normalizeKey(r.nome_padronizado || n),
        name: r.nome_padronizado || n,
        aliases: [normalizeKey(n)].filter((a) => a !== normalizeKey(r.nome_padronizado || n)),
        muscle_group: r.grupo_muscular,
        sub_region: r.sub_regiao,
        mechanic: r.mecanica,
        implement: r.implemento,
        disputed: !!r.aparelho_disputado,
        source: 'ai',
      }
      const existing = await db.exerciseCache.get(p.key)
      if (existing) p.aliases = [...new Set([...existing.aliases, ...p.aliases])]
    } else {
      p = (await findCached(n)) ?? heuristicProfile(n, activeGroups)
    }
    await db.exerciseCache.put({ ...p, updated_at: nowISO(), _dirty: 1 })
    out.set(n, p)
  }
  return out
}

/** Correção manual do treinador (vence IA e heurística). */
export async function saveTrainerProfile(p: ExerciseProfile) {
  await db.exerciseCache.put({ ...p, source: 'trainer', updated_at: nowISO(), _dirty: 1 })
}
