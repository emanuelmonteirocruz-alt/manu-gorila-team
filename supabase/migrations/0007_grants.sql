-- =====================================================================
-- 0007 — Permissões das tabelas para usuários LOGADOS
-- Projetos Supabase novos não dão GRANT automático às tabelas criadas pelo
-- SQL Editor: sem isto o app recebe "permission denied" mesmo com o RLS certo.
-- Só o papel "authenticated" (treinador logado) recebe acesso; quem não entrou
-- (anon) continua sem acesso. O RLS segue limitando cada um aos próprios dados.
-- Pode rodar mais de uma vez.
-- =====================================================================
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.is_trainer(), public.my_student_id() to authenticated;
-- tabelas criadas no futuro por este mesmo usuário já nascem com a permissão
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant usage, select on sequences to authenticated;
