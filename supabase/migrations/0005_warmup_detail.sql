-- Séries de aquecimento detalhadas (carga e reps) dentro do mesmo exercício.
alter table session_exercises add column if not exists warmup_detail jsonb;
