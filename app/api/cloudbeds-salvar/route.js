// ============================================================================
// ROTA DE SERVIDOR: /api/cloudbeds-salvar
// ============================================================================
// Salva (ou atualiza) a chave da API da Cloudbeds de um hotel. Só ADMIN
// pode chamar. A chave chega aqui em texto puro (só nesta requisição, que
// já é HTTPS), é criptografada aqui dentro, e SÓ o texto criptografado vai
// para o banco — o navegador nunca recebe a chave de volta depois de salva.
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import { criptografar } from '../../../lib/cloudbedsCrypto';

export async function POST(request) {
  try {
    const corpo = await request.json();
    const apiKey = (corpo?.apiKey || '').trim();
    const propertyId = (corpo?.propertyId || '').trim();

    if (!apiKey) {
      return Response.json({ erro: 'Informe a chave da API da Cloudbeds.' }, { status: 400 });
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
      return Response.json({
        erro: 'O servidor não está configurado corretamente — falta uma variável de ambiente (confira SUPABASE_SERVICE_ROLE_KEY e CLOUDBEDS_CRYPTO_SECRET no Netlify).',
      }, { status: 500 });
    }

    const supabaseComoChamador = createClient(supabaseUrl, chaveAnonima, {
      global: { headers: { Authorization: `Bearer ${tokenAcesso}` } },
    });

    const { data: dadosAuth, error: erroAuth } = await supabaseComoChamador.auth.getUser(tokenAcesso);
    if (erroAuth || !dadosAuth?.user) {
      return Response.json({ erro: 'Sessão inválida ou expirada. Saia e entre de novo.' }, { status: 401 });
    }

    const { data: chamador, error: erroChamador } = await supabaseComoChamador
      .from('usuarios')
      .select('papel, hotel_id, id')
      .eq('auth_id', dadosAuth.user.id)
      .single();

    if (erroChamador || !chamador || chamador.papel !== 'ADMIN') {
      return Response.json({ erro: 'Só administradores podem configurar a integração com a Cloudbeds.' }, { status: 403 });
    }

    const apiKeyCifrada = criptografar(apiKey, segredoCripto);

    const supabaseAdmin = createClient(supabaseUrl, chaveMestra);
    const { error: erroSalvar } = await supabaseAdmin.from('cloudbeds_credenciais').upsert({
      hotel_id: chamador.hotel_id,
      api_key_cifrada: apiKeyCifrada,
      cloudbeds_property_id: propertyId || null,
      atualizado_em: new Date().toISOString(),
      atualizado_por_id: chamador.id,
    });

    if (erroSalvar) {
      return Response.json({ erro: 'Não foi possível salvar: ' + erroSalvar.message }, { status: 500 });
    }

    return Response.json({ sucesso: true });
  } catch (erro) {
    return Response.json({ erro: 'Erro inesperado no servidor: ' + erro.message }, { status: 500 });
  }
}
