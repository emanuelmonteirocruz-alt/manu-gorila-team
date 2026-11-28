-- =====================================================================
-- 0014 — Check-ins / acompanhamentos enviados aos alunos (sincronizam entre tablet, celular e PC). Acréscimo.
-- =====================================================================
create table if not exists public.followups (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.students(id) on delete cascade,
  key         text not null,               -- "f:2026-11-23" (check-in completo), "q:…" (rápido), "missing:…" (aluno sumido)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted     boolean not null default false,
  synced_at   timestamptz not null default clock_timestamp(),
  unique (student_id, key)
);
create index if not exists followups_synced_at_idx on public.followups (synced_at);
drop trigger if exists followups_touch_synced on public.followups;
create trigger followups_touch_synced before insert or update on public.followups
  for each row execute function touch_synced_at();

alter table public.followups enable row level security;
drop policy if exists trainer_followups on public.followups;
create policy trainer_followups on public.followups for all
  using (is_trainer() and student_id in (select id from public.students where trainer_id = auth.uid()))
  with check (is_trainer() and student_id in (select id from public.students where trainer_id = auth.uid()));
grant select, insert, update, delete on public.followups to authenticated;
