-- ============================================================================
-- CAIXA DE ENTRADA (Atendimento → Caixa de Entrada) — Fase 1, Parte A
-- WhatsApp + E-mails do Google Workspace          (pode rodar várias vezes)
-- ============================================================================
-- Quem acessa: ADMIN e COLABORADOR com a permissão "Pode usar a Caixa de
-- Entrada" (marcada pelo ADMIN em Administração → Usuários).
--
-- Tabelas:
--   atendimento_config      → configurações do hotel (Google, Meta)        [ADMIN]
--   atendimento_segredos    → chaves e senhas criptografadas      [só o servidor]
--   atendimento_canais      → números de WhatsApp e caixas de e-mail ligados
--   atendimento_conversas   → uma conversa por cliente (WhatsApp) ou por
--                             fio de e-mail (Gmail)
--   atendimento_mensagens   → mensagens recebidas, enviadas e notas internas
--   atendimento_respostas_prontas → textos prontos ("/bomdia", "/checkin"...)
-- Arquivos (fotos, áudios, PDFs) ficam no Storage, pasta privada
-- "atendimento-anexos" — só o servidor entrega, com link temporário.
-- Tabelas novas com GRANT explícito (mudança do Supabase de 30/10/2026).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0) Permissão por usuário
-- ---------------------------------------------------------------------------
alter table public.usuarios
  add column if not exists pode_acessar_atendimento boolean not null default false;

-- Quem pode atender no hotel atual: ADMIN, ou COLABORADOR com a permissão
create or replace function public.posso_atender()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.sou_admin(), false)
      or exists (
        select 1 from public.usuarios u
         where u.auth_id = auth.uid()
           and u.papel = 'COLABORADOR'
           and u.pode_acessar_atendimento is true
           and coalesce(u.ativo, true)
      );
$$;
revoke all on function public.posso_atender() from public, anon;
grant execute on function public.posso_atender() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1) Configuração do hotel (nada secreto aqui)
-- ---------------------------------------------------------------------------
create table if not exists public.atendimento_config (
  hotel_id          bigint primary key references public.hoteis(id) on delete cascade,
  google_client_id  text,
  meta_verify_token text,
  meta_app_id       text,
  atualizado_por_id bigint,
  atualizado_em     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2) Segredos (criptografados pelo servidor; ninguém lê pela tela)
--    canal_id = 0 → segredo do hotel (ex.: senha do app do Google)
-- ---------------------------------------------------------------------------
create table if not exists public.atendimento_segredos (
  id            bigserial primary key,
  hotel_id      bigint not null references public.hoteis(id) on delete cascade,
  canal_id      bigint not null default 0,
  chave         text not null,
  valor_cifrado text not null,
  atualizado_em timestamptz not null default now(),
  unique (hotel_id, canal_id, chave)
);

-- ---------------------------------------------------------------------------
-- 3) Canais (WhatsApp / E-mail; Instagram e Facebook na Parte B)
-- ---------------------------------------------------------------------------
create table if not exists public.atendimento_canais (
  id                   bigserial primary key,
  hotel_id             bigint not null references public.hoteis(id) on delete cascade,
  tipo                 text not null check (tipo in ('WHATSAPP', 'EMAIL', 'INSTAGRAM', 'FACEBOOK')),
  nome                 text not null,
  identificador        text not null,      -- WhatsApp: phone_number_id · E-mail: endereço
  endereco_exibicao    text,               -- número formatado ou e-mail
  config               jsonb not null default '{}'::jsonb,
  ativo                boolean not null default true,
  status               text not null default 'OK',
  erro                 text,
  ultima_sincronizacao timestamptz,
  criado_por_id        bigint,
  criado_em            timestamptz not null default now(),
  atualizado_em        timestamptz not null default now(),
  unique (tipo, identificador)
);

-- ---------------------------------------------------------------------------
-- 4) Conversas
-- ---------------------------------------------------------------------------
create table if not exists public.atendimento_conversas (
  id                       bigserial primary key,
  hotel_id                 bigint not null references public.hoteis(id) on delete cascade,
  canal_id                 bigint references public.atendimento_canais(id) on delete set null,
  canal_tipo               text not null,
  chave_externa            text not null,  -- WhatsApp: número do cliente · E-mail: id do fio no Gmail
  contato_nome             text,
  contato_endereco         text,           -- telefone ou e-mail do cliente
  assunto                  text,
  status                   text not null default 'ABERTA' check (status in ('ABERTA', 'PENDENTE', 'RESOLVIDA')),
  responsavel_id           bigint,
  nao_lidas                integer not null default 0,
  ultima_mensagem_em       timestamptz,
  ultima_mensagem_resumo   text,
  ultima_direcao           text,
  ultima_entrada_em        timestamptz,    -- janela de 24 h do WhatsApp
  cloudbeds_reservation_id text,
  criado_em                timestamptz not null default now(),
  atualizado_em            timestamptz not null default now(),
  unique (canal_id, chave_externa)
);
create index if not exists atendimento_conversas_lista_idx
  on public.atendimento_conversas (hotel_id, ultima_mensagem_em desc nulls last);

-- ---------------------------------------------------------------------------
-- 5) Mensagens
--    direcao: ENTRADA (cliente) · SAIDA (hotel) · NOTA (interna, cliente não vê)
--    status_envio: NAO_LIDA / LIDA (entrada) · ENVIANDO / ENVIADA / ENTREGUE /
--                  VISTA / FALHOU (saída)
-- ---------------------------------------------------------------------------
create table if not exists public.atendimento_mensagens (
  id             bigserial primary key,
  hotel_id       bigint not null references public.hoteis(id) on delete cascade,
  conversa_id    bigint not null references public.atendimento_conversas(id) on delete cascade,
  direcao        text not null check (direcao in ('ENTRADA', 'SAIDA', 'NOTA')),
  tipo           text not null default 'texto',
  texto          text,
  html           text,
  de             text,
  para           text,
  cc             text,
  assunto        text,
  anexos         jsonb not null default '[]'::jsonb,
  id_externo     text,
  status_envio   text,
  erro           text,
  enviado_por_id bigint,
  data_original  timestamptz,
  criado_em      timestamptz not null default now(),
  unique (hotel_id, id_externo)
);
create index if not exists atendimento_mensagens_conversa_idx
  on public.atendimento_mensagens (conversa_id, criado_em);

-- Atualiza o resumo da conversa a cada mensagem nova (contagem de não lidas,
-- última mensagem, janela de 24 h, e reabre se o cliente escrever de novo).
create or replace function public.atendimento_apos_mensagem()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  quando timestamptz := coalesce(new.data_original, new.criado_em, now());
begin
  if new.direcao = 'NOTA' then
    update public.atendimento_conversas set atualizado_em = now() where id = new.conversa_id;
    return new;
  end if;

  update public.atendimento_conversas c set
    ultima_mensagem_resumo = case when quando >= coalesce(c.ultima_mensagem_em, '-infinity'::timestamptz)
                                  then left(coalesce(nullif(btrim(new.texto), ''), '[' || new.tipo || ']'), 160)
                                  else c.ultima_mensagem_resumo end,
    ultima_direcao         = case when quando >= coalesce(c.ultima_mensagem_em, '-infinity'::timestamptz)
                                  then new.direcao else c.ultima_direcao end,
    ultima_mensagem_em     = greatest(coalesce(c.ultima_mensagem_em, '-infinity'::timestamptz), quando),
    nao_lidas              = c.nao_lidas + case when new.direcao = 'ENTRADA' and new.status_envio = 'NAO_LIDA' then 1 else 0 end,
    ultima_entrada_em      = case when new.direcao = 'ENTRADA'
                                  then greatest(coalesce(c.ultima_entrada_em, '-infinity'::timestamptz), quando)
                                  else c.ultima_entrada_em end,
    status                 = case when new.direcao = 'ENTRADA' and new.status_envio = 'NAO_LIDA' and c.status = 'RESOLVIDA'
                                  then 'ABERTA' else c.status end,
    atualizado_em          = now()
  where c.id = new.conversa_id;
  return new;
end;
$$;

drop trigger if exists atendimento_apos_mensagem on public.atendimento_mensagens;
create trigger atendimento_apos_mensagem
  after insert on public.atendimento_mensagens
  for each row execute function public.atendimento_apos_mensagem();

-- ---------------------------------------------------------------------------
-- 6) Respostas prontas
-- ---------------------------------------------------------------------------
create table if not exists public.atendimento_respostas_prontas (
  id            bigserial primary key,
  hotel_id      bigint not null references public.hoteis(id) on delete cascade,
  atalho        text not null,
  titulo        text,
  texto         text not null,
  criado_por_id bigint,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists atendimento_respostas_atalho_idx
  on public.atendimento_respostas_prontas (hotel_id, lower(atalho));

-- ---------------------------------------------------------------------------
-- 7) Segurança (RLS)
-- ---------------------------------------------------------------------------
alter table public.atendimento_config            enable row level security;
alter table public.atendimento_segredos          enable row level security;
alter table public.atendimento_canais            enable row level security;
alter table public.atendimento_conversas         enable row level security;
alter table public.atendimento_mensagens         enable row level security;
alter table public.atendimento_respostas_prontas enable row level security;

drop policy if exists atendimento_config_admin on public.atendimento_config;
create policy atendimento_config_admin on public.atendimento_config
  for select to authenticated
  using (public.sou_admin() and hotel_id = public.meu_hotel_id());

-- atendimento_segredos: nenhuma política → só o servidor (service_role) acessa.

drop policy if exists atendimento_canais_ver on public.atendimento_canais;
create policy atendimento_canais_ver on public.atendimento_canais
  for select to authenticated
  using (hotel_id = public.meu_hotel_id() and public.posso_atender());

drop policy if exists atendimento_conversas_ver on public.atendimento_conversas;
create policy atendimento_conversas_ver on public.atendimento_conversas
  for select to authenticated
  using (hotel_id = public.meu_hotel_id() and public.posso_atender());

drop policy if exists atendimento_conversas_alterar on public.atendimento_conversas;
create policy atendimento_conversas_alterar on public.atendimento_conversas
  for update to authenticated
  using (hotel_id = public.meu_hotel_id() and public.posso_atender())
  with check (hotel_id = public.meu_hotel_id() and public.posso_atender());

drop policy if exists atendimento_mensagens_ver on public.atendimento_mensagens;
create policy atendimento_mensagens_ver on public.atendimento_mensagens
  for select to authenticated
  using (hotel_id = public.meu_hotel_id() and public.posso_atender());

drop policy if exists atendimento_respostas_todas on public.atendimento_respostas_prontas;
create policy atendimento_respostas_todas on public.atendimento_respostas_prontas
  for all to authenticated
  using (hotel_id = public.meu_hotel_id() and public.posso_atender())
  with check (hotel_id = public.meu_hotel_id() and public.posso_atender());

-- ---------------------------------------------------------------------------
-- 8) Permissões (tabelas novas). Visitante (anon) não tem acesso a nada.
--    Mensagens e canais só são gravados pelo servidor.
-- ---------------------------------------------------------------------------
revoke all on public.atendimento_config, public.atendimento_segredos, public.atendimento_canais,
              public.atendimento_conversas, public.atendimento_mensagens, public.atendimento_respostas_prontas
  from anon;
revoke all on public.atendimento_segredos from authenticated;

grant select                         on public.atendimento_config            to authenticated;
grant select                         on public.atendimento_canais            to authenticated;
grant select, update                 on public.atendimento_conversas         to authenticated;
grant select                         on public.atendimento_mensagens         to authenticated;
grant select, insert, update, delete on public.atendimento_respostas_prontas to authenticated;
grant usage, select on sequence public.atendimento_respostas_prontas_id_seq to authenticated;

grant all on public.atendimento_config, public.atendimento_segredos, public.atendimento_canais,
             public.atendimento_conversas, public.atendimento_mensagens, public.atendimento_respostas_prontas
  to service_role;
grant usage, select on all sequences in schema public to service_role;

-- ---------------------------------------------------------------------------
-- 9) Atualização ao vivo na tela (Supabase Realtime) — se existir
-- ---------------------------------------------------------------------------
do $$
declare
  tabela text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach tabela in array array['atendimento_conversas', 'atendimento_mensagens'] loop
      if not exists (
        select 1 from pg_publication_tables
         where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = tabela
      ) then
        execute format('alter publication supabase_realtime add table public.%I', tabela);
      end if;
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 10) Pasta privada para anexos (fotos, áudios, PDFs)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    execute $q$
      insert into storage.buckets (id, name, public, file_size_limit)
      values ('atendimento-anexos', 'atendimento-anexos', false, 104857600)
      on conflict (id) do nothing
    $q$;
  end if;
end $$;

-- Pronto! Confira: deve aparecer 6 linhas.
select table_name from information_schema.tables
 where table_schema = 'public' and table_name like 'atendimento_%'
 order by table_name;
