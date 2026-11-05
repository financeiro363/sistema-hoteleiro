-- ============================================================================
-- NÚMEROS PARA O GESTOR — Etapa 2 (meta de vendas, resumo semanal por e-mail,
-- aviso no celular para a Manutenção, bloqueio feito na Cloudbeds)
-- ============================================================================
-- Não apaga nem muda nenhum dado. Pode rodar mais de uma vez.
-- Precisa dos SQL da Caixa de Entrada (Fase 2) e da Governança (etapas 1 a 3).
--   1) atendimento_metas        → meta de vendas em R$ por hotel e mês
--   2) atendimento_preferencias → resumo semanal (ligado e e-mails extras)
--      atendimento_resumos      → cada resumo enviado (não manda 2x na semana)
--   3) manutencoes              → controle dos avisos no celular
--   4) governanca_bloqueios_externos → bloqueios feitos direto na Cloudbeds
-- Quem grava é só o servidor (as telas leem pelo próprio sistema).
-- ============================================================================

-- 1) Meta de vendas ----------------------------------------------------------
create table if not exists public.atendimento_metas (
  hotel_id          bigint not null references public.hoteis(id) on delete cascade,
  mes               date not null,               -- sempre o dia 1 do mês
  valor             numeric(12,2) not null check (valor >= 0),
  atualizado_por_id bigint,
  atualizado_em     timestamptz not null default now(),
  primary key (hotel_id, mes)
);
alter table public.atendimento_metas enable row level security;
revoke all on public.atendimento_metas from anon, authenticated;
grant all on public.atendimento_metas to service_role;

-- 2) Resumo semanal ----------------------------------------------------------
alter table public.atendimento_preferencias
  add column if not exists resumo_semanal        boolean not null default true,
  add column if not exists resumo_emails_extras  text;
create table if not exists public.atendimento_resumos (
  id         bigserial primary key,
  hotel_id   bigint not null references public.hoteis(id) on delete cascade,
  semana     date not null,                      -- segunda-feira da semana resumida
  origem     text not null check (origem in ('AGENDADO', 'MANUAL')),
  para       text,
  enviado_em timestamptz,
  erro       text,
  criado_em  timestamptz not null default now()
);
create index if not exists atendimento_resumos_hotel_idx on public.atendimento_resumos (hotel_id, semana desc);
alter table public.atendimento_resumos enable row level security;
revoke all on public.atendimento_resumos from anon, authenticated;
grant all on public.atendimento_resumos to service_role;
grant usage, select on sequence public.atendimento_resumos_id_seq to service_role;

-- 3) Avisos da Manutenção -----------------------------------------------------
alter table public.manutencoes
  add column if not exists avisado_em      timestamptz,
  add column if not exists ultimo_aviso_em timestamptz,
  add column if not exists avisos_rodadas  integer not null default 0;

-- 4) Bloqueios feitos direto na Cloudbeds -------------------------------------
create table if not exists public.governanca_bloqueios_externos (
  id                 bigserial primary key,
  hotel_id           bigint not null references public.hoteis(id) on delete cascade,
  cloudbeds_block_id text not null,
  cloudbeds_room_id  text not null,
  tipo               text,
  motivo             text,
  inicio             date not null,
  fim                date not null,                -- dia em que o quarto volta
  removido_em        timestamptz,
  aplicado_em        timestamptz,                  -- quando virou "Interditado" aqui
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now(),
  unique (hotel_id, cloudbeds_block_id, cloudbeds_room_id)
);
create index if not exists governanca_bloqueios_externos_dia_idx on public.governanca_bloqueios_externos (hotel_id, inicio) where removido_em is null;
alter table public.governanca_bloqueios_externos enable row level security;
revoke all on public.governanca_bloqueios_externos from anon, authenticated;
grant all on public.governanca_bloqueios_externos to service_role;
grant usage, select on sequence public.governanca_bloqueios_externos_id_seq to service_role;

-- Inscrições do aviso de bloqueio na Cloudbeds (criado, mudou, removido)
alter table public.hoteis add column if not exists governanca_webhook_bloqueio_ids text[];

-- Conferência: tudo true
select
  exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'atendimento_metas') as metas,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'atendimento_preferencias' and column_name = 'resumo_semanal') as resumo,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'manutencoes' and column_name = 'avisos_rodadas') as avisos_manutencao,
  exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'governanca_bloqueios_externos') as bloqueios_cloudbeds;
