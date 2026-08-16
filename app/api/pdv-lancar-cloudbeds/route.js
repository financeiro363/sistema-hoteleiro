// ============================================================================
// ROTA DE SERVIDOR: /api/pdv-lancar-cloudbeds
// ============================================================================
// Recebe uma venda do tipo "Lançamento no Quarto" já salva no nosso banco,
// e lança a cobrança na Cloudbeds usando o endpoint item/v1/items
// (confirmado na documentação oficial, com print da conta real do
// hotel) — sem informar pagamento, então fica "pendente" na conta do
// quarto. O nome do hóspede que retirou o item vai no campo "itemNote"
// de cada item. Também escreve uma anotação geral na reserva.
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import { descriptografar } from '../../../lib/cloudbedsCrypto';

const CLOUDBEDS_BASE_URL = 'https://api.cloudbeds.com/api/v1.2';

export async function POST(request) {
  try {
    const corpo = await request.json();
    const vendaId = corpo?.vendaId;
    if (!vendaId) {
      return Response.json({ erro: 'Informe a venda a lançar.' }, { status: 400 });
    }

    const tokenAcesso = (request.headers.get('authorization') || '').replace('Bearer ', '');
    if (!tokenAcesso) {
      return Response.json({ erro: 'Não autorizado — faça login novamente.' }, { status: 401 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const chaveAnonima = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const chaveMestra = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const segredoCripto = process.env.CLOUDBEDS_CRYPTO_SECRET;
    if (!supabaseUrl || !chaveAnonima || !chaveMestra || !segredoCripto) {
      return Response.json({ erro: 'O servidor não está configurado corretamente (faltam variáveis de ambiente).' }, { status: 500 });
    }

    const supabaseComoChamador = createClient(supabaseUrl, chaveAnonima, {
      global: { headers: { Authorization: `Bearer ${tokenAcesso}` } },
    });
    const { data: dadosAuth, error: erroAuth } = await supabaseComoChamador.auth.getUser(tokenAcesso);
    if (erroAuth || !dadosAuth?.user) {
      return Response.json({ erro: 'Sessão inválida ou expirada.' }, { status: 401 });
    }
    const { data: chamador, error: erroChamador } = await supabaseComoChamador
      .from('usuarios').select('id, hotel_id').eq('auth_id', dadosAuth.user.id).single();
    if (erroChamador || !chamador) {
      return Response.json({ erro: 'Não foi possível confirmar seu usuário.' }, { status: 403 });
    }

    const supabaseAdmin = createClient(supabaseUrl, chaveMestra);

    // Busca a venda + os itens dela
    const { data: venda, error: erroVenda } = await supabaseAdmin
      .from('pdv_vendas').select('*').eq('id', vendaId).eq('hotel_id', chamador.hotel_id).single();
    if (erroVenda || !venda) {
      return Response.json({ erro: 'Venda não encontrada.' }, { status: 404 });
    }
    if (venda.tipo_pagamento !== 'QUARTO' || !venda.cloudbeds_reservation_id) {
      return Response.json({ erro: 'Essa venda não é do tipo "Lançamento no Quarto".' }, { status: 400 });
    }
    const { data: itens, error: erroItens } = await supabaseAdmin
      .from('pdv_venda_itens').select('*').eq('venda_id', vendaId);
    if (erroItens || !itens?.length) {
      return Response.json({ erro: 'Não foi possível carregar os itens da venda.' }, { status: 400 });
    }

    // Credencial da Cloudbeds
    const { data: credencial, error: erroCred } = await supabaseAdmin
      .from('cloudbeds_credenciais').select('*').eq('hotel_id', chamador.hotel_id).maybeSingle();
    if (erroCred || !credencial?.api_key_cifrada) {
      return Response.json({ erro: 'A integração com a Cloudbeds ainda não foi configurada para este hotel.' }, { status: 400 });
    }
    let apiKey;
    try { apiKey = descriptografar(credencial.api_key_cifrada, segredoCripto); }
    catch (e) { return Response.json({ erro: 'Não foi possível ler a credencial salva.' }, { status: 500 }); }

    const cabecalhos = {
      Authorization: `Bearer ${apiKey}`,
      ...(credencial.cloudbeds_property_id ? { 'x-property-id': credencial.cloudbeds_property_id } : {}),
    };

    // ============================================================
    // MAPEAMENTO — endpoint mais novo e confirmado pela documentação
    // oficial (item/v1/items). Diferenças importantes em relação à
    // tentativa anterior:
    //  - É JSON (não "application/x-www-form-urlencoded")
    //  - O preço vai em CENTAVOS, como texto (ex.: R$ 10,50 -> "1050")
    //  - Tem um campo "itemNote" — é aqui que colocamos o nome do
    //    hóspede que retirou o produto, exatamente o que faltava.
    //  - O "itemId" TEM que ser um item que já existe no catálogo da
    //    Cloudbeds (não dá para inventar um ID) — por isso usamos o
    //    cloudbeds_item_id salvo no cadastro do produto, não o nosso ID
    //    interno.
    // ============================================================
    const itensSemCloudbedsId = itens.filter((item) => !item.cloudbeds_item_id);
    if (itensSemCloudbedsId.length > 0) {
      const nomes = itensSemCloudbedsId.map((i) => i.nome_produto).join(', ');
      return Response.json({
        erro: `Estes produtos ainda não têm o "ID do item na Cloudbeds" cadastrado: ${nomes}. Cadastre esse ID em Preços e Estoque → editar o produto, e tente de novo.`,
      }, { status: 400 });
    }

    const nomeHospedeVenda = venda.nome_hospede || 'Hóspede';
    const corpoJson = {
      reservationId: venda.cloudbeds_reservation_id,
      items: itens.map((item) => ({
        itemId: item.cloudbeds_item_id,
        itemQuantity: Number(item.quantidade),
        itemPrice: String(Math.round(Number(item.preco_unitario) * 100)),
        itemNote: `${item.nome_produto} — Retirado por: ${nomeHospedeVenda}`,
        // Sem "payments" e sem "itemPaid" — deixa a cobrança pendente na
        // conta do quarto, para ser paga na saída (conforme pedido).
      })),
    };

    const respostaItem = await fetch('https://api.cloudbeds.com/item/v1/items', {
      method: 'POST',
      headers: { ...cabecalhos, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(corpoJson),
    });
    const dadosItem = await respostaItem.json().catch(() => null);
    if (!respostaItem.ok || dadosItem?.success === false) {
      const mensagem = dadosItem?.message || JSON.stringify(dadosItem) || 'não foi possível lançar os itens';
      await supabaseAdmin.from('pdv_vendas').update({ cloudbeds_status: 'FALHOU', cloudbeds_erro: mensagem }).eq('id', vendaId);
      return Response.json({ erro: `A Cloudbeds recusou o lançamento: ${mensagem}` }, { status: 400 });
    }

    // Anotação na reserva com a descrição completa da compra
    try {
      const listaItens = itens.map((i) => `${i.quantidade}x ${i.nome_produto}`).join(', ');
      const nomeHospede = venda.nome_hospede || 'Hóspede';
      await fetch(`${CLOUDBEDS_BASE_URL}/postReservationNote`, {
        method: 'POST',
        headers: { ...cabecalhos, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          reservationID: venda.cloudbeds_reservation_id,
          note: `Consumo Conveniência: ${listaItens} - Retirado pelo hóspede: ${nomeHospede}`,
        }).toString(),
      });
    } catch (e) { /* melhor esforço — a cobrança já foi lançada de qualquer forma */ }

    await supabaseAdmin.from('pdv_vendas').update({ cloudbeds_status: 'ENVIADO', cloudbeds_erro: null }).eq('id', vendaId);

    return Response.json({ sucesso: true });
  } catch (erro) {
    return Response.json({ erro: 'Erro inesperado no servidor: ' + erro.message }, { status: 500 });
  }
}