-- ============================================================================
-- CAIXA DE ENTRADA — FASE 4 (Robô com IA, 24 horas)      (pode rodar várias vezes)
-- ============================================================================
-- Rode DEPOIS dos SQLs anteriores (Parte A, Fase 2, Fase 3 e Histórico).
--
--  1. Configuração do robô por hotel: ligado/desligado, canais, qual IA,
--     limite de gasto no mês. A chave da Anthropic fica criptografada em
--     atendimento_segredos (ninguém lê pela tela).
--  2. Conteúdo do robô (o que ele sabe do hotel), com rascunho e publicado.
--     Cada publicação fica guardada (dá para voltar a uma versão anterior).
--  3. Solicitações que o robô recebe (pedido especial, grupo, problema ao
--     reservar, confirmação de reserva).
--  4. Registro de uso e custo da IA.
--  5. Conversa: robô atendendo ou pausado (alguém da equipe assumiu).
--  6. Painel do robô.
-- Tabelas novas com GRANT explícito (mudança do Supabase de 30/10/2026).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Configuração do robô (nada secreto aqui)
-- ---------------------------------------------------------------------------
create table if not exists public.atendimento_robo (
  hotel_id           bigint primary key references public.hoteis(id) on delete cascade,
  ligado             boolean not null default false,
  canais             text[] not null default '{WHATSAPP}',
  modelo             text not null default 'claude-haiku-5-5',
  nome_assistente    text,
  horas_retomar      integer not null default 12,       -- robô volta a atender depois de N horas sem a equipe escrever
  limite_mensal_usd  numeric(10,2) not null default 30,  -- passou disso no mês, o robô para e a equipe assume
  email_solicitacoes text,                                -- em branco: as solicitações ficam só no sistema
  chave_salva_em     timestamptz,
  hotel_info         jsonb,                               -- dados do hotel lidos da Cloudbeds
  hotel_info_em      timestamptz,
  atualizado_por_id  bigint,
  atualizado_em      timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'atendimento_robo_regras_check') then
    alter table public.atendimento_robo add constraint atendimento_robo_regras_check
      check (horas_retomar between 1 and 168 and limite_mensal_usd >= 0 and limite_mensal_usd <= 5000);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Conteúdo do robô: lista de assuntos [{ "titulo": "...", "texto": "..." }]
-- ---------------------------------------------------------------------------
create table if not exists public.atendimento_robo_conteudo (
  hotel_id         bigint primary key references public.hoteis(id) on delete cascade,
  rascunho         jsonb not null default '[]'::jsonb,
  rascunho_em      timestamptz,
  rascunho_por_id  bigint,
  publicado        jsonb not null default '[]'::jsonb,
  publicado_em     timestamptz,
  publicado_por_id bigint
);

create table if not exists public.atendimento_robo_versoes (
  id               bigserial primary key,
  hotel_id         bigint not null references public.hoteis(id) on delete cascade,
  conteudo         jsonb not null,
  publicado_em     timestamptz not null default now(),
  publicado_por_id bigint
);
create index if not exists atendimento_robo_versoes_hotel_idx on public.atendimento_robo_versoes (hotel_id, publicado_em desc);

-- ---------------------------------------------------------------------------
-- 3) Solicitações
-- ---------------------------------------------------------------------------
create table if not exists public.atendimento_solicitacoes (
  id               bigserial primary key,
  hotel_id         bigint not null references public.hoteis(id) on delete cascade,
  conversa_id      bigint references public.atendimento_conversas(id) on delete set null,
  contato_id       bigint references public.atendimento_contatos(id) on delete set null,
  tipo             text not null default 'OUTRO',
  resumo           text,
  dados            jsonb not null default '{}'::jsonb,
  situacao         text not null default 'NOVA',
  responsavel_id   bigint,
  email_enviado_em timestamptz,
  email_erro       text,
  criado_pelo_robo boolean not null default true,
  criado_por_id    bigint,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'atendimento_solicitacoes_tipo_check') then
    alter table public.atendimento_solicitacoes add constraint atendimento_solicitacoes_tipo_check
      check (tipo in ('PEDIDO_ESPECIAL', 'GRUPO', 'PROBLEMA_RESERVA', 'CONFIRMACAO_RESERVA', 'OUTRO'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'atendimento_solicitacoes_situacao_check') then
    alter table public.atendimento_solicitacoes add constraint atendimento_solicitacoes_situacao_check
      check (situacao in ('NOVA', 'EM_ANDAMENTO', 'CONCLUIDA'));
  end if;
end $$;
create index if not exists atendimento_solicitacoes_hotel_idx on public.atendimento_solicitacoes (hotel_id, criado_em desc);
create index if not exists atendimento_solicitacoes_conversa_idx on public.atendimento_solicitacoes (conversa_id);

-- ---------------------------------------------------------------------------
-- 4) Uso e custo da IA (uma linha por chamada)
-- ---------------------------------------------------------------------------
create table if not exists public.atendimento_robo_uso (
  id                   bigserial primary key,
  hotel_id             bigint not null references public.hoteis(id) on delete cascade,
  conversa_id          bigint references public.atendimento_conversas(id) on delete set null,
  origem               text not null default 'CONVERSA',   -- CONVERSA ou TESTE
  modelo               text,
  tokens_entrada       integer not null default 0,
  tokens_cache_leitura integer not null default 0,
  tokens_cache_escrita integer not null default 0,
  tokens_saida         integer not null default 0,
  custo_usd            numeric(12,6) not null default 0,
  criado_em            timestamptz not null default now()
);
create index if not exists atendimento_robo_uso_hotel_idx on public.atendimento_robo_uso (hotel_id, criado_em desc);

-- ---------------------------------------------------------------------------
-- 5) Conversas, mensagens e cotações
-- ---------------------------------------------------------------------------
alter table public.atendimento_conversas
  add column if not exists robo_pausado_em         timestamptz,  -- alguém assumiu (ou o robô passou para a equipe)
  add column if not exists robo_pausa_motivo       text,         -- ASSUMIU, PEDIU_HUMANO, ROBO_NAO_SABE, LIMITE, ERRO
  add column if not exists robo_ocupado_ate        timestamptz,  -- trava: o robô está respondendo agora
  add column if not exists robo_atendeu            boolean not null default false,
  add column if not exists robo_ultima_resposta_em timestamptz,
  add column if not exists robo_respondeu_ate      timestamptz;  -- última mensagem do cliente que o robô já respondeu

alter table public.atendimento_mensagens
  add column if not exists enviado_pelo_robo boolean not null default false;

alter table public.atendimento_cotacoes
  add column if not exists enviado_pelo_robo boolean not null default false;

-- Conversa resolvida ou arquivada: o robô volta a atender na próxima mensagem
create or replace function public.atendimento_robo_ao_resolver()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('RESOLVIDA', 'ARQUIVADA') and old.status is distinct from new.status then
    new.robo_pausado_em := null;
    new.robo_pausa_motivo := null;
  end if;
  return new;
end;
$$;

drop trigger if exists atendimento_robo_ao_resolver on public.atendimento_conversas;
create trigger atendimento_robo_ao_resolver
  before update on public.atendimento_conversas
  for each row execute function public.atendimento_robo_ao_resolver();

-- ---------------------------------------------------------------------------
-- 6) Publicar o conteúdo (rascunho → publicado, guardando a versão)
-- ---------------------------------------------------------------------------
create or replace function public.atendimento_robo_publicar(p_hotel bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conteudo jsonb;
  v_quem     bigint;
begin
  if auth.uid() is not null and not public.atendimento_sou_admin(p_hotel) then
    raise exception 'Só o administrador do hotel pode publicar o conteúdo do robô.';
  end if;
  select rascunho into v_conteudo from public.atendimento_robo_conteudo where hotel_id = p_hotel;
  if v_conteudo is null or jsonb_typeof(v_conteudo) <> 'array' or jsonb_array_length(v_conteudo) = 0 then
    raise exception 'O rascunho está vazio. Escreva pelo menos um assunto antes de publicar.';
  end if;
  select id into v_quem from public.usuarios where auth_id = auth.uid() limit 1;
  update public.atendimento_robo_conteudo
     set publicado = v_conteudo, publicado_em = now(), publicado_por_id = v_quem
   where hotel_id = p_hotel;
  insert into public.atendimento_robo_versoes (hotel_id, conteudo, publicado_por_id) values (p_hotel, v_conteudo, v_quem);
  -- guarda só as 30 últimas versões
  delete from public.atendimento_robo_versoes
   where hotel_id = p_hotel
     and id not in (select id from public.atendimento_robo_versoes where hotel_id = p_hotel order by publicado_em desc, id desc limit 30);
  return jsonb_build_object('publicado_em', now(), 'assuntos', jsonb_array_length(v_conteudo));
end;
$$;

-- ---------------------------------------------------------------------------
-- 7) Gasto do mês (o servidor confere o limite antes de cada resposta)
-- ---------------------------------------------------------------------------
create or replace function public.atendimento_robo_gasto_mes(p_hotel bigint)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(custo_usd), 0)
    from public.atendimento_robo_uso
   where hotel_id = p_hotel
     and criado_em >= (date_trunc('month', now() at time zone 'America/Fortaleza') at time zone 'America/Fortaleza');
$$;

-- Resumo para a tela de configuração (só ADMIN do hotel)
create or replace function public.atendimento_robo_resumo(p_hotel bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ini timestamptz := date_trunc('month', now() at time zone 'America/Fortaleza') at time zone 'America/Fortaleza';
begin
  if auth.uid() is not null and not public.atendimento_sou_admin(p_hotel) then
    raise exception 'Só o administrador do hotel pode ver o uso do robô.';
  end if;
  return jsonb_build_object(
    'gasto_mes',       (select coalesce(sum(custo_usd), 0) from public.atendimento_robo_uso where hotel_id = p_hotel and criado_em >= v_ini),
    'gasto_testes',    (select coalesce(sum(custo_usd), 0) from public.atendimento_robo_uso where hotel_id = p_hotel and criado_em >= v_ini and origem = 'TESTE'),
    'chamadas_mes',    (select count(*) from public.atendimento_robo_uso where hotel_id = p_hotel and criado_em >= v_ini),
    'respostas_mes',   (select count(*) from public.atendimento_mensagens where hotel_id = p_hotel and enviado_pelo_robo and direcao = 'SAIDA' and criado_em >= v_ini),
    'conversas_mes',   (select count(distinct conversa_id) from public.atendimento_mensagens where hotel_id = p_hotel and enviado_pelo_robo and direcao = 'SAIDA' and criado_em >= v_ini),
    'gasto_ate_ontem', (select coalesce(sum(custo_usd), 0) from public.atendimento_robo_uso
                         where hotel_id = p_hotel and criado_em >= v_ini
                           and criado_em < (date_trunc('day', now() at time zone 'America/Fortaleza') at time zone 'America/Fortaleza'))
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 8) Painel: o que o robô fez no período
-- ---------------------------------------------------------------------------
create or replace function public.atendimento_painel_robo(p_hoteis bigint[], p_inicio date, p_fim date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_hoteis bigint[];
  v_admin  boolean;
  v_ini    timestamptz := (p_inicio::timestamp) at time zone 'America/Fortaleza';
  v_fim    timestamptz := ((p_fim + 1)::timestamp) at time zone 'America/Fortaleza';
  v_saida  jsonb;
begin
  if auth.uid() is null then
    v_hoteis := p_hoteis;
    v_admin := true;
  else
    select coalesce(array_agg(h), '{}') into v_hoteis from (select public.atendimento_hoteis() as h) x where h = any(p_hoteis);
    select coalesce(bool_and(public.atendimento_sou_admin(h)), false) into v_admin from unnest(v_hoteis) h;
  end if;

  if not exists (select 1 from public.atendimento_mensagens m
                  where m.hotel_id = any(v_hoteis) and m.enviado_pelo_robo
                    and m.criado_em >= v_ini and m.criado_em < v_fim) then
    return null;
  end if;

  with resp as (
    select m.* from public.atendimento_mensagens m
     where m.hotel_id = any(v_hoteis) and m.enviado_pelo_robo and m.direcao = 'SAIDA'
       and m.criado_em >= v_ini and m.criado_em < v_fim
  ),
  conv as (select distinct conversa_id from resp),
  passou as (
    select distinct m.conversa_id from public.atendimento_mensagens m
     where m.hotel_id = any(v_hoteis) and m.tipo = 'robo_passou'
       and m.criado_em >= v_ini and m.criado_em < v_fim
  ),
  cot as (
    select c.* from public.atendimento_cotacoes c
     where c.hotel_id = any(v_hoteis) and c.enviado_pelo_robo and c.status <> 'CANCELADA'
       and c.criado_em >= v_ini and c.criado_em < v_fim
  ),
  sol as (
    select s.* from public.atendimento_solicitacoes s
     where s.hotel_id = any(v_hoteis) and s.criado_pelo_robo and s.criado_em >= v_ini and s.criado_em < v_fim
  )
  select jsonb_build_object(
    'conversas',        (select count(*) from conv),
    'respostas',        (select count(*) from resp),
    'fora_horario',     (select count(*) from conv x join public.atendimento_conversas c on c.id = x.conversa_id
                          where public.atendimento_fora_do_horario(c.hotel_id, c.criado_em)),
    'passou_equipe',    (select count(*) from passou),
    'resolveu_sozinho', (select count(*) from conv x where x.conversa_id not in (select conversa_id from passou)),
    'cotacoes',         (select count(*) from cot where status <> 'SEM_DISPONIBILIDADE'),
    'sem_disponibilidade', (select count(*) from cot where status = 'SEM_DISPONIBILIDADE'),
    'cliques',          (select count(*) from cot where cliques > 0),
    'reservas',         (select count(*) from cot where status = 'RESERVOU'),
    'valor_reservado',  (select coalesce(sum(reserva_valor), 0) from cot where status = 'RESERVOU'),
    'solicitacoes',     (select count(*) from sol),
    'solicitacoes_por_tipo', (select coalesce(jsonb_object_agg(tipo, n), '{}'::jsonb) from (select tipo, count(*) n from sol group by tipo) t),
    'custo_usd',        case when v_admin then (select coalesce(sum(custo_usd), 0) from public.atendimento_robo_uso u
                                                  where u.hotel_id = any(v_hoteis) and u.criado_em >= v_ini and u.criado_em < v_fim)
                             else null end
  ) into v_saida;
  return v_saida;
end;
$$;

revoke all on function public.atendimento_robo_publicar(bigint) from public, anon;
revoke all on function public.atendimento_robo_gasto_mes(bigint) from public, anon, authenticated;
revoke all on function public.atendimento_robo_resumo(bigint) from public, anon;
revoke all on function public.atendimento_painel_robo(bigint[], date, date) from public, anon;
revoke all on function public.atendimento_robo_ao_resolver() from public, anon, authenticated;
grant execute on function public.atendimento_robo_publicar(bigint) to authenticated, service_role;
grant execute on function public.atendimento_robo_gasto_mes(bigint) to service_role;
grant execute on function public.atendimento_robo_resumo(bigint) to authenticated, service_role;
grant execute on function public.atendimento_painel_robo(bigint[], date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9) Segurança (RLS)
-- ---------------------------------------------------------------------------
alter table public.atendimento_robo          enable row level security;
alter table public.atendimento_robo_conteudo enable row level security;
alter table public.atendimento_robo_versoes  enable row level security;
alter table public.atendimento_solicitacoes  enable row level security;
alter table public.atendimento_robo_uso      enable row level security;

-- Configuração: quem atende vê se o robô está ligado; só o servidor grava
drop policy if exists atendimento_robo_ver on public.atendimento_robo;
create policy atendimento_robo_ver on public.atendimento_robo
  for select to authenticated using (hotel_id in (select public.atendimento_hoteis()));

-- Conteúdo: quem atende pode ler; o ADMIN do hotel edita o rascunho
drop policy if exists atendimento_robo_conteudo_ver on public.atendimento_robo_conteudo;
create policy atendimento_robo_conteudo_ver on public.atendimento_robo_conteudo
  for select to authenticated using (hotel_id in (select public.atendimento_hoteis()));
drop policy if exists atendimento_robo_conteudo_admin on public.atendimento_robo_conteudo;
create policy atendimento_robo_conteudo_admin on public.atendimento_robo_conteudo
  for all to authenticated
  using (public.atendimento_sou_admin(hotel_id)) with check (public.atendimento_sou_admin(hotel_id));

drop policy if exists atendimento_robo_versoes_admin on public.atendimento_robo_versoes;
create policy atendimento_robo_versoes_admin on public.atendimento_robo_versoes
  for select to authenticated using (public.atendimento_sou_admin(hotel_id));

-- Solicitações: quem atende vê e muda a situação
drop policy if exists atendimento_solicitacoes_ver on public.atendimento_solicitacoes;
create policy atendimento_solicitacoes_ver on public.atendimento_solicitacoes
  for select to authenticated using (hotel_id in (select public.atendimento_hoteis()));
drop policy if exists atendimento_solicitacoes_alterar on public.atendimento_solicitacoes;
create policy atendimento_solicitacoes_alterar on public.atendimento_solicitacoes
  for update to authenticated
  using (hotel_id in (select public.atendimento_hoteis()))
  with check (hotel_id in (select public.atendimento_hoteis()));

-- Uso e custo: só o ADMIN do hotel
drop policy if exists atendimento_robo_uso_admin on public.atendimento_robo_uso;
create policy atendimento_robo_uso_admin on public.atendimento_robo_uso
  for select to authenticated using (public.atendimento_sou_admin(hotel_id));

-- ---------------------------------------------------------------------------
-- 10) Permissões das tabelas novas (visitante/anon: nada)
-- ---------------------------------------------------------------------------
revoke all on public.atendimento_robo, public.atendimento_robo_conteudo, public.atendimento_robo_versoes,
              public.atendimento_solicitacoes, public.atendimento_robo_uso from anon;
revoke all on public.atendimento_robo, public.atendimento_robo_versoes, public.atendimento_robo_uso from authenticated;
grant select                         on public.atendimento_robo          to authenticated;
grant select, insert, update         on public.atendimento_robo_conteudo to authenticated;
grant select                         on public.atendimento_robo_versoes  to authenticated;
grant select, update                 on public.atendimento_solicitacoes  to authenticated;
grant select                         on public.atendimento_robo_uso      to authenticated;
grant all on public.atendimento_robo, public.atendimento_robo_conteudo, public.atendimento_robo_versoes,
             public.atendimento_solicitacoes, public.atendimento_robo_uso to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Ao vivo na tela: solicitações novas
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'atendimento_solicitacoes') then
    alter publication supabase_realtime add table public.atendimento_solicitacoes;
  end if;
end $$;

-- Pronto! Confira: deve aparecer 5 linhas.
select table_name from information_schema.tables
 where table_schema = 'public'
   and table_name in ('atendimento_robo', 'atendimento_robo_conteudo', 'atendimento_robo_versoes',
                      'atendimento_solicitacoes', 'atendimento_robo_uso')
 order by table_name;
