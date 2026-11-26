-- ============================================================
-- EM Treino — instalação completa do banco (Supabase)
-- Cole TUDO no Supabase → SQL Editor → New query → Run. Rodar uma vez só.
-- (junta os arquivos 0001 a 0009 de supabase/migrations)
-- Pode rodar de novo com segurança: o que já existe é mantido.
-- ============================================================

-- >>> 0001_init.sql
-- =====================================================================
-- EM Treino — Schema inicial
-- Fase 1: Perfil TREINADOR ativo. Perfil ALUNO modelado e desativado.
-- Fase 2: basta criar app_users(role='student', active=true) vinculados a
--         students.user_id e as policies abaixo já liberam PSE + check-in.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------- Perfis / autenticação ----------
do $$ begin create type user_role as enum ('trainer', 'student'); exception when duplicate_object then null; end $$;

create table if not exists app_users (
  id          uuid primary key references auth.users(id) on delete cascade,
  role        user_role not null default 'trainer',
  active      boolean   not null default true,   -- alunos nascem false na Fase 1
  display_name text,
  created_at  timestamptz not null default now()
);

create or replace function is_trainer() returns boolean language sql stable as $$
  select exists(select 1 from app_users where id = auth.uid() and role = 'trainer' and active)
$$;

-- ---------- Alunos (cadastro nominal + financeiro) ----------
do $$ begin create type modality as enum ('online', 'presencial'); exception when duplicate_object then null; end $$;
do $$ begin create type bio_sex as enum ('F', 'M'); exception when duplicate_object then null; end $$;
do $$ begin create type pay_status as enum ('em_dia', 'pendente', 'atrasado'); exception when duplicate_object then null; end $$;

create table if not exists students (
  id              uuid primary key default gen_random_uuid(),
  trainer_id      uuid not null references app_users(id),
  user_id         uuid references app_users(id),          -- Fase 2 (login do aluno)
  full_name       text not null,
  sex             bio_sex not null,
  phone           text,
  modality        modality not null,                      -- modalidade ATUAL
  plan_name       text,
  weekly_frequency int,
  due_day         int check (due_day between 1 and 31),
  plan_value      numeric(10,2),
  hourly_rate     numeric(10,2),                          -- null => calculado
  hourly_rate_manual boolean not null default false,
  payment_status  pay_status not null default 'em_dia',
  archived        boolean not null default false,
  timeline_reset_at timestamptz,                          -- "Novo Aluno (Zerar Base)"
  updated_at      timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

-- (depois da tabela students: o Postgres valida o corpo da função na criação)
create or replace function my_student_id() returns uuid language sql stable as $$
  select s.id from students s
  join app_users u on u.id = s.user_id
  where u.id = auth.uid() and u.role = 'student' and u.active
  limit 1
$$;


-- histórico de modalidade (aluno que migra mantém base unificada)
create table if not exists modality_history (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references students(id) on delete cascade,
  modality    modality not null,
  started_on  date not null,
  ended_on    date
);

-- ---------- Contexto fisiológico semanal ----------
do $$ begin create type diet_phase as enum ('bulking', 'manutencao', 'cutting'); exception when duplicate_object then null; end $$;
do $$ begin create type microcycle as enum ('ordinaria', 'choque', 'regenerativa'); exception when duplicate_object then null; end $$;

create table if not exists week_context (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references students(id) on delete cascade,
  week_start    date not null,                  -- segunda-feira
  menstrual     boolean not null default false, -- somente sexo F (validado no app)
  menstrual_phase text,
  diet          diet_phase not null default 'manutencao',
  planned_microcycle microcycle,
  final_microcycle   microcycle,
  justification text,                           -- ex.: "Regenerativa por ciclo menstrual"
  updated_at    timestamptz not null default now(),
  unique (student_id, week_start)
);

-- ---------- Sessões / exercícios / séries ----------
do $$ begin create type session_source as enum ('whatsapp', 'presencial', 'copiloto'); exception when duplicate_object then null; end $$;
do $$ begin create type reporter as enum ('trainer', 'student'); exception when duplicate_object then null; end $$;
do $$ begin create type sleep_quality as enum ('bem', 'mal', 'irregular'); exception when duplicate_object then null; end $$;

create table if not exists sessions (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references students(id) on delete cascade,
  date         date not null,
  label        text not null,                   -- "Treino A"
  source       session_source not null,
  muscle_groups text[] not null default '{}',   -- grupamentos ativos (3 toques)
  raw_text     text,                            -- mensagem original do WhatsApp
  planned_microcycle microcycle,
  updated_at   timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

create table if not exists session_exercises (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references sessions(id) on delete cascade,
  position      int not null,
  superset_group int,                           -- bi-set: mesmo número
  exercise_key  text not null,
  display_name  text not null,                  -- como o treinador escreveu
  valid_sets    int not null,
  warmup_sets   int not null default 0,
  heavy_sets    int not null default 0,
  reps          jsonb not null default '[]',    -- [{min,max}] por série válida
  load_kg       numeric(7,2),
  drop_set      boolean not null default false,
  notes         text
);

-- Avaliações (PSE + sono): separadas da sessão para o aluno lançar na Fase 2
create table if not exists session_ratings (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references sessions(id) on delete cascade,
  pse         int check (pse between 0 and 10),
  reported_by reporter not null default 'trainer',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists daily_checkins (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references students(id) on delete cascade,
  date        date not null,
  sleep       sleep_quality not null,
  reported_by reporter not null default 'trainer',
  updated_at  timestamptz not null default now(),
  unique (student_id, date, reported_by)
);

-- ---------- Caches (IA e links) ----------
create table if not exists exercise_cache (
  key          text primary key,               -- nome normalizado
  name         text not null,                  -- nome padronizado
  aliases      text[] not null default '{}',
  muscle_group text not null,
  sub_region   text,
  mechanic     text not null check (mechanic in ('multiarticular','monoarticular')),
  implement    text not null check (implement in ('livre','maquina_cabo')),
  disputed     boolean not null default false, -- aparelho com fila (ex.: cross over)
  source       text not null default 'ai',     -- seed | ai | trainer
  created_at   timestamptz not null default now()
);

create table if not exists exercise_links (
  exercise_key text not null references exercise_cache(key) on delete cascade,
  provider     text not null,                  -- musclewiki | exrx | jefit | trainer
  url          text not null,
  verified_at  timestamptz not null default now(),
  primary key (exercise_key, provider)
);

-- (sem FK na chave do exercício: o catálogo embutido no app não está no banco — ver 0006)

-- ---------- RLS ----------
alter table app_users        enable row level security;
alter table students         enable row level security;
alter table modality_history enable row level security;
alter table week_context     enable row level security;
alter table sessions         enable row level security;
alter table session_exercises enable row level security;
alter table session_ratings  enable row level security;
alter table daily_checkins   enable row level security;
alter table exercise_cache   enable row level security;
alter table exercise_links   enable row level security;

drop policy if exists me on app_users;
create policy me on app_users for select using (id = auth.uid());

-- Treinador: acesso total aos próprios alunos
drop policy if exists trainer_students on students;
create policy trainer_students on students for all
  using (is_trainer() and trainer_id = auth.uid())
  with check (is_trainer() and trainer_id = auth.uid());

drop policy if exists trainer_modality on modality_history;
create policy trainer_modality on modality_history for all using (
  is_trainer() and student_id in (select id from students where trainer_id = auth.uid()));
drop policy if exists trainer_week on week_context;
create policy trainer_week on week_context for all using (
  is_trainer() and student_id in (select id from students where trainer_id = auth.uid()));
drop policy if exists trainer_sessions on sessions;
create policy trainer_sessions on sessions for all using (
  is_trainer() and student_id in (select id from students where trainer_id = auth.uid()));
drop policy if exists trainer_exercises on session_exercises;
create policy trainer_exercises on session_exercises for all using (
  is_trainer() and session_id in (select s.id from sessions s join students st on st.id = s.student_id where st.trainer_id = auth.uid()));
drop policy if exists trainer_ratings on session_ratings;
create policy trainer_ratings on session_ratings for all using (
  is_trainer() and session_id in (select s.id from sessions s join students st on st.id = s.student_id where st.trainer_id = auth.uid()));
drop policy if exists trainer_checkins on daily_checkins;
create policy trainer_checkins on daily_checkins for all using (
  is_trainer() and student_id in (select id from students where trainer_id = auth.uid()));
drop policy if exists cache_read on exercise_cache;
create policy cache_read on exercise_cache for select using (auth.uid() is not null);
drop policy if exists cache_write on exercise_cache;
create policy cache_write on exercise_cache for all using (is_trainer()) with check (is_trainer());
drop policy if exists links_read on exercise_links;
create policy links_read on exercise_links for select using (auth.uid() is not null);
drop policy if exists links_write on exercise_links;
create policy links_write on exercise_links for all using (is_trainer()) with check (is_trainer());

-- Fase 2 (inertes enquanto nenhum app_users.role='student' estiver active):
drop policy if exists student_own_profile on students;
create policy student_own_profile on students for select using (id = my_student_id());
drop policy if exists student_own_sessions on sessions;
create policy student_own_sessions on sessions for select using (student_id = my_student_id());
drop policy if exists student_rate on session_ratings;
create policy student_rate on session_ratings for insert with check (
  reported_by = 'student' and session_id in (select id from sessions where student_id = my_student_id()));
drop policy if exists student_checkin on daily_checkins;
create policy student_checkin on daily_checkins for insert with check (
  reported_by = 'student' and student_id = my_student_id());

-- >>> 0002_series_detail.sql
-- Séries progressivas no presencial: carga por série e "kg/lado".
alter table session_exercises add column if not exists loads jsonb;
alter table session_exercises add column if not exists per_side boolean not null default false;
-- reps (jsonb) passa a aceitar {min, max, failure: true} para séries "do máximo".

-- >>> 0003_auth_bootstrap.sql
-- O primeiro usuário cadastrado no Auth vira o Treinador (ativo).
-- Os próximos nascem como Aluno DESATIVADO (Fase 2), até o treinador liberar.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into app_users (id, role, active, display_name)
  values (
    new.id,
    case when exists (select 1 from app_users where role = 'trainer') then 'student'::user_role else 'trainer'::user_role end,
    not exists (select 1 from app_users where role = 'trainer'),
    coalesce(new.raw_user_meta_data->>'name', new.email)
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- >>> 0004_consultancy_plan.sql
-- Consultoria: periodicidade do plano, data de vencimento e troca de treino.
alter table students add column if not exists due_date date;
alter table students add column if not exists plan_period text check (plan_period in ('mensal', 'quinzenal', 'semanal'));
alter table students add column if not exists next_change_date date;

-- >>> 0005_warmup_detail.sql
-- Séries de aquecimento detalhadas (carga e reps) dentro do mesmo exercício.
alter table session_exercises add column if not exists warmup_detail jsonb;

-- >>> 0006_sync_fase1.sql
-- =====================================================================
-- 0006 — Sincronização entre aparelhos (Fase 1)
--
-- 0) Corrige a recursão infinita do RLS em students (bloqueava toda a sincronização).
-- 1) Garante o perfil Treinador: se o seu usuário foi criado no Auth ANTES
--    de rodar o SQL de instalação, ele ficou sem linha em app_users e o RLS
--    bloqueava tudo. O usuário mais antigo vira o Treinador ativo.
-- 2) synced_at: horário do SERVIDOR em cada gravação. O app baixa por ele
--    (e não pelo relógio do celular), assim um treino salvo offline e enviado
--    depois nunca é perdido pelos outros aparelhos.
-- 3) deleted: exclusões viram "lápide" para os outros aparelhos também apagarem.
-- 4) A chave de exercício deixa de ser FK obrigatória (o catálogo embutido no
--    app não existe no banco até ser enviado).
--
-- Pode rodar mais de uma vez sem problema.
-- =====================================================================

-- 0) Funções de permissão sem recursão --------------------------------------
-- A política "student_own_profile" de students chama my_student_id(), que lia
-- students de novo -> recursão infinita ("stack depth limit exceeded") em
-- QUALQUER leitura/gravação de alunos. security definer lê sem reaplicar o RLS.
create or replace function is_trainer() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from app_users where id = auth.uid() and role = 'trainer' and active)
$$;

create or replace function my_student_id() returns uuid
language sql stable security definer set search_path = public as $$
  select s.id from students s
  join app_users u on u.id = s.user_id
  where u.id = auth.uid() and u.role = 'student' and u.active
  limit 1
$$;

-- 1) Perfil do Treinador -------------------------------------------------
insert into app_users (id, role, active, display_name)
select u.id, 'student', false, coalesce(u.raw_user_meta_data->>'name', u.email)
from auth.users u
where not exists (select 1 from app_users a where a.id = u.id);

-- o usuário mais antigo do Auth é sempre o Treinador (regra da Fase 1)
update app_users set role = 'trainer', active = true
where id = (select u.id from auth.users u order by u.created_at limit 1);

-- 2 e 3) synced_at (servidor) + deleted (lápide) ---------------------------
create or replace function touch_synced_at() returns trigger
language plpgsql as $$
begin
  new.synced_at := clock_timestamp();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['students', 'week_context', 'sessions', 'session_ratings', 'daily_checkins', 'exercise_cache'] loop
    execute format('alter table %I add column if not exists synced_at timestamptz not null default clock_timestamp()', t);
    execute format('create index if not exists %I on %I (synced_at)', t || '_synced_at_idx', t);
    execute format('drop trigger if exists %I on %I', t || '_touch_synced', t);
    execute format('create trigger %I before insert or update on %I for each row execute function touch_synced_at()', t || '_touch_synced', t);
    if t <> 'exercise_cache' then
      execute format('alter table %I add column if not exists deleted boolean not null default false', t);
    end if;
  end loop;
end $$;

-- 4) Exercícios do catálogo embutido ---------------------------------------
alter table session_exercises drop constraint if exists fk_exercise_key;


-- >>> 0007_grants.sql
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.is_trainer(), public.my_student_id() to authenticated;
-- tabelas criadas no futuro por este mesmo usuário já nascem com a permissão
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant usage, select on sequences to authenticated;

-- >>> 0008_student_emphasis.sql
alter table public.students add column if not exists emphasis text[];

-- >>> 0009_anamneses.sql
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

-- >>> 0010_student_training_level.sql
alter table public.students add column if not exists training_level text;

-- >>> 0011_cardio.sql
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

-- Resultado: confira aqui qual e-mail ficou como Treinador (é com ele que você entra no app).
select display_name as email, role, active from app_users order by (role = 'trainer') desc, display_name;
