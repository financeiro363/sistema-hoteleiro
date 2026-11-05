// ============================================================================
// ROTA DE SERVIDOR: /api/recepcao-dia  (chegadas e saídas de hoje — M3)
// ============================================================================
// GET → { hoje, chegadas, saidas } do hotel do topo, direto da Cloudbeds, com
// quarto pronto, ficha, saldo e benefício da oferta (lib/recepcao.js).
// ADMIN e recepção (COLABORADOR). Nenhum telefone ou documento sai daqui.
// ============================================================================

import { autenticarChamada, carregarCloudbeds, hojeFortaleza } from '../../../lib/cloudbedsCaixa';
import { diaDaRecepcao } from '../../../lib/recepcao';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function GET(request) {
  try {
    const auth = await autenticarChamada(request);
    if (auth.resposta) return auth.resposta;
    const { chamador, supabaseAdmin, segredoCripto } = auth;
    if (!['ADMIN', 'COLABORADOR'].includes(chamador.papel)) return Response.json({ erro: 'Só a recepção e a administração veem as chegadas e saídas.' }, { status: 403 });
    let cb;
    try { cb = await carregarCloudbeds(supabaseAdmin, chamador.hotel_id, segredoCripto); }
    catch (e) { return Response.json({ erro: 'Este hotel ainda não está ligado à Cloudbeds.' }, { status: 400 }); }
    const hoje = hojeFortaleza();
    const dia = await diaDaRecepcao(supabaseAdmin, cb, chamador.hotel_id, { hoje, mostrarSaldo: true });
    return Response.json({ hoje, ...dia, atualizado_em: new Date().toISOString() });
  } catch (e) {
    return Response.json({ erro: 'Erro inesperado no servidor: ' + e.message }, { status: 500 });
  }
}
