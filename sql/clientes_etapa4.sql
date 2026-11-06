-- ============================================================================
-- CLIENTE QUE VOLTA — Etapa 4 (histórico de estadias, pesquisa da estadia,
-- aniversário e reativação, reserva cancelada ou alterada)
-- ============================================================================
-- Não apaga nem muda nenhum dado. Pode rodar mais de uma vez.
-- Precisa dos SQL das Etapas 1 e 3 das vendas.
--   1) Automações novas: ANIVERSARIO e REATIVACAO
--   2) Reserva cancelada/alterada na Cloudbeds: marcas para não avisar 2x e
--      para o "vendido" do Painel não contar a reserva cancelada
--   3) Funções que leem as fichas de hóspede (aniversário e última estadia).
--      Só o servidor usa; nenhum dado pessoal sai para a tela.
-- O lembrete de pagamento fica manual (decisão do dono, 05/11/2026).
-- ============================================================================

alter table public.atendimento_automacoes drop constraint if exists atendimento_automacoes_tipo_check;
alter table public.atendimento_automacoes add constraint atendimento_automacoes_tipo_check
  check (tipo in ('FUP_RESERVAR', 'FUP_COTACAO', 'SEM_DISPONIBILIDADE', 'GRUPO', 'CONFIRMACAO_RESERVA', 'PRE_CHECKIN', 'POS_CHECKOUT', 'PESQUISA',
                  'RETOMADA', 'FICHA_VESPERA', 'BOAS_VINDAS', 'DIA_SAIDA', 'OFERTA', 'ANIVERSARIO', 'REATIVACAO'));

alter table public.atendimento_reservas_detectadas
  add column if not exists cancelada_em timestamptz,
  add column if not exists datas        text;          -- "AAAA-MM-DD/AAAA-MM-DD" da última mudança avisada
alter table public.atendimento_cotacoes
  add column if not exists reserva_cancelada_em timestamptz;
-- Inscrições do aviso de reserva na Cloudbeds (situação mudou, datas mudaram)
alter table public.hoteis add column if not exists governanca_webhook_reserva_ids text[];

-- Aniversariantes do dia (pela ficha), um por telefone, que se hospedaram nos
-- últimos 3 anos
create or replace function public.atendimento_aniversariantes(p_hotel bigint, p_dia date)
returns table (nome text, telefone text, ultima date)
language sql
stable
security definer
set search_path = public
as $$
  select (array_agg(f.nome_completo order by f.data_checkin desc nulls last))[1],
         regexp_replace(f.telefone, '\D', '', 'g'),
         max(f.data_checkin::date)
    from public.fichas_fnrh f
   where f.hotel_id = p_hotel
     and f.telefone is not null and length(regexp_replace(f.telefone, '\D', '', 'g')) >= 10
     and f.data_nascimento is not null
     and extract(month from f.data_nascimento::date) = extract(month from p_dia)
     and extract(day from f.data_nascimento::date) = extract(day from p_dia)
   group by regexp_replace(f.telefone, '\D', '', 'g')
  having max(f.data_checkin::date) >= p_dia - interval '3 years';
$$;

-- Quem teve a última estadia entre p_de e p_ate (e nenhuma depois), um por telefone
create or replace function public.atendimento_para_reativar(p_hotel bigint, p_de date, p_ate date)
returns table (nome text, telefone text, ultima date)
language sql
stable
security definer
set search_path = public
as $$
  select (array_agg(f.nome_completo order by f.data_checkin desc nulls last))[1],
         regexp_replace(f.telefone, '\D', '', 'g'),
         max(coalesce(f.data_checkout::date, f.data_checkin::date))
    from public.fichas_fnrh f
   where f.hotel_id = p_hotel
     and f.telefone is not null and length(regexp_replace(f.telefone, '\D', '', 'g')) >= 10
   group by regexp_replace(f.telefone, '\D', '', 'g')
  having max(coalesce(f.data_checkout::date, f.data_checkin::date)) between p_de and p_ate;
$$;

revoke all on function public.atendimento_aniversariantes(bigint, date) from public, anon, authenticated;
revoke all on function public.atendimento_para_reativar(bigint, date, date) from public, anon, authenticated;
grant execute on function public.atendimento_aniversariantes(bigint, date) to service_role;
grant execute on function public.atendimento_para_reativar(bigint, date, date) to service_role;

-- Conferência: tudo true
select
  pg_get_constraintdef((select oid from pg_constraint where conname = 'atendimento_automacoes_tipo_check')) like '%REATIVACAO%' as automacoes,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'atendimento_reservas_detectadas' and column_name = 'cancelada_em') as cancelamento,
  exists (select 1 from pg_proc where proname = 'atendimento_aniversariantes') as aniversario,
  exists (select 1 from pg_proc where proname = 'atendimento_para_reativar') as reativacao;
