// ============================================================================
// ROTA DE SERVIDOR: /api/pdv-lancar-cloudbeds
// ============================================================================
// VENDA AVULSA (dinheiro, Pix, cartão): lança o PAGAMENTO e os PRODUTOS na
// Conta da Casa "Conveniência – Vendas Avulsas" da Cloudbeds, no mesmo dia.
// O pagamento vai primeiro (é o que importa para o Fechamento de Caixa); se
// algum produto não for, a venda fica em "Tentar de novo" só para os produtos.
// Ver lancarVendaAvulsa() no fim do arquivo e lib/cloudbedsCaixa.js.
//
// LANÇAMENTO NO QUARTO (como já era):
// Recebe uma venda do tipo "Lançamento no Quarto" já salva no nosso banco,
// e lança a cobrança na Cloudbeds usando o endpoint item/v1/items
// (confirmado na documentação oficial, com print da conta real do
// hotel) — sem informar pagamento, então fica "pendente" na conta do
// quarto. O nome do hóspede que retirou o item vai no campo "itemNote"
// de cada item. Também escreve uma anotação geral na reserva.
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import { descriptografar } from '../../../lib/cloudbedsCrypto';
import {
  carregarCloudbeds, carregarConfigCaixa, garantirContaDaCasa, formaNaCloudbeds, lancarPagamento, lancarItem,
} from '../../../lib/cloudbedsCaixa';

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
    const { data: itens, error: erroItens } = await supabaseAdmin
      .from('pdv_venda_itens').select('*').eq('venda_id', vendaId);
    if (erroItens || !itens?.length) {
      return Response.json({ erro: 'Não foi possível carregar os itens da venda.' }, { status: 400 });
    }

    // Venda avulsa → Conta da Casa da Cloudbeds
    if (venda.tipo_pagamento === 'AVULSO') {
      return lancarVendaAvulsa({ supabaseAdmin, hotelId: chamador.hotel_id, venda, itens, segredoCripto });
    }
    if (venda.tipo_pagamento !== 'QUARTO' || !venda.cloudbeds_reservation_id) {
      return Response.json({ erro: 'Essa venda não é do tipo "Lançamento no Quarto".' }, { status: 400 });
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
// ============================================================================
// VENDA AVULSA → Conta da Casa "Conveniência – Vendas Avulsas"
// ============================================================================
const TRAVA_SEGUNDOS = 60; // evita lançar duas vezes se clicarem duas vezes

async function lancarVendaAvulsa({ supabaseAdmin, hotelId, venda, itens, segredoCripto }) {
  const atualizarVenda = (campos) => supabaseAdmin.from('pdv_vendas').update(campos).eq('id', venda.id);

  if (venda.status && venda.status !== 'CONCLUIDA') {
    return Response.json({ erro: 'Esta venda não está concluída (foi cancelada?).' }, { status: 400 });
  }
  if (venda.cloudbeds_status === 'ENVIADO') return Response.json({ sucesso: true, jaEnviado: true });

  let config;
  try { config = await carregarConfigCaixa(supabaseAdmin, hotelId); }
  catch (e) {
    await atualizarVenda({ cloudbeds_status: 'FALHOU', cloudbeds_erro: e.message });
    return Response.json({ erro: e.message }, { status: 400 });
  }
  if (config.enviar_pdv === false) {
    await atualizarVenda({ cloudbeds_status: 'NAO_APLICAVEL', cloudbeds_erro: null });
    return Response.json({ sucesso: true, ignorado: true, motivo: 'O envio das vendas avulsas para a Cloudbeds está desligado.' });
  }

  // Trava: só um envio por vez para a mesma venda
  const limite = new Date(Date.now() - TRAVA_SEGUNDOS * 1000).toISOString();
  const { data: travada, error: erroTrava } = await supabaseAdmin.from('pdv_vendas')
    .update({ cloudbeds_tentativa_em: new Date().toISOString() })
    .eq('id', venda.id)
    .or(`cloudbeds_tentativa_em.is.null,cloudbeds_tentativa_em.lt.${limite}`)
    .select('id');
  if (erroTrava) {
    const msg = /cloudbeds_|column/i.test(erroTrava.message)
      ? 'O envio para a Cloudbeds ainda não foi ativado no banco de dados (falta rodar o SQL do caixa).'
      : 'Não foi possível preparar o envio: ' + erroTrava.message;
    return Response.json({ erro: msg }, { status: 400 });
  }
  if (!travada?.length) {
    return Response.json({ erro: 'Esta venda já está sendo enviada. Aguarde um minuto e confira.' }, { status: 409 });
  }

  let pagamentoNaCloudbeds = !!venda.cloudbeds_payment_id;
  try {
    const cb = await carregarCloudbeds(supabaseAdmin, hotelId, segredoCripto);
    const contaId = venda.cloudbeds_conta_id
      || await garantirContaDaCasa({ cb, supabaseAdmin, hotelId, config, tipo: 'pdv' });

    // 1) Pagamento (é o que entra no Fechamento de Caixa)
    if (!venda.cloudbeds_payment_id) {
      const forma = formaNaCloudbeds(config, venda.forma_pagamento_avulso);
      const paymentId = await lancarPagamento({
        cb, contaId, forma, valor: Number(venda.valor_total),
        descricao: `Conveniência — Venda #${venda.numero_venda}`,
      });
      await atualizarVenda({ cloudbeds_payment_id: paymentId, cloudbeds_conta_id: contaId });
      pagamentoNaCloudbeds = true;
    }

    // 2) Produtos (um lançamento por produto, com a quantidade)
    const semId = [];
    for (const item of itens) {
      if (item.cloudbeds_sold_product_id) continue; // já foi numa tentativa anterior
      let itemCloudbeds = item.cloudbeds_item_id;
      if (!itemCloudbeds && item.produto_id) {
        // O ID pode ter sido cadastrado no produto depois da venda
        const { data: produto } = await supabaseAdmin.from('pdv_produtos')
          .select('cloudbeds_item_id').eq('id', item.produto_id).maybeSingle();
        if (produto?.cloudbeds_item_id) {
          itemCloudbeds = produto.cloudbeds_item_id;
          await supabaseAdmin.from('pdv_venda_itens').update({ cloudbeds_item_id: itemCloudbeds }).eq('id', item.id);
        }
      }
      if (!itemCloudbeds) { semId.push(item.nome_produto); continue; }
      const soldId = await lancarItem({
        cb, contaId, itemId: itemCloudbeds, quantidade: item.quantidade, precoUnitario: Number(item.preco_unitario),
        nota: `${item.nome_produto} — Venda #${venda.numero_venda}`,
      });
      await supabaseAdmin.from('pdv_venda_itens').update({ cloudbeds_sold_product_id: soldId }).eq('id', item.id);
    }

    if (semId.length) {
      const msg = `O pagamento já está na Cloudbeds, mas faltam os produtos: ${semId.join(', ')} (sem o "ID do item na Cloudbeds"). Cadastre o ID em Preços e Estoque e clique em "Tentar de novo".`;
      await atualizarVenda({ cloudbeds_status: 'FALHOU', cloudbeds_erro: msg, cloudbeds_tentativa_em: null });
      return Response.json({ erro: msg, pagamentoNaCloudbeds: true }, { status: 400 });
    }

    await atualizarVenda({
      cloudbeds_status: 'ENVIADO', cloudbeds_erro: null, cloudbeds_enviado_em: new Date().toISOString(), cloudbeds_tentativa_em: null,
    });
    return Response.json({ sucesso: true });
  } catch (e) {
    const msg = pagamentoNaCloudbeds
      ? `O pagamento já está na Cloudbeds, mas os produtos não foram: ${e.message}`
      : e.message;
    await atualizarVenda({ cloudbeds_status: 'FALHOU', cloudbeds_erro: msg, cloudbeds_tentativa_em: null });
    return Response.json({ erro: msg, pagamentoNaCloudbeds }, { status: 400 });
  }
}
