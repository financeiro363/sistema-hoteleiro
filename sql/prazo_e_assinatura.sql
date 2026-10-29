-- ============================================================================
-- CAIXA DE ENTRADA — PRAZO DE RESPOSTA (SLA) E NOME DO ATENDENTE   (pode rodar várias vezes)
-- ============================================================================
-- Rodar DEPOIS dos SQLs anteriores da Caixa de Entrada.
--
--  1. Esperas: cada vez que o cliente fica esperando resposta vira uma linha
--     (começo, fim e quem respondeu). A conversa guarda desde quando o
--     cliente espera (a 1ª mensagem sem resposta, e não a última): o
--     "esperando há…", o aviso vermelho e o filtro "Fora do prazo" usam isso.
--     Conta como resposta: mensagem de uma pessoa da equipe ou do robô.
--     NÃO conta: resposta do robô quando ele passa a conversa para a equipe
--     (a conversa fica pausada), mensagem automática (automações e campanhas)
--     e mensagem que falhou. Resolver sem responder fecha a espera.
--  2. Placar do Painel: % das mensagens respondidas dentro do prazo.
--     O prazo é o do aviso vermelho (Funil e etiquetas). Conta só as
--     mensagens que chegam no horário comercial e só os canais de conversa
--     (WhatsApp, chat do site, Instagram, Facebook); o e-mail fica de fora.
--  3. Nome do atendente na mensagem do WhatsApp: cada pessoa liga para si.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Esperas: cada vez que o cliente fica esperando resposta
-- ---------------------------------------------------------------------------
-- Uma linha por espera: começa na mensagem do cliente e termina na resposta
-- que conta (EQUIPE ou ROBO) ou quando a conversa é resolvida/arquivada sem
-- resposta (ENCERRADA). Só uma espera aberta por conversa.
create table if not exists public.atendimento_esperas (
  id                bigserial primary key,
  hotel_id          bigint not null references public.hoteis(id) on delete cascade,
  conversa_id       bigint not null references public.atendimento_conversas(id) on delete cascade,
  canal_tipo        text,
  inicio            timestamptz not null,
  primeira          boolean not null default false,  -- 1ª mensagem do cliente na conversa
  fora_horario      boolean not null default false,  -- começou fora do horário comercial
  fim               timestamptz,
  fim_tipo          text,
  respondido_por_id bigint,
  criado_em         timestamptz not null default now()
);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'atendimento_esperas_fim_tipo_check') then
    alter table public.atendimento_esperas add constraint atendimento_esperas_fim_tipo_check
      check (fim_tipo is null or fim_tipo in ('EQUIPE', 'ROBO', 'ENCERRADA'));
  end if;
end $$;
create index if not exists atendimento_esperas_hotel_idx on public.atendimento_esperas (hotel_id, inicio);
create unique index if not exists atendimento_esperas_aberta_idx on public.atendimento_esperas (conversa_id) where fim is null;

-- Só as funções do banco mexem nas esperas
alter table public.atendimento_esperas enable row level security;
revoke all on public.atendimento_esperas from anon, authenticated;
grant all on public.atendimento_esperas to service_role;
grant usage, select on sequence public.atendimento_esperas_id_seq to service_role;

-- Na conversa: desde quando o cliente espera (o "esperando há…", o aviso
-- vermelho e o filtro "Fora do prazo" usam isso)
alter table public.atendimento_conversas
  add column if not exists aguardando_desde timestamptz;
create index if not exists atendimento_conversas_aguardando_idx
  on public.atendimento_conversas (hotel_id, aguardando_desde)
  where aguardando_desde is not null;

-- Conta como resposta: mensagem de uma pessoa da equipe ou do robô que chegou
-- (não falhou). NÃO conta: o robô passando a conversa para a equipe (ela fica
-- pausada nessa hora) e mensagem automática (automações e campanhas: sem autor).
create or replace function public.atendimento_aguardando_mensagem()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  quando timestamptz := coalesce(new.data_original, new.criado_em, now());
  c      public.atendimento_conversas%rowtype;
  robo   boolean := coalesce(new.enviado_pelo_robo, false);
begin
  if new.direcao not in ('ENTRADA', 'SAIDA') then return new; end if;
  select * into c from public.atendimento_conversas where id = new.conversa_id;
  if c.id is null then return new; end if;

  if new.direcao = 'ENTRADA' then
    if not exists (select 1 from public.atendimento_esperas e where e.conversa_id = c.id and e.fim is null) then
      insert into public.atendimento_esperas (hotel_id, conversa_id, canal_tipo, inicio, primeira, fora_horario)
      values (c.hotel_id, c.id, c.canal_tipo, quando,
              not exists (select 1 from public.atendimento_mensagens m
                           where m.conversa_id = c.id and m.direcao = 'ENTRADA' and m.id <> new.id
                             and coalesce(m.data_original, m.criado_em) <= quando),
              public.atendimento_fora_do_horario(c.hotel_id, quando))
      on conflict do nothing;
    end if;
    update public.atendimento_conversas set aguardando_desde = least(coalesce(aguardando_desde, quando), quando) where id = c.id;
    return new;
  end if;

  -- SAIDA
  if new.status_envio is not distinct from 'FALHOU' then return new; end if;
  if new.enviado_por_id is null and not robo then return new; end if;
  if robo and c.robo_pausado_em is not null then return new; end if;
  update public.atendimento_esperas
     set fim = quando, fim_tipo = case when robo then 'ROBO' else 'EQUIPE' end, respondido_por_id = new.enviado_por_id
   where conversa_id = c.id and fim is null and inicio <= quando;
  update public.atendimento_conversas set aguardando_desde = null
   where id = c.id and aguardando_desde is not null and aguardando_desde <= quando;
  return new;
end;
$$;

drop trigger if exists atendimento_aguardando_mensagem on public.atendimento_mensagens;
create trigger atendimento_aguardando_mensagem
  after insert on public.atendimento_mensagens
  for each row execute function public.atendimento_aguardando_mensagem();

-- Resolveu ou arquivou sem responder: a espera fecha como ENCERRADA
create or replace function public.atendimento_aguardando_fechar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('RESOLVIDA', 'ARQUIVADA') and new.status is distinct from old.status then
    new.aguardando_desde := null;
    update public.atendimento_esperas set fim = now(), fim_tipo = 'ENCERRADA'
     where conversa_id = new.id and fim is null;
  end if;
  return new;
end;
$$;

drop trigger if exists atendimento_aguardando_fechar on public.atendimento_conversas;
create trigger atendimento_aguardando_fechar
  before update of status on public.atendimento_conversas
  for each row execute function public.atendimento_aguardando_fechar();

-- Primeira vez: monta as esperas dos últimos 120 dias com o histórico das
-- mensagens e o "desde quando espera" das conversas abertas
do $$
begin
  if exists (select 1 from public.atendimento_esperas) then return; end if;

  with base as (
    select m.id, m.conversa_id, m.hotel_id, m.direcao, m.tipo, m.texto, m.status_envio, m.enviado_por_id,
           coalesce(m.enviado_pelo_robo, false) as robo, coalesce(m.data_original, m.criado_em) as t
      from public.atendimento_mensagens m
     where coalesce(m.data_original, m.criado_em) >= now() - interval '120 days'
       and (m.direcao in ('ENTRADA', 'SAIDA') or (m.direcao = 'NOTA' and m.tipo = 'robo_passou'))
  ),
  passou as (select conversa_id, t from base where direcao = 'NOTA'),
  ev as (
    select b.* from base b
     where b.direcao = 'ENTRADA'
        or (b.direcao = 'SAIDA' and b.status_envio is distinct from 'FALHOU'
            and (b.enviado_por_id is not null or b.robo)
            and not (b.robo and (coalesce(b.texto, '') like 'Recebemos sua mensagem!%'
                                 or exists (select 1 from passou p where p.conversa_id = b.conversa_id
                                              and p.t between b.t - interval '5 minutes' and b.t))))
  ),
  ord as (
    select ev.*, row_number() over w as n, lag(direcao) over w as ant
      from ev
    window w as (partition by conversa_id order by t, id)
  ),
  prox as (
    select o.*, min(case when o.direcao = 'SAIDA' then o.n end)
                  over (partition by o.conversa_id order by o.n rows between current row and unbounded following) as n_resp
      from ord o
  ),
  esperas as (
    select e.conversa_id, e.hotel_id, e.t, e.n, r.t as resp_t, r.robo as resp_robo, r.enviado_por_id as resp_por,
           c.canal_tipo, c.status, c.aguardando_desde, c.robo_pausado_em
      from prox e
      left join prox r on r.conversa_id = e.conversa_id and r.n = e.n_resp
      join public.atendimento_conversas c on c.id = e.conversa_id
     where e.direcao = 'ENTRADA' and (e.ant is null or e.ant = 'SAIDA')
  )
  insert into public.atendimento_esperas (hotel_id, conversa_id, canal_tipo, inicio, primeira, fora_horario, fim, fim_tipo, respondido_por_id)
  select hotel_id, conversa_id, canal_tipo, t,
         not exists (select 1 from public.atendimento_mensagens x where x.conversa_id = esperas.conversa_id and x.direcao = 'ENTRADA'
                       and coalesce(x.data_original, x.criado_em) < esperas.t),
         public.atendimento_fora_do_horario(hotel_id, t),
         case when resp_t is not null then resp_t
              when status not in ('RESOLVIDA', 'ARQUIVADA') and n = (select max(n2.n) from prox n2 where n2.conversa_id = esperas.conversa_id and n2.direcao = 'ENTRADA' and (n2.ant is null or n2.ant = 'SAIDA')) then null
              else t end,
         case when resp_t is not null then (case when resp_robo then 'ROBO' else 'EQUIPE' end)
              when status not in ('RESOLVIDA', 'ARQUIVADA') and n = (select max(n2.n) from prox n2 where n2.conversa_id = esperas.conversa_id and n2.direcao = 'ENTRADA' and (n2.ant is null or n2.ant = 'SAIDA')) then null
              else 'ENCERRADA' end,
         case when resp_t is not null and not resp_robo then resp_por end
    from esperas;

  -- Conversas abertas que estão esperando agora
  update public.atendimento_conversas c set aguardando_desde = e.inicio
    from public.atendimento_esperas e
   where e.conversa_id = c.id and e.fim is null and c.aguardando_desde is null;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Placar do prazo de resposta (Painel)
-- ---------------------------------------------------------------------------
-- O prazo é o do aviso vermelho (Funil e etiquetas). Conta só as esperas que
-- começaram no horário comercial, nos canais de conversa (WhatsApp, chat do
-- site, Instagram, Facebook). Respondida dentro do prazo = resposta da equipe
-- ou do robô em até N minutos.
create or replace function public.atendimento_painel_sla(p_hoteis bigint[], p_inicio date, p_fim date)
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
    select coalesce(array_agg(h), '{}') into v_hoteis from (select public.atendimento_hoteis() as h) x where h = any(p_hoteis);
  end if;

  with todas as (
    select e.*, coalesce(p.alerta_espera_minutos, 15) as prazo
      from public.atendimento_esperas e
      left join public.atendimento_preferencias p on p.hotel_id = e.hotel_id
     where e.hotel_id = any(v_hoteis) and e.inicio >= v_ini and e.inicio < v_fim
       and coalesce(e.canal_tipo, '') in ('WHATSAPP', 'SITE', 'INSTAGRAM', 'FACEBOOK')
  ),
  x as (
    select todas.*,
           extract(epoch from (fim - inicio)) / 60.0 as minutos,
           fim_tipo in ('EQUIPE', 'ROBO') as respondida,
           case when fim_tipo in ('EQUIPE', 'ROBO') then extract(epoch from (fim - inicio)) / 60.0 <= prazo end as no_prazo
      from todas
     where not fora_horario
  )
  select jsonb_build_object(
    'prazo_min',      (select min(coalesce(p.alerta_espera_minutos, 15)) from unnest(v_hoteis) h
                         left join public.atendimento_preferencias p on p.hotel_id = h),
    'prazo_max',      (select max(coalesce(p.alerta_espera_minutos, 15)) from unnest(v_hoteis) h
                         left join public.atendimento_preferencias p on p.hotel_id = h),
    'consideradas',   (select count(*) from x),
    'respondidas',    (select count(*) from x where respondida),
    'dentro',         (select count(*) from x where no_prazo),
    'fora_respondidas', (select count(*) from x where no_prazo = false),
    'aguardando',     (select count(*) from x where fim is null),
    'aguardando_fora', (select count(*) from x where fim is null and now() - inicio > make_interval(mins => prazo)),
    'encerradas_sem_resposta', (select count(*) from x where fim_tipo = 'ENCERRADA'),
    'tempo_medio_min',   (select round(avg(minutos)::numeric, 1) from x where respondida),
    'tempo_mediano_min', (select round((percentile_cont(0.5) within group (order by minutos))::numeric, 1) from x where respondida),
    'primeira',  (select jsonb_build_object('respondidas', count(*) filter (where respondida), 'dentro', count(*) filter (where no_prazo),
                                            'tempo_medio_min', round((avg(minutos) filter (where respondida))::numeric, 1))
                    from x where primeira),
    'seguintes', (select jsonb_build_object('respondidas', count(*) filter (where respondida), 'dentro', count(*) filter (where no_prazo),
                                            'tempo_medio_min', round((avg(minutos) filter (where respondida))::numeric, 1))
                    from x where not primeira),
    'por_atendente', (select coalesce(jsonb_agg(jsonb_build_object('id', respondido_por_id, 'respostas', n, 'dentro', d, 'tempo_medio_min', tm) order by n desc), '[]'::jsonb)
                        from (select respondido_por_id, count(*) n, count(*) filter (where no_prazo) d, round(avg(minutos)::numeric, 1) tm
                                from x where fim_tipo = 'EQUIPE' and respondido_por_id is not null group by 1) a),
    'robo', (select jsonb_build_object('respostas', count(*), 'dentro', count(*) filter (where no_prazo), 'tempo_medio_min', round(avg(minutos)::numeric, 1))
               from x where fim_tipo = 'ROBO'),
    'fora_horario', (select count(*) from todas where fora_horario)
  ) into v_saida;
  return v_saida;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) Nome do atendente na mensagem do WhatsApp (cada pessoa liga para si)
-- ---------------------------------------------------------------------------
alter table public.usuarios
  add column if not exists atendimento_assinar boolean not null default false;

-- ---------------------------------------------------------------------------
-- 4) Permissões
-- ---------------------------------------------------------------------------
revoke all on function public.atendimento_aguardando_mensagem() from public, anon, authenticated;
revoke all on function public.atendimento_aguardando_fechar() from public, anon, authenticated;
revoke all on function public.atendimento_painel_sla(bigint[], date, date) from public, anon;
grant execute on function public.atendimento_painel_sla(bigint[], date, date) to authenticated, service_role;

-- Conferência: deve mostrar as duas colunas novas e quantas esperas há
select table_name, column_name from information_schema.columns
 where table_schema = 'public'
   and ((table_name = 'atendimento_conversas' and column_name = 'aguardando_desde')
     or (table_name = 'usuarios' and column_name = 'atendimento_assinar'))
union all
select 'atendimento_esperas', count(*)::text from public.atendimento_esperas
 order by 1;
