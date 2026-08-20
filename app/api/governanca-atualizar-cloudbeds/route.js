// ============================================================================
// ROTA DE SERVIDOR: /api/governanca-atualizar-cloudbeds
// ============================================================================
// Envia a mudança de status de limpeza de um quarto pra Cloudbeds —
// endpoint oficial POST /postHousekeepingStatus (API v1.3, escopo
// "write:housekeeping"), confirmado na documentação oficial:
// https://developers.cloudbeds.com/reference/post_posthousekeepingstatus-2
//
// Recebe o ID do quarto NO NOSSO sistema (quartoId) — busca o vínculo
// "cloudbeds_room_id" salvo nele pra saber qual quarto avisar na Cloudbeds.
// Se o quarto ainda não tiver esse vínculo configurado, devolve um aviso
// claro em vez de tentar adivinhar.
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import { descriptografar } from '../../../lib/cloudbedsCrypto';

export async function POST(request) {
  try {
    const corpo = await request.json();
    const { quartoId, roomCondition } = corpo || {};
    if (!quartoId || !roomCondition) {
      return Response.json({ erro: 'Informe o quarto e o novo status.' }, { status: 400 });
    }
    if (!['dirty', 'clean', 'inspected'].includes(roomCondition)) {
      return Response.json({ erro: 'Status inválido.' }, { status: 400 });
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

    const { data: quarto, error: erroQuarto } = await supabaseAdmin
      .from('quartos').select('id, numero, cloudbeds_room_id').eq('id', quartoId).eq('hotel_id', chamador.hotel_id).single();
    if (erroQuarto || !quarto) {
      return Response.json({ erro: 'Quarto não encontrado.' }, { status: 404 });
    }
    if (!quarto.cloudbeds_room_id) {
      // Não é um erro de verdade — só significa que esse quarto ainda não
      // foi vinculado a um quarto da Cloudbeds. O chamador decide o que
      // fazer com essa informação (normalmente: não avisar como falha).
      return Response.json({ naoVinculado: true });
    }

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

    const parametros = new URLSearchParams({
      roomID: quarto.cloudbeds_room_id,
      roomCondition,
    });
    if (credencial.cloudbeds_property_id) parametros.set('propertyID', credencial.cloudbeds_property_id);

    const resposta = await fetch('https://api.cloudbeds.com/api/v1.3/postHousekeepingStatus', {
      method: 'POST',
      headers: { ...cabecalhos, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: parametros.toString(),
    });
    const dados = await resposta.json().catch(() => null);

    if (!resposta.ok || dados?.success === false) {
      const mensagem = dados?.message || 'não foi possível atualizar o status na Cloudbeds';
      const dicaEscopo = /scope|permission|unauthorized/i.test(mensagem)
        ? ' — confira se os escopos "Housekeeping" (Ler e Escrever) foram adicionados à chave de API na Cloudbeds.'
        : '';
      return Response.json({ erro: `${mensagem}${dicaEscopo}` }, { status: 400 });
    }

    return Response.json({ sucesso: true });
  } catch (erro) {
    return Response.json({ erro: 'Erro inesperado no servidor: ' + erro.message }, { status: 500 });
  }
}
