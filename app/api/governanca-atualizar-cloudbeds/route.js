// ============================================================================
// ROTA DE SERVIDOR: /api/governanca-atualizar-cloudbeds
// ============================================================================
// Envia para a Cloudbeds a situação de limpeza de um quarto — endpoint oficial
// POST /postHousekeepingStatus (API v1.3):
//   roomCondition  dirty | clean | inspected
//   doNotDisturb   true | false   ("Não perturbe")
//   refusedService true | false   ("Não deseja arrumação")
// Recebe o ID do quarto NO NOSSO sistema (quartoId) e usa o vínculo
// "cloudbeds_room_id" salvo nele. Quarto sem vínculo devolve { naoVinculado }.
// ============================================================================

import { autenticarChamada } from '../../../lib/cloudbedsCaixa';
import { carregarCloudbeds, enviarSituacao } from '../../../lib/governanca/cloudbeds';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const corpo = await request.json().catch(() => ({}));
    const { quartoId, roomCondition } = corpo || {};
    const doNotDisturb = typeof corpo?.doNotDisturb === 'boolean' ? corpo.doNotDisturb : undefined;
    const refusedService = typeof corpo?.refusedService === 'boolean' ? corpo.refusedService : undefined;
    if (!quartoId || (!roomCondition && doNotDisturb === undefined && refusedService === undefined)) {
      return Response.json({ erro: 'Informe o quarto e o que mudou.' }, { status: 400 });
    }
    if (roomCondition && !['dirty', 'clean', 'inspected'].includes(roomCondition)) {
      return Response.json({ erro: 'Status inválido.' }, { status: 400 });
    }

    const auth = await autenticarChamada(request);
    if (auth.resposta) return auth.resposta;
    const { chamador, supabaseAdmin, segredoCripto } = auth;

    const { data: quarto } = await supabaseAdmin
      .from('quartos').select('id, numero, cloudbeds_room_id').eq('id', quartoId).eq('hotel_id', chamador.hotel_id).maybeSingle();
    if (!quarto) return Response.json({ erro: 'Quarto não encontrado.' }, { status: 404 });
    if (!quarto.cloudbeds_room_id) return Response.json({ naoVinculado: true });

    let cb;
    try { cb = await carregarCloudbeds(supabaseAdmin, chamador.hotel_id, segredoCripto); }
    catch (e) { return Response.json({ erro: e.message }, { status: 400 }); }

    try {
      await enviarSituacao(cb, quarto.cloudbeds_room_id, { roomCondition, doNotDisturb, refusedService });
    } catch (e) {
      return Response.json({ erro: e.message }, { status: 400 });
    }
    return Response.json({ sucesso: true });
  } catch (erro) {
    return Response.json({ erro: 'Erro inesperado no servidor: ' + erro.message }, { status: 500 });
  }
}
