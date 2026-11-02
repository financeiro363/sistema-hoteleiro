// ============================================================================
// ROTA DE SERVIDOR: /api/governanca-camareiras-cloudbeds
// ============================================================================
// Liga cada camareira daqui à camareira ("housekeeper") cadastrada na
// Cloudbeds e avisa lá quem ficou com cada quarto depois da distribuição.
//   GET                                      → { housekeepers, mapa }      (admin)
//   POST { acao: 'salvar', mapa: [...] }     → grava a ligação             (admin)
//   POST { acao: 'atribuir', atribuicoes }   → postHousekeepingAssignment  (admin/colaborador)
//        atribuicoes: [{ camareiraId, quartoIds: [...] }]
// Endpoints oficiais (API v1.3): getHousekeepers e postHousekeepingAssignment.
// ============================================================================

import { autenticarChamada } from '../../../lib/cloudbedsCaixa';
import { carregarCloudbeds, listarHousekeepers, atribuirNaCloudbeds } from '../../../lib/governanca/cloudbeds';

export const dynamic = 'force-dynamic';

function erro(mensagem, status = 400) { return Response.json({ erro: mensagem }, { status }); }

export async function GET(request) {
  try {
    const auth = await autenticarChamada(request);
    if (auth.resposta) return auth.resposta;
    const { chamador, supabaseAdmin, segredoCripto } = auth;
    if (chamador.papel !== 'ADMIN') return erro('Só administradores configuram isso.', 403);
    const { data: mapa } = await supabaseAdmin.from('governanca_camareira_cloudbeds')
      .select('usuario_id, housekeeper_id, housekeeper_nome').eq('hotel_id', chamador.hotel_id);
    let housekeepers = [];
    try {
      const cb = await carregarCloudbeds(supabaseAdmin, chamador.hotel_id, segredoCripto);
      housekeepers = await listarHousekeepers(cb);
    } catch (e) {
      return Response.json({ erro: 'A Cloudbeds não mandou a lista de camareiras: ' + e.message, mapa: mapa || [] }, { status: 400 });
    }
    return Response.json({ housekeepers, mapa: mapa || [] });
  } catch (e) {
    return erro('Erro inesperado no servidor: ' + e.message, 500);
  }
}

export async function POST(request) {
  try {
    const corpo = await request.json().catch(() => ({}));
    const auth = await autenticarChamada(request);
    if (auth.resposta) return auth.resposta;
    const { chamador, supabaseAdmin, segredoCripto } = auth;
    const hotelId = chamador.hotel_id;

    if (corpo?.acao === 'salvar') {
      if (chamador.papel !== 'ADMIN') return erro('Só administradores configuram isso.', 403);
      const mapa = Array.isArray(corpo.mapa) ? corpo.mapa.slice(0, 200) : [];
      // Só camareiras deste hotel
      const { data: equipe } = await supabaseAdmin.from('usuarios').select('id').eq('hotel_id', hotelId).eq('papel', 'CAMAREIRA');
      const daqui = new Set((equipe || []).map((u) => Number(u.id)));
      let gravadas = 0;
      for (const m of mapa) {
        const usuarioId = Number(m.usuarioId);
        if (!daqui.has(usuarioId)) continue;
        if (!m.housekeeperId) {
          await supabaseAdmin.from('governanca_camareira_cloudbeds').delete().eq('hotel_id', hotelId).eq('usuario_id', usuarioId);
          continue;
        }
        const { error } = await supabaseAdmin.from('governanca_camareira_cloudbeds').upsert({
          hotel_id: hotelId, usuario_id: usuarioId,
          housekeeper_id: String(m.housekeeperId).slice(0, 60), housekeeper_nome: String(m.housekeeperNome || '').slice(0, 200) || null,
          atualizado_em: new Date().toISOString(),
        }, { onConflict: 'hotel_id,usuario_id' });
        if (error) return erro('Não foi possível salvar: ' + error.message);
        gravadas += 1;
      }
      return Response.json({ sucesso: true, gravadas });
    }

    if (corpo?.acao === 'atribuir') {
      if (!['ADMIN', 'COLABORADOR'].includes(chamador.papel)) return erro('Só a governança distribui quartos.', 403);
      const atribuicoes = Array.isArray(corpo.atribuicoes) ? corpo.atribuicoes.slice(0, 100) : [];
      const { data: mapa } = await supabaseAdmin.from('governanca_camareira_cloudbeds')
        .select('usuario_id, housekeeper_id').eq('hotel_id', hotelId);
      const housekeeperDe = new Map((mapa || []).map((m) => [Number(m.usuario_id), m.housekeeper_id]));
      if (!housekeeperDe.size) return Response.json({ semLigacao: true, enviados: 0 });

      const todosIds = atribuicoes.flatMap((a) => (Array.isArray(a.quartoIds) ? a.quartoIds : []));
      const { data: quartos } = todosIds.length
        ? await supabaseAdmin.from('quartos').select('id, cloudbeds_room_id').eq('hotel_id', hotelId).in('id', todosIds)
        : { data: [] };
      const roomDe = new Map((quartos || []).map((q) => [String(q.id), q.cloudbeds_room_id]));

      let cb;
      try { cb = await carregarCloudbeds(supabaseAdmin, hotelId, segredoCripto); }
      catch (e) { return erro(e.message); }

      let enviados = 0; const semLigacao = []; const erros = [];
      for (const a of atribuicoes) {
        const hk = housekeeperDe.get(Number(a.camareiraId));
        const rooms = (a.quartoIds || []).map((id) => roomDe.get(String(id))).filter(Boolean);
        if (!rooms.length) continue;
        if (!hk) { semLigacao.push(Number(a.camareiraId)); continue; }
        try { await atribuirNaCloudbeds(cb, rooms, hk); enviados += rooms.length; }
        catch (e) { erros.push(e.message); }
      }
      return Response.json({ sucesso: !erros.length, enviados, semLigacao, erros: erros.slice(0, 3) });
    }

    return erro('Pedido inválido.');
  } catch (e) {
    return erro('Erro inesperado no servidor: ' + e.message, 500);
  }
}
