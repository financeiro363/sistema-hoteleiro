-- ============================================================================
-- CONTEÚDO DO ROBÔ PELO SITE E POR PDF — Etapa 6 (M21)
-- ============================================================================
-- Não apaga nem muda nenhum dado. Pode rodar mais de uma vez.
-- Precisa do SQL do robô (Fase 4) e das etapas anteriores.
--   1) atendimento_robo_fontes     → páginas do site e PDFs que valem como fonte
--   2) atendimento_robo_sugestoes  → o que a IA achou de novo ou diferente,
--                                    para a equipe aceitar ou recusar
-- Quem grava é só o servidor (as telas leem pelo próprio sistema).
-- ============================================================================

create table if not exists public.atendimento_robo_fontes (
  id           bigserial primary key,
  hotel_id     bigint not null references public.hoteis(id) on delete cascade,
  tipo         text not null check (tipo in ('SITE', 'PDF')),
  nome         text not null,
  url          text,                       -- página do site
  caminho      text,                       -- PDF guardado na pasta de anexos
  texto        text,                       -- último texto lido
  marca        text,                       -- "impressão digital" do texto (saber se mudou)
  caracteres   integer,
  situacao     text not null default 'NOVA' check (situacao in ('NOVA', 'OK', 'MUDOU', 'ERRO')),
  erro         text,
  conferida_em timestamptz,
  mudou_em     timestamptz,
  sugerida_em  timestamptz,
  ativa        boolean not null default true,
  criado_por   bigint,
  criado_em    timestamptz not null default now(),
  check ((tipo = 'SITE' and url is not null) or (tipo = 'PDF' and caminho is not null))
);
create index if not exists atendimento_robo_fontes_hotel_idx on public.atendimento_robo_fontes (hotel_id);
create index if not exists atendimento_robo_fontes_conferir_idx on public.atendimento_robo_fontes (conferida_em) where ativa and tipo = 'SITE';
alter table public.atendimento_robo_fontes enable row level security;
revoke all on public.atendimento_robo_fontes from anon, authenticated;
grant all on public.atendimento_robo_fontes to service_role;
grant usage, select on sequence public.atendimento_robo_fontes_id_seq to service_role;

create table if not exists public.atendimento_robo_sugestoes (
  id             bigserial primary key,
  hotel_id       bigint not null references public.hoteis(id) on delete cascade,
  fonte_id       bigint references public.atendimento_robo_fontes(id) on delete set null,
  tipo           text not null check (tipo in ('NOVO', 'MUDOU')),
  assunto        text not null,
  trecho_atual   text,
  trecho_fonte   text,
  texto_sugerido text not null,
  explicacao     text,
  situacao       text not null default 'PENDENTE' check (situacao in ('PENDENTE', 'ACEITA', 'RECUSADA')),
  decidido_por   bigint,
  decidido_em    timestamptz,
  criado_em      timestamptz not null default now()
);
create index if not exists atendimento_robo_sugestoes_hotel_idx on public.atendimento_robo_sugestoes (hotel_id, situacao);
alter table public.atendimento_robo_sugestoes enable row level security;
revoke all on public.atendimento_robo_sugestoes from anon, authenticated;
grant all on public.atendimento_robo_sugestoes to service_role;
grant usage, select on sequence public.atendimento_robo_sugestoes_id_seq to service_role;

-- Conferência: tudo true
select
  exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'atendimento_robo_fontes') as fontes,
  exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'atendimento_robo_sugestoes') as sugestoes;
