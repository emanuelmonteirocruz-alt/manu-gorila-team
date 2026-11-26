-- =====================================================================
-- Corrigir o login do treinador ("senha incorreta" com a senha certa)
--
-- Causa comum: usuário criado com INSERT direto em auth.users (pelo SQL).
-- O login do Supabase exige senha criptografada, e-mail confirmado, campos
-- de token preenchidos e uma "identidade" de e-mail — este script ajusta tudo.
--
-- Como usar: troque os DOIS valores abaixo (mantenha as aspas simples),
-- cole no Supabase em SQL Editor → New query → Run.
-- Depois de entrar no app, apague este texto do editor (ele contém a senha).
-- =====================================================================

do $$
declare
  v_email text := 'SEU_EMAIL_AQUI';        -- ex.: 'manu@gmail.com'
  v_senha text := 'SUA_NOVA_SENHA_AQUI';   -- mínimo 6 caracteres
  v_id uuid;
begin
  if v_email like '%SEU_EMAIL%' or v_senha like '%SUA_NOVA%' then
    raise exception 'Troque SEU_EMAIL_AQUI e SUA_NOVA_SENHA_AQUI antes de rodar.';
  end if;
  v_email := lower(trim(v_email));

  select id into v_id from auth.users where lower(email) = v_email;

  if v_id is null then
    -- usuário não existe: cria do jeito que o Supabase espera
    v_id := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
            extensions.crypt(v_senha, extensions.gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
  else
    -- usuário existe: nova senha criptografada, e-mail confirmado e campos obrigatórios
    update auth.users set
      email = v_email,
      encrypted_password = extensions.crypt(v_senha, extensions.gen_salt('bf')),
      email_confirmed_at = coalesce(email_confirmed_at, now()),
      aud = coalesce(nullif(aud, ''), 'authenticated'),
      role = coalesce(nullif(role, ''), 'authenticated'),
      instance_id = coalesce(instance_id, '00000000-0000-0000-0000-000000000000'),
      raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"provider":"email","providers":["email"]}',
      raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb),
      confirmation_token = coalesce(confirmation_token, ''),
      recovery_token = coalesce(recovery_token, ''),
      email_change_token_new = coalesce(email_change_token_new, ''),
      email_change = coalesce(email_change, ''),
      banned_until = null,
      deleted_at = null,
      updated_at = now()
    where id = v_id;
  end if;

  -- identidade de e-mail (sem ela o login por senha falha)
  if not exists (select 1 from auth.identities where user_id = v_id and provider = 'email') then
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (v_id::text, v_id, jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
            'email', now(), now(), now());
  end if;

  -- perfil de Treinador no app
  insert into public.app_users (id, role, active, display_name)
  values (v_id, 'trainer', true, v_email)
  on conflict (id) do update set role = 'trainer', active = true;
end $$;

-- Resultado: deve aparecer o seu e-mail com confirmado = true, senha = true, identidade = true, papel = trainer
select u.email,
       u.email_confirmed_at is not null as confirmado,
       u.encrypted_password like '$2%' as senha,
       exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email') as identidade,
       a.role as papel, a.active as ativo
from auth.users u left join public.app_users a on a.id = u.id
order by u.created_at;
