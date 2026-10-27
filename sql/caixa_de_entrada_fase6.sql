-- ============================================================================
-- CAIXA DE ENTRADA — FASE 6 (WhatsApp avançado)            (pode rodar várias vezes)
-- ============================================================================
-- Rode DEPOIS do SQL da Fase 5 (sql/caixa_de_entrada_fase5.sql).
--
--  1. Campanhas: mensagem com modelo aprovado para um grupo de clientes
--     (contatos do sistema ou planilha), com etiqueta, robô ligado ou não,
--     agendamento e data limite.
--  2. Cada envio da campanha (enviado, falhou, pulado e por quê).
--  3. Preço por mensagem de modelo (marketing e utilidade) para o custo.
--  4. Contador do WhatsApp passa a mostrar também o custo dos modelos.
--  5. Resumo das campanhas (entregues, lidas, responderam, saíram, reservas).
-- Só o ADMIN vê e cria. Tabelas novas com GRANT explícito.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Campanhas
-- ---------------------------------------------------------------------------
create table if not exists public.atendimento_campanhas (
  id                  bigserial primary key,
  hotel_id            bigint not null references public.hoteis(id) on delete cascade,
  nome                text not null,
  canal_id            bigint references public.atendimento_canais(id) on delete set null,
  modelo_nome         text not null,
  modelo_idioma       text not null default 'pt_BR',
  modelo_info         jsonb not null default '{}'::jsonb,   -- texto, categoria, variáveis e botões do modelo
  variaveis           jsonb not null default '[]'::jsonb,   -- o que vai em {{1}}, {{2}}…
  variaveis_cabecalho jsonb not null default '[]'::jsonb,
  botoes              jsonb not null default '[]'::jsonb,   -- final do link de cada botão variável
  publico             jsonb not null default '{}'::jsonb,   -- filtros usados (para lembrar)
  etiqueta            text,                                 -- etiqueta colocada na conversa
  robo_responde       boolean not null default true,        -- o robô responde a quem responder?
  situacao            text not null default 'AGENDADA',
  agendada_para       timestamptz not null default now(),
  expira_em           timestamptz,                          -- depois disso, o que não saiu é cancelado
  iniciada_em         timestamptz,
  concluida_em        timestamptz,
  total               integer not null default 0,
  aviso               text,                                 -- último problema (ex.: token vencido)
  preco_unitario      numeric(8,4),
  custo_estimado      numeric(12,2),
  criado_por_id       bigint,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now()
);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'atendimento_campanhas_situacao_check') then
    alter table public.atendimento_campanhas add constraint atendimento_campanhas_situacao_check
      check (situacao in ('AGENDADA', 'ENVIANDO', 'PAUSADA', 'CONCLUIDA', 'CANCELADA'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'atendimento_campanhas_nome_check') then
    alter table public.atendimento_campanhas add constraint atendimento_campanhas_nome_check
      check (length(trim(nome)) between 1 and 120);
  end if;
end $$;
create index if not exists atendimento_campanhas_hotel_idx on public.atendimento_campanhas (hotel_id, criado_em desc);
create index if not exists atendimento_campanhas_fila_idx on public.atendimento_campanhas (situacao, agendada_para)
  where situacao in ('AGENDADA', 'ENVIANDO');

-- ---------------------------------------------------------------------------
-- 2) Envios (uma linha por cliente da campanha)
-- ---------------------------------------------------------------------------
create table if not exists public.atendimento_campanha_envios (
  id           bigserial primary key,
  campanha_id  bigint not null references public.atendimento_campanhas(id) on delete cascade,
  hotel_id     bigint not null references public.hoteis(id) on delete cascade,
  telefone     text not null,
  nome         text,
  contato_id   bigint references public.atendimento_contatos(id) on delete set null,
  conversa_id  bigint references public.atendimento_conversas(id) on delete set null,
  mensagem_id  bigint,
  valores      jsonb not null default '{}'::jsonb,   -- variáveis já prontas para este cliente
  situacao     text not null default 'PENDENTE',
  motivo       text,
  enviado_em   timestamptz,
  saiu_em      timestamptz,                          -- respondeu "SAIR"
  criado_em    timestamptz not null default now(),
  unique (campanha_id, telefone)
);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'atendimento_campanha_envios_situacao_check') then
    alter table public.atendimento_campanha_envios add constraint atendimento_campanha_envios_situacao_check
      check (situacao in ('PENDENTE', 'ENVIADO', 'FALHOU', 'PULADO', 'CANCELADO'));
  end if;
end $$;
create index if not exists atendimento_campanha_envios_fila_idx on public.atendimento_campanha_envios (campanha_id, id)
  where situacao = 'PENDENTE';
create index if not exists atendimento_campanha_envios_conversa_idx on public.atendimento_campanha_envios (conversa_id, enviado_em desc);

-- ---------------------------------------------------------------------------
-- 3) Preço das mensagens de modelo (estimativa; a fatura da Meta é que vale)
-- ---------------------------------------------------------------------------
alter table public.atendimento_campanhas
  add column if not exists aviso text;
alter table public.atendimento_preferencias
  add column if not exists whatsapp_preco_marketing numeric(8,4) not null default 0.35,
  add column if not exists whatsapp_preco_utilidade numeric(8,4) not null default 0.04;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'atendimento_preferencias_precos_modelo_check') then
    alter table public.atendimento_preferencias add constraint atendimento_preferencias_precos_modelo_check
      check (whatsapp_preco_marketing between 0 and 10 and whatsapp_preco_utilidade between 0 and 10);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4) Contador do WhatsApp com o custo dos modelos
-- ---------------------------------------------------------------------------
-- Igual ao da economia, mais: modelos de marketing e de utilidade, quantos a
-- Meta cobrou e o custo estimado deles (utilidade dentro das 24 h é grátis).
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
           m.cobrada, m.cobranca_tipo, lower(coalesce(m.cobranca_categoria, '')) as categoria,
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
           count(*) filter (where tipo <> 'modelo' and not coalesce(enviado_pelo_robo, false) and enviado_por_id is not null) as equipe,
           -- modelos: marketing e utilidade cobrados (sem informação da Meta: conta como marketing)
           count(*) filter (where tipo = 'modelo' and categoria like 'marketing%' and coalesce(cobrada, true)) as modelos_marketing,
           count(*) filter (where tipo = 'modelo' and categoria in ('utility', 'authentication') and coalesce(cobrada, true)) as modelos_utilidade,
           count(*) filter (where tipo = 'modelo' and categoria = '' )                      as modelos_sem_info,
           count(*) filter (where tipo = 'modelo' and cobrada = false)                      as modelos_gratis
      from msg
     group by canal_id, hotel_id, mes
  ),
  calc as (
    select p.*,
           (p.com_info = 0) as estimado,
           case when p.com_info = 0 then greatest(0, p.entregues - 1000) else p.cobradas_meta end as cobradas,
           coalesce(pr.whatsapp_preco_mensagem, 0.04) as preco,
           coalesce(pr.whatsapp_preco_marketing, 0.35) as preco_marketing,
           coalesce(pr.whatsapp_preco_utilidade, 0.04) as preco_utilidade
      from por_mes p
      left join public.atendimento_preferencias pr on pr.hotel_id = p.hotel_id
  ),
  numeros as (
    select k.id as canal_id, k.hotel_id, k.nome, k.endereco_exibicao as numero,
           coalesce(pr.whatsapp_preco_mensagem, 0.04) as preco,
           coalesce(pr.whatsapp_preco_marketing, 0.35) as preco_marketing,
           coalesce(pr.whatsapp_preco_utilidade, 0.04) as preco_utilidade
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
               'preco_marketing', n.preco_marketing, 'preco_utilidade', n.preco_utilidade,
               'meses', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'mes', c.mes, 'atendimento', c.atendimento, 'entregues', c.entregues, 'modelos', c.modelos,
                          'cobradas', c.cobradas, 'estimado', c.estimado,
                          'gratis_franquia', c.gratis_franquia, 'gratis_anuncio', c.gratis_anuncio,
                          'robo', c.robo, 'equipe', c.equipe,
                          'custo', round(c.cobradas * c.preco, 2),
                          'modelos_marketing', c.modelos_marketing + c.modelos_sem_info,
                          'modelos_utilidade', c.modelos_utilidade, 'modelos_gratis', c.modelos_gratis,
                          'modelos_estimado', c.modelos_sem_info > 0,
                          'custo_modelos', round((c.modelos_marketing + c.modelos_sem_info) * c.preco_marketing + c.modelos_utilidade * c.preco_utilidade, 2)
                        ) order by c.mes)
                   from calc c where c.canal_id = n.canal_id), '[]'::jsonb)
             ) order by n.hotel_id, n.canal_id)
        from numeros n), '[]'::jsonb)
  ) into v_saida;
  return v_saida;
end;
$$;
revoke all on function public.atendimento_whatsapp_uso(bigint[], date, date) from public, anon;
grant execute on function public.atendimento_whatsapp_uso(bigint[], date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5) Resumo das campanhas
-- ---------------------------------------------------------------------------
create or replace function public.atendimento_campanhas_resumo(p_ids bigint[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ids   bigint[];
  v_saida jsonb;
begin
  if auth.uid() is null then
    v_ids := p_ids;
  else
    select coalesce(array_agg(c.id), '{}') into v_ids
      from public.atendimento_campanhas c
     where c.id = any(p_ids) and public.atendimento_sou_admin(c.hotel_id);
  end if;
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    return '{}'::jsonb;
  end if;

  with e as (
    select e.*, m.status_envio,
           exists (select 1 from public.atendimento_mensagens r
                    where r.conversa_id = e.conversa_id and r.direcao = 'ENTRADA'
                      and r.criado_em > e.enviado_em and r.criado_em < e.enviado_em + interval '72 hours') as respondeu,
           exists (select 1 from public.atendimento_reservas_detectadas d
                    where d.conversa_id = e.conversa_id and d.criado_em > e.enviado_em
                      and d.criado_em < e.enviado_em + interval '30 days') as reservou,
           (select coalesce(sum(c.reserva_valor), 0) from public.atendimento_cotacoes c
             where c.conversa_id = e.conversa_id and c.status = 'RESERVOU'
               and c.reservou_em > e.enviado_em and c.reservou_em < e.enviado_em + interval '30 days') as valor
      from public.atendimento_campanha_envios e
      left join public.atendimento_mensagens m on m.id = e.mensagem_id
     where e.campanha_id = any(v_ids)
  )
  select coalesce(jsonb_object_agg(campanha_id, x), '{}'::jsonb) into v_saida from (
    select campanha_id, jsonb_build_object(
      'total',      count(*),
      'pendentes',  count(*) filter (where situacao = 'PENDENTE'),
      'enviados',   count(*) filter (where situacao = 'ENVIADO' and coalesce(status_envio, '') <> 'FALHOU'),
      'entregues',  count(*) filter (where situacao = 'ENVIADO' and status_envio in ('ENTREGUE', 'VISTA')),
      'lidos',      count(*) filter (where situacao = 'ENVIADO' and status_envio = 'VISTA'),
      'falhas',     count(*) filter (where situacao = 'FALHOU' or (situacao = 'ENVIADO' and status_envio = 'FALHOU')),
      'pulados',    count(*) filter (where situacao = 'PULADO'),
      'cancelados', count(*) filter (where situacao = 'CANCELADO'),
      'responderam', count(*) filter (where situacao = 'ENVIADO' and respondeu),
      'sairam',     count(*) filter (where saiu_em is not null),
      'reservas',   count(*) filter (where situacao = 'ENVIADO' and reservou),
      'valor',      coalesce(sum(valor) filter (where situacao = 'ENVIADO'), 0)
    ) as x
    from e group by campanha_id
  ) t;
  return v_saida;
end;
$$;
revoke all on function public.atendimento_campanhas_resumo(bigint[]) from public, anon;
grant execute on function public.atendimento_campanhas_resumo(bigint[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6) Segurança (RLS): só o ADMIN do hotel vê; quem grava é o servidor
-- ---------------------------------------------------------------------------
alter table public.atendimento_campanhas       enable row level security;
alter table public.atendimento_campanha_envios enable row level security;

drop policy if exists atendimento_campanhas_admin on public.atendimento_campanhas;
create policy atendimento_campanhas_admin on public.atendimento_campanhas
  for select to authenticated using (public.atendimento_sou_admin(hotel_id));
drop policy if exists atendimento_campanha_envios_admin on public.atendimento_campanha_envios;
create policy atendimento_campanha_envios_admin on public.atendimento_campanha_envios
  for select to authenticated using (public.atendimento_sou_admin(hotel_id));

revoke all on public.atendimento_campanhas, public.atendimento_campanha_envios from anon, authenticated;
grant select on public.atendimento_campanhas, public.atendimento_campanha_envios to authenticated;
grant all on public.atendimento_campanhas, public.atendimento_campanha_envios to service_role;
grant usage, select on sequence public.atendimento_campanhas_id_seq, public.atendimento_campanha_envios_id_seq to service_role;
