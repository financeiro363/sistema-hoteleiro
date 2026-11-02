-- ============================================================================
-- GOVERNANÇA — etapa 3 (pedidos especiais, avisos no celular, bloqueio pela
-- Manutenção)
-- ============================================================================
-- Não apaga nem muda nenhum dado. Pode rodar mais de uma vez.
-- Precisa do SQL da etapa 2 (função governanca_papel).
--   governanca_pedidos → pedido especial da recepção (toalha extra...)
--   push_inscricoes    → celulares que recebem aviso (só o servidor lê)
--   manutencoes        → quarto do chamado e se ele tirou o quarto da venda
-- ============================================================================

-- 1) Pedidos especiais
create table if not exists public.governanca_pedidos (
  id                 bigserial primary key,
  hotel_id           bigint not null references public.hoteis(id) on delete cascade,
  quarto_numero      text not null,
  tipo               text not null check (tipo in ('TOALHA_BANHO', 'TOALHA_ROSTO', 'ENXOVAL', 'TRAVESSEIRO', 'COBERTOR', 'AMENITIES', 'ARRUMACAO', 'OUTRO')),
  quantidade         int not null default 1 check (quantidade between 1 and 20),
  descricao          text check (descricao is null or length(descricao) <= 300),
  situacao           text not null default 'NOVO' check (situacao in ('NOVO', 'A_CAMINHO', 'ENTREGUE', 'CANCELADO')),
  avisadas           bigint[] not null default '{}',
  avisos_enviados    int not null default 0,
  criado_por_id      bigint references public.usuarios(id) on delete set null,
  criado_por_nome    text,
  criado_em          timestamptz not null default now(),
  atendido_por_id    bigint references public.usuarios(id) on delete set null,
  atendido_por_nome  text,
  a_caminho_em       timestamptz,
  entregue_em        timestamptz,
  cancelado_em       timestamptz
);
do $$
declare
  v_tipo text;
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'governanca_pedidos' and column_name = 'quarto_id') then
    select format_type(a.atttypid, a.atttypmod) into v_tipo from pg_attribute a
     where a.attrelid = 'public.quartos'::regclass and a.attname = 'id' and not a.attisdropped;
    execute format('alter table public.governanca_pedidos add column quarto_id %s references public.quartos(id) on delete set null', v_tipo);
  end if;
  -- Manutenção: quarto do chamado (mesmo tipo do id de quartos)
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'manutencoes' and column_name = 'quarto_id') then
    select format_type(a.atttypid, a.atttypmod) into v_tipo from pg_attribute a
     where a.attrelid = 'public.quartos'::regclass and a.attname = 'id' and not a.attisdropped;
    execute format('alter table public.manutencoes add column quarto_id %s references public.quartos(id) on delete set null', v_tipo);
  end if;
end $$;
create index if not exists governanca_pedidos_hotel_idx on public.governanca_pedidos (hotel_id, criado_em desc);

alter table public.manutencoes add column if not exists tira_da_venda boolean not null default false;

-- 2) Celulares inscritos para receber aviso (Web Push)
create table if not exists public.push_inscricoes (
  id             bigserial primary key,
  hotel_id       bigint not null references public.hoteis(id) on delete cascade,
  usuario_id     bigint not null references public.usuarios(id) on delete cascade,
  endpoint       text not null unique check (length(endpoint) <= 1000),
  p256dh         text not null check (length(p256dh) <= 200),
  auth           text not null check (length(auth) <= 100),
  aparelho       text check (aparelho is null or length(aparelho) <= 300),
  criado_em      timestamptz not null default now(),
  ultimo_aviso_em timestamptz
);
create index if not exists push_inscricoes_usuario_idx on public.push_inscricoes (hotel_id, usuario_id);

-- Trava: pedidos todo o hotel lê (quem grava é o servidor); inscrições só o servidor
alter table public.governanca_pedidos enable row level security;
alter table public.push_inscricoes enable row level security;
drop policy if exists governanca_pedidos_ler on public.governanca_pedidos;
create policy governanca_pedidos_ler on public.governanca_pedidos for select to authenticated
  using (public.governanca_papel(hotel_id) is not null);

revoke all on public.governanca_pedidos, public.push_inscricoes from anon, authenticated;
grant select on public.governanca_pedidos to authenticated;
grant all on public.governanca_pedidos, public.push_inscricoes to service_role;
grant usage, select on sequence public.governanca_pedidos_id_seq, public.push_inscricoes_id_seq to service_role;

-- Tempo real: a camareira vê o pedido na hora (com a tela aberta)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'governanca_pedidos') then
    alter publication supabase_realtime add table public.governanca_pedidos;
  end if;
end $$;

-- Conferência: tudo true
select
  exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'governanca_pedidos') as pedidos,
  exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'push_inscricoes') as avisos_celular,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'manutencoes' and column_name = 'quarto_id') as manutencao_quarto,
  (select relrowsecurity from pg_class where oid = 'public.push_inscricoes'::regclass) as trava_ligada,
  exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'governanca_pedidos') as tempo_real;
