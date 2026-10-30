-- ============================================================================
-- RECEBIMENTO DE DOCUMENTOS DOS COLABORADORES — 30/10/2026
-- (Administração → Documentos dos Colaboradores → Recebimento de documentos)
-- ============================================================================
-- Substitui a planilha "Confirmação de recebimento de e-mail — contracheque".
--   documentos_rodadas      → um pagamento (do mês ou quinzena), com a data e
--                             os documentos que precisam voltar
--   documentos_recebimentos → uma linha por colaborador × documento, com a
--                             situação (OK, Falta, Férias, Licença, Demitido)
--                             ou vazia (ainda não conferida), e quem marcou
-- Só o ADMIN do hotel vê e mexe (mesma regra das outras telas de Administração).
-- Não muda nenhuma tabela que já existe. Pode rodar mais de uma vez.
-- ============================================================================

create table if not exists public.documentos_rodadas (
  id             bigserial primary key,
  hotel_id       bigint not null references public.hoteis(id) on delete cascade,
  tipo           text not null check (tipo in ('MES', 'QUINZENA')),
  data_pagamento date not null,
  documentos     text[] not null check (
                   cardinality(documentos) between 1 and 10
                   and documentos <@ array['EMAIL_CONTRACHEQUE', 'FOLHA_PONTO', 'FOLHA_ALIMENTACAO', 'BANCO_HORAS']::text[]),
  observacao     text check (observacao is null or length(observacao) <= 500),
  criado_por_id  bigint references public.usuarios(id) on delete set null,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  constraint documentos_rodadas_id_hotel unique (id, hotel_id),
  -- o mesmo pagamento não é criado duas vezes
  constraint documentos_rodadas_unica unique (hotel_id, tipo, data_pagamento)
);

create table if not exists public.documentos_recebimentos (
  id               bigserial primary key,
  rodada_id        bigint not null,
  hotel_id         bigint not null,
  colaborador_nome text not null check (length(trim(colaborador_nome)) between 1 and 200),
  documento        text not null check (documento in ('EMAIL_CONTRACHEQUE', 'FOLHA_PONTO', 'FOLHA_ALIMENTACAO', 'BANCO_HORAS')),
  situacao         text check (situacao is null or situacao in ('OK', 'FALTA', 'FERIAS', 'LICENCA', 'DEMITIDO')),
  marcado_em       timestamptz,
  marcado_por_id   bigint references public.usuarios(id) on delete set null,
  marcado_por_nome text,
  criado_em        timestamptz not null default now(),
  -- a linha é sempre do mesmo hotel do pagamento
  constraint documentos_recebimentos_rodada_fk foreign key (rodada_id, hotel_id)
    references public.documentos_rodadas (id, hotel_id) on delete cascade
);

-- Ligação com o cadastro de Funcionários (do Ponto), com o mesmo tipo do id de
-- lá. Se o funcionário for excluído, as linhas continuam, com o nome copiado.
do $$
declare
  v_tipo text;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'documentos_recebimentos' and column_name = 'funcionario_id') then
    select format_type(a.atttypid, a.atttypmod) into v_tipo
      from pg_attribute a
     where a.attrelid = 'public.funcionarios'::regclass and a.attname = 'id' and not a.attisdropped;
    execute format('alter table public.documentos_recebimentos add column funcionario_id %s references public.funcionarios(id) on delete set null', v_tipo);
  end if;
end $$;

create index if not exists documentos_rodadas_hotel_idx on public.documentos_rodadas (hotel_id, data_pagamento desc);
create index if not exists documentos_recebimentos_rodada_idx on public.documentos_recebimentos (rodada_id);
create index if not exists documentos_recebimentos_hotel_idx on public.documentos_recebimentos (hotel_id);
-- cada colaborador aparece uma vez por documento em cada pagamento
create unique index if not exists documentos_recebimentos_unico
  on public.documentos_recebimentos (rodada_id, documento, funcionario_id);

-- Só o ADMIN do hotel (o hotel escolhido no topo) vê e mexe
alter table public.documentos_rodadas enable row level security;
drop policy if exists documentos_rodadas_admin on public.documentos_rodadas;
create policy documentos_rodadas_admin on public.documentos_rodadas
  for all to authenticated
  using (public.atendimento_sou_admin(hotel_id))
  with check (public.atendimento_sou_admin(hotel_id));

alter table public.documentos_recebimentos enable row level security;
drop policy if exists documentos_recebimentos_admin on public.documentos_recebimentos;
create policy documentos_recebimentos_admin on public.documentos_recebimentos
  for all to authenticated
  using (public.atendimento_sou_admin(hotel_id))
  with check (public.atendimento_sou_admin(hotel_id));

revoke all on public.documentos_rodadas, public.documentos_recebimentos from anon;
grant select, insert, update, delete on public.documentos_rodadas, public.documentos_recebimentos to authenticated;
grant all on public.documentos_rodadas, public.documentos_recebimentos to service_role;
grant usage, select on sequence public.documentos_rodadas_id_seq, public.documentos_recebimentos_id_seq to authenticated, service_role;

-- Conferência: deve mostrar tabelas = 2 e travas_ligadas = 2
select count(*) as tabelas, count(*) filter (where c.relrowsecurity) as travas_ligadas
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname in ('documentos_rodadas', 'documentos_recebimentos');
