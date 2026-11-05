-- ============================================================================
-- VENDER MAIS COM O QUE JÁ EXISTE — Etapa 3 (segunda tentativa com oferta)
-- ============================================================================
-- Não apaga nem muda nenhum dado. Pode rodar mais de uma vez.
-- Precisa do SQL da Etapa 1 das vendas (sql/vendas_etapa1.sql).
--   1) Automação nova: OFERTA (segunda tentativa com benefício)
--   2) Na cotação: quando a oferta foi enviada e qual o benefício (a recepção
--      vê na tela de chegadas, para cumprir o combinado)
-- As datas alternativas, a tela da recepção e a linha do tempo não precisam
-- de SQL.
-- ============================================================================

alter table public.atendimento_automacoes drop constraint if exists atendimento_automacoes_tipo_check;
alter table public.atendimento_automacoes add constraint atendimento_automacoes_tipo_check
  check (tipo in ('FUP_RESERVAR', 'FUP_COTACAO', 'SEM_DISPONIBILIDADE', 'GRUPO', 'CONFIRMACAO_RESERVA', 'PRE_CHECKIN', 'POS_CHECKOUT', 'PESQUISA',
                  'RETOMADA', 'FICHA_VESPERA', 'BOAS_VINDAS', 'DIA_SAIDA', 'OFERTA'));

alter table public.atendimento_cotacoes
  add column if not exists oferta_em        timestamptz,
  add column if not exists oferta_beneficio text;

-- Conferência: tudo true
select
  pg_get_constraintdef((select oid from pg_constraint where conname = 'atendimento_automacoes_tipo_check')) like '%OFERTA%' as automacao_oferta,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'atendimento_cotacoes' and column_name = 'oferta_beneficio') as oferta_na_cotacao;
