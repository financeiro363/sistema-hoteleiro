// ============================================================================
// ROTA DE SERVIDOR: /api/hotel-trocar
// ============================================================================
// Troca qual hotel está "ativo" pra pessoa logada — atualiza a única linha
// dela em "usuarios" (hotel_id + papel) pra refletir o hotel escolhido.
// Antes de trocar, confirma que ela realmente tem um vínculo ativo com
// aquele hotel (em vinculos_usuario_hotel) — ninguém troca pra um hotel que
// não é dela só chamando essa rota com um ID diferente.
// ============================================================================

import { createClient } from '@supabase/supabase-js';

export async function POST(request) {
  try {
    const { hotelId } = await request.json();
    if (!hotelId) return Response.json({ erro: 'Informe o hotel.' }, { status: 400 });

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

    const supabaseAdmin = createClient(supabaseUrl, chaveMestra);

    // Confirma que a pessoa realmente tem esse vínculo — é a trava de
    // segurança principal desta rota.
    const { data: vinculo, error: erroVinculo } = await supabaseAdmin
      .from('vinculos_usuario_hotel')
      .select('hotel_id, papel')
      .eq('auth_id', dadosAuth.user.id)
      .eq('hotel_id', hotelId)
      .eq('ativo', true)
      .maybeSingle();
    if (erroVinculo || !vinculo) {
      return Response.json({ erro: 'Você não tem acesso a esse hotel.' }, { status: 403 });
    }

    const { error: erroUpdate } = await supabaseAdmin
      .from('usuarios')
      .update({ hotel_id: vinculo.hotel_id, papel: vinculo.papel })
      .eq('auth_id', dadosAuth.user.id);
    if (erroUpdate) return Response.json({ erro: erroUpdate.message }, { status: 500 });

    return Response.json({ sucesso: true });
  } catch (erro) {
    return Response.json({ erro: 'Erro inesperado no servidor: ' + erro.message }, { status: 500 });
  }
}
