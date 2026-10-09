// ============================================================================
// ROTA DE SERVIDOR: /api/fichas-dispensar-exportacao
// ============================================================================
// Marca (ou desmarca) uma ficha como "não será exportada para a Cloudbeds".
// A ficha NÃO é excluída — só deixa de contar como "aguardando exportação"
// (o número que aparece no menu). Dá pra desfazer a qualquer momento.
//
// Corpo: { fichaId, dispensar: true | false, motivo?: string }
//   dispensar = true  -> só vale para fichas ainda pendentes
//   dispensar = false -> devolve a ficha para a fila de exportação
//
// Quem pode: ADMIN, COLABORADOR e CONTADOR (os mesmos que exportam fichas).
// Tudo fica registrado no log de auditoria das fichas.
// ============================================================================

import { createClient } from '@supabase/supabase-js';

const PAPEIS_PERMITIDOS = ['ADMIN', 'COLABORADOR', 'CONTADOR'];

export async function POST(request) {
  try {
    const corpo = await request.json().catch(() => null);
    const fichaId = Number(corpo?.fichaId);
    if (!fichaId) return Response.json({ erro: 'Informe a ficha.' }, { status: 400 });
    if (typeof corpo?.dispensar !== 'boolean') {
      return Response.json({ erro: 'Informe se a ficha deve ser dispensada ou reativada.' }, { status: 400 });
    }
    const dispensar = corpo.dispensar;
    const motivo = String(corpo?.motivo || '').trim().slice(0, 300);

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
      .from('usuarios').select('id, hotel_id, papel, nome').eq('auth_id', dadosAuth.user.id).single();
    if (erroChamador || !chamador) return Response.json({ erro: 'Não foi possível confirmar seu usuário.' }, { status: 403 });
    if (!PAPEIS_PERMITIDOS.includes(chamador.papel)) {
      return Response.json({ erro: 'Seu perfil não pode alterar a exportação das fichas.' }, { status: 403 });
    }

    const supabaseAdmin = createClient(supabaseUrl, chaveMestra);
    const { data: ficha } = await supabaseAdmin
      .from('fichas_fnrh').select('id, hotel_id, nome_completo, status, exportacao_dispensada')
      .eq('id', fichaId).eq('hotel_id', chamador.hotel_id).maybeSingle();
    if (!ficha) return Response.json({ erro: 'Ficha não encontrada.' }, { status: 404 });

    let alteracao;
    if (dispensar) {
      if (ficha.status !== 'PENDENTE') {
        return Response.json({ erro: 'Esta ficha já foi exportada — não há o que dispensar.' }, { status: 409 });
      }
      alteracao = {
        exportacao_dispensada: true,
        dispensada_por_id: chamador.id,
        dispensada_em: new Date().toISOString(),
        dispensada_motivo: motivo || null,
      };
    } else {
      alteracao = {
        exportacao_dispensada: false,
        dispensada_por_id: null,
        dispensada_em: null,
        dispensada_motivo: null,
      };
    }

    const { error: erroAtualizacao } = await supabaseAdmin
      .from('fichas_fnrh').update(alteracao).eq('id', ficha.id).eq('hotel_id', chamador.hotel_id);
    if (erroAtualizacao) {
      const semColuna = /exportacao_dispensada|dispensada_/i.test(erroAtualizacao.message || '');
      return Response.json({
        erro: semColuna
          ? 'O banco de dados ainda não foi atualizado para este recurso (falta rodar o script SQL "AJUSTES-0").'
          : 'Não foi possível salvar. Detalhe técnico: ' + erroAtualizacao.message,
      }, { status: 500 });
    }

    // Registro no log de auditoria (se falhar, não desfaz a alteração)
    try {
      await supabaseAdmin.from('fichas_fnrh_log').insert({
        usuario_id: chamador.id, ficha_id: ficha.id, hotel_id: chamador.hotel_id,
        acao: dispensar ? 'DISPENSA' : 'REATIVACAO',
        detalhe: dispensar
          ? `Ficha de ${ficha.nome_completo} marcada como "não será exportada" para a Cloudbeds${motivo ? ` — motivo: ${motivo}` : ''}.`
          : `Ficha de ${ficha.nome_completo} voltou para a fila de exportação.`,
      });
    } catch (e) { /* silencioso */ }

    return Response.json({ sucesso: true, dispensada: dispensar, dispensada_em: alteracao.dispensada_em, dispensada_motivo: alteracao.dispensada_motivo });
  } catch (erro) {
    return Response.json({ erro: 'Erro inesperado no servidor: ' + erro.message }, { status: 500 });
  }
}
