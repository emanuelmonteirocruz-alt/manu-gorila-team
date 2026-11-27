-- 0013 — Avaliação do nutricionista: só dados corporais (altura, idade, massa magra além de peso e % gordura). Acréscimo.
alter table public.nutrition add column if not exists height_m numeric;
alter table public.nutrition add column if not exists age numeric;
alter table public.nutrition add column if not exists lean_mass_kg numeric;
