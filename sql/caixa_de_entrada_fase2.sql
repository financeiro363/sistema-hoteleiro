-- ============================================================================
-- CAIXA DE ENTRADA — FASE 2 (LiveChat completo)        (pode rodar várias vezes)
-- ============================================================================
-- Rode DEPOIS do sql/caixa_de_entrada.sql (Parte A).
--
--  1. Os dois hotéis no mesmo quadro: quem atende nos dois (vínculo em
--     vinculos_usuario_hotel) vê as conversas dos dois, com filtro por hotel.
--  2. Contatos: um cadastro por cliente, ligado sozinho pelo telefone/e-mail.
--  3. Etapas do Kanban (iguais às do Asksuite, editáveis pelo ADMIN).
--  4. Etiquetas (manuais e automáticas, ex.: AD = veio de anúncio da Meta).
--  5. Situação "Arquivada", valor da cotação, origem e primeira resposta.
--  6. Horário comercial e alerta de espera, por hotel.
--  7. Painel (indicadores mês a mês) e "juntar contatos".
-- Tabelas novas com GRANT explícito (mudança do Supabase de 30/10/2026).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Em quais hotéis a pessoa atende / é ADMIN
-- ---------------------------------------------------------------------------
create or replace function public.atendimento_hoteis()
returns setof bigint
language sql
stable
security definer
set search_path = public
as $$
  select u.hotel_id::bigint
    from public.usuarios u
   where u.auth_id = auth.uid()
     and coalesce(u.ativo, true)
     and (u.papel = 'ADMIN' or (u.papel = 'COLABORADOR' and u.pode_acessar_atendimento is true))
  union
  select v.hotel_id::bigint
    from public.vinculos_usuario_hotel v
    join public.usuarios u on u.auth_id = v.auth_id
   where v.auth_id = auth.uid()
     and v.ativo is true
     and coalesce(u.ativo, true)
     and (v.papel = 'ADMIN' or (v.papel = 'COLABORADOR' and u.pode_acessar_atendimento is true));
$$;

create or replace function public.atendimento_sou_admin(p_hotel bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.usuarios u
                  where u.auth_id = auth.uid() and coalesce(u.ativo, true)
                    and u.papel = 'ADMIN' and u.hotel_id::bigint = p_hotel)
      or exists (select 1 from public.vinculos_usuario_hotel v
                  where v.auth_id = auth.uid() and v.ativo is true
                    and v.papel = 'ADMIN' and v.hotel_id::bigint = p_hotel);
$$;

revoke all on function public.atendimento_hoteis() from public, anon;
revoke all on function public.atendimento_sou_admin(bigint) from public, anon;
grant execute on function public.atendimento_hoteis() to authenticated, service_role;
grant execute on function public.atendimento_sou_admin(bigint) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) Tabelas novas
-- ---------------------------------------------------------------------------
create table if not exists public.atendimento_contatos (
  id                   bigserial primary key,
  hotel_id             bigint not null references public.hoteis(id) on delete cascade,
  nome                 text,
  telefone             text,           -- só números, com 55 (ex.: 5583988887777)
  email                text,
  idioma               text,
  observacoes          text,
  etiquetas_importadas text,           -- etiquetas que vieram do Asksuite
  origem               text,           -- WHATSAPP, EMAIL, MANUAL, IMPORTADO
  criado_em            timestamptz not null default now(),
  atualizado_em        timestamptz not null default now()
);
create index if not exists atendimento_contatos_telefone_idx on public.atendimento_contatos (hotel_id, telefone);
create index if not exists atendimento_contatos_email_idx on public.atendimento_contatos (hotel_id, lower(email));
create index if not exists atendimento_contatos_atualizado_idx on public.atendimento_contatos (hotel_id, atualizado_em desc);

create table if not exists public.atendimento_etapas (
  id        bigserial primary key,
  hotel_id  bigint not null references public.hoteis(id) on delete cascade,
  nome      text not null,
  cor       text,
  ordem     integer not null default 0,
  ativa     boolean not null default true,
  criado_em timestamptz not null default now()
);
create unique index if not exists atendimento_etapas_nome_idx on public.atendimento_etapas (hotel_id, lower(nome));

create table if not exists public.atendimento_etiquetas (
  id         bigserial primary key,
  hotel_id   bigint not null references public.hoteis(id) on delete cascade,
  nome       text not null,
  cor        text,
  automatica boolean not null default false,
  criado_em  timestamptz not null default now()
);
create unique index if not exists atendimento_etiquetas_nome_idx on public.atendimento_etiquetas (hotel_id, lower(nome));

create table if not exists public.atendimento_preferencias (
  hotel_id              bigint primary key references public.hoteis(id) on delete cascade,
  -- dia da semana (0 = domingo) → ["início", "fim"]; dia sem faixa = fechado
  horario_comercial     jsonb not null default
    '{"1":["08:00","18:00"],"2":["08:00","18:00"],"3":["08:00","18:00"],"4":["08:00","18:00"],"5":["08:00","18:00"],"6":["08:00","12:00"]}'::jsonb,
  alerta_espera_minutos integer not null default 15,
  atualizado_por_id     bigint,
  atualizado_em         timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3) Colunas novas nas conversas
-- ---------------------------------------------------------------------------
alter table public.atendimento_conversas
  add column if not exists contato_id           bigint references public.atendimento_contatos(id) on delete set null,
  add column if not exists etapa_id             bigint references public.atendimento_etapas(id) on delete set null,
  add column if not exists etiquetas            bigint[] not null default '{}',
  add column if not exists valor_cotacao        numeric(12,2),
  add column if not exists origem               jsonb,
  add column if not exists primeira_resposta_em timestamptz,
  add column if not exists ultima_saida_em      timestamptz,
  add column if not exists arquivada_em         timestamptz;

create index if not exists atendimento_conversas_contato_idx on public.atendimento_conversas (contato_id);
create index if not exists atendimento_conversas_etapa_idx on public.atendimento_conversas (etapa_id);
create index if not exists atendimento_conversas_etiquetas_idx on public.atendimento_conversas using gin (etiquetas);

-- Situação "ARQUIVADA" (troca a regra antiga de situações)
do $$
declare
  regra record;
begin
  for regra in
    select con.conname from pg_constraint con
     where con.conrelid = 'public.atendimento_conversas'::regclass and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%status%'
  loop
    execute format('alter table public.atendimento_conversas drop constraint %I', regra.conname);
  end loop;
end $$;
alter table public.atendimento_conversas
  add constraint atendimento_conversas_status_check
  check (status in ('ABERTA', 'PENDENTE', 'RESOLVIDA', 'ARQUIVADA'));

-- ---------------------------------------------------------------------------
-- 4) Etapas e etiquetas padrão de cada hotel
-- ---------------------------------------------------------------------------
create or replace function public.atendimento_preparar_hotel(p_hotel bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Etapas: só quando o hotel ainda não tem nenhuma (para não desfazer edições)
  if not exists (select 1 from public.atendimento_etapas where hotel_id = p_hotel) then
    insert into public.atendimento_etapas (hotel_id, nome, cor, ordem) values
      (p_hotel, 'Atendimentos iniciados', '#2E7D32', 1),
      (p_hotel, 'Cotação',               '#1D4E89', 2),
      (p_hotel, 'Reservar agora',        '#00897B', 3),
      (p_hotel, 'Solicitado humano',     '#E65100', 4),
      (p_hotel, 'Reservou',              '#6A1B9A', 5)
    on conflict do nothing;
  end if;

  -- Etiquetas manuais sugeridas: só na primeira vez
  if not exists (select 1 from public.atendimento_etiquetas where hotel_id = p_hotel) then
    insert into public.atendimento_etiquetas (hotel_id, nome, cor) values
      (p_hotel, 'Solicitação',            '#546E7A'),
      (p_hotel, 'Solicitado atendimento', '#AD1457'),
      (p_hotel, 'Grupo',                  '#5D4037'),
      (p_hotel, 'Evento',                 '#283593'),
      (p_hotel, 'VIP',                    '#B8860B')
    on conflict do nothing;
  end if;

  -- Etiquetas automáticas (o sistema coloca sozinho): sempre garantidas
  insert into public.atendimento_etiquetas (hotel_id, nome, cor, automatica) values
    (p_hotel, 'AD',                  '#1565C0', true),
    (p_hotel, 'Cotação',             '#3949AB', true),
    (p_hotel, 'Reservar agora',      '#00897B', true),
    (p_hotel, 'Reservou',            '#6A1B9A', true),
    (p_hotel, 'Follow-up automático','#8E24AA', true)
  on conflict do nothing;

  insert into public.atendimento_preferencias (hotel_id) values (p_hotel) on conflict do nothing;
end;
$$;

select public.atendimento_preparar_hotel(id::bigint) from public.hoteis;

-- ---------------------------------------------------------------------------
-- 5) Contato automático (pelo telefone ou e-mail) e etapa inicial
-- ---------------------------------------------------------------------------
-- Telefones brasileiros com e sem o 9 (contas antigas do WhatsApp)
create or replace function public.atendimento_variantes_telefone(p_tel text)
returns text[]
language sql
immutable
as $$
  select array_remove(array[
    d,
    case when d like '55%' and length(d) = 13 and substr(d, 5, 1) = '9' then substr(d, 1, 4) || substr(d, 6) end,
    case when d like '55%' and length(d) = 12 and substr(d, 5, 1) between '6' and '9' then substr(d, 1, 4) || '9' || substr(d, 5) end
  ], null)
  from (select regexp_replace(coalesce(p_tel, ''), '\D', '', 'g') as d) x;
$$;

create or replace function public.atendimento_contato_para(p_hotel bigint, p_tipo text, p_chave text, p_endereco text, p_nome text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id    bigint;
  v_tel   text;
  v_email text;
begin
  if p_tipo = 'WHATSAPP' then
    v_tel := regexp_replace(coalesce(p_chave, ''), '\D', '', 'g');
    if v_tel = '' then return null; end if;
    select id into v_id from public.atendimento_contatos
     where hotel_id = p_hotel and telefone = any(public.atendimento_variantes_telefone(v_tel))
     order by id limit 1;
  elsif p_tipo = 'EMAIL' then
    v_email := lower(btrim(coalesce(p_endereco, '')));
    if v_email = '' then return null; end if;
    select id into v_id from public.atendimento_contatos
     where hotel_id = p_hotel and lower(email) = v_email
     order by id limit 1;
  else
    return null;
  end if;

  if v_id is null then
    insert into public.atendimento_contatos (hotel_id, nome, telefone, email, origem)
    values (p_hotel, nullif(btrim(coalesce(p_nome, '')), ''),
            case when p_tipo = 'WHATSAPP' then v_tel end, v_email, p_tipo)
    returning id into v_id;
  elsif nullif(btrim(coalesce(p_nome, '')), '') is not null then
    update public.atendimento_contatos set nome = coalesce(nome, btrim(p_nome)) where id = v_id;
  end if;
  return v_id;
end;
$$;

create or replace function public.atendimento_antes_conversa()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.atendimento_etapas where hotel_id = new.hotel_id) then
    perform public.atendimento_preparar_hotel(new.hotel_id);
  end if;
  if new.contato_id is null then
    new.contato_id := public.atendimento_contato_para(new.hotel_id, new.canal_tipo, new.chave_externa, new.contato_endereco, new.contato_nome);
  end if;
  if new.etapa_id is null then
    select id into new.etapa_id from public.atendimento_etapas
     where hotel_id = new.hotel_id and ativa order by ordem, id limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists atendimento_antes_conversa on public.atendimento_conversas;
create trigger atendimento_antes_conversa
  before insert on public.atendimento_conversas
  for each row execute function public.atendimento_antes_conversa();

-- Ao alterar uma conversa (pela tela): confere hotel, etapa e etiquetas e,
-- ao mover o cartão para uma etapa que tem etiqueta com o mesmo nome
-- (Cotação, Reservar agora, Reservou), coloca a etiqueta sozinho — é ela que
-- alimenta o Painel.
create or replace function public.atendimento_antes_alterar_conversa()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome text;
  v_tag  bigint;
begin
  if new.hotel_id is distinct from old.hotel_id or new.canal_id is distinct from old.canal_id then
    raise exception 'Não é permitido mudar o hotel ou o canal de uma conversa.';
  end if;

  if new.etapa_id is distinct from old.etapa_id and new.etapa_id is not null then
    select nome into v_nome from public.atendimento_etapas where id = new.etapa_id and hotel_id = new.hotel_id;
    if v_nome is null then raise exception 'Etapa inválida para este hotel.'; end if;
    select id into v_tag from public.atendimento_etiquetas where hotel_id = new.hotel_id and lower(nome) = lower(v_nome);
    if v_tag is not null and not (v_tag = any(coalesce(new.etiquetas, '{}'))) then
      new.etiquetas := array_append(coalesce(new.etiquetas, '{}'), v_tag);
    end if;
  end if;

  if new.etiquetas is distinct from old.etiquetas then
    new.etiquetas := coalesce((select array_agg(distinct e.id order by e.id) from public.atendimento_etiquetas e
                                where e.hotel_id = new.hotel_id and e.id = any(coalesce(new.etiquetas, '{}'))), '{}');
  end if;

  if new.status = 'ARQUIVADA' and old.status is distinct from 'ARQUIVADA' then
    new.arquivada_em := now();
  elsif new.status <> 'ARQUIVADA' then
    new.arquivada_em := null;
  end if;
  return new;
end;
$$;

drop trigger if exists atendimento_antes_alterar_conversa on public.atendimento_conversas;
create trigger atendimento_antes_alterar_conversa
  before update on public.atendimento_conversas
  for each row execute function public.atendimento_antes_alterar_conversa();

-- Conversas que já existiam: liga contato e etapa
update public.atendimento_conversas
   set contato_id = public.atendimento_contato_para(hotel_id, canal_tipo, chave_externa, contato_endereco, contato_nome)
 where contato_id is null;
update public.atendimento_conversas c
   set etapa_id = (select e.id from public.atendimento_etapas e where e.hotel_id = c.hotel_id and e.ativa order by e.ordem, e.id limit 1)
 where etapa_id is null;

-- ---------------------------------------------------------------------------
-- 6) Resumo da conversa a cada mensagem (versão nova: primeira resposta,
--    última saída e "atualizado em" do contato)
-- ---------------------------------------------------------------------------
create or replace function public.atendimento_apos_mensagem()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  quando timestamptz := coalesce(new.data_original, new.criado_em, now());
begin
  if new.direcao = 'NOTA' then
    update public.atendimento_conversas set atualizado_em = now() where id = new.conversa_id;
    return new;
  end if;

  update public.atendimento_conversas c set
    ultima_mensagem_resumo = case when quando >= coalesce(c.ultima_mensagem_em, '-infinity'::timestamptz)
                                  then left(coalesce(nullif(btrim(new.texto), ''), '[' || new.tipo || ']'), 160)
                                  else c.ultima_mensagem_resumo end,
    ultima_direcao         = case when quando >= coalesce(c.ultima_mensagem_em, '-infinity'::timestamptz)
                                  then new.direcao else c.ultima_direcao end,
    ultima_mensagem_em     = greatest(coalesce(c.ultima_mensagem_em, '-infinity'::timestamptz), quando),
    nao_lidas              = c.nao_lidas + case when new.direcao = 'ENTRADA' and new.status_envio = 'NAO_LIDA' then 1 else 0 end,
    ultima_entrada_em      = case when new.direcao = 'ENTRADA'
                                  then greatest(coalesce(c.ultima_entrada_em, '-infinity'::timestamptz), quando)
                                  else c.ultima_entrada_em end,
    ultima_saida_em        = case when new.direcao = 'SAIDA'
                                  then greatest(coalesce(c.ultima_saida_em, '-infinity'::timestamptz), quando)
                                  else c.ultima_saida_em end,
    primeira_resposta_em   = case when new.direcao = 'SAIDA' and c.primeira_resposta_em is null and new.status_envio is distinct from 'FALHOU'
                                  then quando else c.primeira_resposta_em end,
    status                 = case when new.direcao = 'ENTRADA' and new.status_envio = 'NAO_LIDA' and c.status in ('RESOLVIDA', 'ARQUIVADA')
                                  then 'ABERTA' else c.status end,
    arquivada_em           = case when new.direcao = 'ENTRADA' and new.status_envio = 'NAO_LIDA' then null else c.arquivada_em end,
    atualizado_em          = now()
  where c.id = new.conversa_id;

  update public.atendimento_contatos ct set atualizado_em = greatest(ct.atualizado_em, quando)
   where ct.id = (select contato_id from public.atendimento_conversas where id = new.conversa_id);
  return new;
end;
$$;

-- Conversas que já existiam: primeira resposta e última saída
update public.atendimento_conversas c set
  primeira_resposta_em = (select min(coalesce(m.data_original, m.criado_em)) from public.atendimento_mensagens m
                           where m.conversa_id = c.id and m.direcao = 'SAIDA' and m.status_envio is distinct from 'FALHOU'),
  ultima_saida_em      = (select max(coalesce(m.data_original, m.criado_em)) from public.atendimento_mensagens m
                           where m.conversa_id = c.id and m.direcao = 'SAIDA')
 where c.primeira_resposta_em is null;

-- ---------------------------------------------------------------------------
-- 7) Etiqueta automática (usada pelo servidor; ex.: AD)
-- ---------------------------------------------------------------------------
create or replace function public.atendimento_adicionar_etiqueta(p_conversa bigint, p_nome text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hotel bigint;
  v_id    bigint;
begin
  select hotel_id into v_hotel from public.atendimento_conversas where id = p_conversa;
  if v_hotel is null then return; end if;
  if auth.uid() is not null and v_hotel not in (select public.atendimento_hoteis()) then
    raise exception 'Sem acesso a esta conversa.';
  end if;
  select id into v_id from public.atendimento_etiquetas where hotel_id = v_hotel and lower(nome) = lower(p_nome);
  if v_id is null then
    insert into public.atendimento_etiquetas (hotel_id, nome, automatica) values (v_hotel, p_nome, true)
    on conflict do nothing returning id into v_id;
    if v_id is null then
      select id into v_id from public.atendimento_etiquetas where hotel_id = v_hotel and lower(nome) = lower(p_nome);
    end if;
  end if;
  update public.atendimento_conversas set etiquetas = array_append(etiquetas, v_id)
   where id = p_conversa and not (v_id = any(etiquetas));
end;
$$;

-- ---------------------------------------------------------------------------
-- 8) Juntar dois contatos (mesma pessoa no WhatsApp e no e-mail, por exemplo)
-- ---------------------------------------------------------------------------
create or replace function public.atendimento_juntar_contatos(p_manter bigint, p_remover bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.atendimento_contatos;
  b public.atendimento_contatos;
begin
  select * into a from public.atendimento_contatos where id = p_manter;
  select * into b from public.atendimento_contatos where id = p_remover;
  if a.id is null or b.id is null or a.id = b.id then raise exception 'Escolha dois contatos diferentes.'; end if;
  if a.hotel_id <> b.hotel_id then raise exception 'Só dá para juntar contatos do mesmo hotel.'; end if;
  if auth.uid() is not null and a.hotel_id not in (select public.atendimento_hoteis()) then raise exception 'Sem acesso.'; end if;

  update public.atendimento_contatos set
    nome                 = coalesce(a.nome, b.nome),
    telefone             = coalesce(a.telefone, b.telefone),
    email                = coalesce(a.email, b.email),
    idioma               = coalesce(a.idioma, b.idioma),
    observacoes          = nullif(concat_ws(E'\n', a.observacoes, b.observacoes), ''),
    etiquetas_importadas = nullif(concat_ws(', ', a.etiquetas_importadas, b.etiquetas_importadas), ''),
    criado_em            = least(a.criado_em, b.criado_em),
    atualizado_em        = greatest(a.atualizado_em, b.atualizado_em)
  where id = a.id;
  update public.atendimento_conversas set contato_id = a.id where contato_id = b.id;
  delete from public.atendimento_contatos where id = b.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9) Painel: indicadores mês a mês
-- ---------------------------------------------------------------------------
create or replace function public.atendimento_fora_do_horario(p_hotel bigint, p_quando timestamptz)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cfg   jsonb;
  v_local timestamp := p_quando at time zone 'America/Fortaleza';
  v_faixa jsonb;
begin
  select horario_comercial into v_cfg from public.atendimento_preferencias where hotel_id = p_hotel;
  if v_cfg is null then
    v_cfg := '{"1":["08:00","18:00"],"2":["08:00","18:00"],"3":["08:00","18:00"],"4":["08:00","18:00"],"5":["08:00","18:00"],"6":["08:00","12:00"]}'::jsonb;
  end if;
  v_faixa := v_cfg -> (extract(dow from v_local)::int)::text;
  if v_faixa is null or jsonb_typeof(v_faixa) <> 'array' or jsonb_array_length(v_faixa) < 2 then return true; end if;
  return not (v_local::time >= (v_faixa ->> 0)::time and v_local::time < (v_faixa ->> 1)::time);
end;
$$;

create or replace function public.atendimento_painel(p_hoteis bigint[], p_inicio date, p_fim date)
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

  with conv as (
    select c.*,
           (c.criado_em at time zone 'America/Fortaleza') as local_criado,
           public.atendimento_fora_do_horario(c.hotel_id, c.criado_em) as fora,
           exists (select 1 from public.atendimento_etiquetas e where e.id = any(c.etiquetas) and lower(e.nome) = 'cotação') as cotou,
           exists (select 1 from public.atendimento_etiquetas e where e.id = any(c.etiquetas) and lower(e.nome) = 'reservou') as reservou,
           exists (select 1 from public.atendimento_etiquetas e where e.id = any(c.etiquetas) and lower(e.nome) = 'ad') as anuncio,
           (select min(coalesce(m.data_original, m.criado_em)) from public.atendimento_mensagens m
             where m.conversa_id = c.id and m.direcao = 'ENTRADA') as primeira_entrada_em
      from public.atendimento_conversas c
     where c.hotel_id = any(v_hoteis) and c.criado_em >= v_ini and c.criado_em < v_fim
  ),
  msgs as (
    select m.* from public.atendimento_mensagens m
     where m.hotel_id = any(v_hoteis) and m.direcao in ('ENTRADA', 'SAIDA')
       and coalesce(m.data_original, m.criado_em) >= v_ini and coalesce(m.data_original, m.criado_em) < v_fim
  ),
  meses as (
    select generate_series(date_trunc('month', p_inicio::timestamp), date_trunc('month', p_fim::timestamp), interval '1 month') as mes
  )
  select jsonb_build_object(
    'hoteis', to_jsonb(v_hoteis),
    'totais', jsonb_build_object(
      'atendimentos',  (select count(*) from conv),
      'fora_horario',  (select count(*) from conv where fora),
      'cotacoes',      (select count(*) from conv where cotou),
      'reservas',      (select count(*) from conv where reservou),
      'anuncios',      (select count(*) from conv where anuncio),
      'mensagens',     (select count(*) from msgs),
      'recebidas',     (select count(*) from msgs where direcao = 'ENTRADA'),
      'enviadas',      (select count(*) from msgs where direcao = 'SAIDA'),
      'respondidas',   (select count(*) from conv where primeira_resposta_em is not null),
      'primeira_resposta_min', (select round(avg(extract(epoch from (primeira_resposta_em - primeira_entrada_em)) / 60)::numeric, 1)
                                  from conv where primeira_resposta_em is not null and primeira_entrada_em is not null
                                    and primeira_resposta_em >= primeira_entrada_em),
      'contatos_novos', (select count(*) from public.atendimento_contatos ct
                          where ct.hotel_id = any(v_hoteis) and ct.criado_em >= v_ini and ct.criado_em < v_fim
                            and coalesce(ct.origem, '') <> 'IMPORTADO')
    ),
    'meses', (select coalesce(jsonb_agg(jsonb_build_object(
                'mes', to_char(mes, 'YYYY-MM'),
                'atendimentos', (select count(*) from conv where date_trunc('month', local_criado) = mes),
                'fora_horario', (select count(*) from conv where fora and date_trunc('month', local_criado) = mes),
                'cotacoes',     (select count(*) from conv where cotou and date_trunc('month', local_criado) = mes),
                'reservas',     (select count(*) from conv where reservou and date_trunc('month', local_criado) = mes),
                'mensagens',    (select count(*) from msgs where date_trunc('month', coalesce(data_original, criado_em) at time zone 'America/Fortaleza') = mes)
              ) order by mes), '[]'::jsonb) from meses),
    'canais', (select coalesce(jsonb_object_agg(canal_tipo, n), '{}'::jsonb)
                 from (select canal_tipo, count(*) n from conv group by canal_tipo) x),
    'atendentes', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'conversas', conversas, 'enviadas', enviadas) order by enviadas desc), '[]'::jsonb)
                     from (select coalesce(a.id, b.id) id, coalesce(a.n, 0) conversas, coalesce(b.n, 0) enviadas
                             from (select responsavel_id id, count(*) n from conv where responsavel_id is not null group by 1) a
                             full join (select enviado_por_id id, count(*) n from msgs where direcao = 'SAIDA' and enviado_por_id is not null group by 1) b
                               on a.id = b.id) y),
    'por_hora', (select coalesce(jsonb_object_agg(h, n), '{}'::jsonb)
                   from (select extract(hour from local_criado)::int h, count(*) n from conv group by 1) z)
  ) into v_saida;
  return v_saida;
end;
$$;

revoke all on function public.atendimento_juntar_contatos(bigint, bigint) from public, anon;
revoke all on function public.atendimento_painel(bigint[], date, date) from public, anon;
revoke all on function public.atendimento_adicionar_etiqueta(bigint, text) from public, anon, authenticated;
revoke all on function public.atendimento_preparar_hotel(bigint) from public, anon, authenticated;
revoke all on function public.atendimento_contato_para(bigint, text, text, text, text) from public, anon, authenticated;
grant execute on function public.atendimento_juntar_contatos(bigint, bigint) to authenticated, service_role;
grant execute on function public.atendimento_painel(bigint[], date, date) to authenticated, service_role;
grant execute on function public.atendimento_adicionar_etiqueta(bigint, text) to service_role;
grant execute on function public.atendimento_preparar_hotel(bigint) to service_role;
grant execute on function public.atendimento_contato_para(bigint, text, text, text, text) to service_role;
grant execute on function public.atendimento_fora_do_horario(bigint, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10) Segurança: tudo passa a valer para os hotéis em que a pessoa atende
-- ---------------------------------------------------------------------------
alter table public.atendimento_contatos     enable row level security;
alter table public.atendimento_etapas       enable row level security;
alter table public.atendimento_etiquetas    enable row level security;
alter table public.atendimento_preferencias enable row level security;

drop policy if exists atendimento_canais_ver on public.atendimento_canais;
create policy atendimento_canais_ver on public.atendimento_canais
  for select to authenticated using (hotel_id in (select public.atendimento_hoteis()));

drop policy if exists atendimento_conversas_ver on public.atendimento_conversas;
create policy atendimento_conversas_ver on public.atendimento_conversas
  for select to authenticated using (hotel_id in (select public.atendimento_hoteis()));

drop policy if exists atendimento_conversas_alterar on public.atendimento_conversas;
create policy atendimento_conversas_alterar on public.atendimento_conversas
  for update to authenticated
  using (hotel_id in (select public.atendimento_hoteis()))
  with check (hotel_id in (select public.atendimento_hoteis()));

drop policy if exists atendimento_mensagens_ver on public.atendimento_mensagens;
create policy atendimento_mensagens_ver on public.atendimento_mensagens
  for select to authenticated using (hotel_id in (select public.atendimento_hoteis()));

drop policy if exists atendimento_respostas_todas on public.atendimento_respostas_prontas;
create policy atendimento_respostas_todas on public.atendimento_respostas_prontas
  for all to authenticated
  using (hotel_id in (select public.atendimento_hoteis()))
  with check (hotel_id in (select public.atendimento_hoteis()));

drop policy if exists atendimento_contatos_todos on public.atendimento_contatos;
create policy atendimento_contatos_todos on public.atendimento_contatos
  for all to authenticated
  using (hotel_id in (select public.atendimento_hoteis()))
  with check (hotel_id in (select public.atendimento_hoteis()));

drop policy if exists atendimento_etapas_ver on public.atendimento_etapas;
create policy atendimento_etapas_ver on public.atendimento_etapas
  for select to authenticated using (hotel_id in (select public.atendimento_hoteis()));
drop policy if exists atendimento_etapas_admin on public.atendimento_etapas;
create policy atendimento_etapas_admin on public.atendimento_etapas
  for all to authenticated
  using (public.atendimento_sou_admin(hotel_id)) with check (public.atendimento_sou_admin(hotel_id));

drop policy if exists atendimento_etiquetas_ver on public.atendimento_etiquetas;
create policy atendimento_etiquetas_ver on public.atendimento_etiquetas
  for select to authenticated using (hotel_id in (select public.atendimento_hoteis()));
drop policy if exists atendimento_etiquetas_admin on public.atendimento_etiquetas;
create policy atendimento_etiquetas_admin on public.atendimento_etiquetas
  for all to authenticated
  using (public.atendimento_sou_admin(hotel_id)) with check (public.atendimento_sou_admin(hotel_id));

drop policy if exists atendimento_preferencias_ver on public.atendimento_preferencias;
create policy atendimento_preferencias_ver on public.atendimento_preferencias
  for select to authenticated using (hotel_id in (select public.atendimento_hoteis()));
drop policy if exists atendimento_preferencias_admin on public.atendimento_preferencias;
create policy atendimento_preferencias_admin on public.atendimento_preferencias
  for all to authenticated
  using (public.atendimento_sou_admin(hotel_id)) with check (public.atendimento_sou_admin(hotel_id));

-- ---------------------------------------------------------------------------
-- 11) Permissões das tabelas novas (visitante/anon: nada)
-- ---------------------------------------------------------------------------
revoke all on public.atendimento_contatos, public.atendimento_etapas, public.atendimento_etiquetas,
              public.atendimento_preferencias from anon;
grant select, insert, update, delete on public.atendimento_contatos     to authenticated;
grant select, insert, update, delete on public.atendimento_etapas       to authenticated;
grant select, insert, update, delete on public.atendimento_etiquetas    to authenticated;
grant select, insert, update, delete on public.atendimento_preferencias to authenticated;
grant usage, select on sequence public.atendimento_contatos_id_seq  to authenticated;
grant usage, select on sequence public.atendimento_etapas_id_seq    to authenticated;
grant usage, select on sequence public.atendimento_etiquetas_id_seq to authenticated;
grant all on public.atendimento_contatos, public.atendimento_etapas, public.atendimento_etiquetas,
             public.atendimento_preferencias to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Pronto! Confira: deve aparecer 4 linhas.
select table_name from information_schema.tables
 where table_schema = 'public'
   and table_name in ('atendimento_contatos', 'atendimento_etapas', 'atendimento_etiquetas', 'atendimento_preferencias')
 order by table_name;
