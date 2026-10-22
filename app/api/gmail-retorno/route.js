// ============================================================================
// ROTA DE SERVIDOR: /api/gmail-retorno   (o GOOGLE manda o navegador para cá)
// ============================================================================
// Depois que o administrador clica em "Conectar caixa de e-mail" e autoriza no
// Google, o Google volta para este endereço com um código. Aqui:
//   1. confere o "estado" assinado (quem pediu, de qual hotel, e se não venceu)
//   2. troca o código pelas chaves de acesso e guarda criptografado
//   3. cria (ou atualiza) o canal de e-mail com a assinatura da caixa
//   4. volta para Caixa de Entrada → Canais
// Endereço a cadastrar no Google Cloud ("URIs de redirecionamento autorizados"):
//   https://chokmahsystem.netlify.app/api/gmail-retorno
// ============================================================================

import {
  clienteAdmin, verificarEstado, gravarSegredo, origemDoSite, erroBanco,
} from '../../../lib/atendimento/servidor';
import {
  credenciaisGoogle, trocarCodigo, perfilDaCaixa, remetentesDaCaixa,
} from '../../../lib/atendimento/gmail';

export const dynamic = 'force-dynamic';

function voltar(origem, parametros) {
  const p = new URLSearchParams({ aba: 'canais', ...parametros });
  return Response.redirect(`${origem}/atendimento?${p.toString()}`, 302);
}

export async function GET(request) {
  const url = new URL(request.url);
  const origem = origemDoSite(request);
  if (url.searchParams.get('error')) {
    const motivo = url.searchParams.get('error') === 'access_denied'
      ? 'A autorização foi cancelada no Google.'
      : `O Google não autorizou: ${url.searchParams.get('error')}`;
    return voltar(origem, { gmail: 'erro', motivo });
  }

  const estado = verificarEstado(url.searchParams.get('state'));
  if (!estado?.h) return voltar(origem, { gmail: 'erro', motivo: 'O link de conexão venceu (15 minutos). Clique em "Conectar caixa de e-mail" de novo.' });
  const code = url.searchParams.get('code');
  if (!code) return voltar(origem, { gmail: 'erro', motivo: 'O Google não enviou o código de autorização.' });

  try {
    const supabaseAdmin = clienteAdmin();
    const hotelId = estado.h;
    const { clientId, clientSecret } = await credenciaisGoogle(supabaseAdmin, hotelId);
    const tokens = await trocarCodigo({ clientId, clientSecret, redirectUri: `${origem}/api/gmail-retorno`, code });
    if (!tokens.refresh_token) {
      return voltar(origem, {
        gmail: 'erro',
        motivo: 'O Google não liberou o acesso permanente. Remova o app em myaccount.google.com → Segurança → Apps de terceiros e conecte de novo.',
      });
    }

    const perfil = await perfilDaCaixa(tokens.access_token);
    const email = String(perfil.emailAddress || '').toLowerCase();
    const remetentes = await remetentesDaCaixa(tokens.access_token);
    const principal = remetentes.find((r) => String(r.sendAsEmail).toLowerCase() === email) || remetentes.find((r) => r.isPrimary) || {};

    // Já existe? (mesma caixa conectada antes)
    const { data: existente } = await supabaseAdmin.from('atendimento_canais')
      .select('*').eq('tipo', 'EMAIL').eq('identificador', email).maybeSingle();
    if (existente && Number(existente.hotel_id) !== Number(hotelId)) {
      return voltar(origem, { gmail: 'erro', motivo: `A caixa ${email} já está conectada em outro hotel.` });
    }

    const config = {
      ...(existente?.config || {}),
      nomeExibicao: principal.displayName || existente?.config?.nomeExibicao || null,
      assinatura: principal.signature || null,
      enderecos: remetentes.map((r) => String(r.sendAsEmail).toLowerCase()).filter(Boolean),
    };
    let canalId;
    if (existente) {
      const { error } = await supabaseAdmin.from('atendimento_canais').update({
        config, ativo: true, status: 'OK', erro: null, endereco_exibicao: email, atualizado_em: new Date().toISOString(),
      }).eq('id', existente.id);
      if (error) throw error;
      canalId = existente.id;
    } else {
      const { data, error } = await supabaseAdmin.from('atendimento_canais').insert({
        hotel_id: hotelId, tipo: 'EMAIL', nome: email, identificador: email, endereco_exibicao: email,
        config, criado_por_id: estado.u || null,
      }).select().single();
      if (error) throw error;
      canalId = data.id;
    }

    await gravarSegredo(supabaseAdmin, hotelId, 'gmail_refresh', tokens.refresh_token, canalId);
    await gravarSegredo(supabaseAdmin, hotelId, 'gmail_acesso',
      JSON.stringify({ token: tokens.access_token, expira: Date.now() + (Number(tokens.expires_in) || 3600) * 1000 }), canalId);

    return voltar(origem, { gmail: 'ok', email });
  } catch (e) {
    return voltar(origem, { gmail: 'erro', motivo: erroBanco(e, 'Não foi possível conectar') });
  }
}
