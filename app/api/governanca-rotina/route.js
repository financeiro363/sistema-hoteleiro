// ============================================================================
// ROTA DE SERVIDOR: /api/governanca-rotina  (saídas e chegadas do dia)
// ============================================================================
//   POST (função agendada da Netlify, todo dia às 6h) → roda nos hotéis com Cloudbeds
//   POST (governança/recepção, botão do Painel)        → roda no hotel do topo
// Regras em lib/governanca/rotina.js; busca e gravação em lib/governanca/rotinaServidor.js.
// A chamada agendada usa a mesma senha das outras funções agendadas
// (x-atendimento-agendado, derivada de CLOUDBEDS_CRYPTO_SECRET).
// ============================================================================

import { autenticarChamada } from '../../../lib/cloudbedsCaixa';
import { clienteAdmin, chamadaAgendadaValida } from '../../../lib/atendimento/servidor';
import { rodarRotina } from '../../../lib/governanca/rotinaServidor';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    if (request.headers.get('x-atendimento-agendado')) {
      if (!chamadaAgendadaValida(request)) return Response.json({ erro: 'Senha da chamada agendada não confere.' }, { status: 401 });
      const supabaseAdmin = clienteAdmin();
      const { data: credenciais } = await supabaseAdmin.from('cloudbeds_credenciais').select('hotel_id, cloudbeds_property_id');
      const hoteis = (credenciais || []).filter((c) => c.cloudbeds_property_id).map((c) => c.hotel_id);
      const resultados = await Promise.all(hoteis.map(async (hotelId) => {
        try { return { hotelId, ...(await rodarRotina(supabaseAdmin, hotelId, { origem: 'AGENDADA', segredoCripto: process.env.CLOUDBEDS_CRYPTO_SECRET })) }; }
        catch (e) { return { hotelId, erro: e.message }; }
      }));
      return Response.json({ resultados });
    }

    const auth = await autenticarChamada(request);
    if (auth.resposta) return auth.resposta;
    const { chamador, supabaseAdmin, segredoCripto } = auth;
    if (!['ADMIN', 'COLABORADOR'].includes(chamador.papel)) {
      return Response.json({ erro: 'Só a governança e a recepção atualizam as saídas e chegadas.' }, { status: 403 });
    }
    const r = await rodarRotina(supabaseAdmin, chamador.hotel_id, { origem: 'MANUAL', quem: chamador.nome, segredoCripto });
    if (r.erro) return Response.json(r, { status: 400 });
    return Response.json(r);
  } catch (e) {
    return Response.json({ erro: 'Erro inesperado no servidor: ' + e.message }, { status: 500 });
  }
}
