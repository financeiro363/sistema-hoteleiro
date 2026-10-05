// ============================================================================
// ROTA DE SERVIDOR: /api/fichas-imprimir
// ============================================================================
// Devolve os dados de uma ficha específica — usada só na hora de imprimir.
// Qualquer colaborador consegue imprimir (essa é a exceção explícita da
// listagem), mas só recebe o que o modelo impresso realmente usa: nome,
// documento e datas de entrada/saída. Os demais dados (endereço, país de
// origem, foto do passaporte etc.) só chegam pro ADMINISTRADOR — mesmo
// resultado na folha impressa, bem menos dado pessoal trafegando.
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
      .from('usuarios').select('id, hotel_id, papel').eq('auth_id', dadosAuth.user.id).single();
    if (erroChamador || !chamador) return Response.json({ erro: 'Não foi possível confirmar seu usuário.' }, { status: 403 });

    const supabaseAdmin = createClient(supabaseUrl, chaveMestra);
    const { data: ficha, error: erroFicha } = await supabaseAdmin
      .from('fichas_fnrh').select('*').eq('id', fichaId).eq('hotel_id', chamador.hotel_id).single();
    if (erroFicha || !ficha) return Response.json({ erro: 'Ficha não encontrada.' }, { status: 404 });

    if (chamador.papel === 'ADMIN') return Response.json({ ficha });

    // Colaborador: só o que o modelo impresso usa
    const fichaParaImpressao = {
      id: ficha.id,
      nome_completo: ficha.nome_completo,
      tipo_documento: ficha.tipo_documento,
      numero_documento: ficha.numero_documento,
      data_checkin: ficha.data_checkin,
      data_checkout: ficha.data_checkout,
    };
    return Response.json({ ficha: fichaParaImpressao });
  } catch (erro) {
    return Response.json({ erro: 'Erro inesperado no servidor: ' + erro.message }, { status: 500 });
  }
}
