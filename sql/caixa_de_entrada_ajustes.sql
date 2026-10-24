-- ============================================================================
-- CAIXA DE ENTRADA — ROBÔ MAIS ESPERTO E AJUSTES          (pode rodar várias vezes)
-- ============================================================================
-- Rode DEPOIS do SQL da economia (sql/caixa_de_entrada_economia.sql).
--
--  1. Tipos novos de solicitação: cancelamento de reserva e 2ª via de boleto.
--  2. Perguntas que o robô não soube responder (para completar o conteúdo).
--  3. Arquivar sozinho os atendimentos parados há X dias (o ADMIN escolhe).
--  4. Painel de vendas: valor das reservas por atendente, robô, canal,
--     dentro × fora do horário comercial, e antecedência das cotações.
-- Tabela nova com GRANT explícito (mudança do Supabase de 30/10/2026).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Tipos de solicitação
-- ---------------------------------------------------------------------------
alter table public.atendimento_solicitacoes drop constraint if exists atendimento_solicitacoes_tipo_check;
alter table public.atendimento_solicitacoes add constraint atendimento_solicitacoes_tipo_check
  check (tipo in ('PEDIDO_ESPECIAL', 'GRUPO', 'PROBLEMA_RESERVA', 'CONFIRMACAO_RESERVA', 'CANCELAMENTO', 'SEGUNDA_VIA', 'OUTRO'));

-- ---------------------------------------------------------------------------
-- 2) Perguntas que o robô não soube
-- ---------------------------------------------------------------------------
create table if not exists public.atendimento_robo_lacunas (
  id               bigserial primary key,
  hotel_id         bigint not null references public.hoteis(id) on delete cascade,
  conversa_id      bigint references public.atendimento_conversas(id) on delete set null,
  pergunta         text not null,
  situacao         text not null default 'NOVA',
  resolvida_em     timestamptz,
  resolvida_por_id bigint,
  criado_em        timestamptz not null default now()
);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'atendimento_robo_lacunas_situacao_check') then
    alter table public.atendimento_robo_lacunas add constraint atendimento_robo_lacunas_situacao_check
      check (situacao in ('NOVA', 'RESOLVIDA', 'IGNORADA'));
  end if;
end $$;
create index if not exists atendimento_robo_lacunas_hotel_idx on public.atendimento_robo_lacunas (hotel_id, situacao, criado_em desc);

alter table public.atendimento_robo_lacunas enable row level security;
-- Só o ADMIN do hotel vê e marca como resolvida/ignorada; quem grava é o servidor
drop policy if exists atendimento_robo_lacunas_ver on public.atendimento_robo_lacunas;
create policy atendimento_robo_lacunas_ver on public.atendimento_robo_lacunas
  for select to authenticated using (public.atendimento_sou_admin(hotel_id));
drop policy if exists atendimento_robo_lacunas_alterar on public.atendimento_robo_lacunas;
create policy atendimento_robo_lacunas_alterar on public.atendimento_robo_lacunas
  for update to authenticated
  using (public.atendimento_sou_admin(hotel_id)) with check (public.atendimento_sou_admin(hotel_id));

revoke all on public.atendimento_robo_lacunas from anon, authenticated;
grant select, update on public.atendimento_robo_lacunas to authenticated;
grant all on public.atendimento_robo_lacunas to service_role;
grant usage, select on sequence public.atendimento_robo_lacunas_id_seq to service_role;

-- ---------------------------------------------------------------------------
-- 3) Arquivar sozinho
-- ---------------------------------------------------------------------------
alter table public.atendimento_preferencias
  add column if not exists arquivar_apos_dias integer;  -- vazio = nunca
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'atendimento_preferencias_arquivar_chk') then
    alter table public.atendimento_preferencias
      add constraint atendimento_preferencias_arquivar_chk check (arquivar_apos_dias is null or arquivar_apos_dias between 1 and 90);
  end if;
end $$;

-- Arquiva os atendimentos sem nenhuma mensagem há mais de X dias (só o
-- servidor chama, na função agendada). Se o cliente escrever de novo, a
-- conversa volta a ficar aberta, como já acontece hoje.
create or replace function public.atendimento_arquivar_antigos()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qtd integer;
begin
  with alvo as (
    select c.id from public.atendimento_conversas c
      join public.atendimento_preferencias p on p.hotel_id = c.hotel_id
     where p.arquivar_apos_dias is not null
       and c.status <> 'ARQUIVADA'
       and coalesce(c.ultima_mensagem_em, c.criado_em) < now() - make_interval(days => p.arquivar_apos_dias)
     limit 500
  )
  update public.atendimento_conversas c set status = 'ARQUIVADA', atualizado_em = now()
    from alvo where c.id = alvo.id;
  get diagnostics v_qtd = row_count;
  return v_qtd;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) Painel de vendas
-- ---------------------------------------------------------------------------
create or replace function public.atendimento_painel_vendas(p_hoteis bigint[], p_inicio date, p_fim date)
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

  with cot as (
    select c.*,
           coalesce(c.enviado_pelo_robo, false) as robo,
           public.atendimento_fora_do_horario(c.hotel_id, c.criado_em) as fora,
           (c.checkin - (c.criado_em at time zone 'America/Fortaleza')::date) as antecedencia,
           case when c.status = 'RESERVOU' then coalesce(c.reserva_valor, 0) else 0 end as valor
      from public.atendimento_cotacoes c
     where c.hotel_id = any(v_hoteis) and c.criado_em >= v_ini and c.criado_em < v_fim
       and c.status in ('ENVIADA', 'CLICOU', 'RESERVOU')
  ),
  resumo as (
    select count(*) as cotacoes, count(*) filter (where status = 'RESERVOU') as reservas, coalesce(sum(valor), 0) as valor from cot
  )
  select jsonb_build_object(
    'total', (select to_jsonb(r) from resumo r),
    'por_atendente', (select coalesce(jsonb_agg(jsonb_build_object('id', enviado_por_id, 'cotacoes', n, 'reservas', rs, 'valor', v) order by v desc, n desc), '[]'::jsonb)
                        from (select enviado_por_id, count(*) n, count(*) filter (where status = 'RESERVOU') rs, coalesce(sum(valor), 0) v
                                from cot where not robo and enviado_por_id is not null group by 1) a),
    'robo', (select jsonb_build_object('cotacoes', count(*), 'reservas', count(*) filter (where status = 'RESERVOU'), 'valor', coalesce(sum(valor), 0)) from cot where robo),
    'por_canal', (select coalesce(jsonb_agg(jsonb_build_object('canal', canal, 'cotacoes', n, 'reservas', rs, 'valor', v) order by v desc, n desc), '[]'::jsonb)
                    from (select coalesce(canal_tipo, 'OUTRO') canal, count(*) n, count(*) filter (where status = 'RESERVOU') rs, coalesce(sum(valor), 0) v
                            from cot group by 1) a),
    'horario', jsonb_build_object(
      'dentro', (select jsonb_build_object('cotacoes', count(*), 'reservas', count(*) filter (where status = 'RESERVOU'), 'valor', coalesce(sum(valor), 0),
                                           'robo', count(*) filter (where robo)) from cot where not fora),
      'fora',   (select jsonb_build_object('cotacoes', count(*), 'reservas', count(*) filter (where status = 'RESERVOU'), 'valor', coalesce(sum(valor), 0),
                                           'robo', count(*) filter (where robo)) from cot where fora)),
    'antecedencia', jsonb_build_object(
      'media_dias', (select round(avg(greatest(antecedencia, 0))::numeric, 1) from cot),
      'faixas', (select coalesce(jsonb_agg(jsonb_build_object('faixa', faixa, 'cotacoes', n, 'reservas', rs) order by ordem), '[]'::jsonb)
                   from (select case when antecedencia <= 7 then 1 when antecedencia <= 30 then 2 when antecedencia <= 90 then 3 else 4 end as ordem,
                                case when antecedencia <= 7 then 'Até 7 dias' when antecedencia <= 30 then '8 a 30 dias'
                                     when antecedencia <= 90 then '31 a 90 dias' else 'Mais de 90 dias' end as faixa,
                                count(*) n, count(*) filter (where status = 'RESERVOU') rs
                           from cot group by 1, 2) f))
  ) into v_saida;
  return v_saida;
end;
$$;

revoke all on function public.atendimento_arquivar_antigos() from public, anon, authenticated;
revoke all on function public.atendimento_painel_vendas(bigint[], date, date) from public, anon;
grant execute on function public.atendimento_arquivar_antigos() to service_role;
grant execute on function public.atendimento_painel_vendas(bigint[], date, date) to authenticated, service_role;
