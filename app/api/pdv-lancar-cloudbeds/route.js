// ============================================================================
// ROTA DE SERVIDOR: /api/pdv-lancar-cloudbeds
// ============================================================================
// Recebe uma venda do tipo "Lançamento no Quarto" já salva no nosso banco,
// e lança a cobrança na Cloudbeds: um item por produto (postCustomItem,
// sem informar pagamento — assim fica "pendente", para o hóspede pagar na
// saída) + uma anotação na reserva com a descrição da compra.
//
// ⚠️ SOBRE OS NOMES DOS CAMPOS: baseei em documentação oficial da
// Cloudbeds sobre postCustomItem, mas nunca testei contra uma conta real
// — é bem provável que precise de um pequeno ajuste no primeiro teste
// (mesma situação que teve no módulo de Fichas de Hóspedes). Os nomes
// estão reunidos na seção "MAPEAMENTO" abaixo, fácil de ajustar.
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
    // MAPEAMENTO — um único postCustomItem, com todos os produtos dentro
    // do parâmetro "items" (a Cloudbeds recusa se não vier assim —
    // confirmado no primeiro teste real: "Parameter items is required").
    // ============================================================
    const corpoItem = new URLSearchParams({
      reservationID: venda.cloudbeds_reservation_id,
      // Sem "payments" — deixa a cobrança pendente na conta do quarto,
      // para ser paga na saída (conforme pedido).
    });
    // Mandando em dois formatos possíveis (texto JSON + colchetes
    // numerados), mesma estratégia que funcionou nos campos
    // personalizados das Fichas de Hóspedes.
    const listaItensCloudbeds = itens.map((item) => {
      // O appItemID PRECISA continuar só ligado ao produto (sem o nome
      // do hóspede) — a própria Cloudbeds orienta isso, para não criar
      // um "produto" novo no relatório dela a cada venda.
      const nomeComHospede = `${item.nome_produto} - ${venda.nome_hospede || 'Hóspede'}`;
      return {
        appItemID: String(item.produto_id || item.nome_produto).slice(0, 40),
        name: nomeComHospede,
        description: nomeComHospede,
        quantity: Number(item.quantidade),
        unitCost: Number(item.preco_unitario),
        price: Number(item.preco_unitario),
      };
    });
    corpoItem.set('items', JSON.stringify(listaItensCloudbeds));
    listaItensCloudbeds.forEach((it, indice) => {
      corpoItem.set(`items[${indice}][appItemID]`, it.appItemID);
      // A Cloudbeds confirmou "itemQuantity" (com prefixo "item") no
      // primeiro teste real — mandando os dois formatos por garantia.
      corpoItem.set(`items[${indice}][itemName]`, it.name);
      corpoItem.set(`items[${indice}][name]`, it.name);
      corpoItem.set(`items[${indice}][itemDescription]`, it.description);
      corpoItem.set(`items[${indice}][description]`, it.description);
      corpoItem.set(`items[${indice}][itemQuantity]`, String(it.quantity));
      corpoItem.set(`items[${indice}][quantity]`, String(it.quantity));
      corpoItem.set(`items[${indice}][itemUnitCost]`, String(it.unitCost));
      corpoItem.set(`items[${indice}][unitCost]`, String(it.unitCost));
      corpoItem.set(`items[${indice}][itemPrice]`, String(it.price));
      corpoItem.set(`items[${indice}][price]`, String(it.price));
    });

    const respostaItem = await fetch(`${CLOUDBEDS_BASE_URL}/postCustomItem`, {
      method: 'POST',
      headers: { ...cabecalhos, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: corpoItem.toString(),
    });
    const dadosItem = await respostaItem.json().catch(() => null);
    if (!respostaItem.ok || dadosItem?.success === false) {
      const mensagem = dadosItem?.message || 'não foi possível lançar os itens';
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