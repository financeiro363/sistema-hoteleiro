// ============================================================================
// ROTA DE SERVIDOR: /api/devolucao-notificar
// ============================================================================
// Envia o e-mail automático de aviso de uma solicitação de devolução, pro
// endereço configurado em Créditos e Devoluções → Configurações daquele
// hotel. O modelo do e-mail muda conforme o tipo (Pix / Cartão / Depósito
// Bancário) — os três modelos abaixo são exatamente os que foram pedidos.
//
// Usa o Resend (https://resend.com) pra enviar de verdade. Duas variáveis
// de ambiente são necessárias na Netlify:
//   RESEND_API_KEY   → a chave de API criada no painel do Resend
//   RESEND_FROM_EMAIL → o remetente (ex.: "Chokmah System <notificacoes@SEUDOMINIO.com.br>")
//                        — enquanto nenhum domínio estiver verificado no
//                        Resend, pode deixar em branco: a rota usa
//                        "onboarding@resend.dev" como reserva, mas esse
//                        remetente só consegue mandar e-mail pro próprio
//                        endereço de quem criou a conta no Resend (é uma
//                        limitação do modo de teste deles, não nossa).
// ============================================================================

import { createClient } from '@supabase/supabase-js';

function formatarDataBR(valor) {
  if (!valor) return '—';
  try {
    const [ano, mes, dia] = String(valor).slice(0, 10).split('-');
    return `${dia}/${mes}/${ano}`;
  } catch (e) { return String(valor); }
}

function formatarMoedaBR(valor) {
  if (valor == null) return '—';
  return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function montarEmail(d, nomeSolicitante) {
  const dataSolicitacao = formatarDataBR(d.criado_em);
  const nomePax = d.nome_pax || '—';
  const dataCheckout = formatarDataBR(d.data_checkout);
  const numeroReserva = d.fatura_reserva || '—';
  const nomeEmpresa = d.nome_empresa || 'Particular';

  if (d.tipo === 'PIX') {
    return {
      assunto: `Nova Solicitação de Devolução - PIX - ${nomePax}`,
      corpo: [
        'Olá, pedimos que seja cancelado o pix abaixo.',
        `Solicitação feita por: ${nomeSolicitante}`,
        `Data da solicitação: ${dataSolicitacao}`,
        '=-=-=-=-=-=-=-=-=-=-=-=-=',
        `Nome do pax: ${nomePax}`,
        `Data do check-out: ${dataCheckout}`,
        `Fatura / reserva: ${numeroReserva}`,
        `Nome da empresa: ${nomeEmpresa}`,
        '=-=-=-=-=-=-=-=-=-=-=-=-=',
        `Nome do depositante: ${d.nome_depositante || '—'}`,
        `Valor do depósito: ${formatarMoedaBR(d.valor_depositado)}`,
        `Data do depósito: ${formatarDataBR(d.data_deposito)}`,
        '=-=-=-=-=-=-=-=-=-=-=-=-=',
        `Qual o valor que precisa ser estornado? ${formatarMoedaBR(d.valor_devolver)}`,
      ].join('\n'),
    };
  }

  if (d.tipo === 'CARTAO') {
    return {
      assunto: `Nova Solicitação de Devolução - Cartão - ${nomePax}`,
      corpo: [
        'Olá, pedimos que seja cancelado o cartão abaixo.',
        `Solicitação feita por: ${nomeSolicitante}`,
        `Data de solicitação: ${dataSolicitacao}`,
        '-=-=-=-=-=-=-=-=-=-=-=-',
        `Nome do pax: ${nomePax}`,
        `Data do check-out: ${dataCheckout}`,
        `Fatura / reserva: ${numeroReserva}`,
        `Nome da empresa: ${nomeEmpresa}`,
        `Qual a forma que foi feita o pagamento ao hotel? ${d.forma_pagamento || '—'}`,
        '-=-=-=-=-=-=-=-=-=-=-=--',
        `Quatro últimos números do cartão que foi passado: ${d.ultimos_digitos || '—'}`,
        `Qual o valor que foi passado o cartão? ${formatarMoedaBR(d.valor_passado_cartao)}`,
        `Qual o dia que foi passado a venda no cartão? ${formatarDataBR(d.data_venda_cartao)}`,
        '-=-=-=-=-=-=-=-=-=-=-=--',
        `Qual o valor que precisa ser estornado? ${formatarMoedaBR(d.valor_estornar)}`,
      ].join('\n'),
    };
  }

  // DEPOSITO
  return {
    assunto: `Nova Solicitação de Devolução - Depósito Bancário - ${nomePax}`,
    corpo: [
      'Olá, segue abaixo os dados para a devolução do seguinte pagamento antecipado.',
      `Solicitação feita por: ${nomeSolicitante}`,
      `Data da solicitação: ${dataSolicitacao}`,
      '=-=-=-=-=-=-=-=-=-=-=-=-=',
      `Data do check-out: ${dataCheckout}`,
      `Nome do pax: ${nomePax}`,
      `Fatura / reserva: ${numeroReserva}`,
      `Nome da empresa: ${nomeEmpresa}`,
      `Qual a forma de pagt. ao hotel: ${d.forma_pagamento || '—'}`,
      '=-=-=-=-=-=-=-=-=-=-=-=-=',
      `Qual o nome do banco: ${d.nome_banco || '—'}`,
      `Conta corrente ou poupança? ${d.tipo_conta || '—'}`,
      `Agência: ${d.agencia || '—'}`,
      `Número da conta: ${d.numero_conta || '—'}`,
      `Nome do titular da conta: ${d.nome_titular || '—'}`,
      '=-=-=-=-=-=-=-=-=-=-=-=-=',
      `Valor a ser devolvido: ${formatarMoedaBR(d.valor_devolver)}`,
    ].join('\n'),
  };
}

export async function POST(request) {
  try {
    const { devolucaoId } = await request.json();
    if (!devolucaoId) return Response.json({ erro: 'Informe a solicitação.' }, { status: 400 });

    const tokenAcesso = (request.headers.get('authorization') || '').replace('Bearer ', '');
    if (!tokenAcesso) return Response.json({ erro: 'Não autorizado — faça login novamente.' }, { status: 401 });

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const chaveAnonima = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const chaveMestra = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const resendApiKey = process.env.RESEND_API_KEY;
    if (!supabaseUrl || !chaveAnonima || !chaveMestra) {
      return Response.json({ erro: 'O servidor não está configurado corretamente.' }, { status: 500 });
    }
    if (!resendApiKey) {
      return Response.json({ erro: 'O envio de e-mail ainda não foi configurado no servidor (falta a chave do Resend).' }, { status: 500 });
    }

    const supabaseComoChamador = createClient(supabaseUrl, chaveAnonima, {
      global: { headers: { Authorization: `Bearer ${tokenAcesso}` } },
    });
    const { data: dadosAuth, error: erroAuth } = await supabaseComoChamador.auth.getUser(tokenAcesso);
    if (erroAuth || !dadosAuth?.user) return Response.json({ erro: 'Sessão inválida ou expirada.' }, { status: 401 });
    const { data: chamador, error: erroChamador } = await supabaseComoChamador
      .from('usuarios').select('id, hotel_id').eq('auth_id', dadosAuth.user.id).single();
    if (erroChamador || !chamador) return Response.json({ erro: 'Não foi possível confirmar seu usuário.' }, { status: 403 });

    const supabaseAdmin = createClient(supabaseUrl, chaveMestra);

    const { data: devolucao, error: erroDev } = await supabaseAdmin
      .from('devolucoes').select('*').eq('id', devolucaoId).eq('hotel_id', chamador.hotel_id).single();
    if (erroDev || !devolucao) return Response.json({ erro: 'Solicitação não encontrada.' }, { status: 404 });

    const { data: hotel } = await supabaseAdmin
      .from('hoteis').select('email_notificacao_devolucoes').eq('id', chamador.hotel_id).single();
    if (!hotel?.email_notificacao_devolucoes) {
      return Response.json({ semEmailConfigurado: true });
    }

    const { data: solicitante } = await supabaseAdmin
      .from('usuarios').select('nome').eq('id', devolucao.solicitado_por_id).maybeSingle();

    const { assunto, corpo } = montarEmail(devolucao, solicitante?.nome || 'Usuário do sistema');
    const remetente = process.env.RESEND_FROM_EMAIL || 'Chokmah System <onboarding@resend.dev>';

    const respostaResend = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: remetente,
        to: [hotel.email_notificacao_devolucoes],
        subject: assunto,
        text: corpo,
      }),
    });
    const dadosResend = await respostaResend.json().catch(() => null);
    if (!respostaResend.ok) {
      const mensagem = dadosResend?.message || 'A Resend recusou o envio.';
      const dica = /verify a domain|domain is not verified/i.test(mensagem)
        ? ' — isso confirma que ainda falta verificar um domínio próprio no Resend (veja resend.com/domains).'
        : '';
      return Response.json({ erro: `${mensagem}${dica}` }, { status: 502 });
    }

    return Response.json({ sucesso: true });
  } catch (erro) {
    return Response.json({ erro: 'Erro inesperado no servidor: ' + erro.message }, { status: 500 });
  }
}
