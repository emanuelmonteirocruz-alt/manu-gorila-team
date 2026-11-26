// Supabase Edge Function — Copiloto do próximo ciclo (refino por IA no estilo do treinador).
// O app SEMPRE revalida o resultado com as travas locais (src/copilot/rules.ts).
import Anthropic from 'npm:@anthropic-ai/sdk'

const SYSTEM = `Você é o copiloto de prescrição do treinador Emanuel Monteiro (consultoria online via WhatsApp).
Escreva os próximos treinos EXATAMENTE no estilo dele, copiando a forma das mensagens de exemplo:
- Uma mensagem por treino, uma linha por exercício, sem títulos, sem emojis, sem markdown.
- Nomes diretos como ele escreve (Leg45, Hack, Pulley frente, Supino halteres...).
- Esquema no formato dele: "4x8", "3x8 a 10", "15/12/10/8", "2x15 aquecimento + 4x8", "3x10 1x drop", bi-set com "+".
- Anotações curtas como "Carga alta", "Amplitude máxima", "Carga fixa"; descanso no padrão das mensagens de exemplo.
Travas técnicas OBRIGATÓRIAS:
1. Nunca abrir a sessão com multiarticular em faixa pesada (6–8, 8, 8–10) sem aquecimento / adaptação neuromuscular antes.
2. Nunca usar séries picadas (ex.: 2x12) em aparelho disputado (ex.: cross over); consolidar em movimentos que permitam carga real.
3. Renovar de verdade em relação ao ciclo anterior: ordem das divisões na semana, sequência dos exercícios e repertório.
4. Respeitar o protocolo pedido (Regenerativa / Ordinária / Choque), a diretriz de intensidade e as restrições (tempo disponível, semana menstrual => nunca Choque).
Séries pesadas = apenas faixas 6–8, 8 e 8–10. 10 fixo é moderado.
Parta do rascunho fornecido (já respeita as travas) e melhore-o; não invente exercícios exóticos.`

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['treinos'],
  properties: {
    treinos: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'texto'],
        properties: { label: { type: 'string' }, texto: { type: 'string' } },
      },
    },
  },
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const body = await req.json()
    const client = new Anthropic()
    const stream = client.beta.messages.stream({
      model: 'claude-opus-5-5',
      max_tokens: 32000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'high', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: [
          `<mensagens_de_exemplo>\n${(body.style_samples ?? []).slice(-12).join('\n---\n')}\n</mensagens_de_exemplo>`,
          `<ciclo_anterior>\n${body.previous_cycle}\n</ciclo_anterior>`,
          `<contexto>${JSON.stringify(body.context)}</contexto>`,
          `<diretriz>protocolo=${body.protocol}; intensidade=${body.intensity}; tempo_min=${body.minutes ?? 'livre'}; pedido_extra=${body.command ?? ''}</diretriz>`,
          `<rascunho_local>\n${body.draft}\n</rascunho_local>`,
        ].join('\n\n'),
      }],
    } as never)
    const msg = (await stream.finalMessage()) as { stop_reason: string; content: Array<{ type: string; text?: string }> }
    if (msg.stop_reason === 'refusal') return Response.json({ treinos: [] }, { headers: cors })
    const text = msg.content.find((b) => b.type === 'text')?.text ?? '{"treinos":[]}'
    return Response.json(JSON.parse(text), { headers: cors })
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500, headers: cors })
  }
})
