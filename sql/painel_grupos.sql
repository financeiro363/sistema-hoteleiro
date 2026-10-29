-- ============================================================================
-- PAINEL DE GRUPOS (item 2 da varredura do Asksuite de 27/10)
-- ============================================================================
-- Cada pedido de grupo (solicitação do tipo GRUPO) ganha:
--   - pessoas, quartos e noites. O robô pergunta quantos quartos; se o
--     cliente não souber, o sistema conta 2 pessoas por quarto e marca
--     "estimado".
--   - valor estimado = tarifa do quarto mais barato na Cloudbeds nas datas
--     × quartos × noites. O servidor calcula; a equipe pode corrigir.
--   - resultado: FECHOU (com o valor fechado) ou NAO_FECHOU (com o motivo)
-- O Painel ganha a seção "Grupos": potencial, fechado, taxa de fechamento,
-- ticket médio, média de quartos e de diárias, motivos de não fechar.
-- Decidido pelo Eduardo em 28/10. Pode rodar mais de uma vez.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Colunas novas nas solicitações (só usadas no tipo GRUPO)
-- ---------------------------------------------------------------------------
alter table public.atendimento_solicitacoes
  add column if not exists grupo_pessoas          integer,
  add column if not exists grupo_quartos          integer,
  add column if not exists grupo_quartos_estimado boolean not null default false,
  add column if not exists grupo_noites           integer,
  add column if not exists grupo_tarifa_noite     numeric(12,2),   -- quarto mais barato, por noite
  add column if not exists grupo_quartos_livres   integer,         -- quartos livres nas datas quando calculou
  add column if not exists valor_estimado         numeric(12,2),
  add column if not exists valor_estimado_origem  text,            -- CLOUDBEDS ou EQUIPE
  add column if not exists valor_estimado_em      timestamptz,     -- quando o servidor tentou calcular
  add column if not exists valor_estimado_obs     text,            -- por que não calculou / aviso
  add column if not exists valor_estimado_erro    boolean not null default false, -- erro da Cloudbeds: tenta de novo depois
  add column if not exists resultado              text,            -- FECHOU ou NAO_FECHOU (vazio = em aberto)
  add column if not exists valor_fechado          numeric(12,2),
  add column if not exists motivo_perda           text,
  add column if not exists resultado_obs          text,
  add column if not exists resultado_em           timestamptz,
  add column if not exists resultado_por_id       bigint;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'atendimento_solicitacoes_grupo_numeros_check') then
    alter table public.atendimento_solicitacoes add constraint atendimento_solicitacoes_grupo_numeros_check check (
      (grupo_pessoas is null or grupo_pessoas between 1 and 5000)
      and (grupo_quartos is null or grupo_quartos between 1 and 1000)
      and (grupo_noites is null or grupo_noites between 1 and 365)
      and (grupo_tarifa_noite is null or grupo_tarifa_noite >= 0)
      and (valor_estimado is null or valor_estimado >= 0)
      and (valor_fechado is null or valor_fechado >= 0));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'atendimento_solicitacoes_valor_origem_check') then
    alter table public.atendimento_solicitacoes add constraint atendimento_solicitacoes_valor_origem_check
      check (valor_estimado_origem is null or valor_estimado_origem in ('CLOUDBEDS', 'EQUIPE'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'atendimento_solicitacoes_resultado_check') then
    -- coalesce: sem ele, uma comparação com vazio daria "desconhecido" e passaria
    alter table public.atendimento_solicitacoes add constraint atendimento_solicitacoes_resultado_check check (coalesce(
      (resultado is null and valor_fechado is null and motivo_perda is null)
      or (resultado = 'FECHOU' and valor_fechado is not null and motivo_perda is null)
      or (resultado = 'NAO_FECHOU' and valor_fechado is null
          and motivo_perda in ('PRECO', 'SEM_QUARTO', 'SEM_RESPOSTA', 'OUTRO_HOTEL', 'DESISTIU', 'OUTRO')), false));
  end if;
end $$;

-- O servidor procura os pedidos de grupo ainda sem cálculo
create index if not exists atendimento_solicitacoes_grupo_pendente_idx
  on public.atendimento_solicitacoes (criado_em desc) where tipo = 'GRUPO' and valor_estimado_em is null;
create index if not exists atendimento_solicitacoes_tipo_idx
  on public.atendimento_solicitacoes (hotel_id, tipo, criado_em desc);

-- ---------------------------------------------------------------------------
-- 2) Painel: números dos pedidos de grupo do período (pela data do pedido)
-- ---------------------------------------------------------------------------
create or replace function public.atendimento_painel_grupos(p_hoteis bigint[], p_inicio date, p_fim date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_hoteis bigint[];
  v_ini    timestamptz := (p_inicio::timestamp) at time zone 'America/Fortaleza';
  v_fim    timestamptz := ((p_fim + 1)::timestamp) at time zone 'America/Fortaleza';
  v_saida  jsonb;
begin
  if auth.uid() is null then
    v_hoteis := p_hoteis;
  else
    select coalesce(array_agg(h), '{}') into v_hoteis from (select public.atendimento_hoteis() as h) x where h = any(p_hoteis);
  end if;

  with g as (
    select s.* from public.atendimento_solicitacoes s
     where s.tipo = 'GRUPO' and s.hotel_id = any(v_hoteis) and s.criado_em >= v_ini and s.criado_em < v_fim
  )
  select jsonb_build_object(
    'pedidos',           count(*),
    'pelo_robo',         count(*) filter (where criado_pelo_robo),
    'com_valor',         count(*) filter (where valor_estimado is not null),
    'potencial',         coalesce(sum(valor_estimado), 0),
    'ticket_medio',      round(avg(valor_estimado), 2),
    'media_quartos',     round(avg(grupo_quartos), 1),
    'media_noites',      round(avg(grupo_noites), 1),
    'media_pessoas',     round(avg(grupo_pessoas), 1),
    'quartos_estimados', count(*) filter (where grupo_quartos_estimado),
    'fecharam',          count(*) filter (where resultado = 'FECHOU'),
    'valor_fechado',     coalesce(sum(valor_fechado) filter (where resultado = 'FECHOU'), 0),
    'ticket_fechado',    round(avg(valor_fechado) filter (where resultado = 'FECHOU'), 2),
    'nao_fecharam',      count(*) filter (where resultado = 'NAO_FECHOU'),
    'potencial_perdido', coalesce(sum(valor_estimado) filter (where resultado = 'NAO_FECHOU'), 0),
    'em_aberto',         count(*) filter (where resultado is null),
    'potencial_aberto',  coalesce(sum(valor_estimado) filter (where resultado is null), 0),
    'motivos',           (select coalesce(jsonb_object_agg(motivo_perda, n), '{}'::jsonb)
                            from (select motivo_perda, count(*) n from g where resultado = 'NAO_FECHOU' group by motivo_perda) m)
  ) into v_saida
  from g;
  return v_saida;
end;
$$;

revoke all on function public.atendimento_painel_grupos(bigint[], date, date) from public, anon;
grant execute on function public.atendimento_painel_grupos(bigint[], date, date) to authenticated, service_role;

-- Conferência: deve mostrar 17 colunas novas
select count(*) as colunas_novas from information_schema.columns
 where table_schema = 'public' and table_name = 'atendimento_solicitacoes'
   and column_name in ('grupo_pessoas', 'grupo_quartos', 'grupo_quartos_estimado', 'grupo_noites', 'grupo_tarifa_noite', 'grupo_quartos_livres',
                       'valor_estimado', 'valor_estimado_origem', 'valor_estimado_em', 'valor_estimado_obs', 'valor_estimado_erro',
                       'resultado', 'valor_fechado', 'motivo_perda', 'resultado_obs', 'resultado_em', 'resultado_por_id');
