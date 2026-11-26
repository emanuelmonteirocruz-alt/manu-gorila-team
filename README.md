# Manu Gorila Team — Consultoria & Presencial

Um PWA em React + TypeScript para o treinador Emanuel Monteiro: prescrição, registro, análise e relatórios em PDF vetorial para enviar pelo WhatsApp.

- **Fase 1 (ativa):** só o **Perfil Treinador**. O aluno não tem login e recebe PDF + áudio pelo WhatsApp.
- **Fase 2 (preparada, desligada):** **Perfil Aluno** para lançar PSE e check-in de sono pelo celular. As tabelas e as policies RLS já existem. Para ligar, basta criar `app_users(role='student', active=true)` e vincular em `students.user_id`. Não precisa refatorar o banco.

## Rodar

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # testes do motor de cálculo, do parser e da voz
npm run build        # gera o PWA em dist/
```

Sem Supabase, o app funciona **100% offline** no dispositivo (IndexedDB).

Para publicar e instalar no tablet/celular de graça, veja **[DEPLOY.md](DEPLOY.md)**. Revisão do planejamento e erros corrigidos: **[docs/PLANEJAMENTO.md](docs/PLANEJAMENTO.md)**.

## Nuvem (Supabase) — sincronização tablet ⇄ computador

1. Crie um projeto no Supabase e rode `supabase/setup_completo.sql` (ou use o botão **Copiar SQL de instalação** em Config.).
2. Em Auth, crie o usuário do treinador — o primeiro usuário vira Treinador automaticamente (`0003`).
3. Edge Functions (IA):
   ```bash
   supabase secrets set ANTHROPIC_API_KEY=...
   supabase functions deploy classify-exercise copilot-draft verify-link
   ```
4. No app, abra **Config.**, informe a URL e a anon key e entre como Treinador. Também dá para usar o `.env` (veja `.env.example`).

Funcionamento offline-first: toda escrita vai primeiro para o IndexedDB com a marca `_dirty`. O sync envia e recebe quando a rede volta, e também a cada 5 minutos. Em caso de conflito, vale a última escrita (`updated_at`).

## Mapa do código

| Módulo | Arquivo |
|---|---|
| Esquema SQL e RLS (Treinador/Aluno) | `supabase/migrations/0001_init.sql` |
| Tipos de domínio | `src/domain/types.ts` |
| **Regras de contagem** (válidas, aquecimento, bi-set, drop, séries pesadas) | `src/engine/prescription.ts` |
| **Motor de cálculo** (volume, intensidade, biomecânica, kcal, g de gordura, microciclos, PSE, divergência, trava menstrual, hora/aula) | `src/engine/metrics.ts` |
| Classificação: cache → IA → heurística | `src/engine/classifier.ts`, `src/engine/exerciseSeed.ts` |
| Parser do WhatsApp | `src/parser/whatsapp.ts` |
| Copiloto (gerador no estilo do treinador e travas técnicas) | `src/copilot/generator.ts`, `src/copilot/rules.ts` |
| Links multi-fonte (MuscleWiki → ExRx → JEFIT, só URLs verificadas) | `src/links/linkResolver.ts`, `supabase/functions/verify-link` |
| Voz → dados | `src/voice/useSpeech.ts`, `src/voice/spokenParser.ts` |
| PDF vetorial, templates A/B/C/D (+ prévia em canvas) | `src/pdf/charts.ts`, `src/pdf/templates.ts`, `src/pdf/canvasDoc.ts` |
| Histórico de treinos | `src/ui/pages/History.tsx` |
| Autocorreção de voz | `src/voice/autocorrect.ts` |
| Sync offline-first | `src/data/db.ts`, `src/data/sync.ts`, `src/data/repo.ts` |
| Telas | `src/ui/pages/*` |

## Regras implementadas (resumo)

- **Séries válidas:** aquecimento e adaptação neuromuscular ficam de fora. Exemplo: `15/15/12/10 Duas primeiras de 15 como aquecimento` conta 2 séries. Em bi-set, as séries contam para cada exercício. Em drop-set, conta a série principal.
- **Séries pesadas:** só as faixas 6–8, 8 e 8–10. `10` fixo é moderado. A intensidade aparece sempre em número absoluto e em % das séries válidas.
- **Kcal:** custo base por série conforme o perfil biomecânico (multi livre > multi máquina > mono livre > mono máquina), multiplicado por um fator de repetições. No presencial, soma o trabalho mecânico calculado pela tonelagem. A equivalência é de 7.700 kcal por kg de gordura, com contexto da fase da dieta.
- **Microciclo:** é comparado com a semana anterior (Choque, Regenerativa ou Ordinária) e depois ajustado pela PSE média. Em semana menstrual, Choque é **bloqueado** e vira Regenerativa, com a justificativa registrada.
- **Prescrição:** o app coloca aquecimento automático antes de um multiarticular pesado na abertura da sessão. Séries picadas em aparelho disputado são consolidadas em outro exercício. A renovação mexe na ordem das divisões, na sequência dos exercícios e no repertório (pelo menos 25% de exercícios novos).
- **Links:** o app nunca inventa URL. Sem cache e sem verificação HTTP 200, o exercício fica como `[pendente de link]`.

## Limitações conhecidas

- O ditado por voz usa a Web Speech API (Chrome, Edge, Android e Safari 17+). No Firefox, use o campo de texto, que aceita o mesmo formato.
- Os valores de kcal são **estimativas** para comunicar com o aluno, não uma medição.
- As Edge Functions (Deno) não são compiladas neste repositório. Valide com `supabase functions serve` antes do deploy.
