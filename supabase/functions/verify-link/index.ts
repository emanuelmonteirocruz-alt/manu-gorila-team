// Supabase Edge Function — Busca multi-fonte EM CASCATA de links de execução.
// Ordem: MuscleWiki → ExRx.net → JEFIT. Só retorna URLs que (1) vieram de resultados
// reais de busca e (2) responderam HTTP 200 na verificação. Nunca inventa URL.
import Anthropic from 'npm:@anthropic-ai/sdk'

const PROVIDERS = [
  { id: 'musclewiki', domain: 'musclewiki.com' },
  { id: 'exrx', domain: 'exrx.net' },
  { id: 'jefit', domain: 'jefit.com' },
]

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function isAlive(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(8000) })
    return r.ok
  } catch {
    return false
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { exercise, english_hint } = await req.json()
    const client = new Anthropic()

    for (const p of PROVIDERS) {
      const res = await client.beta.messages.create({
        model: 'claude-opus-5-5',
        max_tokens: 2048,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'low' },
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 2, allowed_domains: [p.domain] }],
        messages: [{
          role: 'user',
          content: `Encontre em ${p.domain} a página de demonstração do exercício de musculação "${exercise}"${english_hint ? ` (em inglês: ${english_hint})` : ''}. Responda apenas com a URL exata de um resultado da busca, ou NENHUMA.`,
        }],
      } as never) as { content: Array<Record<string, unknown>> }

      // URLs vindas dos resultados reais de busca
      const found = new Set<string>()
      for (const b of res.content) {
        if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
          for (const r of b.content as Array<{ url?: string }>) if (r.url) found.add(r.url)
        }
      }
      const answer = res.content.filter((b) => b.type === 'text').map((b) => String(b.text)).join(' ')
      const picked = [...found].find((u) => answer.includes(u)) ?? [...found][0]
      if (picked && new URL(picked).hostname.endsWith(p.domain) && (await isAlive(picked))) {
        return Response.json({ provider: p.id, url: picked }, { headers: cors })
      }
    }
    return Response.json({ provider: null, url: null }, { headers: cors })
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500, headers: cors })
  }
})
