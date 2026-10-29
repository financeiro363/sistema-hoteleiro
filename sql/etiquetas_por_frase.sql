-- ============================================================================
-- ETIQUETAS AUTOMÁTICAS POR FRASE (item 5 da varredura do Asksuite de 27/10)
-- ============================================================================
-- O ADMIN cadastra frases (ex.: “Quero reservar!”, a mensagem pronta do
-- anúncio). Quando a 1ª mensagem do cliente tem uma delas, a conversa ganha a
-- etiqueta da regra (padrão: AD, que já conta em “Vieram de anúncio” no Painel).
-- Se a regra tiver resposta pronta, ela só é enviada quando o robô não vai
-- responder (desligado, pausado na conversa ou canal sem robô).
-- Canais: os de conversa (WhatsApp, chat do site, Instagram, Facebook); o
-- e-mail fica de fora.
-- Decidido pelo Eduardo em 29/10. Pode rodar mais de uma vez.
-- ============================================================================

create table if not exists public.atendimento_frases_etiqueta (
  id            bigserial primary key,
  hotel_id      bigint not null references public.hoteis(id) on delete cascade,
  nome          text,                               -- só para a equipe se achar (ex.: "Anúncio de dezembro")
  frases        text[] not null default '{}',
  etiqueta      text not null default 'AD',
  resposta      text,                               -- vazia = só a etiqueta
  ativo         boolean not null default true,
  vezes         integer not null default 0,         -- quantas conversas a regra já marcou
  ultima_vez    timestamptz,
  criado_por_id bigint,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'atendimento_frases_etiqueta_check') then
    alter table public.atendimento_frases_etiqueta add constraint atendimento_frases_etiqueta_check check (
      coalesce(array_length(frases, 1), 0) between 1 and 50
      and length(trim(etiqueta)) between 1 and 40
      and (nome is null or length(nome) <= 80)
      and (resposta is null or length(resposta) <= 2000));
  end if;
end $$;

create index if not exists atendimento_frases_etiqueta_hotel_idx on public.atendimento_frases_etiqueta (hotel_id) where ativo;

-- Só o ADMIN do hotel vê e mexe nas regras (o servidor usa a chave de serviço)
alter table public.atendimento_frases_etiqueta enable row level security;
drop policy if exists atendimento_frases_etiqueta_admin on public.atendimento_frases_etiqueta;
create policy atendimento_frases_etiqueta_admin on public.atendimento_frases_etiqueta
  for all to authenticated
  using (public.atendimento_sou_admin(hotel_id))
  with check (public.atendimento_sou_admin(hotel_id));

revoke all on public.atendimento_frases_etiqueta from anon;
grant select, insert, update, delete on public.atendimento_frases_etiqueta to authenticated;
grant all on public.atendimento_frases_etiqueta to service_role;
grant usage, select on sequence public.atendimento_frases_etiqueta_id_seq to authenticated, service_role;

-- Conferência: deve mostrar 1 tabela
select count(*) as tabela_nova from information_schema.tables
 where table_schema = 'public' and table_name = 'atendimento_frases_etiqueta';
