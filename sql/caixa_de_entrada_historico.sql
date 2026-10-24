-- ============================================================================
-- CAIXA DE ENTRADA — HISTÓRICO DO ASKSUITE e "SEM DISPONIBILIDADE"
-- (pode rodar várias vezes)
-- ============================================================================
-- Rode DEPOIS dos SQLs da Caixa de Entrada (Parte A, Fase 2 e Fase 3).
--
--  1. Histórico do Asksuite: cada linha da planilha "Conversas" exportada do
--     Asksuite vira um registro (canal, cotou, clicou, reservou, valor,
--     atendente, etiquetas…) ligado ao contato. Aparece no painel do contato
--     e numa seção própria do Painel.
--  2. Contato "Já reservou" (⭐): marcado pelo histórico e pelas reservas que
--     o sistema encontra na Cloudbeds.
--  3. Cotação sem disponibilidade: fica registrada (demanda perdida), com a
--     etiqueta "Indisponibilidade na cotação" e números no Painel.
--  4. Painel: reservas por atendente e datas mais procuradas sem quarto.
-- Tabelas novas com GRANT explícito (mudança do Supabase de 30/10/2026).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Histórico importado (Asksuite)
-- ---------------------------------------------------------------------------
create table if not exists public.atendimento_historico_externo (
  id              bigserial primary key,
  hotel_id        bigint not null references public.hoteis(id) on delete cascade,
  contato_id      bigint references public.atendimento_contatos(id) on delete set null,
  sistema         text not null default 'ASKSUITE',
  chave           text not null,            -- link da conversa no Asksuite (ou um resumo da linha)
  criado_origem   timestamptz,              -- "Data de criação"
  atualizado_origem timestamptz,            -- "Data de atualização"
  plataforma      text,                     -- WhatsApp, Instagram, Email, Mobile - Android…
  fonte           text,                     -- WhatsApp, INSTAGRAM, Email, BOOKING, Site…
  pediu_cotacao   boolean not null default false,
  clicou_reservar boolean not null default false,
  reservou        boolean not null default false,
  reserva_codigo  text,
  reserva_valor   numeric(12,2),
  reserva_em      timestamptz,
  reserva_agente  text,
  chegada         date,
  partida         date,
  adultos         integer,
  criancas        integer,
  agente          text,
  etiquetas       text[] not null default '{}',
  idioma          text,
  cidade          text,
  pais            text,
  link            text,
  importado_em    timestamptz not null default now(),
  unique (hotel_id, sistema, chave)
);
create index if not exists atendimento_historico_contato_idx on public.atendimento_historico_externo (contato_id, criado_origem desc);
create index if not exists atendimento_historico_hotel_idx on public.atendimento_historico_externo (hotel_id, criado_origem);

-- ---------------------------------------------------------------------------
-- 2) Contato que já reservou
-- ---------------------------------------------------------------------------
alter table public.atendimento_contatos
  add column if not exists ja_reservou boolean not null default false;

-- ---------------------------------------------------------------------------
-- 3) Cotação sem disponibilidade (nova situação da cotação)
-- ---------------------------------------------------------------------------
alter table public.atendimento_cotacoes drop constraint if exists atendimento_cotacoes_status_check;
alter table public.atendimento_cotacoes
  add constraint atendimento_cotacoes_status_check
  check (status in ('ENVIADA', 'CLICOU', 'RESERVOU', 'CANCELADA', 'SEM_DISPONIBILIDADE'));

-- Reserva encontrada → também marca o contato como "já reservou"
create or replace function public.atendimento_marcar_reserva(
  p_conversa bigint, p_reserva text, p_valor numeric, p_texto text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hotel   bigint;
  v_contato bigint;
  v_cot     bigint;
begin
  select hotel_id, contato_id into v_hotel, v_contato from public.atendimento_conversas where id = p_conversa;
  if v_hotel is null or coalesce(p_reserva, '') = '' then return false; end if;

  insert into public.atendimento_reservas_detectadas (hotel_id, reserva_id, conversa_id)
  values (v_hotel, p_reserva, p_conversa)
  on conflict do nothing;
  if not found then return false; end if;

  update public.atendimento_conversas
     set cloudbeds_reservation_id = coalesce(cloudbeds_reservation_id, p_reserva), atualizado_em = now()
   where id = p_conversa;
  perform public.atendimento_avancar_etapa(p_conversa, 'Reservou');
  if v_contato is not null then
    update public.atendimento_contatos set ja_reservou = true where id = v_contato;
  end if;

  select id into v_cot from public.atendimento_cotacoes
   where conversa_id = p_conversa and status in ('ENVIADA', 'CLICOU')
   order by criado_em desc limit 1;
  if v_cot is not null then
    update public.atendimento_cotacoes
       set status = 'RESERVOU', reserva_id = p_reserva, reserva_valor = p_valor, reservou_em = now()
     where id = v_cot;
  end if;

  if coalesce(p_texto, '') <> '' then
    insert into public.atendimento_mensagens (hotel_id, conversa_id, direcao, tipo, texto, data_original)
    values (v_hotel, p_conversa, 'NOTA', 'sistema', p_texto, now());
  end if;
  return true;
end;
$$;

-- Contatos que já tinham reserva ligada pelo sistema
update public.atendimento_contatos ct set ja_reservou = true
 where not ct.ja_reservou
   and exists (select 1 from public.atendimento_reservas_detectadas r
                 join public.atendimento_conversas c on c.id = r.conversa_id
                where c.contato_id = ct.id);

-- ---------------------------------------------------------------------------
-- 4) Painel: cotações (versão nova, com "sem disponibilidade" e atendentes)
-- ---------------------------------------------------------------------------
create or replace function public.atendimento_painel_cotacoes(p_hoteis bigint[], p_inicio date, p_fim date)
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

  with todas as (
    select * from public.atendimento_cotacoes
     where hotel_id = any(v_hoteis) and criado_em >= v_ini and criado_em < v_fim
  ),
  cot as (select * from todas where status in ('ENVIADA', 'CLICOU', 'RESERVOU')),
  sem as (select * from todas where status = 'SEM_DISPONIBILIDADE'),
  res as (
    select r.*, c.responsavel_id from public.atendimento_reservas_detectadas r
      left join public.atendimento_conversas c on c.id = r.conversa_id
     where r.hotel_id = any(v_hoteis) and r.criado_em >= v_ini and r.criado_em < v_fim
  ),
  meses as (
    select generate_series(date_trunc('month', p_inicio::timestamp), date_trunc('month', p_fim::timestamp), interval '1 month') as mes
  )
  select jsonb_build_object(
    'enviadas',            (select count(*) from cot),
    'clicadas',            (select count(*) from cot where cliques > 0),
    'reservadas',          (select count(*) from cot where status = 'RESERVOU'),
    'valor_cotado',        (select coalesce(sum(valor_minimo), 0) from cot),
    'valor_reservado',     (select coalesce(sum(reserva_valor), 0) from cot where status = 'RESERVOU'),
    'reservas_detectadas', (select count(*) from res),
    'sem_disponibilidade', (select count(*) from sem),
    'datas_sem_disponibilidade', (select coalesce(jsonb_agg(jsonb_build_object('checkin', checkin, 'checkout', checkout, 'pedidos', n) order by n desc, checkin), '[]'::jsonb)
                                    from (select checkin, checkout, count(*) n from sem group by 1, 2 order by 3 desc, 1 limit 8) d),
    'reservas_por_atendente', (select coalesce(jsonb_agg(jsonb_build_object('id', responsavel_id, 'reservas', n)), '[]'::jsonb)
                                 from (select responsavel_id, count(*) n from res where responsavel_id is not null group by 1) a),
    'meses', (select coalesce(jsonb_agg(jsonb_build_object(
                'mes', to_char(mes, 'YYYY-MM'),
                'enviadas',   (select count(*) from cot where date_trunc('month', criado_em at time zone 'America/Fortaleza') = mes),
                'clicadas',   (select count(*) from cot where cliques > 0 and date_trunc('month', criado_em at time zone 'America/Fortaleza') = mes),
                'reservadas', (select count(*) from cot where status = 'RESERVOU' and date_trunc('month', criado_em at time zone 'America/Fortaleza') = mes),
                'sem_disponibilidade', (select count(*) from sem where date_trunc('month', criado_em at time zone 'America/Fortaleza') = mes)
              ) order by mes), '[]'::jsonb) from meses)
  ) into v_saida;
  return v_saida;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) Painel: histórico do Asksuite
-- ---------------------------------------------------------------------------
create or replace function public.atendimento_painel_historico(p_hoteis bigint[], p_inicio date, p_fim date)
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

  with h as (
    select *, (criado_origem at time zone 'America/Fortaleza') as local_criado
      from public.atendimento_historico_externo
     where hotel_id = any(v_hoteis) and criado_origem >= v_ini and criado_origem < v_fim
  ),
  meses as (
    select generate_series(date_trunc('month', p_inicio::timestamp), date_trunc('month', p_fim::timestamp), interval '1 month') as mes
  )
  select case when (select count(*) from h) = 0 then null else jsonb_build_object(
    'conversas',      (select count(*) from h),
    'cotacoes',       (select count(*) from h where pediu_cotacao),
    'cliques',        (select count(*) from h where clicou_reservar),
    'reservas',       (select count(*) from h where reservou),
    'valor_reservado',(select coalesce(sum(reserva_valor), 0) from h where reservou),
    'sem_disponibilidade', (select count(*) from h where 'Indisponibilidade na cotação' = any(etiquetas)),
    'pelo_robo',      (select count(*) from h where lower(coalesce(agente, '')) in ('robô', 'robo', 'robot')),
    'reservas_robo',  (select count(*) from h where reservou and upper(coalesce(reserva_agente, '')) in ('ROBOT', 'ROBÔ', 'ROBO')),
    'por_fonte', (select coalesce(jsonb_agg(jsonb_build_object('fonte', fonte, 'conversas', n, 'cotacoes', c, 'reservas', r) order by n desc), '[]'::jsonb)
                    from (select coalesce(nullif(fonte, ''), 'Outros') fonte, count(*) n, count(*) filter (where pediu_cotacao) c, count(*) filter (where reservou) r
                            from h group by 1) f),
    'meses', (select coalesce(jsonb_agg(jsonb_build_object(
                'mes', to_char(mes, 'YYYY-MM'),
                'conversas', (select count(*) from h where date_trunc('month', local_criado) = mes),
                'cotacoes',  (select count(*) from h where pediu_cotacao and date_trunc('month', local_criado) = mes),
                'cliques',   (select count(*) from h where clicou_reservar and date_trunc('month', local_criado) = mes),
                'reservas',  (select count(*) from h where reservou and date_trunc('month', local_criado) = mes)
              ) order by mes), '[]'::jsonb) from meses)
  ) end into v_saida;
  return v_saida;
end;
$$;

revoke all on function public.atendimento_marcar_reserva(bigint, text, numeric, text) from public, anon, authenticated;
revoke all on function public.atendimento_painel_cotacoes(bigint[], date, date) from public, anon;
revoke all on function public.atendimento_painel_historico(bigint[], date, date) from public, anon;
grant execute on function public.atendimento_marcar_reserva(bigint, text, numeric, text) to service_role;
grant execute on function public.atendimento_painel_cotacoes(bigint[], date, date) to authenticated, service_role;
grant execute on function public.atendimento_painel_historico(bigint[], date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6) Segurança da tabela nova: a equipe lê; quem grava é o servidor
-- ---------------------------------------------------------------------------
alter table public.atendimento_historico_externo enable row level security;
drop policy if exists atendimento_historico_ver on public.atendimento_historico_externo;
create policy atendimento_historico_ver on public.atendimento_historico_externo
  for select to authenticated using (hotel_id in (select public.atendimento_hoteis()));

revoke all on public.atendimento_historico_externo from anon;
grant select on public.atendimento_historico_externo to authenticated;
grant all on public.atendimento_historico_externo to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Pronto! Confira: deve aparecer 1 linha.
select table_name from information_schema.tables
 where table_schema = 'public' and table_name = 'atendimento_historico_externo';
