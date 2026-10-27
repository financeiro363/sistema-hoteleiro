-- ============================================================================
-- SOLICITAÇÕES — números claros (27/10/2026)           (pode rodar várias vezes)
-- ============================================================================
-- Rodar DEPOIS do sql/correcoes_2026_10_27.sql.
--
--  1. Começa do zero: tudo o que aconteceu nas solicitações ANTES deste SQL
--     conta como já visto. Sem isso, a bolinha vermelha contava a história
--     inteira (todas as solicitações antigas, que ninguém tinha "aberto" pelo
--     sistema novo). Isso é feito uma vez só, mesmo rodando o SQL de novo.
--  2. "Marcar todas como vistas": limpa as novidades do hotel escolhido no topo.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Começar do zero (uma vez só)
-- ---------------------------------------------------------------------------
create table if not exists public.tarefas_leituras_inicio (
  id        integer primary key default 1 check (id = 1),
  feito_em  timestamptz not null default now()
);
alter table public.tarefas_leituras_inicio enable row level security;
revoke all on public.tarefas_leituras_inicio from public, anon, authenticated;
grant all on public.tarefas_leituras_inicio to service_role;

do $$
begin
  if not exists (select 1 from public.tarefas_leituras_inicio) then
    insert into public.tarefas_leituras (task_id, usuario_id, visto_em)
    select x.task_id, x.usuario_id, now()
      from (
        select t.id::bigint as task_id, t.criado_por_id::bigint as usuario_id from public.tarefas t where t.criado_por_id is not null
        union
        select t.id::bigint, t.responsavel_atual_id::bigint from public.tarefas t where t.responsavel_atual_id is not null
      ) x
    on conflict (task_id, usuario_id) do update set visto_em = greatest(public.tarefas_leituras.visto_em, excluded.visto_em);
    insert into public.tarefas_leituras_inicio (id) values (1);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Marcar todas como vistas (hotel escolhido no topo)
-- ---------------------------------------------------------------------------
create or replace function public.solicitacoes_marcar_todas_vistas()
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_eu    bigint;
  v_hotel bigint;
  v_qtd   integer;
begin
  select u.id, u.hotel_id into v_eu, v_hotel
    from public.usuarios u where u.auth_id = auth.uid() and coalesce(u.ativo, true)
   limit 1;
  if v_eu is null then
    return 0;
  end if;
  insert into public.tarefas_leituras (task_id, usuario_id, visto_em)
  select t.id::bigint, v_eu, now()
    from public.tarefas t
   where t.hotel_id = v_hotel
     and (t.criado_por_id = v_eu or t.responsavel_atual_id = v_eu)
  on conflict (task_id, usuario_id) do update set visto_em = excluded.visto_em;
  get diagnostics v_qtd = row_count;
  return v_qtd;
end;
$$;
revoke all on function public.solicitacoes_marcar_todas_vistas() from public, anon;
grant execute on function public.solicitacoes_marcar_todas_vistas() to authenticated;
