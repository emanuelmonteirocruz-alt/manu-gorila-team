# Manu Team — guia para o Claude

App PWA do personal Emanuel Monteiro (Consultoria Online + Personal Presencial).
O usuário escreve em português: responda em português, de forma curta.

## Stack e fluxo
- React 19 + TypeScript + Vite + Dexie (IndexedDB, offline-first) + Supabase (sync e storage). Deploy automático na Vercel (manu-gorila-team.vercel.app) a cada push.
- Branch `main`. **Pode dar commit e push depois de cada mudança** (já autorizado).
- Antes de subir: `npx tsc --noEmit -p .`, `npx vitest run` e `npm run build`.
- Migrações do Supabase em `supabase/` (numeradas; também somadas em `supabase/setup_completo.sql`). O token de gerenciamento antigo não vale mais: não peça nem guarde tokens.
- Nunca colocar dados reais de alunos (nome, saúde, telefone) no repositório: testes e simulações com dados inventados.

## Onde fica cada coisa
- PDFs dos alunos: `src/pdf/templates.ts` (Semana × Semana, Mês × mês, Resumo do mês, Treino do dia, Uma semana) e `src/pdf/charts.ts`.
- Métricas (séries, séries pesadas, kcal por MET, fases): `src/engine/metrics.ts`; cardio: `src/engine/cardio.ts`.
- Dados dos relatórios: `src/data/reportData.ts` (expansão ABCDA, treinos executados) e `src/data/repo.ts` (weekPoints, fases).
- Consultoria (gerador do próximo ciclo, choque, níveis, 1ª semana): `src/consultoria/`.
- Telas: `src/ui/pages/` e `src/ui/components/` (StudentTabs, NextCycle, CopyWeek, InPerson, CardioPanel, NutritionPanel, SessionEditor).

## Regras do produto (decididas pelo Emanuel)
- PDFs **técnicos, didáticos e clean**: o aluno precisa perceber a evolução pelo visual. O mínimo de texto, **sem frases motivacionais**.
- **Nunca mostrar nome de método para o aluno** (drop, bi-set, rest-pause…). Métodos só aparecem para o treinador.
- Não usar "superior/inferior"; nos grupos musculares, só o músculo principal.
- **Repetições antes do kg** em tudo (ex.: 10 × 40 kg).
- Consultoria: sem comparação ou lista de músculos nos PDFs; sem gramas de gordura; sem "equivalente em caminhada".
- Nomes das fases: "Fase de consolidação", "Base e controle técnico", "Pico de estímulo". Semana regenerativa deve ficar evidente ("redução planejada de volume"), sem a frase "não é perda de treino".
- Manter o termo "mais intensidade".
- **Pergunte antes de mudar o layout** ou propor algo grande, com exemplos de opções.
