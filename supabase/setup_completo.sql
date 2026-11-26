-- ============================================================
-- EM Treino — instalação completa do banco (Supabase)
-- Cole TUDO no Supabase → SQL Editor → New query → Run. Rodar uma vez só.
-- (junta os arquivos 0001 a 0005 de supabase/migrations)
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
create type user_role as enum ('trainer', 'student');

create table app_users (
  id          uuid primary key references auth.users(id) on delete cascade,
  role        user_role not null default 'trainer',
  active      boolean   not null default true,   -- alunos nascem false na Fase 1
  display_name text,
  created_at  timestamptz not null default now()
);

create or replace function is_trainer() returns boolean language sql stable as $$
  select exists(select 1 from app_users where id = auth.uid() and role = 'trainer' and active)
$$;

create or replace function my_student_id() returns uuid language sql stable as $$
  select s.id from students s
  join app_users u on u.id = s.user_id
  where u.id = auth.uid() and u.role = 'student' and u.active
  limit 1
$$;

-- ---------- Alunos (cadastro nominal + financeiro) ----------
create type modality   as enum ('online', 'presencial');
create type bio_sex    as enum ('F', 'M');
create type pay_status as enum ('em_dia', 'pendente', 'atrasado');

create table students (
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

-- histórico de modalidade (aluno que migra mantém base unificada)
create table modality_history (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references students(id) on delete cascade,
  modality    modality not null,
  started_on  date not null,
  ended_on    date
);

-- ---------- Contexto fisiológico semanal ----------
create type diet_phase as enum ('bulking', 'manutencao', 'cutting');
create type microcycle as enum ('ordinaria', 'choque', 'regenerativa');

create table week_context (
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
create type session_source as enum ('whatsapp', 'presencial', 'copiloto');
create type reporter       as enum ('trainer', 'student');
create type sleep_quality  as enum ('bem', 'mal', 'irregular');

create table sessions (
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

create table session_exercises (
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
create table session_ratings (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references sessions(id) on delete cascade,
  pse         int check (pse between 0 and 10),
  reported_by reporter not null default 'trainer',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table daily_checkins (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references students(id) on delete cascade,
  date        date not null,
  sleep       sleep_quality not null,
  reported_by reporter not null default 'trainer',
  updated_at  timestamptz not null default now(),
  unique (student_id, date, reported_by)
);

-- ---------- Caches (IA e links) ----------
create table exercise_cache (
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

create table exercise_links (
  exercise_key text not null references exercise_cache(key) on delete cascade,
  provider     text not null,                  -- musclewiki | exrx | jefit | trainer
  url          text not null,
  verified_at  timestamptz not null default now(),
  primary key (exercise_key, provider)
);

alter table session_exercises add constraint fk_exercise_key
  foreign key (exercise_key) references exercise_cache(key);

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

create policy me on app_users for select using (id = auth.uid());

-- Treinador: acesso total aos próprios alunos
create policy trainer_students on students for all
  using (is_trainer() and trainer_id = auth.uid())
  with check (is_trainer() and trainer_id = auth.uid());

create policy trainer_modality on modality_history for all using (
  is_trainer() and student_id in (select id from students where trainer_id = auth.uid()));
create policy trainer_week on week_context for all using (
  is_trainer() and student_id in (select id from students where trainer_id = auth.uid()));
create policy trainer_sessions on sessions for all using (
  is_trainer() and student_id in (select id from students where trainer_id = auth.uid()));
create policy trainer_exercises on session_exercises for all using (
  is_trainer() and session_id in (select s.id from sessions s join students st on st.id = s.student_id where st.trainer_id = auth.uid()));
create policy trainer_ratings on session_ratings for all using (
  is_trainer() and session_id in (select s.id from sessions s join students st on st.id = s.student_id where st.trainer_id = auth.uid()));
create policy trainer_checkins on daily_checkins for all using (
  is_trainer() and student_id in (select id from students where trainer_id = auth.uid()));
create policy cache_read  on exercise_cache for select using (auth.uid() is not null);
create policy cache_write on exercise_cache for all using (is_trainer()) with check (is_trainer());
create policy links_read  on exercise_links for select using (auth.uid() is not null);
create policy links_write on exercise_links for all using (is_trainer()) with check (is_trainer());

-- Fase 2 (inertes enquanto nenhum app_users.role='student' estiver active):
create policy student_own_profile on students for select using (id = my_student_id());
create policy student_own_sessions on sessions for select using (student_id = my_student_id());
create policy student_rate on session_ratings for insert with check (
  reported_by = 'student' and session_id in (select id from sessions where student_id = my_student_id()));
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
