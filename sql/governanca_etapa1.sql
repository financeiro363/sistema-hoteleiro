-- ============================================================================
-- GOVERNANÇA — etapa 1 (02/11/2026)
-- ============================================================================
-- Só ACRESCENTA colunas; não apaga nem muda nenhum dado. Pode rodar mais de
-- uma vez.
--   quartos            → prioridade pedida pela recepção, "Não perturbe" do
--                        dia, previsão de volta e bloqueio na Cloudbeds
--                        (quarto Interditado)
--   governanca_sessoes → arrumação desistida (não conta nos Insights)
--   manutencoes        → foto do problema (chamado aberto pela camareira)
--   tempo real         → a tela da Governança se atualiza sozinha quando um
--                        quarto muda (Supabase Realtime)
-- ============================================================================

alter table public.quartos add column if not exists prioridade boolean not null default false;
alter table public.quartos add column if not exists prioridade_obs text;
alter table public.quartos add column if not exists nao_perturbe_em timestamptz;
alter table public.quartos add column if not exists interditado_ate date;
alter table public.quartos add column if not exists cloudbeds_bloqueio_id text;

alter table public.governanca_sessoes add column if not exists cancelada boolean not null default false;

alter table public.manutencoes add column if not exists foto_caminho text;
alter table public.manutencoes add column if not exists foto_nome text;

-- Tempo real: avisa as telas abertas quando um quarto muda
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'quartos') then
    alter publication supabase_realtime add table public.quartos;
  end if;
end $$;

-- Conferência: colunas_novas e tempo_real devem mostrar true
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'quartos'
      and column_name in ('prioridade', 'prioridade_obs', 'nao_perturbe_em', 'interditado_ate', 'cloudbeds_bloqueio_id')) = 5
    and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'governanca_sessoes' and column_name = 'cancelada')
    and (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'manutencoes' and column_name in ('foto_caminho', 'foto_nome')) = 2
    as colunas_novas,
  exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'quartos') as tempo_real,
  (select count(*) from public.quartos) as quartos_cadastrados;
