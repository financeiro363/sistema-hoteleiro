-- ============================================================================
-- GOVERNANÇA — etapa 2 (escala do dia, distribuição, vistoria, enxoval)
-- ============================================================================
-- Não apaga nem muda nenhum dado. Pode rodar mais de uma vez.
--   governanca_escala            → quem veio hoje e em que andar(es) fica
--   governanca_vistorias         → vistoria da governanta (aprovado/reprovado)
--   governanca_camareira_cloudbeds → qual camareira daqui é qual camareira
--                                  ("housekeeper") lá na Cloudbeds
--   quartos.andar                → andar do quarto (vazio = sai do número)
--   governanca_sessoes.tipo      → SAIDA ou OCUPADO (produtividade por tipo)
--   estoque_produtos.enxoval     → marca lençol, toalha, fronha... como enxoval
-- Quem lê: todos do hotel. Quem grava escala e vistoria: ADMIN e COLABORADOR.
-- ============================================================================

-- Papel da pessoa logada NESTE hotel (ou null se não for do hotel)
create or replace function public.governanca_papel(p_hotel bigint)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select u.papel from public.usuarios u
      where u.auth_id = auth.uid() and coalesce(u.ativo, true) and u.hotel_id::bigint = p_hotel limit 1),
    (select v.papel from public.vinculos_usuario_hotel v
      where v.auth_id = auth.uid() and v.ativo is true and v.hotel_id::bigint = p_hotel limit 1));
$$;
revoke all on function public.governanca_papel(bigint) from public, anon;
grant execute on function public.governanca_papel(bigint) to authenticated, service_role;

-- Colunas novas
alter table public.quartos add column if not exists andar smallint check (andar is null or andar between -5 and 200);
alter table public.governanca_sessoes add column if not exists tipo text check (tipo is null or tipo in ('SAIDA', 'OCUPADO'));
alter table public.estoque_produtos add column if not exists enxoval boolean not null default false;

-- 1) Escala do dia
create table if not exists public.governanca_escala (
  id               bigserial primary key,
  hotel_id         bigint not null references public.hoteis(id) on delete cascade,
  data             date not null,
  camareira_id     bigint not null references public.usuarios(id) on delete cascade,
  camareira_nome   text not null check (length(camareira_nome) <= 200),
  presente         boolean not null default true,
  andares          smallint[] not null default '{}',
  atualizado_por_id bigint references public.usuarios(id) on delete set null,
  atualizado_em    timestamptz not null default now(),
  unique (hotel_id, data, camareira_id)
);
create index if not exists governanca_escala_dia_idx on public.governanca_escala (hotel_id, data desc);

-- 2) Vistorias
create table if not exists public.governanca_vistorias (
  id                  bigserial primary key,
  hotel_id            bigint not null references public.hoteis(id) on delete cascade,
  quarto_numero       text not null,
  camareira_id        bigint references public.usuarios(id) on delete set null,
  camareira_nome      text,
  vistoriado_por_id   bigint references public.usuarios(id) on delete set null,
  vistoriado_por_nome text,
  resultado           text not null check (resultado in ('APROVADO', 'REPROVADO')),
  itens               jsonb not null default '[]'::jsonb check (jsonb_typeof(itens) = 'array'),
  observacao          text check (observacao is null or length(observacao) <= 500),
  criado_em           timestamptz not null default now()
);
-- Ligação com o quarto e com a arrumação, no mesmo tipo do id de lá
do $$
declare
  v_tipo text;
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'governanca_vistorias' and column_name = 'quarto_id') then
    select format_type(a.atttypid, a.atttypmod) into v_tipo from pg_attribute a
     where a.attrelid = 'public.quartos'::regclass and a.attname = 'id' and not a.attisdropped;
    execute format('alter table public.governanca_vistorias add column quarto_id %s references public.quartos(id) on delete set null', v_tipo);
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'governanca_vistorias' and column_name = 'sessao_id') then
    select format_type(a.atttypid, a.atttypmod) into v_tipo from pg_attribute a
     where a.attrelid = 'public.governanca_sessoes'::regclass and a.attname = 'id' and not a.attisdropped;
    execute format('alter table public.governanca_vistorias add column sessao_id %s references public.governanca_sessoes(id) on delete set null', v_tipo);
  end if;
end $$;
create index if not exists governanca_vistorias_dia_idx on public.governanca_vistorias (hotel_id, criado_em desc);

-- 3) Camareira daqui ↔ housekeeper da Cloudbeds
create table if not exists public.governanca_camareira_cloudbeds (
  id               bigserial primary key,
  hotel_id         bigint not null references public.hoteis(id) on delete cascade,
  usuario_id       bigint not null references public.usuarios(id) on delete cascade,
  housekeeper_id   text not null,
  housekeeper_nome text,
  atualizado_em    timestamptz not null default now(),
  unique (hotel_id, usuario_id)
);

-- Trava (RLS)
alter table public.governanca_escala enable row level security;
alter table public.governanca_vistorias enable row level security;
alter table public.governanca_camareira_cloudbeds enable row level security;

drop policy if exists governanca_escala_ler on public.governanca_escala;
create policy governanca_escala_ler on public.governanca_escala for select to authenticated
  using (public.governanca_papel(hotel_id) is not null);
drop policy if exists governanca_escala_gravar on public.governanca_escala;
create policy governanca_escala_gravar on public.governanca_escala for all to authenticated
  using (public.governanca_papel(hotel_id) in ('ADMIN', 'COLABORADOR'))
  with check (public.governanca_papel(hotel_id) in ('ADMIN', 'COLABORADOR'));

drop policy if exists governanca_vistorias_ler on public.governanca_vistorias;
create policy governanca_vistorias_ler on public.governanca_vistorias for select to authenticated
  using (public.governanca_papel(hotel_id) is not null);
drop policy if exists governanca_vistorias_gravar on public.governanca_vistorias;
create policy governanca_vistorias_gravar on public.governanca_vistorias for insert to authenticated
  with check (public.governanca_papel(hotel_id) in ('ADMIN', 'COLABORADOR'));

drop policy if exists governanca_camareira_cloudbeds_admin on public.governanca_camareira_cloudbeds;
create policy governanca_camareira_cloudbeds_admin on public.governanca_camareira_cloudbeds for all to authenticated
  using (public.atendimento_sou_admin(hotel_id))
  with check (public.atendimento_sou_admin(hotel_id));

revoke all on public.governanca_escala, public.governanca_vistorias, public.governanca_camareira_cloudbeds from anon;
grant select, insert, update, delete on public.governanca_escala, public.governanca_camareira_cloudbeds to authenticated;
grant select, insert on public.governanca_vistorias to authenticated;
grant all on public.governanca_escala, public.governanca_vistorias, public.governanca_camareira_cloudbeds to service_role;
grant usage, select on sequence public.governanca_escala_id_seq, public.governanca_vistorias_id_seq, public.governanca_camareira_cloudbeds_id_seq to authenticated, service_role;

-- Conferência: tudo true
select
  exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'governanca_escala') as escala,
  exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'governanca_vistorias') as vistorias,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'quartos' and column_name = 'andar') as andar,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'estoque_produtos' and column_name = 'enxoval') as enxoval,
  (select relrowsecurity from pg_class where oid = 'public.governanca_escala'::regclass)
    and (select relrowsecurity from pg_class where oid = 'public.governanca_vistorias'::regclass) as trava_ligada;
