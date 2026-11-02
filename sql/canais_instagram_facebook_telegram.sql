-- ============================================================================
-- CAIXA DE ENTRADA — Instagram, Facebook Messenger e Telegram (02/11/2026)
-- ============================================================================
-- Instagram e Facebook já cabiam na tabela de canais desde a Fase 1. Este SQL:
--   1) libera o tipo de canal TELEGRAM
--   2) faz o painel do prazo de resposta (SLA) contar também o Telegram
-- Não apaga nem muda nenhum dado. Pode rodar mais de uma vez.
-- ============================================================================

-- 1) Tipo de canal TELEGRAM
alter table public.atendimento_canais drop constraint if exists atendimento_canais_tipo_check;
alter table public.atendimento_canais add constraint atendimento_canais_tipo_check
  check (tipo in ('WHATSAPP', 'EMAIL', 'INSTAGRAM', 'FACEBOOK', 'SITE', 'TELEGRAM'));

-- 2) Painel do prazo (sql/prazo_e_assinatura.sql): a lista de canais de
--    conversa ganha o Telegram. Parte da função que está no banco, para não
--    desfazer nenhum ajuste feito nela depois.
do $$
declare
  v_funcao regprocedure := to_regprocedure('public.atendimento_painel_sla(bigint[], date, date)');
  v_def    text;
begin
  if v_funcao is null then return; end if;   -- SQL do prazo ainda não rodado
  v_def := pg_get_functiondef(v_funcao);
  if v_def ilike '%TELEGRAM%' then return; end if;
  v_def := replace(v_def, $t$'INSTAGRAM', 'FACEBOOK')$t$, $t$'INSTAGRAM', 'FACEBOOK', 'TELEGRAM')$t$);
  execute v_def;
end $$;

-- Conferência: as duas colunas devem mostrar true
-- (prazo_conta_telegram = null quer dizer que o SQL do prazo ainda não foi rodado)
select
  (select pg_get_constraintdef(oid) from pg_constraint where conname = 'atendimento_canais_tipo_check') ilike '%TELEGRAM%' as telegram_liberado,
  (select pg_get_functiondef(to_regprocedure('public.atendimento_painel_sla(bigint[], date, date)')) ilike '%TELEGRAM%') as prazo_conta_telegram;
