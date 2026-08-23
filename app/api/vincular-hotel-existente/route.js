// ============================================================================
// ROTA DE SERVIDOR: /api/vincular-hotel-existente
// ============================================================================
// Pra quando alguém já tem conta em OUTRO hotel do sistema (mesmo e-mail) e
// precisa também trabalhar no hotel de quem está chamando essa rota. Acha
// o auth_id dessa pessoa pelo e-mail já cadastrado e cria o vínculo — não
// mexe na linha atual dela em "usuarios" (ela só passa a ver esse hotel
// como opção no seletor, e decide quando trocar pra ele).
//
// Se o e-mail não pertencer a ninguém no sistema ainda, devolve um erro
// claro — nesse caso o caminho certo é "+ Novo Usuário" (convite), não
// esta rota.
// ============================================================================

import { createClient } from '@supabase/supabase-js';

export async function POST(request) {
  try {
    const { email, papel } = await request.json();
    if (!email?.trim() || !papel) return Response.json({ erro: 'Informe o e-mail e o papel.' }, { status: 400 });
    if (!['ADMIN', 'COLABORADOR', 'CONTADOR', 'MANUTENCAO', 'CAMAREIRA'].includes(papel)) {
      return Response.json({ erro: 'Papel inválido.' }, { status: 400 });
    }

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
    if (chamador.papel !== 'ADMIN') return Response.json({ erro: 'Só administradores podem vincular usuários.' }, { status: 403 });

    const supabaseAdmin = createClient(supabaseUrl, chaveMestra);

    // Acha alguém já cadastrado com esse e-mail, em qualquer hotel.
    const { data: existente, error: erroExistente } = await supabaseAdmin
      .from('usuarios').select('auth_id, nome, hotel_id').ilike('email', email.trim()).limit(1).maybeSingle();
    if (erroExistente || !existente) {
      return Response.json({
        erro: 'Não achamos ninguém com esse e-mail no sistema ainda. Se a pessoa é realmente nova, use o botão "+ Novo Usuário" em vez desta opção.',
      }, { status: 404 });
    }
    if (existente.hotel_id === chamador.hotel_id) {
      return Response.json({ erro: 'Essa pessoa já trabalha neste hotel.' }, { status: 400 });
    }

    const { error: erroVinculo } = await supabaseAdmin
      .from('vinculos_usuario_hotel')
      .upsert({ auth_id: existente.auth_id, hotel_id: chamador.hotel_id, papel, ativo: true }, { onConflict: 'auth_id,hotel_id' });
    if (erroVinculo) return Response.json({ erro: erroVinculo.message }, { status: 500 });

    return Response.json({ sucesso: true, nome: existente.nome });
  } catch (erro) {
    return Response.json({ erro: 'Erro inesperado no servidor: ' + erro.message }, { status: 500 });
  }
}
