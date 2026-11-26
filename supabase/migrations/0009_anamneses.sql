-- =====================================================================
-- 0009 — Anamnese da consultoria (uma por aluno). Acréscimo: não altera nada existente.
-- =====================================================================
create table if not exists public.anamneses (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null unique references public.students(id) on delete cascade,
  answers     jsonb not null default '{}',
  raw_text    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted     boolean not null default false,
  synced_at   timestamptz not null default clock_timestamp()
);
create index if not exists anamneses_synced_at_idx on public.anamneses (synced_at);
drop trigger if exists anamneses_touch_synced on public.anamneses;
create trigger anamneses_touch_synced before insert or update on public.anamneses
  for each row execute function touch_synced_at();

alter table public.anamneses enable row level security;
drop policy if exists trainer_anamneses on public.anamneses;
create policy trainer_anamneses on public.anamneses for all
  using (is_trainer() and student_id in (select id from public.students where trainer_id = auth.uid()))
  with check (is_trainer() and student_id in (select id from public.students where trainer_id = auth.uid()));
grant select, insert, update, delete on public.anamneses to authenticated;
