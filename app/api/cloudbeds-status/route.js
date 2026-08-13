// ============================================================================
// ROTA DE SERVIDOR: /api/cloudbeds-status
// ============================================================================
// Diz só se já existe uma credencial salva para o hotel (e o property_id,
// que não é segredo) — NUNCA devolve a chave da API em si.
// ============================================================================

import { createClient } from '@supabase/supabase-js';

export async function GET(request) {
  try {
    const tokenAcesso = (request.headers.get('authorization') || '').replace('Bearer ', '');
    if (!tokenAcesso) {
      return Response.json({ erro: 'Não autorizado — faça login novamente.' }, { status: 401 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const chaveAnonima = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const chaveMestra = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !chaveAnonima || !chaveMestra) {
      return Response.json({ erro: 'O servidor não está configurado corretamente.' }, { status: 500 });
    }

    const supabaseComoChamador = createClient(supabaseUrl, chaveAnonima, {
      global: { headers: { Authorization: `Bearer ${tokenAcesso}` } },
    });
    const { data: dadosAuth, error: erroAuth } = await supabaseComoChamador.auth.getUser(tokenAcesso);
    if (erroAuth || !dadosAuth?.user) {
      return Response.json({ erro: 'Sessão inválida ou expirada.' }, { status: 401 });
    }

    const { data: chamador, error: erroChamador } = await supabaseComoChamador
      .from('usuarios').select('papel, hotel_id').eq('auth_id', dadosAuth.user.id).single();
    if (erroChamador || !chamador || chamador.papel !== 'ADMIN') {
      return Response.json({ erro: 'Só administradores podem ver isso.' }, { status: 403 });
    }

    const supabaseAdmin = createClient(supabaseUrl, chaveMestra);
    const { data: credencial } = await supabaseAdmin
      .from('cloudbeds_credenciais')
      .select('cloudbeds_property_id, atualizado_em')
      .eq('hotel_id', chamador.hotel_id)
      .maybeSingle();

    return Response.json({
      configurado: !!credencial?.atualizado_em,
      propertyId: credencial?.cloudbeds_property_id || null,
      atualizadoEm: credencial?.atualizado_em || null,
    });
  } catch (erro) {
    return Response.json({ erro: 'Erro inesperado no servidor: ' + erro.message }, { status: 500 });
  }
}
