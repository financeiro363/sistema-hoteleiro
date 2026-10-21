// ============================================================================
// ROTA DE SERVIDOR: /api/sala-pagamento-cloudbeds
// ============================================================================
// Leva um pagamento da Sala de Reunião (já salvo no sistema) para a Conta da
// Casa "Sala de Reunião" da Cloudbeds — ou anula lá um pagamento que foi
// anulado no sistema.
//
// Corpo: { pagamentoId, acao: 'enviar' | 'anular' }
//
// Situação gravada em reservas_sala_pagamentos.cloudbeds_status:
//   ENVIADO        → está na Cloudbeds (o Fechamento de Caixa conta só de lá)
//   FALHOU         → não foi; a tela mostra "Tentar de novo"
//   NAO_ENVIADO    → pagamento com data passada (a Cloudbeds só registra hoje);
//                    fica somado no caixa pelo sistema, como antes
//   ANULADO        → anulado no sistema e na Cloudbeds
//   FALHA_ANULACAO → anulado no sistema, mas a Cloudbeds não anulou (anular lá à mão)
// ============================================================================

import {
  autenticarChamada, carregarCloudbeds, carregarConfigCaixa, garantirContaDaCasa, formaNaCloudbeds,
  lancarPagamento, anularPagamentoNaCloudbeds, hojeFortaleza,
} from '../../../lib/cloudbedsCaixa';

const TRAVA_SEGUNDOS = 60; // evita lançar duas vezes se clicarem duas vezes

export async function POST(request) {
  try {
    const auth = await autenticarChamada(request);
    if (auth.resposta) return auth.resposta;
    const { chamador, supabaseAdmin, segredoCripto } = auth;

    const corpo = await request.json().catch(() => ({}));
    const acao = corpo?.acao === 'anular' ? 'anular' : 'enviar';
    const pagamentoId = corpo?.pagamentoId;
    const numeroRecibo = corpo?.numeroRecibo;
    if (!pagamentoId && !numeroRecibo) return Response.json({ erro: 'Informe o pagamento.' }, { status: 400 });

    let consulta = supabaseAdmin.from('reservas_sala_pagamentos').select('*').eq('hotel_id', chamador.hotel_id);
    consulta = pagamentoId ? consulta.eq('id', pagamentoId) : consulta.eq('numero_recibo', numeroRecibo);
    const { data: pagamento, error: erroPag } = await consulta.maybeSingle();
    if (erroPag) {
      return Response.json({
        erro: /cloudbeds_|column/i.test(erroPag.message)
          ? 'O envio para a Cloudbeds ainda não foi ativado no banco de dados (falta rodar o SQL do caixa).'
          : 'Não foi possível ler o pagamento: ' + erroPag.message,
      }, { status: 400 });
    }
    if (!pagamento) return Response.json({ erro: 'Pagamento não encontrado.' }, { status: 404 });

    const atualizar = async (campos) => {
      const { data } = await supabaseAdmin.from('reservas_sala_pagamentos')
        .update(campos).eq('id', pagamento.id).select().single();
      return data || { ...pagamento, ...campos };
    };

    // ------------------------------------------------------------------ ANULAR
    if (acao === 'anular') {
      if (!pagamento.anulado_em) return Response.json({ erro: 'Este pagamento não foi anulado no sistema.' }, { status: 400 });
      if (!pagamento.cloudbeds_payment_id) return Response.json({ sucesso: true, nadaAFazer: true, pagamento });
      if (pagamento.cloudbeds_status === 'ANULADO') return Response.json({ sucesso: true, pagamento });
      if (pagamento.cloudbeds_payment_id === 'SEM_ID' || !pagamento.cloudbeds_conta_id) {
        const p = await atualizar({
          cloudbeds_status: 'FALHA_ANULACAO',
          cloudbeds_erro: 'A Cloudbeds não informou o número deste pagamento. Anule à mão na Conta da Casa "Sala de Reunião".',
        });
        return Response.json({ erro: p.cloudbeds_erro, pagamento: p }, { status: 400 });
      }
      try {
        const cb = await carregarCloudbeds(supabaseAdmin, chamador.hotel_id, segredoCripto);
        await anularPagamentoNaCloudbeds({ cb, contaId: pagamento.cloudbeds_conta_id, paymentId: pagamento.cloudbeds_payment_id });
        const p = await atualizar({ cloudbeds_status: 'ANULADO', cloudbeds_anulado_em: new Date().toISOString(), cloudbeds_erro: null });
        return Response.json({ sucesso: true, pagamento: p });
      } catch (e) {
        const p = await atualizar({ cloudbeds_status: 'FALHA_ANULACAO', cloudbeds_erro: `A Cloudbeds não anulou: ${e.message}. Anule à mão na Conta da Casa.` });
        return Response.json({ erro: p.cloudbeds_erro, pagamento: p }, { status: 400 });
      }
    }

    // ------------------------------------------------------------------ ENVIAR
    if (pagamento.anulado_em) return Response.json({ erro: 'Este pagamento foi anulado — não vai para a Cloudbeds.' }, { status: 400 });
    if (pagamento.cloudbeds_payment_id) return Response.json({ sucesso: true, jaEnviado: true, pagamento });

    let config;
    try { config = await carregarConfigCaixa(supabaseAdmin, chamador.hotel_id); }
    catch (e) { return Response.json({ erro: e.message }, { status: 400 }); }
    if (config.enviar_sala === false) {
      return Response.json({ sucesso: true, ignorado: true, motivo: 'O envio da Sala de Reunião para a Cloudbeds está desligado.', pagamento });
    }

    if (String(pagamento.data_pagamento).slice(0, 10) !== hojeFortaleza()) {
      const p = await atualizar({
        cloudbeds_status: 'NAO_ENVIADO',
        cloudbeds_erro: 'Pagamento com data passada: a Cloudbeds só registra na data de hoje. Ele continua somado no Fechamento de Caixa pelo sistema.',
      });
      return Response.json({ sucesso: true, ignorado: true, motivo: p.cloudbeds_erro, pagamento: p });
    }

    // Trava: só um envio por vez para o mesmo pagamento
    const limite = new Date(Date.now() - TRAVA_SEGUNDOS * 1000).toISOString();
    const { data: travado } = await supabaseAdmin.from('reservas_sala_pagamentos')
      .update({ cloudbeds_tentativa_em: new Date().toISOString() })
      .eq('id', pagamento.id).is('cloudbeds_payment_id', null)
      .or(`cloudbeds_tentativa_em.is.null,cloudbeds_tentativa_em.lt.${limite}`)
      .select('id');
    if (!travado?.length) {
      return Response.json({ erro: 'Este pagamento já está sendo enviado. Aguarde um minuto e confira.' }, { status: 409 });
    }

    try {
      const cb = await carregarCloudbeds(supabaseAdmin, chamador.hotel_id, segredoCripto);
      const forma = formaNaCloudbeds(config, pagamento.forma_pagamento);
      const contaId = await garantirContaDaCasa({ cb, supabaseAdmin, hotelId: chamador.hotel_id, config, tipo: 'sala' });
      const descricao = `Sala de Reunião — ${pagamento.sala_nome || 'Sala'} — ${pagamento.pagador_nome || 'Cliente'} — Recibo ${pagamento.numero_recibo || pagamento.id}`;
      const paymentId = await lancarPagamento({ cb, contaId, forma, valor: Number(pagamento.valor), descricao });
      const p = await atualizar({
        cloudbeds_status: 'ENVIADO', cloudbeds_payment_id: paymentId, cloudbeds_conta_id: contaId,
        cloudbeds_enviado_em: new Date().toISOString(), cloudbeds_erro: null, cloudbeds_tentativa_em: null,
      });
      return Response.json({ sucesso: true, pagamento: p });
    } catch (e) {
      const p = await atualizar({ cloudbeds_status: 'FALHOU', cloudbeds_erro: e.message, cloudbeds_tentativa_em: null });
      return Response.json({ erro: `Não foi para a Cloudbeds: ${e.message}`, pagamento: p }, { status: 400 });
    }
  } catch (erro) {
    return Response.json({ erro: 'Erro inesperado no servidor: ' + erro.message }, { status: 500 });
  }
}
