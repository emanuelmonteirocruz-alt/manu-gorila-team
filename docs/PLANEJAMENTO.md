# EM Treino — Planejamento revisado

## 1. Objetivo
Ferramenta do **treinador** (Fase 1) para prescrever, registrar e analisar treinos de **Consultoria Online** e **Personal Presencial**. A entrega para o aluno é feita por **PDF visual + áudio no WhatsApp**. O banco já está pronto para a **Fase 2**, em que o aluno lança PSE e sono pelo celular.

## 2. Módulos e telas
| Tela | Função |
|---|---|
| **Painel** | Vencimentos próximos (atalho para o resumo mensal), alertas de PSE × prescrito, últimas sessões |
| **Presencial** | Aluno → Treino → Grupamentos → sessão com ditado, autocorreção, cards com série a série (carga, reps/Máx, kg/lado e marcação **Pesada**), PSE e sono no fim, PDF do treino |
| **Alunos** | Cadastro nominal e financeiro, hora/aula automática, salvar e **excluir** |
| **Aluno (detalhe)** | Contexto da semana (dieta, ciclo, microciclo com trava), sono do dia, recálculo semanal (válidas, pesadas, %, tonelagem, kcal, kcal/treino), copiloto |
| **Colar WhatsApp** | Só alunos de consultoria; parser de mensagens → Treino A/B/C por semana |
| **Histórico** | Todos os treinos com filtro por aluno e período, detalhe série a série, tonelagem, kcal, PSE, PDF e exclusão |
| **Relatórios PDF** | A (antes × depois), B (evolução semanal), C (mês / dia do pagamento), D (treino do dia), com prévia na tela |
| **Config.** | Marca (logo, nome, cores), instalar app, Supabase, cache de exercícios e links |

## 3. Regras de cálculo (fonte única: `src/engine`)
- **Série válida:** exclui aquecimento/adaptação. Bi-set conta para cada exercício. Drop conta a série principal.
- **Série pesada:**
  1. **Marcação do treinador** em cada série (vence a regra).
  2. Senão, a regra automática pelas faixas **6–8, 8 e 8–10**.
  3. "Máx" sem faixa não conta como pesada, a menos que seja marcada.
- **Tonelagem:** soma de *carga × reps* de **cada série**. "kg/lado" conta em dobro. Aparece no treino do dia, na semana, no mês, no antes × depois e no histórico.
- **kcal:** custo base por perfil biomecânico × reps + trabalho mecânico pela tonelagem. **Gordura** = kcal ÷ 7.700 × 1000 g. Também é mostrada a média por treino.
- **Microciclo:** comparação com a semana anterior, ajustada pela PSE. A semana menstrual **bloqueia Choque**.

## 4. Erros encontrados nesta revisão (e o que foi feito)
| # | Problema | Situação |
|---|---|---|
| 1 | **Prévia do PDF em branco.** PDF dentro de iframe é bloqueado no visualizador e não renderiza no Chrome Android | ✅ Prévia desenhada em canvas, com os mesmos traços do PDF |
| 2 | **Série pesada só pela faixa de reps.** Uma série pesada de 10 reps não era contada | ✅ Campo **Pesada** por série, e a palavra "pesada"/"carga alta" no ditado já marca |
| 3 | **Sincronização recusada pelo Supabase.** Alunos criados offline levavam um id provisório do treinador e a regra de segurança (RLS) bloquearia o envio | ✅ O sync troca pelo usuário autenticado antes de enviar |
| 4 | **Conflito tablet × celular.** Contexto da semana ou check-in de sono criado offline nos dois aparelhos violaria a chave única | ✅ Upsert pela chave natural (aluno + semana / aluno + dia) |
| 5 | **PSE e sono editados não desciam para o outro aparelho** (a busca usava a data de criação) | ✅ Passou a usar `updated_at` |
| 6 | **Primeiro acesso exigia SQL manual** para virar treinador | ✅ Gatilho `0003`: o 1º usuário vira Treinador e os próximos nascem Aluno desativado (Fase 2) |
| 7 | **Instalação como app incompleta** (sem ícones PNG, sem rotas no host) | ✅ Ícones 192/512/maskable/Apple, manifesto, botão "Instalar", `vercel.json` / `netlify.toml` |
| 8 | Ficha do aluno não salvava | ✅ Corrigido antes (formulário refeito, aviso "Salvo ✓") |
| 9 | Check-in de sono sem retorno visual | ✅ Corrigido antes (marca ✓, troca e desmarca) |

## 5. Pendências conhecidas (não bloqueiam o uso)
- **Exclusões entre aparelhos:** o que você apaga num aparelho é removido da nuvem, mas outro aparelho que já tinha o dado só deixa de mostrá-lo depois de reinstalar ou limpar os dados. Solução futura: exclusão lógica no banco.
- **kcal é estimativa.** Serve para comunicar ao aluno, não é medição.
- **Ditado no iPhone** depende do teclado do iOS. A caixa de texto e a autocorreção funcionam igual.
- **Treino iniciado e abandonado** fica salvo vazio. Ele aparece no Histórico como "vazio" e pode ser excluído ali.
