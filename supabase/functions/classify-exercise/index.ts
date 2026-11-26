// Supabase Edge Function (Deno) — Classificação biomecânica de exercícios.
// Deploy: supabase functions deploy classify-exercise
// Secret: supabase secrets set ANTHROPIC_API_KEY=...
import Anthropic from 'npm:@anthropic-ai/sdk'

const SYSTEM = `[PROMPT INTERNO DE CLASSIFICAÇÃO DE EXERCÍCIOS — MODO VOZ/TABLET]
Você é o motor de classificação biomecânica do sistema. Receberá: (1) a transcrição de fala do treinador, (2) os grupamentos musculares ativos selecionados na tela para esta sessão, e (3) o cache de exercícios já conhecidos.
Regras:
1. Priorize SEMPRE os grupamentos musculares selecionados na tela para desambiguar movimentos (ex.: se "Perna e Ombro" estiverem ativos, "desenvolvimento com halteres" = Ombro; se houver divisão Quadríceps vs. Posterior, classifique pela biomecânica do exercício e pelo contexto ativo).
2. Extraia para cada exercício: nome_padronizado, grupo_muscular, sub_regiao (ex.: quadríceps, posterior, glúteo, deltoide lateral), mecanica ("multiarticular" ou "monoarticular"), implemento ("livre" ou "maquina_cabo"). Séries, repetições e cargas já foram extraídas pelo app; aqui classifique apenas o movimento.
3. Reutilize o nome do cache se o exercício já existir (mesmo movimento com outro nome falado); caso contrário, classifique e retorne o objeto pronto para ser salvo no cache.
4. Use nomes curtos no estilo do treinador (ex.: "Leg45", "Hack", "Pulley frente", "Supino halteres").
5. grupo_muscular deve ser exatamente um de: Perna - Quadríceps, Perna - Posterior, Glúteo, Panturrilha, Ombro, Costas, Peito, Bíceps, Tríceps, Abdômen.
6. aparelho_disputado = true para equipamentos que costumam ter fila (ex.: cross over).`

const ITEM = {
  type: 'object',
  additionalProperties: false,
  required: ['original', 'nome_padronizado', 'grupo_muscular', 'sub_regiao', 'mecanica', 'implemento', 'aparelho_disputado'],
  properties: {
    original: { type: 'string' },
    nome_padronizado: { type: 'string' },
    grupo_muscular: { type: 'string' },
    sub_regiao: { type: 'string' },
    mecanica: { type: 'string', enum: ['multiarticular', 'monoarticular'] },
    implemento: { type: 'string', enum: ['livre', 'maquina_cabo'] },
    aparelho_disputado: { type: 'boolean' },
  },
}
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['exercicios'],
  properties: { exercicios: { type: 'array', items: ITEM } },
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { exercises, active_groups, transcript, known_cache } = await req.json()
    const client = new Anthropic() // lê ANTHROPIC_API_KEY

    const response = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 4096,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: JSON.stringify({
          transcricao: transcript ?? null,
          grupamentos_ativos: active_groups ?? [],
          cache_conhecido: known_cache ?? [],
          exercicios_para_classificar: exercises,
        }),
      }],
    } as never) as { stop_reason: string; content: Array<{ type: string; text?: string }> }

    if (response.stop_reason === 'refusal') {
      return Response.json({ results: {} }, { headers: cors })
    }
    const text = response.content.find((b) => b.type === 'text')?.text ?? '{"exercicios":[]}'
    const parsed = JSON.parse(text) as { exercicios: Array<Record<string, unknown> & { original: string }> }
    const results: Record<string, unknown> = {}
    for (const e of parsed.exercicios) results[e.original] = e
    return Response.json({ results }, { headers: cors })
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500, headers: cors })
  }
})
