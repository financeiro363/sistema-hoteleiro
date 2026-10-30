-- ============================================================================
-- FICHAS DE EPI (Administração → Fichas de EPI) — 30/10/2026
-- ============================================================================
-- Cada linha é uma Ficha de Controle de EPI: o colaborador, os EPIs entregues
-- (quantidade, descrição, validade, CA e ANVISA) e a data. Nome, função, setor
-- e hotel ficam copiados na ficha, para a reimpressão sair igual mesmo que o
-- cadastro mude depois.
--   impresso_em / impressoes → quando foi impressa (e quantas vezes)
--   devolvida_em / devolvida_por_* → baixa: a ficha voltou assinada
-- Só o ADMIN do hotel vê e mexe (mesma regra das outras telas de Administração).
-- Não muda nenhuma tabela que já existe. Pode rodar mais de uma vez.
-- ============================================================================

create table if not exists public.epi_fichas (
  id                 bigserial primary key,
  hotel_id           bigint not null references public.hoteis(id) on delete cascade,
  colaborador_nome   text not null check (length(trim(colaborador_nome)) between 1 and 200),
  funcao             text check (funcao is null or length(funcao) <= 120),
  setor              text check (setor is null or length(setor) <= 120),
  hotel_nome         text check (hotel_nome is null or length(hotel_nome) <= 200),
  data_entrega       date not null default ((now() at time zone 'America/Fortaleza')::date),
  itens              jsonb not null default '[]'::jsonb,
  impresso_em        timestamptz,
  impressoes         int not null default 0 check (impressoes >= 0),
  devolvida_em       timestamptz,
  devolvida_por_id   bigint references public.usuarios(id) on delete set null,
  devolvida_por_nome text,
  criado_por_id      bigint references public.usuarios(id) on delete set null,
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now(),
  -- de 1 a 18 EPIs (o que cabe na folha)
  constraint epi_fichas_itens_validos check (jsonb_typeof(itens) = 'array' and jsonb_array_length(itens) between 1 and 18),
  -- só dá baixa em ficha que já foi impressa
  constraint epi_fichas_baixa_depois_de_imprimir check (devolvida_em is null or impresso_em is not null)
);

-- Ligação com o cadastro de Funcionários (do Ponto), com o mesmo tipo do id de
-- lá. Se o funcionário for excluído, a ficha continua, com o nome copiado.
do $$
declare
  v_tipo text;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'epi_fichas' and column_name = 'funcionario_id') then
    select format_type(a.atttypid, a.atttypmod) into v_tipo
      from pg_attribute a
     where a.attrelid = 'public.funcionarios'::regclass and a.attname = 'id' and not a.attisdropped;
    execute format('alter table public.epi_fichas add column funcionario_id %s references public.funcionarios(id) on delete set null', v_tipo);
  end if;
end $$;

create index if not exists epi_fichas_hotel_idx on public.epi_fichas (hotel_id, criado_em desc);
create index if not exists epi_fichas_funcionario_idx on public.epi_fichas (funcionario_id);

-- Só o ADMIN do hotel (o hotel escolhido no topo) vê e mexe
alter table public.epi_fichas enable row level security;
drop policy if exists epi_fichas_admin on public.epi_fichas;
create policy epi_fichas_admin on public.epi_fichas
  for all to authenticated
  using (public.atendimento_sou_admin(hotel_id))
  with check (public.atendimento_sou_admin(hotel_id));

revoke all on public.epi_fichas from anon;
grant select, insert, update, delete on public.epi_fichas to authenticated;
grant all on public.epi_fichas to service_role;
grant usage, select on sequence public.epi_fichas_id_seq to authenticated, service_role;

-- Conferência: deve mostrar tabela_criada = true e trava_ligada = true
select exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'epi_fichas') as tabela_criada,
       (select relrowsecurity from pg_class where oid = 'public.epi_fichas'::regclass) as trava_ligada;
