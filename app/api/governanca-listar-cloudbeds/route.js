// ============================================================================
// ROTA DE SERVIDOR: /api/governanca-listar-cloudbeds
// ============================================================================
// Busca na Cloudbeds a lista de quartos com o status de limpeza (governança)
// de cada um — endpoint oficial GET /getHousekeepingStatus (API v1.3,
// escopo "read:housekeeping"), confirmado na documentação oficial:
// https://developers.cloudbeds.com/reference/get_gethousekeepingstatus-2
//
// Usa a MESMA credencial já configurada para outras integrações (Fichas de
// Hóspedes, PDV) — não é uma chave separada. A chamada acontece só aqui no
// servidor: a chave nunca é enviada para o navegador.
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import { descriptografar } from '../../../lib/cloudbedsCrypto';

export async function GET(request) {
  try {
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

    const parametros = new URLSearchParams({ pageSize: '5000' });
    if (credencial.cloudbeds_property_id) parametros.set('propertyID', credencial.cloudbeds_property_id);

    const resposta = await fetch(`https://api.cloudbeds.com/api/v1.3/getHousekeepingStatus?${parametros.toString()}`, {
      method: 'GET',
      headers: { ...cabecalhos, Accept: 'application/json' },
    });
    const dados = await resposta.json().catch(() => null);

    if (!resposta.ok || dados?.success === false) {
      const mensagem = dados?.message || 'não foi possível consultar a Cloudbeds';
      const dicaEscopo = /scope|permission|unauthorized/i.test(mensagem)
        ? ' — confira se os escopos "Housekeeping" (Ler e Escrever) foram adicionados à chave de API na Cloudbeds.'
        : '';
      return Response.json({ erro: `A Cloudbeds recusou a consulta: ${mensagem}${dicaEscopo}` }, { status: 400 });
    }

    return Response.json({
      quartos: (dados?.data || []).map((r) => ({
        roomID: r.roomID,
        roomName: r.roomName,
        roomTypeName: r.roomTypeName,
        roomCondition: r.roomCondition,
        roomOccupied: !!r.roomOccupied,
        roomBlocked: !!r.roomBlocked,
        frontdeskStatus: r.frontdeskStatus,
        housekeeper: r.housekeeper || null,
        doNotDisturb: !!r.doNotDisturb,
        refusedService: !!r.refusedService,
        vacantPickup: !!r.vacantPickup,
        roomComments: r.roomComments || '',
      })),
    });
  } catch (erro) {
    return Response.json({ erro: 'Erro inesperado no servidor: ' + erro.message }, { status: 500 });
  }
}
