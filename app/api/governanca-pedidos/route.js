// ============================================================================
// ROTA DE SERVIDOR: /api/governanca-pedidos  (pedidos especiais)
// ============================================================================
//   POST { acao: 'criar', quartoId, tipo, quantidade, descricao }  (recepção/governança)
//        → grava o pedido e manda aviso no celular para quem deve levar
//          (regra em lib/governanca/pedidos.js)
//   POST { acao: 'andamento', pedidoId, situacao: 'A_CAMINHO'|'ENTREGUE' }  (camareira)
//   POST { acao: 'cancelar', pedidoId }   (recepção/governança)
//   POST { acao: 'reavisar', pedidoId }   (recepção/governança) → manda o aviso de novo
// Quem grava é sempre o servidor; a tela só lê (com tempo real).
// ============================================================================

import { autenticarChamada, hojeFortaleza } from '../../../lib/cloudbedsCaixa';
import { enviarPush } from '../../../lib/push';
import { destinatariosDoPedido, pedidoValido, textoDoPedido, MOTIVO_AVISO } from '../../../lib/governanca/pedidos';

export const dynamic = 'force-dynamic';

const erro = (m, s = 400) => Response.json({ erro: m }, { status: s });
const EQUIPE = ['ADMIN', 'COLABORADOR'];

function mensagemDoPedido(p) {
  return {
    titulo: `📣 Pedido — Apto ${p.quarto_numero}`,
    corpo: `${textoDoPedido(p)}${p.descricao && p.tipo !== 'OUTRO' ? ` · ${p.descricao}` : ''}`,
    url: '/governanca', tag: `pedido-${p.id}`,
  };
}

async function avisar(supabaseAdmin, pedido, nomes) {
  const r = await enviarPush(supabaseAdmin, pedido.hotel_id, pedido.avisadas, mensagemDoPedido(pedido));
  await supabaseAdmin.from('governanca_pedidos').update({ avisos_enviados: (pedido.avisos_enviados || 0) + r.enviados }).eq('id', pedido.id);
  return { enviados: r.enviados, semCelular: r.semCelular.map((id) => nomes.get(Number(id)) || `#${id}`) };
}

export async function POST(request) {
  try {
    const corpo = await request.json().catch(() => ({}));
    const auth = await autenticarChamada(request);
    if (auth.resposta) return auth.resposta;
    const { chamador, supabaseAdmin } = auth;
    const hotelId = chamador.hotel_id;

    const { data: camareiras } = await supabaseAdmin.from('usuarios').select('id, nome, ativo')
      .eq('hotel_id', hotelId).eq('papel', 'CAMAREIRA');
    const ativas = (camareiras || []).filter((c) => c.ativo !== false);
    const nomes = new Map(ativas.map((c) => [Number(c.id), c.nome]));

    if (corpo.acao === 'criar') {
      if (!EQUIPE.includes(chamador.papel)) return erro('Só a recepção e a governança lançam pedidos.', 403);
      const problema = pedidoValido(corpo);
      if (problema) return erro(problema);
      const { data: quarto } = await supabaseAdmin.from('quartos').select('*').eq('id', corpo.quartoId).eq('hotel_id', hotelId).maybeSingle();
      if (!quarto) return erro('Apartamento não encontrado.', 404);
      const { data: escala } = await supabaseAdmin.from('governanca_escala').select('*').eq('hotel_id', hotelId).eq('data', hojeFortaleza());
      const destino = destinatariosDoPedido(quarto, escala || [], ativas);
      const { data: pedido, error } = await supabaseAdmin.from('governanca_pedidos').insert({
        hotel_id: hotelId, quarto_id: quarto.id, quarto_numero: quarto.numero,
        tipo: corpo.tipo, quantidade: Number(corpo.quantidade || 1),
        descricao: String(corpo.descricao || '').trim().slice(0, 300) || null,
        avisadas: destino.ids, criado_por_id: chamador.id, criado_por_nome: chamador.nome,
      }).select().single();
      if (error) return erro('Não foi possível gravar o pedido: ' + error.message);
      const r = await avisar(supabaseAdmin, pedido, nomes);
      return Response.json({
        sucesso: true, pedidoId: pedido.id, motivo: MOTIVO_AVISO[destino.motivo],
        avisadas: destino.ids.map((id) => nomes.get(Number(id)) || `#${id}`), ...r,
      });
    }

    const pedidoId = Number(corpo.pedidoId);
    if (!pedidoId) return erro('Pedido não informado.');
    const { data: pedido } = await supabaseAdmin.from('governanca_pedidos').select('*').eq('id', pedidoId).eq('hotel_id', hotelId).maybeSingle();
    if (!pedido) return erro('Pedido não encontrado.', 404);
    const agora = new Date().toISOString();

    if (corpo.acao === 'andamento') {
      if (corpo.situacao === 'A_CAMINHO') {
        // Só a primeira que tocar fica com o pedido
        const { data: pegou } = await supabaseAdmin.from('governanca_pedidos')
          .update({ situacao: 'A_CAMINHO', a_caminho_em: agora, atendido_por_id: chamador.id, atendido_por_nome: chamador.nome })
          .eq('id', pedidoId).eq('situacao', 'NOVO').select('id');
        if (!pegou?.length) return erro(pedido.situacao === 'A_CAMINHO' ? `${pedido.atendido_por_nome || 'Outra pessoa'} já está levando.` : 'Este pedido já foi resolvido.', 409);
        return Response.json({ sucesso: true });
      }
      if (corpo.situacao === 'ENTREGUE') {
        if (!['NOVO', 'A_CAMINHO'].includes(pedido.situacao)) return erro('Este pedido já foi resolvido.', 409);
        if (pedido.situacao === 'A_CAMINHO' && Number(pedido.atendido_por_id) !== Number(chamador.id) && !EQUIPE.includes(chamador.papel)) {
          return erro(`${pedido.atendido_por_nome || 'Outra pessoa'} está levando este pedido.`, 409);
        }
        await supabaseAdmin.from('governanca_pedidos').update({
          situacao: 'ENTREGUE', entregue_em: agora,
          ...(pedido.atendido_por_id ? {} : { atendido_por_id: chamador.id, atendido_por_nome: chamador.nome }),
        }).eq('id', pedidoId).in('situacao', ['NOVO', 'A_CAMINHO']);
        return Response.json({ sucesso: true });
      }
      return erro('Situação inválida.');
    }

    if (!EQUIPE.includes(chamador.papel)) return erro('Só a recepção e a governança mexem nisso.', 403);

    if (corpo.acao === 'cancelar') {
      if (!['NOVO', 'A_CAMINHO'].includes(pedido.situacao)) return erro('Este pedido já foi resolvido.', 409);
      await supabaseAdmin.from('governanca_pedidos').update({ situacao: 'CANCELADO', cancelado_em: agora }).eq('id', pedidoId);
      return Response.json({ sucesso: true });
    }

    if (corpo.acao === 'reavisar') {
      if (pedido.situacao !== 'NOVO') return erro('Só dá para avisar de novo um pedido que ninguém pegou.', 409);
      const r = await avisar(supabaseAdmin, pedido, nomes);
      return Response.json({ sucesso: true, avisadas: (pedido.avisadas || []).map((id) => nomes.get(Number(id)) || `#${id}`), ...r });
    }

    return erro('Pedido inválido.');
  } catch (e) {
    return erro('Erro inesperado no servidor: ' + e.message, 500);
  }
}
