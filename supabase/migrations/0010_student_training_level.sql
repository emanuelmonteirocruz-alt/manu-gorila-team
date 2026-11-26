-- 0010 — Nível de treino do aluno da consultoria (adaptação, iniciante, intermediário, avançado 1, avançado 2, atleta)
alter table public.students add column if not exists training_level text;
