// ============================================================================
// ROTA DE SERVIDOR: /api/push  (avisos no celular)
// ============================================================================
//   GET                                   → { chavePublica }
//   POST { acao: 'inscrever', inscricao }  → guarda este celular (PushSubscription)
//   POST { acao: 'cancelar', endpoint }    → apaga este celular
//   POST { acao: 'testar' }                → manda um aviso de teste para mim
// Cada pessoa só mexe nos próprios celulares. Ver lib/push.js.
// ============================================================================

import { autenticarChamada } from '../../../lib/cloudbedsCaixa';
import { chavesVapid, enviarPush, inscricaoValida } from '../../../lib/push';

export const dynamic = 'force-dynamic';

const erro = (m, s = 400) => Response.json({ erro: m }, { status: s });

export async function GET(request) {
  try {
    const auth = await autenticarChamada(request);
    if (auth.resposta) return auth.resposta;
    const chaves = await chavesVapid(auth.supabaseAdmin, auth.chamador.hotel_id);
    return Response.json({ chavePublica: chaves.publicKey });
  } catch (e) {
    return erro('Não foi possível preparar os avisos: ' + e.message, 500);
  }
}

export async function POST(request) {
  try {
    const corpo = await request.json().catch(() => ({}));
    const auth = await autenticarChamada(request);
    if (auth.resposta) return auth.resposta;
    const { chamador, supabaseAdmin } = auth;

    if (corpo.acao === 'inscrever') {
      const i = inscricaoValida(corpo.inscricao);
      if (!i) return erro('Dados do celular inválidos.');
      const { error } = await supabaseAdmin.from('push_inscricoes').upsert({
        ...i, hotel_id: chamador.hotel_id, usuario_id: chamador.id,
        aparelho: String(request.headers.get('user-agent') || '').slice(0, 300) || null,
      }, { onConflict: 'endpoint' });
      if (error) return erro('Não foi possível ligar os avisos: ' + error.message);
      return Response.json({ sucesso: true });
    }

    if (corpo.acao === 'cancelar') {
      const endpoint = String(corpo.endpoint || '');
      if (!endpoint) return erro('Celular não informado.');
      await supabaseAdmin.from('push_inscricoes').delete().eq('endpoint', endpoint).eq('usuario_id', chamador.id);
      return Response.json({ sucesso: true });
    }

    if (corpo.acao === 'testar') {
      const r = await enviarPush(supabaseAdmin, chamador.hotel_id, [chamador.id], {
        titulo: '🔔 Teste de aviso', corpo: `Tudo certo, ${String(chamador.nome || '').split(' ')[0]}! Os pedidos da recepção chegam assim.`,
        url: '/governanca', tag: 'teste',
      });
      if (!r.enviados) return erro('Nenhum aviso chegou. Desligue e ligue os avisos de novo neste celular.');
      return Response.json({ sucesso: true, enviados: r.enviados });
    }

    return erro('Pedido inválido.');
  } catch (e) {
    return erro('Erro inesperado no servidor: ' + e.message, 500);
  }
}
