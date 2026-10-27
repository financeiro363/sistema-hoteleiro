-- ============================================================================
-- CORREÇÕES DE 27/10/2026                                   (pode rodar várias vezes)
-- ============================================================================
--  1. Sala de Reunião: pagamento só com a data de hoje (para todos).
--  2. Caixa de Entrada: cada pessoa vê só o hotel escolhido no topo da página
--     (quem trabalha nos dois hotéis troca o hotel para ver o outro).
--  3. Respostas prontas: só o ADMIN cria, edita e exclui (todos continuam
--     usando na conversa).
--  4. Solicitações: "novidades" — a bolinha vermelha aparece quando a
--     solicitação é criada, encaminhada, comentada ou muda de situação, até a
--     pessoa abrir a solicitação.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Sala de Reunião: nada de pagamento com data anterior a hoje
-- ---------------------------------------------------------------------------
create or replace function public.sala_pagamento_so_hoje()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.data_pagamento is not null
     and new.data_pagamento::date < (now() at time zone 'America/Fortaleza')::date then
    raise exception 'O pagamento só pode ser lançado com a data de hoje.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.sala_pagamento_so_hoje() from public, anon, authenticated;

do $$
begin
  if to_regclass('public.reservas_sala_pagamentos') is not null then
    execute 'drop trigger if exists sala_pagamento_so_hoje on public.reservas_sala_pagamentos';
    execute 'create trigger sala_pagamento_so_hoje before insert on public.reservas_sala_pagamentos
               for each row execute function public.sala_pagamento_so_hoje()';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Caixa de Entrada: só o hotel atual (o escolhido no topo)
-- ---------------------------------------------------------------------------
-- "usuarios.hotel_id" e "usuarios.papel" já mudam quando a pessoa troca de
-- hotel no topo da página. Antes, as funções juntavam também os outros hotéis
-- do vínculo; agora valem só para o hotel atual. Todas as regras de acesso
-- (RLS) da Caixa de Entrada usam estas duas funções.
create or replace function public.atendimento_hoteis()
returns setof bigint
language sql
stable
security definer
set search_path = public
as $$
  select u.hotel_id::bigint
    from public.usuarios u
   where u.auth_id = auth.uid()
     and coalesce(u.ativo, true)
     and (u.papel = 'ADMIN' or (u.papel = 'COLABORADOR' and u.pode_acessar_atendimento is true));
$$;

create or replace function public.atendimento_sou_admin(p_hotel bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.usuarios u
                  where u.auth_id = auth.uid() and coalesce(u.ativo, true)
                    and u.papel = 'ADMIN' and u.hotel_id::bigint = p_hotel);
$$;

revoke all on function public.atendimento_hoteis() from public, anon;
revoke all on function public.atendimento_sou_admin(bigint) from public, anon;
grant execute on function public.atendimento_hoteis() to authenticated, service_role;
grant execute on function public.atendimento_sou_admin(bigint) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) Respostas prontas: todos usam; só o ADMIN muda
-- ---------------------------------------------------------------------------
drop policy if exists atendimento_respostas_todas on public.atendimento_respostas_prontas;
drop policy if exists atendimento_respostas_ver on public.atendimento_respostas_prontas;
create policy atendimento_respostas_ver on public.atendimento_respostas_prontas
  for select to authenticated using (hotel_id in (select public.atendimento_hoteis()));
drop policy if exists atendimento_respostas_admin on public.atendimento_respostas_prontas;
create policy atendimento_respostas_admin on public.atendimento_respostas_prontas
  for all to authenticated
  using (public.atendimento_sou_admin(hotel_id)) with check (public.atendimento_sou_admin(hotel_id));

-- ---------------------------------------------------------------------------
-- 4) Solicitações: o que cada pessoa já viu
-- ---------------------------------------------------------------------------
create table if not exists public.tarefas_leituras (
  task_id    bigint not null,
  usuario_id bigint not null,
  visto_em   timestamptz not null default now(),
  primary key (task_id, usuario_id)
);
alter table public.tarefas_leituras enable row level security;
-- Ninguém mexe nesta tabela direto: só as duas funções abaixo (que usam a
-- pessoa logada e a hora do banco, para o relógio do celular não atrapalhar).
drop policy if exists tarefas_leituras_minhas on public.tarefas_leituras;
revoke all on public.tarefas_leituras from public, anon, authenticated;
grant all on public.tarefas_leituras to service_role;

-- "Abri a solicitação": guarda a hora em que a pessoa logada viu.
create or replace function public.solicitacoes_marcar_vista(p_task bigint)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_eu bigint;
begin
  select u.id into v_eu
    from public.usuarios u where u.auth_id = auth.uid() and coalesce(u.ativo, true)
   limit 1;
  if v_eu is null or p_task is null
     or not exists (select 1 from public.tarefas t where t.id = p_task) then
    return;
  end if;
  insert into public.tarefas_leituras (task_id, usuario_id, visto_em)
  values (p_task, v_eu, now())
  on conflict (task_id, usuario_id) do update set visto_em = excluded.visto_em;
end;
$$;
revoke all on function public.solicitacoes_marcar_vista(bigint) from public, anon;
grant execute on function public.solicitacoes_marcar_vista(bigint) to authenticated;

-- Novidades da pessoa logada: solicitações que ela criou ou que estão com ela
-- e tiveram alguma ação de OUTRA pessoa (criou, encaminhou, comentou, mudou a
-- situação, concluiu…) depois da última vez que ela abriu a solicitação.
-- Devolve:
--   novidades → nº das solicitações do hotel atual com novidade
--   abertas   → nº das solicitações do hotel atual que estão com a pessoa e não terminaram
--   outros    → por hotel (os outros hotéis da pessoa): quantas têm novidade ou estão abertas com ela
create or replace function public.solicitacoes_novidades()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_eu    bigint;
  v_hotel bigint;
  v_saida jsonb;
begin
  select u.id, u.hotel_id into v_eu, v_hotel
    from public.usuarios u where u.auth_id = auth.uid() and coalesce(u.ativo, true)
   limit 1;
  if v_eu is null then
    return null;
  end if;

  with meus_hoteis as (
    select v_hotel as hotel_id
    union
    select v.hotel_id::bigint from public.vinculos_usuario_hotel v
     where v.auth_id = auth.uid() and v.ativo is true
  ),
  minhas as (
    select t.id::bigint as id, t.hotel_id::bigint as hotel_id,
           (t.responsavel_atual_id = v_eu and coalesce(t.status, '') not in ('Concluído', 'Cancelado')) as aberta_comigo,
           exists (select 1 from public.tarefas_historico h
                    where h.task_id = t.id and h.usuario_id is distinct from v_eu
                      and h.data_hora > coalesce((select l.visto_em from public.tarefas_leituras l
                                                   where l.task_id = t.id and l.usuario_id = v_eu), '-infinity'::timestamptz)) as novidade
      from public.tarefas t
     where t.hotel_id in (select hotel_id from meus_hoteis)
       and (t.responsavel_atual_id = v_eu or t.criado_por_id = v_eu)
  )
  select jsonb_build_object(
    'hotel', v_hotel,
    'novidades', coalesce((select jsonb_agg(id order by id) from minhas where novidade and hotel_id = v_hotel), '[]'::jsonb),
    'abertas', coalesce((select jsonb_agg(id order by id) from minhas where aberta_comigo and hotel_id = v_hotel), '[]'::jsonb),
    'outros', coalesce((select jsonb_agg(jsonb_build_object('hotel_id', m.hotel_id, 'nome', h.nome_fantasia, 'quantidade', m.n) order by m.hotel_id)
                          from (select hotel_id, count(*) as n from minhas
                                 where hotel_id <> v_hotel and (novidade or aberta_comigo) group by hotel_id) m
                          left join public.hoteis h on h.id = m.hotel_id), '[]'::jsonb)
  ) into v_saida;
  return v_saida;
end;
$$;
revoke all on function public.solicitacoes_novidades() from public, anon;
grant execute on function public.solicitacoes_novidades() to authenticated;

-- Avisos na hora: o histórico das solicitações também entra no tempo real
do $$
begin
  if to_regclass('public.tarefas_historico') is not null
     and exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tarefas_historico') then
    execute 'alter publication supabase_realtime add table public.tarefas_historico';
  end if;
end $$;
