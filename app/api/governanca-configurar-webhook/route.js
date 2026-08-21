// ============================================================================
// ROTA DE SERVIDOR: /api/governanca-configurar-webhook
// ============================================================================
// Ativa/desativa a inscrição no webhook oficial "housekeeping/
// room_condition_changed" da Cloudbeds (documentação:
// https://developers.cloudbeds.com/docs/webhooks-1), usando o endpoint
// oficial POST /postWebhook. Formato do call confirmado na documentação:
//
//   curl -X POST 'https://hotels.cloudbeds.com/api/v1.3/postWebhook' \
//     -H 'Authorization: Bearer <chave>' \
//     -H 'Content-Type: application/x-www-form-urlencoded' \
//     --data-urlencode 'endpointUrl=...' \
//     --data-urlencode 'object=housekeeping' \
//     --data-urlencode 'action=room_condition_changed'
//
// ⚠️ O formato exato do "deleteWebhook" (pra desativar) não veio explícito
// na documentação pública — implementei da forma mais comum (parâmetro
// subscriptionID na URL). Se a desativação der erro, o aviso vai mostrar a
// mensagem exata da Cloudbeds pra ajustarmos.
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import { descriptografar } from '../../../lib/cloudbedsCrypto';

const URL_ENDPOINT_WEBHOOK = 'https://chokmahsystem.netlify.app/api/governanca-webhook-cloudbeds';

export async function POST(request) {
  try {
    const { ativar } = await request.json();

    const tokenAcesso = (request.headers.get('authorization') || '').replace('Bearer ', '');
    if (!tokenAcesso) return Response.json({ erro: 'Não autorizado — faça login novamente.' }, { status: 401 });

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
    if (erroAuth || !dadosAuth?.user) return Response.json({ erro: 'Sessão inválida ou expirada.' }, { status: 401 });
    const { data: chamador, error: erroChamador } = await supabaseComoChamador
      .from('usuarios').select('id, hotel_id, papel').eq('auth_id', dadosAuth.user.id).single();
    if (erroChamador || !chamador) return Response.json({ erro: 'Não foi possível confirmar seu usuário.' }, { status: 403 });
    if (chamador.papel !== 'ADMIN') return Response.json({ erro: 'Só administradores podem configurar isso.' }, { status: 403 });

    const supabaseAdmin = createClient(supabaseUrl, chaveMestra);

    const { data: credencial, error: erroCred } = await supabaseAdmin
      .from('cloudbeds_credenciais').select('*').eq('hotel_id', chamador.hotel_id).maybeSingle();
    if (erroCred || !credencial?.api_key_cifrada) {
      return Response.json({ erro: 'A integração com a Cloudbeds ainda não foi configurada para este hotel.' }, { status: 400 });
    }
    let apiKey;
    try { apiKey = descriptografar(credencial.api_key_cifrada, segredoCripto); }
    catch (e) { return Response.json({ erro: 'Não foi possível ler a credencial salva.' }, { status: 500 }); }

    const { data: hotel } = await supabaseAdmin.from('hoteis').select('governanca_webhook_id').eq('id', chamador.hotel_id).single();

    if (ativar) {
      const parametros = new URLSearchParams({
        endpointUrl: URL_ENDPOINT_WEBHOOK,
        object: 'housekeeping',
        action: 'room_condition_changed',
      });
      if (credencial.cloudbeds_property_id) parametros.set('propertyID', credencial.cloudbeds_property_id);

      const resposta = await fetch('https://hotels.cloudbeds.com/api/v1.3/postWebhook', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: parametros.toString(),
      });
      const dados = await resposta.json().catch(() => null);
      if (!resposta.ok || dados?.success === false) {
        const mensagem = dados?.message || 'A Cloudbeds recusou a inscrição.';
        const dicaEscopo = /scope|permission|unauthorized/i.test(mensagem)
          ? ' — confira se os escopos "Housekeeping" (Ler e Escrever) foram adicionados à chave de API.'
          : '';
        return Response.json({ erro: `${mensagem}${dicaEscopo}` }, { status: 400 });
      }
      const idInscricao = dados?.data?.id || dados?.id || null;
      await supabaseAdmin.from('hoteis').update({ governanca_webhook_id: idInscricao }).eq('id', chamador.hotel_id);
      return Response.json({ sucesso: true });
    } else {
      if (hotel?.governanca_webhook_id) {
        const resposta = await fetch(`https://hotels.cloudbeds.com/api/v1.3/deleteWebhook?subscriptionID=${encodeURIComponent(hotel.governanca_webhook_id)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        });
        const dados = await resposta.json().catch(() => null);
        if (!resposta.ok || dados?.success === false) {
          return Response.json({ erro: dados?.message || 'A Cloudbeds recusou o cancelamento da inscrição.' }, { status: 400 });
        }
      }
      await supabaseAdmin.from('hoteis').update({ governanca_webhook_id: null }).eq('id', chamador.hotel_id);
      return Response.json({ sucesso: true });
    }
  } catch (erro) {
    return Response.json({ erro: 'Erro inesperado no servidor: ' + erro.message }, { status: 500 });
  }
}
