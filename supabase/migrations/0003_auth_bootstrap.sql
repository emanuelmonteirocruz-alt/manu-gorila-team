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
