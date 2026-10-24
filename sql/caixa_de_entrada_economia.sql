-- ============================================================================
-- CAIXA DE ENTRADA — ECONOMIA DE MENSAGENS DO WHATSAPP   (pode rodar várias vezes)
-- ============================================================================
-- Rode DEPOIS do SQL da Fase 4 (sql/caixa_de_entrada_fase4.sql).
--
-- Desde 1º/10/2026 a Meta cobra cada mensagem que o hotel envia dentro da
-- conversa (depois das 1.000 grátis por número no mês). Este SQL:
--  1. Guarda em cada mensagem enviada o que a Meta informou sobre a cobrança
--     (cobrada ou grátis, e por quê).
--  2. Guarda o preço de cada mensagem cobrada, por hotel (o ADMIN ajusta).
--  3. Liga o "modo econômico" do robô (uma mensagem só por resposta).
--  4. Cria o relatório de mensagens e custo do WhatsApp (só ADMIN).
-- Só colunas novas e uma função: nenhuma tabela nova.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Cobrança informada pela Meta em cada mensagem enviada
-- ---------------------------------------------------------------------------
alter table public.atendimento_mensagens
  add column if not exists cobrada            boolean,  -- true = a Meta cobra; false = grátis; null = sem informação
  add column if not exists cobranca_tipo      text,     -- regular, free_customer_service, free_entry_point…
  add column if not exists cobranca_categoria text;     -- service, utility, marketing…

create index if not exists atendimento_mensagens_saida_idx
  on public.atendimento_mensagens (hotel_id, criado_em) where direcao = 'SAIDA';

-- ---------------------------------------------------------------------------
-- 2) Preço de cada mensagem cobrada (R$), por hotel
-- ---------------------------------------------------------------------------
alter table public.atendimento_preferencias
  add column if not exists whatsapp_preco_mensagem numeric(8,4) not null default 0.04;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'atendimento_preferencias_preco_whats_chk') then
    alter table public.atendimento_preferencias
      add constraint atendimento_preferencias_preco_whats_chk check (whatsapp_preco_mensagem >= 0 and whatsapp_preco_mensagem <= 5);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3) Modo econômico do robô (ligado para todos)
-- ---------------------------------------------------------------------------
alter table public.atendimento_robo
  add column if not exists modo_economico boolean not null default true;

-- ---------------------------------------------------------------------------
-- 4) Relatório: mensagens enviadas e custo do WhatsApp, por número e por mês
-- ---------------------------------------------------------------------------
-- Franquia da Meta: 1.000 mensagens de atendimento grátis por número no mês.
-- Quando a Meta ainda não informou a cobrança (mensagens antigas), a conta é
-- estimada: tudo o que passou de 1.000 entregues no mês.
create or replace function public.atendimento_whatsapp_uso(p_hoteis bigint[], p_inicio date, p_fim date)
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
    -- custo é assunto do ADMIN
    select coalesce(array_agg(h), '{}') into v_hoteis
      from (select public.atendimento_hoteis() as h) x
     where h = any(p_hoteis) and public.atendimento_sou_admin(h);
  end if;
  if coalesce(array_length(v_hoteis, 1), 0) = 0 then
    return null;
  end if;

  with msg as (
    select c.canal_id, m.hotel_id, m.tipo, m.status_envio, m.enviado_pelo_robo, m.enviado_por_id,
           m.cobrada, m.cobranca_tipo,
           to_char(m.criado_em at time zone 'America/Fortaleza', 'YYYY-MM') as mes
      from public.atendimento_mensagens m
      join public.atendimento_conversas c on c.id = m.conversa_id
     where m.hotel_id = any(v_hoteis) and m.direcao = 'SAIDA' and c.canal_tipo = 'WHATSAPP'
       and m.criado_em >= v_ini and m.criado_em < v_fim
       and coalesce(m.status_envio, '') <> 'FALHOU'
  ),
  por_mes as (
    select canal_id, hotel_id, mes,
           count(*) filter (where tipo <> 'modelo')                                         as atendimento,
           count(*) filter (where tipo <> 'modelo' and status_envio in ('ENTREGUE', 'VISTA')) as entregues,
           count(*) filter (where tipo = 'modelo')                                          as modelos,
           count(*) filter (where tipo <> 'modelo' and cobrada)                             as cobradas_meta,
           count(*) filter (where tipo <> 'modelo' and cobrada is not null)                 as com_info,
           count(*) filter (where cobranca_tipo = 'free_customer_service')                  as gratis_franquia,
           count(*) filter (where cobranca_tipo = 'free_entry_point')                       as gratis_anuncio,
           count(*) filter (where tipo <> 'modelo' and coalesce(enviado_pelo_robo, false))  as robo,
           count(*) filter (where tipo <> 'modelo' and not coalesce(enviado_pelo_robo, false) and enviado_por_id is not null) as equipe
      from msg
     group by canal_id, hotel_id, mes
  ),
  calc as (
    select p.*,
           (p.com_info = 0) as estimado,
           case when p.com_info = 0 then greatest(0, p.entregues - 1000) else p.cobradas_meta end as cobradas,
           coalesce(pr.whatsapp_preco_mensagem, 0.04) as preco
      from por_mes p
      left join public.atendimento_preferencias pr on pr.hotel_id = p.hotel_id
  ),
  numeros as (
    select k.id as canal_id, k.hotel_id, k.nome, k.endereco_exibicao as numero,
           coalesce(pr.whatsapp_preco_mensagem, 0.04) as preco
      from public.atendimento_canais k
      left join public.atendimento_preferencias pr on pr.hotel_id = k.hotel_id
     where k.tipo = 'WHATSAPP' and k.hotel_id = any(v_hoteis)
       and (k.ativo or exists (select 1 from calc where calc.canal_id = k.id))
  )
  select jsonb_build_object(
    'franquia', 1000,
    'numeros', coalesce((
      select jsonb_agg(jsonb_build_object(
               'canal_id', n.canal_id, 'hotel_id', n.hotel_id, 'nome', n.nome, 'numero', n.numero, 'preco', n.preco,
               'meses', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'mes', c.mes, 'atendimento', c.atendimento, 'entregues', c.entregues, 'modelos', c.modelos,
                          'cobradas', c.cobradas, 'estimado', c.estimado,
                          'gratis_franquia', c.gratis_franquia, 'gratis_anuncio', c.gratis_anuncio,
                          'robo', c.robo, 'equipe', c.equipe,
                          'custo', round(c.cobradas * c.preco, 2)) order by c.mes)
                   from calc c where c.canal_id = n.canal_id), '[]'::jsonb)
             ) order by n.hotel_id, n.canal_id)
        from numeros n), '[]'::jsonb)
  ) into v_saida;
  return v_saida;
end;
$$;

revoke all on function public.atendimento_whatsapp_uso(bigint[], date, date) from public, anon;
grant execute on function public.atendimento_whatsapp_uso(bigint[], date, date) to authenticated, service_role;
