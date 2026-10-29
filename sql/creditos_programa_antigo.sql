-- ============================================================================
-- CRÉDITOS DE HÓSPEDES — campos do programa antigo (29/10/2026)
-- ============================================================================
-- A planilha do programa antigo ("créditos a devolver") tem dados que a
-- tabela creditos_hospedes ainda não tinha. Este SQL cria esses campos, para
-- importar a planilha inteira e para a equipe preencher daqui para a frente:
--   data_checkin, data_checkout, data_pagamento, forma_pagamento,
--   documento_bancario                       → quando o crédito foi pago
--   lancado_fatura_reserva, nome_pax_lancado,
--   valor_devolvido                          → onde/como o crédito foi usado
--   encerrado_por_nome                       → nome de quem encerrou, guardado
--                                              como texto (vale também para
--                                              quem já saiu da empresa)
--   importado_de, importado_chave,
--   importado_em                             → marca das linhas importadas
-- E a forma de encerramento nova DINHEIRO (devolvido em dinheiro, em mãos).
-- Não apaga nem muda nenhum dado. Pode rodar mais de uma vez.
-- ============================================================================

alter table public.creditos_hospedes
  add column if not exists data_checkin           date,
  add column if not exists data_checkout          date,
  add column if not exists data_pagamento         date,
  add column if not exists forma_pagamento        text,
  add column if not exists documento_bancario     text,
  add column if not exists lancado_fatura_reserva text,
  add column if not exists nome_pax_lancado       text,
  add column if not exists valor_devolvido        numeric(12,2),
  add column if not exists encerrado_por_nome     text,
  add column if not exists importado_de           text,
  add column if not exists importado_chave        text,
  add column if not exists importado_em           timestamptz;

-- Uma linha da planilha entra uma vez só (rodar a importação de novo não duplica)
create unique index if not exists creditos_hospedes_importado_chave_idx
  on public.creditos_hospedes (importado_chave) where importado_chave is not null;

-- Créditos do programa antigo não têm quem cadastrou no sistema novo
alter table public.creditos_hospedes alter column criado_por_id drop not null;

-- Formas de encerramento: as de antes + DINHEIRO. Se já existe uma regra
-- (check) com a lista das formas, ela é refeita com DINHEIRO na lista, sem
-- perder o resto da regra; se não existe, cria uma.
do $$
declare
  r record;
  v_def text;
  v_achou boolean := false;
begin
  for r in
    select con.conname, pg_get_constraintdef(con.oid) as def
      from pg_constraint con
     where con.conrelid = 'public.creditos_hospedes'::regclass and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%NOVA_RESERVA%'
  loop
    v_achou := true;
    if r.def ilike '%DINHEIRO%' then continue; end if;   -- já tem
    v_def := regexp_replace(r.def, '''NOVA_RESERVA''(::[a-z ]+)?', '''NOVA_RESERVA''\1, ''DINHEIRO''\1', 'g');
    execute format('alter table public.creditos_hospedes drop constraint %I', r.conname);
    execute format('alter table public.creditos_hospedes add constraint %I %s', r.conname, v_def);
  end loop;
  if not v_achou and not exists (select 1 from pg_constraint where conname = 'creditos_hospedes_forma_encerramento_valida') then
    alter table public.creditos_hospedes add constraint creditos_hospedes_forma_encerramento_valida
      check (forma_encerramento is null or forma_encerramento in ('PIX', 'DEPOSITO', 'CARTAO', 'NOVA_RESERVA', 'DINHEIRO'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'creditos_hospedes_valor_devolvido_check') then
    alter table public.creditos_hospedes add constraint creditos_hospedes_valor_devolvido_check
      check (valor_devolvido is null or valor_devolvido >= 0);
  end if;
end $$;

-- Conferência: deve mostrar 12 colunas novas
select count(*) as colunas_novas from information_schema.columns
 where table_schema = 'public' and table_name = 'creditos_hospedes'
   and column_name in ('data_checkin', 'data_checkout', 'data_pagamento', 'forma_pagamento', 'documento_bancario',
                       'lancado_fatura_reserva', 'nome_pax_lancado', 'valor_devolvido', 'encerrado_por_nome',
                       'importado_de', 'importado_chave', 'importado_em');
