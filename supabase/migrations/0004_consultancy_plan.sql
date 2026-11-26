-- Consultoria: periodicidade do plano, data de vencimento e troca de treino.
alter table students add column if not exists due_date date;
alter table students add column if not exists plan_period text check (plan_period in ('mensal', 'quinzenal', 'semanal'));
alter table students add column if not exists next_change_date date;
