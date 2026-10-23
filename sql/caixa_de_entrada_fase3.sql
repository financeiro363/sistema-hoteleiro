-- ============================================================================
-- CAIXA DE ENTRADA — FASE 3 (Cotação e reserva)          (pode rodar várias vezes)
-- ============================================================================
-- Rode DEPOIS do sql/caixa_de_entrada.sql e do sql/caixa_de_entrada_fase2.sql.
--
--  1. Cotações: preço e disponibilidade da Cloudbeds enviados ao cliente, com
--     um link "Reservar agora" por quarto (o sistema conta os cliques).
--  2. Ao enviar a cotação o cartão vai para "Cotação"; ao clicar no link, para
--     "Reservar agora"; quando a reserva entra na Cloudbeds, para "Reservou".
--  3. Modelos de e-mail formatados por hotel (Atrações, Cancelamento,
--     Confirmação, Cotação, Formas de pagamento…), editados pelo ADMIN.
--  4. Link do motor de reservas e a verificação automática de reservas novas.
-- Tabelas novas com GRANT explícito (mudança do Supabase de 30/10/2026).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Preferências: motor de reservas e verificação de reservas
-- ---------------------------------------------------------------------------
alter table public.atendimento_preferencias
  add column if not exists motor_url                text,
  add column if not exists cotacao_texto_abertura   text,
  add column if not exists cotacao_texto_final      text,
  add column if not exists verificar_reservas       boolean not null default true,
  add column if not exists reservas_verificadas_ate timestamptz;

-- ---------------------------------------------------------------------------
-- 2) Cotações enviadas
-- ---------------------------------------------------------------------------
create table if not exists public.atendimento_cotacoes (
  id                 bigserial primary key,
  hotel_id           bigint not null references public.hoteis(id) on delete cascade,
  conversa_id        bigint references public.atendimento_conversas(id) on delete set null,
  contato_id         bigint references public.atendimento_contatos(id) on delete set null,
  codigo             text not null unique,     -- vai no link /r/<codigo>
  checkin            date not null,
  checkout           date not null,
  adultos            integer not null default 2,
  criancas           integer not null default 0,
  quartos            integer not null default 1,
  -- [{ tipoId, nome, abreviacao, total, porNoite, disponiveis, foto }]
  itens              jsonb not null default '[]'::jsonb,
  valor_minimo       numeric(12,2),
  valor_maximo       numeric(12,2),
  mensagem           text,
  canal_tipo         text,
  status             text not null default 'ENVIADA',
  cliques            integer not null default 0,
  primeiro_clique_em timestamptz,
  ultimo_clique_em   timestamptz,
  item_clicado       integer,
  reserva_id         text,
  reserva_valor      numeric(12,2),
  reservou_em        timestamptz,
  enviado_por_id     bigint,
  criado_em          timestamptz not null default now()
);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'atendimento_cotacoes_status_check') then
    alter table public.atendimento_cotacoes
      add constraint atendimento_cotacoes_status_check check (status in ('ENVIADA', 'CLICOU', 'RESERVOU', 'CANCELADA'));
  end if;
end $$;
create index if not exists atendimento_cotacoes_hotel_idx on public.atendimento_cotacoes (hotel_id, criado_em desc);
create index if not exists atendimento_cotacoes_conversa_idx on public.atendimento_cotacoes (conversa_id, criado_em desc);
create index if not exists atendimento_cotacoes_contato_idx on public.atendimento_cotacoes (contato_id);

-- Reservas da Cloudbeds já ligadas a uma conversa (para não repetir o aviso)
create table if not exists public.atendimento_reservas_detectadas (
  hotel_id    bigint not null references public.hoteis(id) on delete cascade,
  reserva_id  text not null,
  conversa_id bigint references public.atendimento_conversas(id) on delete set null,
  criado_em   timestamptz not null default now(),
  primary key (hotel_id, reserva_id)
);

-- ---------------------------------------------------------------------------
-- 3) Modelos de e-mail
-- ---------------------------------------------------------------------------
create table if not exists public.atendimento_modelos_email (
  id                bigserial primary key,
  hotel_id          bigint not null references public.hoteis(id) on delete cascade,
  categoria         text not null default 'OUTRO',
  nome              text not null,
  assunto           text,
  corpo_html        text not null default '',
  idioma            text not null default 'pt',
  ativo             boolean not null default true,
  criado_por_id     bigint,
  atualizado_por_id bigint,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'atendimento_modelos_email_categoria_check') then
    alter table public.atendimento_modelos_email
      add constraint atendimento_modelos_email_categoria_check
      check (categoria in ('ATRACOES', 'CANCELAMENTO', 'CONFIRMACAO', 'COTACAO', 'PAGAMENTO', 'OUTRO'));
  end if;
end $$;
create unique index if not exists atendimento_modelos_email_nome_idx on public.atendimento_modelos_email (hotel_id, lower(nome));

-- ---------------------------------------------------------------------------
-- 4) Mover a conversa no funil (só para frente) e pôr a etiqueta da etapa
-- ---------------------------------------------------------------------------
create or replace function public.atendimento_avancar_etapa(p_conversa bigint, p_nome text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hotel      bigint;
  v_atual      bigint;
  v_ordem_at   integer;
  v_destino    bigint;
  v_ordem_dest integer;
begin
  select hotel_id, etapa_id into v_hotel, v_atual from public.atendimento_conversas where id = p_conversa;
  if v_hotel is null then return; end if;

  select id, ordem into v_destino, v_ordem_dest from public.atendimento_etapas
   where hotel_id = v_hotel and ativa and lower(nome) = lower(p_nome) order by ordem limit 1;
  select ordem into v_ordem_at from public.atendimento_etapas where id = v_atual;

  if v_destino is not null and v_destino is distinct from v_atual
     and (v_ordem_at is null or v_ordem_at < v_ordem_dest) then
    update public.atendimento_conversas set etapa_id = v_destino, atualizado_em = now() where id = p_conversa;
  end if;
  -- A etiqueta de mesmo nome entra mesmo quando o cartão já está mais à frente
  perform public.atendimento_adicionar_etiqueta(p_conversa, p_nome);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) Clique no "Reservar agora" (chamada pela rota /r/<codigo>)
-- ---------------------------------------------------------------------------
create or replace function public.atendimento_registrar_clique(p_codigo text, p_item integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c        public.atendimento_cotacoes;
  v_item   jsonb;
  v_motor  text;
  v_nome   text;
begin
  select * into c from public.atendimento_cotacoes where codigo = p_codigo;
  if c.id is null then return null; end if;

  v_item := c.itens -> greatest(coalesce(p_item, 0), 0);
  if v_item is null then v_item := c.itens -> 0; end if;
  select motor_url into v_motor from public.atendimento_preferencias where hotel_id = c.hotel_id;

  update public.atendimento_cotacoes set
    cliques            = cliques + 1,
    primeiro_clique_em = coalesce(primeiro_clique_em, now()),
    ultimo_clique_em   = now(),
    item_clicado       = coalesce(p_item, item_clicado),
    status             = case when status = 'ENVIADA' then 'CLICOU' else status end
  where id = c.id;

  if c.conversa_id is not null then
    perform public.atendimento_avancar_etapa(c.conversa_id, 'Reservar agora');
    if c.cliques = 0 then
      v_nome := coalesce(v_item ->> 'nome', 'quarto');
      insert into public.atendimento_mensagens (hotel_id, conversa_id, direcao, tipo, texto, data_original)
      values (c.hotel_id, c.conversa_id, 'NOTA', 'sistema',
              '🖱️ O cliente clicou em "Reservar agora" (' || v_nome || ', '
              || to_char(c.checkin, 'DD/MM') || ' a ' || to_char(c.checkout, 'DD/MM') || ').', now());
    end if;
  end if;

  return jsonb_build_object(
    'motor_url', v_motor, 'checkin', c.checkin, 'checkout', c.checkout,
    'adultos', c.adultos, 'criancas', c.criancas, 'abreviacao', v_item ->> 'abreviacao', 'hotel_id', c.hotel_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6) Reserva nova encontrada na Cloudbeds → "Reservou"
-- ---------------------------------------------------------------------------
-- Devolve true quando marcou agora (false se essa reserva já tinha sido ligada).
create or replace function public.atendimento_marcar_reserva(
  p_conversa bigint, p_reserva text, p_valor numeric, p_texto text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hotel bigint;
  v_cot   bigint;
begin
  select hotel_id into v_hotel from public.atendimento_conversas where id = p_conversa;
  if v_hotel is null or coalesce(p_reserva, '') = '' then return false; end if;

  insert into public.atendimento_reservas_detectadas (hotel_id, reserva_id, conversa_id)
  values (v_hotel, p_reserva, p_conversa)
  on conflict do nothing;
  if not found then return false; end if;

  update public.atendimento_conversas
     set cloudbeds_reservation_id = coalesce(cloudbeds_reservation_id, p_reserva), atualizado_em = now()
   where id = p_conversa;
  perform public.atendimento_avancar_etapa(p_conversa, 'Reservou');

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

-- ---------------------------------------------------------------------------
-- 7) Painel: números das cotações no período
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

  with cot as (
    select * from public.atendimento_cotacoes
     where hotel_id = any(v_hoteis) and criado_em >= v_ini and criado_em < v_fim
  ),
  meses as (
    select generate_series(date_trunc('month', p_inicio::timestamp), date_trunc('month', p_fim::timestamp), interval '1 month') as mes
  )
  select jsonb_build_object(
    'enviadas',        (select count(*) from cot),
    'clicadas',        (select count(*) from cot where cliques > 0),
    'reservadas',      (select count(*) from cot where status = 'RESERVOU'),
    'valor_cotado',    (select coalesce(sum(valor_minimo), 0) from cot),
    'valor_reservado', (select coalesce(sum(reserva_valor), 0) from cot where status = 'RESERVOU'),
    'reservas_detectadas', (select count(*) from public.atendimento_reservas_detectadas r
                             where r.hotel_id = any(v_hoteis) and r.criado_em >= v_ini and r.criado_em < v_fim),
    'meses', (select coalesce(jsonb_agg(jsonb_build_object(
                'mes', to_char(mes, 'YYYY-MM'),
                'enviadas',   (select count(*) from cot where date_trunc('month', criado_em at time zone 'America/Fortaleza') = mes),
                'clicadas',   (select count(*) from cot where cliques > 0 and date_trunc('month', criado_em at time zone 'America/Fortaleza') = mes),
                'reservadas', (select count(*) from cot where status = 'RESERVOU' and date_trunc('month', criado_em at time zone 'America/Fortaleza') = mes)
              ) order by mes), '[]'::jsonb) from meses)
  ) into v_saida;
  return v_saida;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8) Permissões das funções
-- ---------------------------------------------------------------------------
revoke all on function public.atendimento_avancar_etapa(bigint, text) from public, anon, authenticated;
revoke all on function public.atendimento_registrar_clique(text, integer) from public, anon, authenticated;
revoke all on function public.atendimento_marcar_reserva(bigint, text, numeric, text) from public, anon, authenticated;
revoke all on function public.atendimento_painel_cotacoes(bigint[], date, date) from public, anon;
grant execute on function public.atendimento_avancar_etapa(bigint, text) to service_role;
grant execute on function public.atendimento_registrar_clique(text, integer) to service_role;
grant execute on function public.atendimento_marcar_reserva(bigint, text, numeric, text) to service_role;
grant execute on function public.atendimento_painel_cotacoes(bigint[], date, date) to authenticated, service_role;

-- Correção da Fase 2 (caso ainda não tenha sido rodada): funções auxiliares
-- não ficam liberadas para o visitante.
revoke all on function public.atendimento_fora_do_horario(bigint, timestamptz) from public, anon;
revoke all on function public.atendimento_variantes_telefone(text) from public, anon;
grant execute on function public.atendimento_fora_do_horario(bigint, timestamptz) to authenticated, service_role;
grant execute on function public.atendimento_variantes_telefone(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9) Segurança das tabelas novas
-- ---------------------------------------------------------------------------
alter table public.atendimento_cotacoes            enable row level security;
alter table public.atendimento_reservas_detectadas enable row level security;
alter table public.atendimento_modelos_email       enable row level security;

-- Cotações: a equipe vê; quem grava é só o servidor
drop policy if exists atendimento_cotacoes_ver on public.atendimento_cotacoes;
create policy atendimento_cotacoes_ver on public.atendimento_cotacoes
  for select to authenticated using (hotel_id in (select public.atendimento_hoteis()));

-- Reservas detectadas: nenhuma política → só o servidor

-- Modelos de e-mail: a equipe usa; o ADMIN do hotel cria e edita
drop policy if exists atendimento_modelos_ver on public.atendimento_modelos_email;
create policy atendimento_modelos_ver on public.atendimento_modelos_email
  for select to authenticated using (hotel_id in (select public.atendimento_hoteis()));
drop policy if exists atendimento_modelos_admin on public.atendimento_modelos_email;
create policy atendimento_modelos_admin on public.atendimento_modelos_email
  for all to authenticated
  using (public.atendimento_sou_admin(hotel_id)) with check (public.atendimento_sou_admin(hotel_id));

revoke all on public.atendimento_cotacoes, public.atendimento_reservas_detectadas, public.atendimento_modelos_email from anon;
revoke all on public.atendimento_reservas_detectadas from authenticated;
grant select on public.atendimento_cotacoes to authenticated;
grant select, insert, update, delete on public.atendimento_modelos_email to authenticated;
grant usage, select on sequence public.atendimento_modelos_email_id_seq to authenticated;
grant all on public.atendimento_cotacoes, public.atendimento_reservas_detectadas, public.atendimento_modelos_email to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Ao vivo: a tela atualiza quando o cliente clica ou a reserva entra
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'atendimento_cotacoes') then
    execute 'alter publication supabase_realtime add table public.atendimento_cotacoes';
  end if;
end $$;

-- Pronto! Confira: deve aparecer 3 linhas.
select table_name from information_schema.tables
 where table_schema = 'public'
   and table_name in ('atendimento_cotacoes', 'atendimento_modelos_email', 'atendimento_reservas_detectadas')
 order by table_name;
