-- ============================================================================
-- VENDAS E RECEPÇÃO — Etapa 1 (ficha automática, boas-vindas, saída,
-- retomada de conversa parada, motivo da perda)
-- ============================================================================
-- Não apaga nem muda nenhum dado. Pode rodar mais de uma vez.
-- Precisa do SQL da Fase 5 (automações) já rodado.
--   1) Automações novas: RETOMADA, FICHA_VESPERA, BOAS_VINDAS, DIA_SAIDA
--   2) Motivo da perda ao arquivar a conversa (Preço, Sem vaga, OTA…)
--   3) Código da reserva na ficha de hóspede (para saber quem já preencheu)
-- ============================================================================

-- 1) Tipos de automação ------------------------------------------------------
alter table public.atendimento_automacoes drop constraint if exists atendimento_automacoes_tipo_check;
alter table public.atendimento_automacoes add constraint atendimento_automacoes_tipo_check
  check (tipo in ('FUP_RESERVAR', 'FUP_COTACAO', 'SEM_DISPONIBILIDADE', 'GRUPO', 'CONFIRMACAO_RESERVA', 'PRE_CHECKIN', 'POS_CHECKOUT', 'PESQUISA',
                  'RETOMADA', 'FICHA_VESPERA', 'BOAS_VINDAS', 'DIA_SAIDA'));

-- 2) Motivo da perda ---------------------------------------------------------
alter table public.atendimento_conversas
  add column if not exists motivo_perda        text,
  add column if not exists motivo_perda_obs    text,
  add column if not exists motivo_perda_em     timestamptz,
  add column if not exists motivo_perda_por_id bigint;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'atendimento_conversas_motivo_perda_check') then
    alter table public.atendimento_conversas add constraint atendimento_conversas_motivo_perda_check
      check (motivo_perda is null or motivo_perda in ('PRECO', 'SEM_VAGA', 'OTA', 'DESISTIU', 'SEM_RESPOSTA', 'OUTRO'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'atendimento_conversas_motivo_obs_tamanho') then
    alter table public.atendimento_conversas add constraint atendimento_conversas_motivo_obs_tamanho
      check (motivo_perda_obs is null or length(motivo_perda_obs) <= 200);
  end if;
end $$;
create index if not exists atendimento_conversas_motivo_perda_idx
  on public.atendimento_conversas (hotel_id, motivo_perda_em desc) where motivo_perda is not null;

-- 3) Ficha de hóspede: código da reserva (vem do link /f/<código>) -----------
alter table public.fichas_fnrh add column if not exists codigo_reserva text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fichas_fnrh_codigo_reserva_formato') then
    alter table public.fichas_fnrh add constraint fichas_fnrh_codigo_reserva_formato
      check (codigo_reserva is null or codigo_reserva ~ '^[0-9]{1,9}-[A-Za-z0-9_-]{10}$');
  end if;
end $$;
create index if not exists fichas_fnrh_codigo_reserva_idx on public.fichas_fnrh (hotel_id, codigo_reserva) where codigo_reserva is not null;
-- O hóspede (sem login) grava a ficha com o código
grant insert (codigo_reserva) on public.fichas_fnrh to anon;

-- Conferência: tudo true
select
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'atendimento_conversas' and column_name = 'motivo_perda') as motivo_da_perda,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'fichas_fnrh' and column_name = 'codigo_reserva') as codigo_na_ficha,
  pg_get_constraintdef((select oid from pg_constraint where conname = 'atendimento_automacoes_tipo_check')) like '%BOAS_VINDAS%' as automacoes_novas;
