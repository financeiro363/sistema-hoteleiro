// ============================================================================
// ROTA DE SERVIDOR: /api/fichas-excluir
// ============================================================================
// Só ADMINISTRADOR. Exclui uma ficha de hóspede (ex.: preenchimento em
// duplicidade) — e, se a ficha tiver foto de passaporte, apaga a foto do
// espaço privado também. Antes, a exclusão feita direto pela tela só
// removia a linha do banco; com foto de passaporte isso deixaria uma
// imagem de documento "órfã" guardada pra sempre, sem ninguém conseguir
// apagar depois (LGPD).
// ============================================================================

import { createClient } from '@supabase/supabase-js';

export async function POST(request) {
  try {
    const corpo = await request.json().catch(() => null);
    const fichaId = Number(corpo?.fichaId);
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
      return Response.json({ erro: 'Só administradores podem excluir fichas.' }, { status: 403 });
    }

    const supabaseAdmin = createClient(supabaseUrl, chaveMestra);
    const { data: ficha } = await supabaseAdmin
      .from('fichas_fnrh').select('id, hotel_id, nome_completo, foto_passaporte_caminho')
      .eq('id', fichaId).eq('hotel_id', chamador.hotel_id).maybeSingle();
    if (!ficha) return Response.json({ erro: 'Ficha não encontrada.' }, { status: 404 });

    // 1) Registra no log ANTES de excluir (depois, o ficha_id deixaria de existir)
    try {
      await supabaseAdmin.from('fichas_fnrh_log').insert({
        usuario_id: chamador.id, ficha_id: ficha.id, acao: 'EXCLUSAO',
        detalhe: `Ficha de ${ficha.nome_completo} excluída (provável duplicidade).`,
        hotel_id: chamador.hotel_id,
      });
    } catch (e) { /* silencioso */ }

    // 2) Apaga a foto do passaporte, se existir. Se não conseguir, NÃO
    //    exclui a ficha — assim ninguém perde o "ponteiro" pra uma foto que
    //    ficaria guardada sem dono. O administrador pode tentar de novo.
    if (ficha.foto_passaporte_caminho && ficha.foto_passaporte_caminho.startsWith(`${ficha.hotel_id}/`)) {
      const { error: erroRemocao } = await supabaseAdmin.storage
        .from('fichas-passaportes').remove([ficha.foto_passaporte_caminho]);
      if (erroRemocao) {
        return Response.json({ erro: 'Não foi possível apagar a foto do passaporte, então a ficha foi mantida. Detalhe técnico: ' + erroRemocao.message }, { status: 500 });
      }
    }

    // 3) Exclui a ficha
    const { error: erroExclusao } = await supabaseAdmin.from('fichas_fnrh').delete().eq('id', ficha.id);
    if (erroExclusao) {
      return Response.json({ erro: 'Não foi possível excluir a ficha. Detalhe técnico: ' + erroExclusao.message }, { status: 500 });
    }

    return Response.json({ sucesso: true });
  } catch (erro) {
    return Response.json({ erro: 'Erro inesperado no servidor: ' + erro.message }, { status: 500 });
  }
}
