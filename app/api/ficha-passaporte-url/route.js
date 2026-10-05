// ============================================================================
// ROTA DE SERVIDOR: /api/ficha-passaporte-url?fichaId=NÚMERO
// ============================================================================
// Só ADMINISTRADOR. Devolve um link TEMPORÁRIO (2 minutos) pra ver a foto
// do passaporte de uma ficha. A foto fica num espaço privado — sem esse
// link, ninguém consegue abrir. Cada visualização é registrada no log da
// tela de Fichas de Hóspedes (quem viu, de quem, quando).
// ============================================================================

import { createClient } from '@supabase/supabase-js';

export async function GET(request) {
  try {
    const fichaId = Number(new URL(request.url).searchParams.get('fichaId'));
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
    if (chamador.papel !== 'ADMIN') {
      return Response.json({ erro: 'Só administradores podem ver a foto do passaporte.' }, { status: 403 });
    }

    const supabaseAdmin = createClient(supabaseUrl, chaveMestra);
    const { data: ficha } = await supabaseAdmin
      .from('fichas_fnrh').select('id, hotel_id, nome_completo, foto_passaporte_caminho')
      .eq('id', fichaId).eq('hotel_id', chamador.hotel_id).maybeSingle();
    if (!ficha) return Response.json({ erro: 'Ficha não encontrada.' }, { status: 404 });
    if (!ficha.foto_passaporte_caminho) return Response.json({ erro: 'Essa ficha não tem foto de passaporte.' }, { status: 404 });

    // Trava extra: a foto precisa estar na pasta do próprio hotel
    if (!ficha.foto_passaporte_caminho.startsWith(`${ficha.hotel_id}/`)) {
      return Response.json({ erro: 'Foto inválida para este hotel.' }, { status: 403 });
    }

    const { data: link, error: erroLink } = await supabaseAdmin.storage
      .from('fichas-passaportes').createSignedUrl(ficha.foto_passaporte_caminho, 120);
    if (erroLink || !link?.signedUrl) {
      return Response.json({ erro: 'Não foi possível abrir a foto. Detalhe técnico: ' + (erroLink?.message || 'link não gerado') }, { status: 500 });
    }

    // Registro de auditoria — melhor esforço, não trava a resposta
    try {
      await supabaseAdmin.from('fichas_fnrh_log').insert({
        usuario_id: chamador.id, ficha_id: ficha.id, acao: 'VISUALIZACAO',
        detalhe: `Foto do passaporte de ${ficha.nome_completo} visualizada.`,
        hotel_id: chamador.hotel_id,
      });
    } catch (e) { /* silencioso */ }

    return Response.json({ url: link.signedUrl });
  } catch (erro) {
    return Response.json({ erro: 'Erro inesperado no servidor: ' + erro.message }, { status: 500 });
  }
}
