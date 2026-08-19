// ============================================================================
// ROTA DE SERVIDOR: /api/lavanderia-lancar-cloudbeds
// ============================================================================
// Recebe um lote de lavanderia já salvo no nosso banco (com o número da
// reserva informado pelo operador) e lança a cobrança na Cloudbeds, usando
// o mesmo endpoint já confirmado no PDV (item/v1/items). Diferente do PDV,
// aqui um ÚNICO item da Cloudbeds ("Serviço de Lavanderia", configurado uma
// vez pelo admin) é reaproveitado para todo lançamento — o valor e o
// detalhamento de peças/serviços vão dinamicamente em cada cobrança.
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import { descriptografar } from '../../../lib/cloudbedsCrypto';

const CLOUDBEDS_BASE_URL = 'https://api.cloudbeds.com/api/v1.2';

function formatarItens(itens) {
  return (Array.isArray(itens) ? itens : [])
    .map((it) => `${it.peca} (${{ LAVAR: 'Lavar', PASSAR: 'Passar', LAVAR_PASSAR: 'Lavar e Passar' }[it.servico] || it.servico})`)
    .join(', ');
}

export async function POST(request) {
  try {
    const corpo = await request.json();
    const loteId = corpo?.loteId;
    if (!loteId) {
      return Response.json({ erro: 'Informe o lote a lançar.' }, { status: 400 });
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

    const { data: lote, error: erroLote } = await supabaseAdmin
      .from('lavanderia_lotes').select('*').eq('id', loteId).eq('hotel_id', chamador.hotel_id).single();
    if (erroLote || !lote) {
      return Response.json({ erro: 'Lote não encontrado.' }, { status: 404 });
    }
    if (!lote.numero_reserva) {
      return Response.json({ erro: 'Este lote não tem número de reserva informado.' }, { status: 400 });
    }

    const { data: hotel, error: erroHotel } = await supabaseAdmin
      .from('hoteis').select('lavanderia_cloudbeds_item_id').eq('id', chamador.hotel_id).single();
    if (erroHotel || !hotel?.lavanderia_cloudbeds_item_id) {
      return Response.json({
        erro: 'O item de Lavanderia da Cloudbeds ainda não foi configurado. Peça ao administrador para configurar em Lavanderia → Catálogo de Preços → Configuração da Cloudbeds.',
      }, { status: 400 });
    }

    // Credencial da Cloudbeds (mesma tabela/criptografia usada no PDV)
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

    const nomeHospede = lote.nome_hospede || 'Hóspede';
    const detalheItens = formatarItens(lote.itens);
    // itemNote tem limite de tamanho na Cloudbeds — mantém direto ao ponto.
    const notaCobranca = `Lavanderia ${lote.codigo}: ${detalheItens} — Hóspede: ${nomeHospede}`.slice(0, 250);

    const corpoJson = {
      reservationId: lote.numero_reserva,
      items: [{
        itemId: hotel.lavanderia_cloudbeds_item_id,
        itemQuantity: 1,
        itemPrice: String(Math.round(Number(lote.valor_total) * 100)),
        itemNote: notaCobranca,
      }],
    };

    const respostaItem = await fetch('https://api.cloudbeds.com/item/v1/items', {
      method: 'POST',
      headers: { ...cabecalhos, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(corpoJson),
    });
    const dadosItem = await respostaItem.json().catch(() => null);
    if (!respostaItem.ok || dadosItem?.success === false) {
      const mensagem = dadosItem?.message || JSON.stringify(dadosItem) || 'não foi possível lançar a cobrança';
      await supabaseAdmin.from('lavanderia_lotes').update({ cloudbeds_status: 'FALHOU', cloudbeds_erro: mensagem }).eq('id', loteId);
      return Response.json({ erro: `A Cloudbeds recusou o lançamento: ${mensagem}` }, { status: 400 });
    }

    // Anotação extra na reserva, com o detalhamento completo (reforço, caso
    // o itemNote da cobrança seja cortado na tela da Cloudbeds).
    try {
      await fetch(`${CLOUDBEDS_BASE_URL}/postReservationNote`, {
        method: 'POST',
        headers: { ...cabecalhos, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          reservationID: lote.numero_reserva,
          note: `Lavanderia — Lote ${lote.codigo}: ${detalheItens}. Hóspede: ${nomeHospede}. Total: R$ ${Number(lote.valor_total).toFixed(2)}.`,
        }).toString(),
      });
    } catch (e) { /* melhor esforço — a cobrança já foi lançada de qualquer forma */ }

    await supabaseAdmin.from('lavanderia_lotes').update({ cloudbeds_status: 'ENVIADO', cloudbeds_erro: null }).eq('id', loteId);

    return Response.json({ sucesso: true });
  } catch (erro) {
    return Response.json({ erro: 'Erro inesperado no servidor: ' + erro.message }, { status: 500 });
  }
}
