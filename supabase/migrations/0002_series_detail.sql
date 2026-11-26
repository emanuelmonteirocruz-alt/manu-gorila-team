-- Séries progressivas no presencial: carga por série e "kg/lado".
alter table session_exercises add column if not exists loads jsonb;
alter table session_exercises add column if not exists per_side boolean not null default false;
-- reps (jsonb) passa a aceitar {min, max, failure: true} para séries "do máximo".
