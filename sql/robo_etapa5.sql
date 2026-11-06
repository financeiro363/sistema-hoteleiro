-- ============================================================================
-- ROBÔ MAIS COMPLETO — Etapa 5 (idioma do cliente, upgrade na véspera)
-- ============================================================================
-- Não apaga nem muda nenhum dado. Pode rodar mais de uma vez.
-- Precisa do SQL da Etapa 4 (sql/clientes_etapa4.sql).
--   1) Idioma da conversa (pt, en, es): o robô grava o idioma do cliente e as
--      automações escolhem o modelo traduzido
--   2) Automação nova: UPGRADE (upgrade de quarto e late check-out na véspera)
-- O áudio (chave da Groq) e o copiloto não precisam de SQL.
-- ============================================================================

alter table public.atendimento_conversas add column if not exists idioma text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'atendimento_conversas_idioma_check') then
    alter table public.atendimento_conversas add constraint atendimento_conversas_idioma_check check (idioma is null or idioma in ('pt', 'en', 'es'));
  end if;
end $$;

alter table public.atendimento_automacoes drop constraint if exists atendimento_automacoes_tipo_check;
alter table public.atendimento_automacoes add constraint atendimento_automacoes_tipo_check
  check (tipo in ('FUP_RESERVAR', 'FUP_COTACAO', 'SEM_DISPONIBILIDADE', 'GRUPO', 'CONFIRMACAO_RESERVA', 'PRE_CHECKIN', 'POS_CHECKOUT', 'PESQUISA',
                  'RETOMADA', 'FICHA_VESPERA', 'BOAS_VINDAS', 'DIA_SAIDA', 'OFERTA', 'ANIVERSARIO', 'REATIVACAO', 'UPGRADE'));

-- Conferência: tudo true
select
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'atendimento_conversas' and column_name = 'idioma') as idioma,
  pg_get_constraintdef((select oid from pg_constraint where conname = 'atendimento_automacoes_tipo_check')) like '%UPGRADE%' as upgrade;
