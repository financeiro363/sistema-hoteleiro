// ============================================================================
// ROTA DE SERVIDOR: /api/manutencao-avisos  (aviso no celular da Manutenção)
// ============================================================================
//   POST { chamadoId }  (quem abriu o chamado, logo depois de gravar)
//        → avisa o técnico (ou todos da Manutenção) no celular
//   POST com x-atendimento-agendado (função agendada, a cada 2 minutos)
//        → avisos que faltaram e repetição dos urgentes a cada 30 minutos
// Regras em lib/manutencaoAvisos.js.
// ============================================================================

import { autenticarChamada } from '../../../lib/cloudbedsCaixa';
import { clienteAdmin, chamadaAgendadaValida } from '../../../lib/atendimento/servidor';
import { avisarChamado, varrerChamados } from '../../../lib/manutencaoAvisos';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    if (request.headers.get('x-atendimento-agendado')) {
      if (!chamadaAgendadaValida(request)) return Response.json({ erro: 'Senha da chamada agendada não confere.' }, { status: 401 });
      return Response.json(await varrerChamados(clienteAdmin()));
    }
    const corpo = await request.json().catch(() => ({}));
    const auth = await autenticarChamada(request);
    if (auth.resposta) return auth.resposta;
    const { chamador, supabaseAdmin } = auth;
    const { data: chamado, error } = await supabaseAdmin.from('manutencoes').select('*')
      .eq('id', Number(corpo.chamadoId) || 0).eq('hotel_id', chamador.hotel_id).maybeSingle();
    if (error) return Response.json({ erro: /avisado_em|avisos_rodadas/.test(error.message) ? 'Falta rodar no Supabase o SQL da Etapa 2.' : error.message }, { status: 400 });
    if (!chamado) return Response.json({ erro: 'Chamado não encontrado.' }, { status: 404 });
    return Response.json(await avisarChamado(supabaseAdmin, chamado));
  } catch (e) {
    return Response.json({ erro: 'Erro inesperado no servidor: ' + e.message }, { status: 500 });
  }
}
