-- ============================================================================
-- CAIXA DE ENTRADA — OUTRO HOTEL DO GRUPO QUANDO NÃO HÁ QUARTO   (pode rodar várias vezes)
-- ============================================================================
-- Rodar DEPOIS dos SQLs anteriores da Caixa de Entrada (até a Fase 1B).
--
-- Quando o hotel da conversa (ex.: J.R.) não tem quarto nas datas pedidas, o
-- robô consulta o outro hotel do grupo (ex.: Guarany) e já manda a cotação
-- dele, na mesma mensagem. A equipe também pode cotar o outro hotel na tela
-- de cotação. A conversa continua no hotel que atendeu; a cotação guarda qual
-- hotel foi cotado.
--
--  1. Robô: lista dos hotéis do grupo que ele pode oferecer (o ADMIN escolhe).
--  2. Cotação: qual hotel foi cotado (vazio = o próprio hotel da conversa).
--  3. Clique no "Reservar agora": abre o motor do hotel cotado.
--  4. Reserva encontrada na Cloudbeds do hotel cotado → "Reservou" na conversa.
--  5. Painéis: as cotações do outro hotel aparecem numa linha separada e não
--     se misturam com as vendas do hotel que atendeu.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Robô: hotéis do grupo que ele oferece quando não há quarto
-- ---------------------------------------------------------------------------
--  [{ "hotel_id": 2, "descricao": "também no Centro, a 1 km daqui" }]
alter table public.atendimento_robo
  add column if not exists outros_hoteis jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- 2) Cotação de outro hotel do grupo
-- ---------------------------------------------------------------------------
alter table public.atendimento_cotacoes
  add column if not exists hotel_cotado_id bigint references public.hoteis(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'atendimento_cotacoes_cotado_check') then
    alter table public.atendimento_cotacoes add constraint atendimento_cotacoes_cotado_check
      check (hotel_cotado_id is null or hotel_cotado_id <> hotel_id);
  end if;
end $$;

create index if not exists atendimento_cotacoes_cotado_idx
  on public.atendimento_cotacoes (hotel_cotado_id, criado_em desc)
  where hotel_cotado_id is not null;

-- ---------------------------------------------------------------------------
-- 3) Clique no "Reservar agora" (rota /r/<codigo>): motor do hotel cotado
-- ---------------------------------------------------------------------------
create or replace function public.atendimento_registrar_clique(p_codigo text, p_item integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c        public.atendimento_cotacoes;
  v_item   jsonb;
  v_motor  text;
  v_nome   text;
  v_hotel  bigint;
  v_outro  text;
begin
  select * into c from public.atendimento_cotacoes where codigo = p_codigo;
  if c.id is null then return null; end if;

  v_hotel := coalesce(c.hotel_cotado_id, c.hotel_id);
  v_item := c.itens -> greatest(coalesce(p_item, 0), 0);
  if v_item is null then v_item := c.itens -> 0; end if;
  select motor_url into v_motor from public.atendimento_preferencias where hotel_id = v_hotel;

  update public.atendimento_cotacoes set
    cliques            = cliques + 1,
    primeiro_clique_em = coalesce(primeiro_clique_em, now()),
    ultimo_clique_em   = now(),
    item_clicado       = coalesce(p_item, item_clicado),
    status             = case when status = 'ENVIADA' then 'CLICOU' else status end
  where id = c.id;

  if c.conversa_id is not null then
    perform public.atendimento_avancar_etapa(c.conversa_id, 'Reservar agora');
    if c.cliques = 0 then
      v_nome := coalesce(v_item ->> 'nome', 'quarto');
      if c.hotel_cotado_id is not null then
        select nome_fantasia into v_outro from public.hoteis where id = c.hotel_cotado_id;
      end if;
      insert into public.atendimento_mensagens (hotel_id, conversa_id, direcao, tipo, texto, data_original)
      values (c.hotel_id, c.conversa_id, 'NOTA', 'sistema',
              '🖱️ O cliente clicou em "Reservar agora" ('
              || case when v_outro is not null then v_outro || ': ' else '' end
              || v_nome || ', '
              || to_char(c.checkin, 'DD/MM') || ' a ' || to_char(c.checkout, 'DD/MM') || ').', now());
    end if;
  end if;

  return jsonb_build_object(
    'motor_url', v_motor, 'checkin', c.checkin, 'checkout', c.checkout,
    'adultos', c.adultos, 'criancas', c.criancas, 'abreviacao', v_item ->> 'abreviacao', 'hotel_id', v_hotel
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) Reserva encontrada na Cloudbeds → "Reservou"
-- ---------------------------------------------------------------------------
-- p_hotel_reserva: hotel em que a reserva foi feita (vazio = o hotel da
-- conversa). Marca a cotação desse hotel, e não a de outro.
drop function if exists public.atendimento_marcar_reserva(bigint, text, numeric, text);

create or replace function public.atendimento_marcar_reserva(
  p_conversa bigint, p_reserva text, p_valor numeric, p_texto text, p_hotel_reserva bigint default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hotel    bigint;
  v_contato  bigint;
  v_cot      bigint;
  v_reserva  bigint;
begin
  select hotel_id, contato_id into v_hotel, v_contato from public.atendimento_conversas where id = p_conversa;
  if v_hotel is null or coalesce(p_reserva, '') = '' then return false; end if;
  v_reserva := coalesce(p_hotel_reserva, v_hotel);

  insert into public.atendimento_reservas_detectadas (hotel_id, reserva_id, conversa_id)
  values (v_reserva, p_reserva, p_conversa)
  on conflict do nothing;
  if not found then return false; end if;

  -- O nº da reserva na conversa é o da Cloudbeds do hotel da conversa (a
  -- lateral "Reserva na Cloudbeds" procura lá); a de outro hotel fica na nota
  update public.atendimento_conversas
     set cloudbeds_reservation_id = case when v_reserva = v_hotel then coalesce(cloudbeds_reservation_id, p_reserva)
                                         else cloudbeds_reservation_id end,
         atualizado_em = now()
   where id = p_conversa;
  perform public.atendimento_avancar_etapa(p_conversa, 'Reservou');
  if v_contato is not null then
    update public.atendimento_contatos set ja_reservou = true where id = v_contato;
  end if;

  select id into v_cot from public.atendimento_cotacoes
   where conversa_id = p_conversa and status in ('ENVIADA', 'CLICOU')
     and coalesce(hotel_cotado_id, hotel_id) = v_reserva
   order by criado_em desc limit 1;
  if v_cot is not null then
    update public.atendimento_cotacoes
       set status = 'RESERVOU', reserva_id = p_reserva, reserva_valor = p_valor, reservou_em = now()
     where id = v_cot;
  end if;

  if coalesce(p_texto, '') <> '' then
    insert into public.atendimento_mensagens (hotel_id, conversa_id, direcao, tipo, texto, data_original)
    values (v_hotel, p_conversa, 'NOTA', 'sistema', p_texto, now());
  end if;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5a) Painel: cotações (as do outro hotel ficam numa linha separada)
-- ---------------------------------------------------------------------------
create or replace function public.atendimento_painel_cotacoes(p_hoteis bigint[], p_inicio date, p_fim date)
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

  with periodo as (
    select * from public.atendimento_cotacoes
     where hotel_id = any(v_hoteis) and criado_em >= v_ini and criado_em < v_fim
  ),
  todas as (select * from periodo where hotel_cotado_id is null),
  cot as (select * from todas where status in ('ENVIADA', 'CLICOU', 'RESERVOU')),
  sem as (select * from todas where status = 'SEM_DISPONIBILIDADE'),
  -- Mandou para outro hotel do grupo (não havia quarto aqui)
  mandou as (select * from periodo where hotel_cotado_id is not null and status in ('ENVIADA', 'CLICOU', 'RESERVOU')),
  -- Recebeu de outro hotel do grupo (cotações deste hotel feitas na conversa de outro)
  recebeu as (
    select * from public.atendimento_cotacoes
     where hotel_cotado_id = any(v_hoteis) and not (hotel_id = any(v_hoteis))
       and criado_em >= v_ini and criado_em < v_fim and status in ('ENVIADA', 'CLICOU', 'RESERVOU')
  ),
  res as (
    select r.*, c.responsavel_id from public.atendimento_reservas_detectadas r
      left join public.atendimento_conversas c on c.id = r.conversa_id
     where r.hotel_id = any(v_hoteis) and r.criado_em >= v_ini and r.criado_em < v_fim
       and (c.hotel_id is null or c.hotel_id = any(v_hoteis))
  ),
  meses as (
    select generate_series(date_trunc('month', p_inicio::timestamp), date_trunc('month', p_fim::timestamp), interval '1 month') as mes
  )
  select jsonb_build_object(
    'enviadas',            (select count(*) from cot),
    'clicadas',            (select count(*) from cot where cliques > 0),
    'reservadas',          (select count(*) from cot where status = 'RESERVOU'),
    'valor_cotado',        (select coalesce(sum(valor_minimo), 0) from cot),
    'valor_reservado',     (select coalesce(sum(reserva_valor), 0) from cot where status = 'RESERVOU'),
    'reservas_detectadas', (select count(*) from res),
    'sem_disponibilidade', (select count(*) from sem),
    'datas_sem_disponibilidade', (select coalesce(jsonb_agg(jsonb_build_object('checkin', checkin, 'checkout', checkout, 'pedidos', n) order by n desc, checkin), '[]'::jsonb)
                                    from (select checkin, checkout, count(*) n from sem group by 1, 2 order by 3 desc, 1 limit 8) d),
    'reservas_por_atendente', (select coalesce(jsonb_agg(jsonb_build_object('id', responsavel_id, 'reservas', n)), '[]'::jsonb)
                                 from (select responsavel_id, count(*) n from res where responsavel_id is not null group by 1) a),
    'outro_hotel', jsonb_build_object(
      'enviadas',        (select count(*) from mandou),
      'clicadas',        (select count(*) from mandou where cliques > 0),
      'reservadas',      (select count(*) from mandou where status = 'RESERVOU'),
      'valor_reservado', (select coalesce(sum(reserva_valor), 0) from mandou where status = 'RESERVOU'),
      'por_hotel', (select coalesce(jsonb_agg(jsonb_build_object('hotel_id', m.hotel_cotado_id, 'nome', h.nome_fantasia,
                                                                 'enviadas', m.n, 'reservadas', m.rs, 'valor', m.v) order by m.n desc), '[]'::jsonb)
                      from (select hotel_cotado_id, count(*) n, count(*) filter (where status = 'RESERVOU') rs,
                                   coalesce(sum(reserva_valor) filter (where status = 'RESERVOU'), 0) v
                              from mandou group by 1) m
                      left join public.hoteis h on h.id = m.hotel_cotado_id)),
    'recebeu_outro_hotel', jsonb_build_object(
      'enviadas',        (select count(*) from recebeu),
      'reservadas',      (select count(*) from recebeu where status = 'RESERVOU'),
      'valor_reservado', (select coalesce(sum(reserva_valor), 0) from recebeu where status = 'RESERVOU'),
      'por_hotel', (select coalesce(jsonb_agg(jsonb_build_object('hotel_id', m.hotel_id, 'nome', h.nome_fantasia,
                                                                 'enviadas', m.n, 'reservadas', m.rs, 'valor', m.v) order by m.n desc), '[]'::jsonb)
                      from (select hotel_id, count(*) n, count(*) filter (where status = 'RESERVOU') rs,
                                   coalesce(sum(reserva_valor) filter (where status = 'RESERVOU'), 0) v
                              from recebeu group by 1) m
                      left join public.hoteis h on h.id = m.hotel_id)),
    'meses', (select coalesce(jsonb_agg(jsonb_build_object(
                'mes', to_char(mes, 'YYYY-MM'),
                'enviadas',   (select count(*) from cot where date_trunc('month', criado_em at time zone 'America/Fortaleza') = mes),
                'clicadas',   (select count(*) from cot where cliques > 0 and date_trunc('month', criado_em at time zone 'America/Fortaleza') = mes),
                'reservadas', (select count(*) from cot where status = 'RESERVOU' and date_trunc('month', criado_em at time zone 'America/Fortaleza') = mes),
                'sem_disponibilidade', (select count(*) from sem where date_trunc('month', criado_em at time zone 'America/Fortaleza') = mes)
              ) order by mes), '[]'::jsonb) from meses)
  ) into v_saida;
  return v_saida;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5b) Painel de vendas: só as cotações do próprio hotel
-- ---------------------------------------------------------------------------
create or replace function public.atendimento_painel_vendas(p_hoteis bigint[], p_inicio date, p_fim date)
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

  with cot as (
    select c.*,
           coalesce(c.enviado_pelo_robo, false) as robo,
           public.atendimento_fora_do_horario(c.hotel_id, c.criado_em) as fora,
           (c.checkin - (c.criado_em at time zone 'America/Fortaleza')::date) as antecedencia,
           case when c.status = 'RESERVOU' then coalesce(c.reserva_valor, 0) else 0 end as valor
      from public.atendimento_cotacoes c
     where c.hotel_id = any(v_hoteis) and c.criado_em >= v_ini and c.criado_em < v_fim
       and c.status in ('ENVIADA', 'CLICOU', 'RESERVOU')
       and c.hotel_cotado_id is null
  ),
  resumo as (
    select count(*) as cotacoes, count(*) filter (where status = 'RESERVOU') as reservas, coalesce(sum(valor), 0) as valor from cot
  )
  select jsonb_build_object(
    'total', (select to_jsonb(r) from resumo r),
    'por_atendente', (select coalesce(jsonb_agg(jsonb_build_object('id', enviado_por_id, 'cotacoes', n, 'reservas', rs, 'valor', v) order by v desc, n desc), '[]'::jsonb)
                        from (select enviado_por_id, count(*) n, count(*) filter (where status = 'RESERVOU') rs, coalesce(sum(valor), 0) v
                                from cot where not robo and enviado_por_id is not null group by 1) a),
    'robo', (select jsonb_build_object('cotacoes', count(*), 'reservas', count(*) filter (where status = 'RESERVOU'), 'valor', coalesce(sum(valor), 0)) from cot where robo),
    'por_canal', (select coalesce(jsonb_agg(jsonb_build_object('canal', canal, 'cotacoes', n, 'reservas', rs, 'valor', v) order by v desc, n desc), '[]'::jsonb)
                    from (select coalesce(canal_tipo, 'OUTRO') canal, count(*) n, count(*) filter (where status = 'RESERVOU') rs, coalesce(sum(valor), 0) v
                            from cot group by 1) a),
    'horario', jsonb_build_object(
      'dentro', (select jsonb_build_object('cotacoes', count(*), 'reservas', count(*) filter (where status = 'RESERVOU'), 'valor', coalesce(sum(valor), 0),
                                           'robo', count(*) filter (where robo)) from cot where not fora),
      'fora',   (select jsonb_build_object('cotacoes', count(*), 'reservas', count(*) filter (where status = 'RESERVOU'), 'valor', coalesce(sum(valor), 0),
                                           'robo', count(*) filter (where robo)) from cot where fora)),
    'antecedencia', jsonb_build_object(
      'media_dias', (select round(avg(greatest(antecedencia, 0))::numeric, 1) from cot),
      'faixas', (select coalesce(jsonb_agg(jsonb_build_object('faixa', faixa, 'cotacoes', n, 'reservas', rs) order by ordem), '[]'::jsonb)
                   from (select case when antecedencia <= 7 then 1 when antecedencia <= 30 then 2 when antecedencia <= 90 then 3 else 4 end as ordem,
                                case when antecedencia <= 7 then 'Até 7 dias' when antecedencia <= 30 then '8 a 30 dias'
                                     when antecedencia <= 90 then '31 a 90 dias' else 'Mais de 90 dias' end as faixa,
                                count(*) n, count(*) filter (where status = 'RESERVOU') rs
                           from cot group by 1, 2) f))
  ) into v_saida;
  return v_saida;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5c) Painel do robô: cotações do outro hotel numa linha separada
-- ---------------------------------------------------------------------------
create or replace function public.atendimento_painel_robo(p_hoteis bigint[], p_inicio date, p_fim date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_hoteis bigint[];
  v_admin  boolean;
  v_ini    timestamptz := (p_inicio::timestamp) at time zone 'America/Fortaleza';
  v_fim    timestamptz := ((p_fim + 1)::timestamp) at time zone 'America/Fortaleza';
  v_saida  jsonb;
begin
  if auth.uid() is null then
    v_hoteis := p_hoteis;
    v_admin := true;
  else
    select coalesce(array_agg(h), '{}') into v_hoteis from (select public.atendimento_hoteis() as h) x where h = any(p_hoteis);
    select coalesce(bool_and(public.atendimento_sou_admin(h)), false) into v_admin from unnest(v_hoteis) h;
  end if;

  if not exists (select 1 from public.atendimento_mensagens m
                  where m.hotel_id = any(v_hoteis) and m.enviado_pelo_robo
                    and m.criado_em >= v_ini and m.criado_em < v_fim) then
    return null;
  end if;

  with resp as (
    select m.* from public.atendimento_mensagens m
     where m.hotel_id = any(v_hoteis) and m.enviado_pelo_robo and m.direcao = 'SAIDA'
       and m.criado_em >= v_ini and m.criado_em < v_fim
  ),
  conv as (select distinct conversa_id from resp),
  passou as (
    select distinct m.conversa_id from public.atendimento_mensagens m
     where m.hotel_id = any(v_hoteis) and m.tipo = 'robo_passou'
       and m.criado_em >= v_ini and m.criado_em < v_fim
  ),
  todas_cot as (
    select c.* from public.atendimento_cotacoes c
     where c.hotel_id = any(v_hoteis) and c.enviado_pelo_robo and c.status <> 'CANCELADA'
       and c.criado_em >= v_ini and c.criado_em < v_fim
  ),
  cot as (select * from todas_cot where hotel_cotado_id is null),
  outro as (select * from todas_cot where hotel_cotado_id is not null),
  sol as (
    select s.* from public.atendimento_solicitacoes s
     where s.hotel_id = any(v_hoteis) and s.criado_pelo_robo and s.criado_em >= v_ini and s.criado_em < v_fim
  )
  select jsonb_build_object(
    'conversas',        (select count(*) from conv),
    'respostas',        (select count(*) from resp),
    'fora_horario',     (select count(*) from conv x join public.atendimento_conversas c on c.id = x.conversa_id
                          where public.atendimento_fora_do_horario(c.hotel_id, c.criado_em)),
    'passou_equipe',    (select count(*) from passou),
    'resolveu_sozinho', (select count(*) from conv x where x.conversa_id not in (select conversa_id from passou)),
    'cotacoes',         (select count(*) from cot where status <> 'SEM_DISPONIBILIDADE'),
    'sem_disponibilidade', (select count(*) from cot where status = 'SEM_DISPONIBILIDADE'),
    'cliques',          (select count(*) from cot where cliques > 0),
    'reservas',         (select count(*) from cot where status = 'RESERVOU'),
    'valor_reservado',  (select coalesce(sum(reserva_valor), 0) from cot where status = 'RESERVOU'),
    'outro_hotel',      jsonb_build_object(
                          'cotacoes',        (select count(*) from outro),
                          'cliques',         (select count(*) from outro where cliques > 0),
                          'reservas',        (select count(*) from outro where status = 'RESERVOU'),
                          'valor_reservado', (select coalesce(sum(reserva_valor), 0) from outro where status = 'RESERVOU')),
    'solicitacoes',     (select count(*) from sol),
    'solicitacoes_por_tipo', (select coalesce(jsonb_object_agg(tipo, n), '{}'::jsonb) from (select tipo, count(*) n from sol group by tipo) t),
    'custo_usd',        case when v_admin then (select coalesce(sum(custo_usd), 0) from public.atendimento_robo_uso u
                                                  where u.hotel_id = any(v_hoteis) and u.criado_em >= v_ini and u.criado_em < v_fim)
                             else null end
  ) into v_saida;
  return v_saida;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6) Permissões das funções
-- ---------------------------------------------------------------------------
revoke all on function public.atendimento_registrar_clique(text, integer) from public, anon, authenticated;
revoke all on function public.atendimento_marcar_reserva(bigint, text, numeric, text, bigint) from public, anon, authenticated;
revoke all on function public.atendimento_painel_cotacoes(bigint[], date, date) from public, anon;
revoke all on function public.atendimento_painel_vendas(bigint[], date, date) from public, anon;
revoke all on function public.atendimento_painel_robo(bigint[], date, date) from public, anon;
grant execute on function public.atendimento_registrar_clique(text, integer) to service_role;
grant execute on function public.atendimento_marcar_reserva(bigint, text, numeric, text, bigint) to service_role;
grant execute on function public.atendimento_painel_cotacoes(bigint[], date, date) to authenticated, service_role;
grant execute on function public.atendimento_painel_vendas(bigint[], date, date) to authenticated, service_role;
grant execute on function public.atendimento_painel_robo(bigint[], date, date) to authenticated, service_role;

-- Conferência: deve mostrar as duas colunas novas
select table_name, column_name from information_schema.columns
 where table_schema = 'public'
   and ((table_name = 'atendimento_robo' and column_name = 'outros_hoteis')
     or (table_name = 'atendimento_cotacoes' and column_name = 'hotel_cotado_id'))
 order by table_name;
