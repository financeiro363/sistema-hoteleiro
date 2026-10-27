-- ============================================================================
-- CAIXA DE ENTRADA — FASE 1B: CHAT DO SITE              (pode rodar várias vezes)
-- ============================================================================
-- Rodar DEPOIS dos SQLs anteriores da Caixa de Entrada (até a Fase 6).
--
--  1. Canal novo "SITE" (chat no site do hotel).
--  2. Dados do visitante na conversa (página, cidade aproximada, idioma,
--     aparelho) e o controle do aviso por e-mail.
--  3. Contato deixado pelo visitante (nome e WhatsApp ou e-mail): junta com o
--     cadastro que já existir do mesmo cliente.
--  4. Respostas que o visitante não leu em 10 minutos: lista para a função
--     agendada mandar por e-mail.
--
-- Quem grava é só o servidor do sistema (chave de serviço). O site do hotel
-- não fala com o banco: fala com o sistema, que confere o endereço do site,
-- limita a quantidade de mensagens e guarda só um resumo (hash) do IP.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Canal "SITE"
-- ---------------------------------------------------------------------------
alter table public.atendimento_canais drop constraint if exists atendimento_canais_tipo_check;
alter table public.atendimento_canais add constraint atendimento_canais_tipo_check
  check (tipo in ('WHATSAPP', 'EMAIL', 'INSTAGRAM', 'FACEBOOK', 'SITE'));

-- ---------------------------------------------------------------------------
-- 2) Conversa do chat do site
-- ---------------------------------------------------------------------------
--  visitante         → { pagina, titulo, referencia, utm, idioma, fuso, cidade,
--                        estado, pais, aparelho, ip (hash) }
--  site_visto_em     → última vez que a janela do chat buscou mensagens
--                      (gravado no máximo 1 vez por minuto)
--  site_email_msg_id → até qual resposta já foi avisada por e-mail
alter table public.atendimento_conversas
  add column if not exists visitante         jsonb,
  add column if not exists site_visto_em     timestamptz,
  add column if not exists site_email_msg_id bigint;

create index if not exists atendimento_conversas_site_idx
  on public.atendimento_conversas (canal_id, criado_em desc)
  where canal_tipo = 'SITE';

-- ---------------------------------------------------------------------------
-- 3) Contato deixado pelo visitante
-- ---------------------------------------------------------------------------
-- Procura o cliente pelo telefone (com e sem o 9) ou pelo e-mail; se não
-- achar, cria. Completa o que faltar no cadastro e liga a conversa a ele.
create or replace function public.atendimento_site_contato(p_conversa bigint, p_nome text, p_telefone text, p_email text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conv  public.atendimento_conversas%rowtype;
  v_id    bigint;
  v_nome  text := nullif(btrim(coalesce(p_nome, '')), '');
  v_tel   text := nullif(regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g'), '');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
begin
  select * into v_conv from public.atendimento_conversas where id = p_conversa and canal_tipo = 'SITE';
  if not found then
    raise exception 'Conversa do chat do site não encontrada.' using errcode = 'P0001';
  end if;
  if v_tel is null and v_email is null then
    raise exception 'Informe o WhatsApp ou o e-mail.' using errcode = 'P0001';
  end if;

  if v_tel is not null then
    select id into v_id from public.atendimento_contatos
     where hotel_id = v_conv.hotel_id and telefone = any(public.atendimento_variantes_telefone(v_tel))
     order by id limit 1;
  end if;
  if v_id is null and v_email is not null then
    select id into v_id from public.atendimento_contatos
     where hotel_id = v_conv.hotel_id and lower(email) = v_email
     order by id limit 1;
  end if;

  if v_id is null then
    insert into public.atendimento_contatos (hotel_id, nome, telefone, email, idioma, origem)
    values (v_conv.hotel_id, v_nome, v_tel, v_email, nullif(v_conv.visitante->>'idioma', ''), 'SITE')
    returning id into v_id;
  else
    update public.atendimento_contatos set
      nome          = coalesce(nome, v_nome),
      telefone      = coalesce(telefone, v_tel),
      email         = coalesce(email, v_email),
      atualizado_em = now()
    where id = v_id;
  end if;

  update public.atendimento_conversas set
    contato_id       = v_id,
    contato_nome     = coalesce(v_nome, contato_nome),
    contato_endereco = coalesce(v_email, contato_endereco, v_tel),
    atualizado_em    = now()
  where id = p_conversa;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) Respostas que o visitante não leu: avisar por e-mail
-- ---------------------------------------------------------------------------
-- Conversas do chat do site com resposta do hotel (equipe ou robô) que a
-- janela do chat não entregou há mais de p_minutos, de até 3 dias, e que
-- ainda não foram avisadas. Só entra quem deixou e-mail.
create or replace function public.atendimento_site_para_avisar(p_minutos integer default 10, p_limite integer default 10)
returns table (conversa_id bigint, hotel_id bigint, email text, nome text, pagina text, ate_id bigint, mensagens jsonb)
language sql
stable
security definer
set search_path = public
as $$
  with pendentes as (
    select c.id as conversa_id, c.hotel_id, m.id, m.texto, m.criado_em,
           coalesce(nullif(ct.email, ''), case when c.contato_endereco like '%@%' then c.contato_endereco end) as email,
           coalesce(ct.nome, c.contato_nome) as nome, c.visitante->>'pagina' as pagina
      from public.atendimento_conversas c
      join public.atendimento_mensagens m on m.conversa_id = c.id
      left join public.atendimento_contatos ct on ct.id = c.contato_id
     where c.canal_tipo = 'SITE'
       and m.direcao = 'SAIDA'
       and m.status_envio in ('ENVIADA', 'ENTREGUE')
       and m.criado_em < now() - make_interval(mins => greatest(p_minutos, 1))
       and m.criado_em > now() - interval '3 days'
       and m.id > coalesce(c.site_email_msg_id, 0)
  )
  select p.conversa_id, p.hotel_id, min(p.email), min(p.nome), min(p.pagina), max(p.id),
         jsonb_agg(jsonb_build_object('id', p.id, 'texto', p.texto, 'criado_em', p.criado_em) order by p.id)
    from pendentes p
   where p.email is not null
   group by p.conversa_id, p.hotel_id
   order by max(p.id)
   limit greatest(p_limite, 1);
$$;

revoke all on function public.atendimento_site_contato(bigint, text, text, text) from public, anon, authenticated;
revoke all on function public.atendimento_site_para_avisar(integer, integer) from public, anon, authenticated;
grant execute on function public.atendimento_site_contato(bigint, text, text, text) to service_role;
grant execute on function public.atendimento_site_para_avisar(integer, integer) to service_role;
