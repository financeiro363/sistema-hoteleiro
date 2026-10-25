-- ============================================================================
-- CAIXA DE ENTRADA — FASE 5 (Automações)                  (pode rodar várias vezes)
-- ============================================================================
-- Rode DEPOIS do SQL dos ajustes (sql/caixa_de_entrada_ajustes.sql).
--
--  1. Automações por hotel (todas começam DESLIGADAS): follow-up de cotação,
--     de "Reservar agora", lista de espera (sem quarto), grupo, confirmação
--     depois da reserva, véspera da chegada, depois da saída e pesquisa de
--     satisfação. Cada uma tem modelo do WhatsApp, espera, horário e limite.
--  2. Registro de cada disparo (agendado, enviado, pulado e por quê).
--  3. Cliente que responde "SAIR" não recebe mais mensagens automáticas.
--  4. Pesquisa de satisfação: nota de 1 a 5 por atendimento.
--  5. Painel das automações.
-- Só o ADMIN vê e configura. Tabelas novas com GRANT explícito.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Automações
-- ---------------------------------------------------------------------------
create table if not exists public.atendimento_automacoes (
  id                bigserial primary key,
  hotel_id          bigint not null references public.hoteis(id) on delete cascade,
  tipo              text not null,
  ativo             boolean not null default false,
  canal_id          bigint references public.atendimento_canais(id) on delete set null,
  modelo_nome       text,              -- modelo (template) aprovado na Meta
  modelo_idioma     text,
  variaveis         jsonb not null default '[]'::jsonb,   -- {{1}}, {{2}}… → campo
  variaveis_cabecalho jsonb not null default '[]'::jsonb,
  texto_livre       text,              -- pesquisa: texto quando a janela de 24 h está aberta
  espera_minutos    integer not null default 60,
  janela_inicio     text not null default '08:00',
  janela_fim        text not null default '21:00',
  limite_dia        integer not null default 100,
  config            jsonb not null default '{}'::jsonb,   -- hora do envio, reverificar a cada X h, texto do modelo…
  ligado_em         timestamptz,       -- só vale para o que acontecer depois de ligar
  ultima_rodada     timestamptz,
  atualizado_por_id bigint,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now(),
  unique (hotel_id, tipo)
);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'atendimento_automacoes_tipo_check') then
    alter table public.atendimento_automacoes add constraint atendimento_automacoes_tipo_check
      check (tipo in ('FUP_RESERVAR', 'FUP_COTACAO', 'SEM_DISPONIBILIDADE', 'GRUPO', 'CONFIRMACAO_RESERVA', 'PRE_CHECKIN', 'POS_CHECKOUT', 'PESQUISA'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'atendimento_automacoes_numeros_check') then
    alter table public.atendimento_automacoes add constraint atendimento_automacoes_numeros_check
      check (espera_minutos between 0 and 43200 and limite_dia between 1 and 5000
             and janela_inicio ~ '^[0-2][0-9]:[0-5][0-9]$' and janela_fim ~ '^[0-2][0-9]:[0-5][0-9]$');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Disparos (cada mensagem que uma automação agendou ou enviou)
-- ---------------------------------------------------------------------------
create table if not exists public.atendimento_disparos (
  id            bigserial primary key,
  hotel_id      bigint not null references public.hoteis(id) on delete cascade,
  automacao_id  bigint not null references public.atendimento_automacoes(id) on delete cascade,
  tipo          text not null,
  chave         text not null,          -- evita mandar duas vezes a mesma coisa (ex.: cot:123)
  conversa_id   bigint references public.atendimento_conversas(id) on delete set null,
  contato_id    bigint references public.atendimento_contatos(id) on delete set null,
  cotacao_id    bigint references public.atendimento_cotacoes(id) on delete set null,
  reserva_id    text,
  telefone      text,
  nome          text,
  dados         jsonb not null default '{}'::jsonb,
  situacao      text not null default 'AGENDADO',
  motivo        text,
  agendado_para timestamptz not null,
  enviado_em    timestamptz,
  mensagem_id   bigint,
  nota          integer,                -- pesquisa de satisfação (1 a 5)
  nota_em       timestamptz,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (automacao_id, chave)
);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'atendimento_disparos_situacao_check') then
    alter table public.atendimento_disparos add constraint atendimento_disparos_situacao_check
      check (situacao in ('AGENDADO', 'ENVIADO', 'PULADO', 'FALHOU', 'CANCELADO'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'atendimento_disparos_nota_check') then
    alter table public.atendimento_disparos add constraint atendimento_disparos_nota_check check (nota is null or nota between 1 and 5);
  end if;
end $$;
create index if not exists atendimento_disparos_fila_idx on public.atendimento_disparos (situacao, agendado_para) where situacao = 'AGENDADO';
create index if not exists atendimento_disparos_hotel_idx on public.atendimento_disparos (hotel_id, criado_em desc);
create index if not exists atendimento_disparos_conversa_idx on public.atendimento_disparos (conversa_id, enviado_em desc);

-- ---------------------------------------------------------------------------
-- 3) Colunas novas
-- ---------------------------------------------------------------------------
alter table public.atendimento_contatos
  add column if not exists sem_automacoes    boolean not null default false,  -- respondeu "SAIR"
  add column if not exists sem_automacoes_em timestamptz;
alter table public.atendimento_conversas
  add column if not exists resolvida_em timestamptz;
alter table public.atendimento_mensagens
  add column if not exists automacao_id bigint;
alter table public.atendimento_automacoes
  add column if not exists ligado_em timestamptz;

-- Hora em que a conversa foi resolvida (para a pesquisa de satisfação)
create or replace function public.atendimento_marcar_resolvida()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'RESOLVIDA' and old.status is distinct from 'RESOLVIDA' then
    new.resolvida_em := now();
  end if;
  return new;
end;
$$;
drop trigger if exists atendimento_marcar_resolvida on public.atendimento_conversas;
create trigger atendimento_marcar_resolvida
  before update on public.atendimento_conversas
  for each row execute function public.atendimento_marcar_resolvida();
revoke all on function public.atendimento_marcar_resolvida() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) Painel das automações
-- ---------------------------------------------------------------------------
create or replace function public.atendimento_painel_automacoes(p_hoteis bigint[], p_inicio date, p_fim date)
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
    select coalesce(array_agg(h), '{}') into v_hoteis
      from (select public.atendimento_hoteis() as h) x
     where h = any(p_hoteis) and public.atendimento_sou_admin(h);
  end if;
  if coalesce(array_length(v_hoteis, 1), 0) = 0 then
    return null;
  end if;

  with d as (
    select d.*,
           exists (select 1 from public.atendimento_mensagens m
                    where m.conversa_id = d.conversa_id and m.direcao = 'ENTRADA'
                      and m.criado_em > d.enviado_em and m.criado_em < d.enviado_em + interval '48 hours') as respondeu,
           (select c.reserva_valor from public.atendimento_cotacoes c
             where c.id = d.cotacao_id and c.status = 'RESERVOU' and c.reservou_em > d.enviado_em) as valor_reserva
      from public.atendimento_disparos d
     where d.hotel_id = any(v_hoteis) and d.criado_em >= v_ini and d.criado_em < v_fim
  ),
  notas as (
    select d.*, c.responsavel_id, coalesce(c.robo_atendeu, false) and c.responsavel_id is null as so_robo
      from public.atendimento_disparos d
      join public.atendimento_conversas c on c.id = d.conversa_id
     where d.hotel_id = any(v_hoteis) and d.nota is not null and d.nota_em >= v_ini and d.nota_em < v_fim
  )
  select jsonb_build_object(
    'por_tipo', (select coalesce(jsonb_object_agg(tipo, x), '{}'::jsonb) from (
        select tipo, jsonb_build_object(
          'agendados', count(*) filter (where situacao = 'AGENDADO'),
          'enviados',  count(*) filter (where situacao = 'ENVIADO'),
          'pulados',   count(*) filter (where situacao = 'PULADO'),
          'falhas',    count(*) filter (where situacao = 'FALHOU'),
          'respostas', count(*) filter (where situacao = 'ENVIADO' and respondeu),
          'reservas',  count(*) filter (where valor_reserva is not null),
          'valor',     coalesce(sum(valor_reserva), 0)) as x
          from d group by tipo) t),
    'notas', jsonb_build_object(
      'quantidade', (select count(*) from notas),
      'media', (select round(avg(nota)::numeric, 2) from notas),
      'por_atendente', (select coalesce(jsonb_agg(jsonb_build_object('id', responsavel_id, 'quantidade', n, 'media', m)), '[]'::jsonb)
                          from (select responsavel_id, count(*) n, round(avg(nota)::numeric, 2) m from notas where responsavel_id is not null group by 1) a),
      'robo', (select jsonb_build_object('quantidade', count(*), 'media', round(avg(nota)::numeric, 2)) from notas where so_robo))
  ) into v_saida;
  return v_saida;
end;
$$;

revoke all on function public.atendimento_painel_automacoes(bigint[], date, date) from public, anon;
grant execute on function public.atendimento_painel_automacoes(bigint[], date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5) Segurança (RLS): só o ADMIN do hotel vê; quem grava é o servidor
-- ---------------------------------------------------------------------------
alter table public.atendimento_automacoes enable row level security;
alter table public.atendimento_disparos   enable row level security;

drop policy if exists atendimento_automacoes_admin on public.atendimento_automacoes;
create policy atendimento_automacoes_admin on public.atendimento_automacoes
  for select to authenticated using (public.atendimento_sou_admin(hotel_id));
drop policy if exists atendimento_disparos_admin on public.atendimento_disparos;
create policy atendimento_disparos_admin on public.atendimento_disparos
  for select to authenticated using (public.atendimento_sou_admin(hotel_id));

revoke all on public.atendimento_automacoes, public.atendimento_disparos from anon, authenticated;
grant select on public.atendimento_automacoes, public.atendimento_disparos to authenticated;
grant all on public.atendimento_automacoes, public.atendimento_disparos to service_role;
grant usage, select on sequence public.atendimento_automacoes_id_seq, public.atendimento_disparos_id_seq to service_role;
