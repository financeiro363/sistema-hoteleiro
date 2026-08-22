// ============================================================================
// ROTA DE SERVIDOR: /api/fichas-listar
// ============================================================================
// Lista as fichas de hóspede (FNRH) do hotel. Adequação à LGPD: quando quem
// pede não é ADMIN, os campos sensíveis (telefone, e-mail, endereço,
// documento, nascimento, etc.) são cortados AQUI, no servidor, antes da
// resposta sair — o colaborador nunca recebe esses dados no navegador,
// nem aparecem na aba Network/Rede. Só filtrar na tela não seria
// suficiente, já que os dados continuariam chegando no JSON da resposta.
//
// Quem é ADMIN continua recebendo a linha inteira, sem nenhum corte.
// ============================================================================

import { createClient } from '@supabase/supabase-js';

// Campos liberados pra quem NÃO é admin — só o essencial pra identificar o
// hóspede e a estadia, mais o que é necessário pro fluxo de exportação
// (status/reserva) continuar funcionando. Nada de dado pessoal sensível.
function somenteCamposPermitidos(f) {
  return {
    id: f.id,
    nome_completo: f.nome_completo,
    tipo_documento: f.tipo_documento,
    numero_documento: f.numero_documento, // é o CPF quando tipo_documento === 'CPF'
    data_checkin: f.data_checkin,
    data_checkout: f.data_checkout,
    status: f.status,
    criado_em: f.criado_em,
    cloudbeds_reservation_id: f.cloudbeds_reservation_id,
    exportado_em: f.exportado_em,
  };
}

export async function GET(request) {
  try {
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
    const { data: fichas, error: erroFichas } = await supabaseAdmin
      .from('fichas_fnrh').select('*').eq('hotel_id', chamador.hotel_id).order('criado_em', { ascending: false });
    if (erroFichas) return Response.json({ erro: erroFichas.message }, { status: 500 });

    const ehAdmin = chamador.papel === 'ADMIN';
    const listaFinal = ehAdmin ? fichas : (fichas || []).map(somenteCamposPermitidos);

    return Response.json({ fichas: listaFinal });
  } catch (erro) {
    return Response.json({ erro: 'Erro inesperado no servidor: ' + erro.message }, { status: 500 });
  }
}
