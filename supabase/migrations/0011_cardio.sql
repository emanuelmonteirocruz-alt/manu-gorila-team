-- =====================================================================
-- 0011 — Cardio (consultoria e presencial) + peso do aluno (para o gasto calórico). Acréscimo.
-- =====================================================================
alter table public.students add column if not exists weight_kg numeric;

create table if not exists public.cardio (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.students(id) on delete cascade,
  date        date not null,
  kind        text not null,
  minutes     numeric not null,
  km          numeric,
  intensity   text,
  incline     numeric,
  met         numeric,
  kcal        numeric,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted     boolean not null default false,
  synced_at   timestamptz not null default clock_timestamp()
);
create index if not exists cardio_synced_at_idx on public.cardio (synced_at);
create index if not exists cardio_student_date_idx on public.cardio (student_id, date);
drop trigger if exists cardio_touch_synced on public.cardio;
create trigger cardio_touch_synced before insert or update on public.cardio
  for each row execute function touch_synced_at();

alter table public.cardio enable row level security;
drop policy if exists trainer_cardio on public.cardio;
create policy trainer_cardio on public.cardio for all
  using (is_trainer() and student_id in (select id from public.students where trainer_id = auth.uid()))
  with check (is_trainer() and student_id in (select id from public.students where trainer_id = auth.uid()));
grant select, insert, update, delete on public.cardio to authenticated;
