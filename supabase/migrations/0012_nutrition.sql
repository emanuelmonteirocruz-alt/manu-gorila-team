-- =====================================================================
-- 0012 — Avaliação do nutricionista (foto/PDF anexado + dados lidos: peso, kcal, fase da dieta…). Acréscimo.
-- =====================================================================
create table if not exists public.nutrition (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.students(id) on delete cascade,
  date        date not null,
  file_path   text,
  file_name   text,
  mime        text,
  weight_kg   numeric,
  kcal        numeric,
  phase       text,
  protein_g   numeric,
  body_fat    numeric,
  notes       text,
  raw_text    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted     boolean not null default false,
  synced_at   timestamptz not null default clock_timestamp()
);
create index if not exists nutrition_synced_at_idx on public.nutrition (synced_at);
create index if not exists nutrition_student_idx on public.nutrition (student_id, date);
drop trigger if exists nutrition_touch_synced on public.nutrition;
create trigger nutrition_touch_synced before insert or update on public.nutrition
  for each row execute function touch_synced_at();

alter table public.nutrition enable row level security;
drop policy if exists trainer_nutrition on public.nutrition;
create policy trainer_nutrition on public.nutrition for all
  using (is_trainer() and student_id in (select id from public.students where trainer_id = auth.uid()))
  with check (is_trainer() and student_id in (select id from public.students where trainer_id = auth.uid()));
grant select, insert, update, delete on public.nutrition to authenticated;

-- arquivos (foto/PDF) num bucket privado: só o treinador lê e grava
insert into storage.buckets (id, name, public) values ('nutrition', 'nutrition', false) on conflict (id) do nothing;
drop policy if exists trainer_nutrition_files on storage.objects;
create policy trainer_nutrition_files on storage.objects for all to authenticated
  using (bucket_id = 'nutrition' and public.is_trainer())
  with check (bucket_id = 'nutrition' and public.is_trainer());
