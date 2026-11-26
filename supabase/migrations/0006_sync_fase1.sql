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

-- Resultado: confira aqui qual e-mail ficou como Treinador (é com ele que você entra no app).
select display_name as email, role, active from app_users order by (role = 'trainer') desc, display_name;
