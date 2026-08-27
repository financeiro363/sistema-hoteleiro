// ============================================================================
// ROTA DE SERVIDOR: /api/atestado-notificar
// ============================================================================
// Envia o e-mail automático de aviso de um novo atestado médico/
// odontológico cadastrado, pro endereço configurado em Administração →
// Atestados → Configurações. Mesmo padrão (e mesmo provedor, Resend) já
// usado em /api/devolucao-notificar.
// ============================================================================

import { createClient } from '@supabase/supabase-js';

function formatarDataBR(valor) {
  if (!valor) return '—';
  try {
    const [ano, mes, dia] = String(valor).slice(0, 10).split('-');
    return `${dia}/${mes}/${ano}`;
  } catch (e) { return String(valor); }
}

export async function POST(request) {
  try {
    const { atestadoId } = await request.json();
    if (!atestadoId) return Response.json({ erro: 'Informe o atestado.' }, { status: 400 });

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

    const { data: atestado, error: erroAtestado } = await supabaseAdmin
      .from('atestados').select('*').eq('id', atestadoId).eq('hotel_id', chamador.hotel_id).single();
    if (erroAtestado || !atestado) return Response.json({ erro: 'Atestado não encontrado.' }, { status: 404 });

    const { data: hotel } = await supabaseAdmin
      .from('hoteis').select('email_notificacao_atestados').eq('id', chamador.hotel_id).single();
    if (!hotel?.email_notificacao_atestados) {
      return Response.json({ semEmailConfigurado: true });
    }

    const [{ data: funcionario }, { data: solicitante }] = await Promise.all([
      supabaseAdmin.from('funcionarios').select('nome').eq('id', atestado.funcionario_id).maybeSingle(),
      supabaseAdmin.from('usuarios').select('nome').eq('id', atestado.criado_por_id).maybeSingle(),
    ]);

    const nomeColaborador = funcionario?.nome || 'Colaborador não identificado';
    const nomeSolicitante = solicitante?.nome || 'Usuário do sistema';

    const assunto = `Novo Atestado Registrado - ${nomeColaborador}`;
    const corpo = [
      'Olá, um novo atestado médico/odontológico foi registrado no sistema.',
      '=-=-=-=-=-=-=-=-=-=-=-=-=',
      `Nome do colaborador: ${nomeColaborador}`,
      `Data de emissão: ${formatarDataBR(atestado.data_emissao)}`,
      `Dias de afastamento: ${atestado.dias_afastamento}`,
      `Protocolo: ${atestado.protocolo}`,
      '=-=-=-=-=-=-=-=-=-=-=-=-=',
      `Cadastrado por: ${nomeSolicitante}`,
    ].join('\n');

    const remetente = process.env.RESEND_FROM_EMAIL || 'Chokmah System <onboarding@resend.dev>';

    const respostaResend = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: remetente,
        to: [hotel.email_notificacao_atestados],
        subject: assunto,
        text: corpo,
      }),
    });
    const dadosResend = await respostaResend.json().catch(() => null);
    if (!respostaResend.ok) {
      const mensagem = dadosResend?.message || 'A Resend recusou o envio.';
      return Response.json({ erro: mensagem }, { status: 502 });
    }

    return Response.json({ sucesso: true });
  } catch (erro) {
    return Response.json({ erro: 'Erro inesperado no servidor: ' + erro.message }, { status: 500 });
  }
}
