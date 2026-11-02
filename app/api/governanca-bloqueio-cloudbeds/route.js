// ============================================================================
// ROTA DE SERVIDOR: /api/governanca-bloqueio-cloudbeds
// ============================================================================
// Quarto "Interditado" sai da venda na Cloudbeds: cria um bloqueio
// "fora de serviço" (POST /postRoomBlock, API v1.3) de hoje até a previsão de
// volta. Ao tirar de Interditado, apaga o bloqueio (POST /deleteRoomBlock).
//   { quartoId, acao: 'bloquear', ate: 'AAAA-MM-DD', motivo? }
//   { quartoId, acao: 'liberar' }
// Camareira não usa. O número do bloqueio fica salvo no quarto
// (cloudbeds_bloqueio_id) para poder liberar depois.
// ============================================================================

import { autenticarChamada, hojeFortaleza } from '../../../lib/cloudbedsCaixa';
import { carregarCloudbeds, bloquearNaCloudbeds, liberarNaCloudbeds } from '../../../lib/governanca/cloudbeds';
import { dataDeVoltaInvalida, formatarDia } from '../../../lib/governanca/regras';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const corpo = await request.json().catch(() => ({}));
    const { quartoId, acao } = corpo || {};
    if (!quartoId || !['bloquear', 'liberar'].includes(acao)) {
      return Response.json({ erro: 'Pedido inválido.' }, { status: 400 });
    }

    const auth = await autenticarChamada(request);
    if (auth.resposta) return auth.resposta;
    const { chamador, supabaseAdmin, segredoCripto } = auth;
    if (!['ADMIN', 'COLABORADOR'].includes(chamador.papel)) {
      return Response.json({ erro: 'Só a governança e a recepção bloqueiam quartos.' }, { status: 403 });
    }

    const { data: quarto, error } = await supabaseAdmin
      .from('quartos').select('*').eq('id', quartoId).eq('hotel_id', chamador.hotel_id).maybeSingle();
    if (error) return Response.json({ erro: 'Não foi possível ler o quarto: ' + error.message }, { status: 400 });
    if (!quarto) return Response.json({ erro: 'Quarto não encontrado.' }, { status: 404 });

    const hoje = hojeFortaleza();
    const ate = acao === 'bloquear' ? String(corpo.ate || '') : null;
    if (acao === 'bloquear') {
      const problema = dataDeVoltaInvalida(ate);
      if (problema) return Response.json({ erro: problema }, { status: 400 });
    }

    async function gravar(campos) {
      const { error: e } = await supabaseAdmin.from('quartos').update(campos).eq('id', quarto.id);
      if (e) throw new Error('Não foi possível salvar o bloqueio no quarto: ' + e.message);
    }

    if (!quarto.cloudbeds_room_id) {
      await gravar(acao === 'bloquear' ? { interditado_ate: ate } : { interditado_ate: null, cloudbeds_bloqueio_id: null });
      return Response.json({ naoVinculado: true });
    }

    let cb;
    try { cb = await carregarCloudbeds(supabaseAdmin, chamador.hotel_id, segredoCripto); }
    catch (e) { return Response.json({ erro: e.message }, { status: 400 }); }

    // Tira o bloqueio antigo (liberar, ou trocar a data). Bloqueio que já
    // venceu pode nem existir mais lá — nesse caso seguimos em frente.
    if (quarto.cloudbeds_bloqueio_id) {
      try {
        await liberarNaCloudbeds(cb, quarto.cloudbeds_bloqueio_id);
      } catch (e) {
        const vencido = quarto.interditado_ate && quarto.interditado_ate < hoje;
        if (!vencido) return Response.json({ erro: 'A Cloudbeds não tirou o bloqueio: ' + e.message }, { status: 400 });
      }
      await gravar({ cloudbeds_bloqueio_id: null, ...(acao === 'liberar' ? { interditado_ate: null } : {}) });
    } else if (acao === 'liberar') {
      await gravar({ interditado_ate: null });
    }
    if (acao === 'liberar') return Response.json({ sucesso: true });

    const motivo = String(corpo.motivo || '').trim().slice(0, 120);
    let bloqueioId;
    try {
      bloqueioId = await bloquearNaCloudbeds(cb, quarto.cloudbeds_room_id, {
        inicio: hoje, fim: ate, motivo: `Interditado${motivo ? ' — ' + motivo : ''} (Chokmah)`,
      });
    } catch (e) {
      await gravar({ interditado_ate: ate });
      return Response.json({ erro: 'A Cloudbeds não bloqueou o quarto: ' + e.message }, { status: 400 });
    }
    await gravar({ cloudbeds_bloqueio_id: bloqueioId, interditado_ate: ate });
    return Response.json({ sucesso: true, bloqueioId, ate, texto: `Bloqueado na Cloudbeds até ${formatarDia(ate)}.` });
  } catch (erro) {
    return Response.json({ erro: 'Erro inesperado no servidor: ' + erro.message }, { status: 500 });
  }
}
