-- ============================================================================
-- GOVERNANÇA — saídas e chegadas do dia (rotina das 6h + botão do Painel)
-- ============================================================================
-- Não apaga nem muda nenhum dado. Pode rodar mais de uma vez.
-- Precisa do SQL da etapa 2 (função governanca_papel).
--   governanca_rotina_execucoes → cada vez que a rotina rodou e o resumo
--                                 (o Painel mostra a de hoje)
--   governanca_rotina_marcas    → o que a rotina já fez em cada quarto hoje,
--                                 para não desfazer o que a governanta mudou
-- Quem grava é só o servidor.
-- ============================================================================

create table if not exists public.governanca_rotina_execucoes (
  id                 bigserial primary key,
  hotel_id           bigint not null references public.hoteis(id) on delete cascade,
  data               date not null,
  origem             text not null check (origem in ('AGENDADA', 'MANUAL')),
  executado_por_nome text,
  executado_em       timestamptz not null default now(),
  resumo             jsonb not null default '{}'::jsonb,
  erro               text
);
create index if not exists governanca_rotina_execucoes_dia_idx on public.governanca_rotina_execucoes (hotel_id, data desc, executado_em desc);

create table if not exists public.governanca_rotina_marcas (
  id        bigserial primary key,
  hotel_id  bigint not null references public.hoteis(id) on delete cascade,
  data      date not null,
  tipo      text not null check (tipo in ('SAIDA', 'FICOU', 'SAIU', 'DIARIA', 'CHEGADA')),
  criado_em timestamptz not null default now()
);
do $$
declare
  v_tipo text;
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'governanca_rotina_marcas' and column_name = 'quarto_id') then
    select format_type(a.atttypid, a.atttypmod) into v_tipo from pg_attribute a
     where a.attrelid = 'public.quartos'::regclass and a.attname = 'id' and not a.attisdropped;
    execute format('alter table public.governanca_rotina_marcas add column quarto_id %s not null references public.quartos(id) on delete cascade', v_tipo);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'governanca_rotina_marcas_unica') then
    alter table public.governanca_rotina_marcas add constraint governanca_rotina_marcas_unica unique (hotel_id, data, quarto_id, tipo);
  end if;
end $$;

alter table public.governanca_rotina_execucoes enable row level security;
alter table public.governanca_rotina_marcas enable row level security;
drop policy if exists governanca_rotina_execucoes_ler on public.governanca_rotina_execucoes;
create policy governanca_rotina_execucoes_ler on public.governanca_rotina_execucoes for select to authenticated
  using (public.governanca_papel(hotel_id) is not null);

revoke all on public.governanca_rotina_execucoes, public.governanca_rotina_marcas from anon, authenticated;
grant select on public.governanca_rotina_execucoes to authenticated;
grant all on public.governanca_rotina_execucoes, public.governanca_rotina_marcas to service_role;
grant usage, select on sequence public.governanca_rotina_execucoes_id_seq, public.governanca_rotina_marcas_id_seq to service_role;

-- Conferência: tudo true
select
  exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'governanca_rotina_execucoes') as execucoes,
  exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'governanca_rotina_marcas') as marcas,
  (select relrowsecurity from pg_class where oid = 'public.governanca_rotina_marcas'::regclass) as trava_ligada;
