// ============================================================================
// ROTA DE SERVIDOR: /api/fichas-imprimir
// ============================================================================
// Devolve os dados COMPLETOS de uma ficha específica — usada só na hora de
// imprimir. É a exceção explícita: mesmo um colaborador (que não vê esses
// campos na listagem) continua conseguindo imprimir a ficha física completa,
// como já funcionava antes. A diferença é que agora esse dado completo só
// trafega no momento exato da impressão, não fica exposto o tempo todo na
// listagem geral.
// ============================================================================

import { createClient } from '@supabase/supabase-js';

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const fichaId = url.searchParams.get('fichaId');
    if (!fichaId) return Response.json({ erro: 'Informe a ficha.' }, { status: 400 });

    const tokenAcesso = (request.headers.get('authorization') || '').replace('Bearer ', '');
    if (!tokenAcesso) return Response.json({ erro: 'Não autorizado — faça login novamente.' }, { status: 401 });

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
    if (erroAuth || !dadosAuth?.user) return Response.json({ erro: 'Sessão inválida ou expirada.' }, { status: 401 });
    const { data: chamador, error: erroChamador } = await supabaseComoChamador
      .from('usuarios').select('id, hotel_id').eq('auth_id', dadosAuth.user.id).single();
    if (erroChamador || !chamador) return Response.json({ erro: 'Não foi possível confirmar seu usuário.' }, { status: 403 });

    const supabaseAdmin = createClient(supabaseUrl, chaveMestra);
    const { data: ficha, error: erroFicha } = await supabaseAdmin
      .from('fichas_fnrh').select('*').eq('id', fichaId).eq('hotel_id', chamador.hotel_id).single();
    if (erroFicha || !ficha) return Response.json({ erro: 'Ficha não encontrada.' }, { status: 404 });

    return Response.json({ ficha });
  } catch (erro) {
    return Response.json({ erro: 'Erro inesperado no servidor: ' + erro.message }, { status: 500 });
  }
}
