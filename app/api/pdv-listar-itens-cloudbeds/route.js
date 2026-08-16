// ============================================================================
// ROTA DE SERVIDOR: /api/pdv-listar-itens-cloudbeds
// ============================================================================
// Busca a lista de itens (produtos/serviços) já cadastrados no catálogo
// da Cloudbeds, para a pessoa escolher direto na nossa tela — sem
// precisar copiar nenhum ID manualmente.
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
      return Response.json({ erro: 'O servidor não está configurado corretamente.' }, { status: 500 });
    }

    const supabaseComoChamador = createClient(supabaseUrl, chaveAnonima, {
      global: { headers: { Authorization: `Bearer ${tokenAcesso}` } },
    });
    const { data: dadosAuth, error: erroAuth } = await supabaseComoChamador.auth.getUser(tokenAcesso);
    if (erroAuth || !dadosAuth?.user) {
      return Response.json({ erro: 'Sessão inválida ou expirada.' }, { status: 401 });
    }
    const { data: chamador } = await supabaseComoChamador
      .from('usuarios').select('id, hotel_id').eq('auth_id', dadosAuth.user.id).single();
    if (!chamador) {
      return Response.json({ erro: 'Não foi possível confirmar seu usuário.' }, { status: 403 });
    }

    const supabaseAdmin = createClient(supabaseUrl, chaveMestra);
    const { data: credencial } = await supabaseAdmin
      .from('cloudbeds_credenciais').select('*').eq('hotel_id', chamador.hotel_id).maybeSingle();
    if (!credencial?.api_key_cifrada) {
      return Response.json({ erro: 'A integração com a Cloudbeds ainda não foi configurada.' }, { status: 400 });
    }
    let apiKey;
    try { apiKey = descriptografar(credencial.api_key_cifrada, segredoCripto); }
    catch (e) { return Response.json({ erro: 'Não foi possível ler a credencial salva.' }, { status: 500 }); }

    const cabecalhos = {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      ...(credencial.cloudbeds_property_id ? { 'x-property-id': credencial.cloudbeds_property_id } : {}),
    };

    // Tenta o endpoint novo (item/v1) primeiro; se não der certo, tenta o
    // clássico (getItems, v1.2) como reforço.
    let itensEncontrados = null;
    try {
      const resposta = await fetch('https://api.cloudbeds.com/item/v1/items', { method: 'GET', headers: cabecalhos });
      const dados = await resposta.json().catch(() => null);
      if (resposta.ok && dados) itensEncontrados = dados?.data || dados?.items || dados;
    } catch (e) { /* segue para o reforço */ }

    if (!itensEncontrados) {
      try {
        const resposta = await fetch('https://api.cloudbeds.com/api/v1.2/getItems', { method: 'GET', headers: cabecalhos });
        const dados = await resposta.json().catch(() => null);
        if (resposta.ok && dados) itensEncontrados = dados?.data || dados;
      } catch (e) { /* segue */ }
    }

    if (!itensEncontrados) {
      return Response.json({ erro: 'Não foi possível buscar os itens na Cloudbeds.' }, { status: 400 });
    }

    return Response.json({ sucesso: true, itens: itensEncontrados });
  } catch (erro) {
    return Response.json({ erro: 'Erro inesperado no servidor: ' + erro.message }, { status: 500 });
  }
}
