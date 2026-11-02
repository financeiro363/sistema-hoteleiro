// ============================================================================
// ROTA DE SERVIDOR: /api/governanca-configurar-webhook
// ============================================================================
// Liga/desliga a inscrição no aviso oficial "housekeeping/room_condition_changed"
// da Cloudbeds (POST /postWebhook e DELETE /deleteWebhook, API v1.3).
//   GET                    → { ativo, comSenha }
//   POST { ativar: true }  → cria uma senha nova, inscreve o endereço com a
//                            senha e, se havia inscrição antiga, tenta apagá-la
//   POST { ativar: false } → apaga a inscrição e a senha
// A senha fica criptografada (atendimento_segredos) e nunca volta para a tela.
// Só administrador.
// ============================================================================

import { autenticarChamada } from '../../../lib/cloudbedsCaixa';
import { lerSegredo, gravarSegredo } from '../../../lib/atendimento/servidor';
import { carregarCloudbeds, novaSenhaWebhook } from '../../../lib/governanca/cloudbeds';

export const dynamic = 'force-dynamic';

const API_WEBHOOK = 'https://hotels.cloudbeds.com/api/v1.3';
const URL_ENDPOINT_WEBHOOK = 'https://chokmahsystem.netlify.app/api/governanca-webhook-cloudbeds';
const CHAVE_SENHA = 'governanca_webhook_senha';

async function chamador(request) {
  const auth = await autenticarChamada(request);
  if (auth.resposta) return auth;
  if (auth.chamador.papel !== 'ADMIN') return { resposta: Response.json({ erro: 'Só administradores podem configurar isso.' }, { status: 403 }) };
  return auth;
}

export async function GET(request) {
  try {
    const auth = await chamador(request);
    if (auth.resposta) return auth.resposta;
    const { chamador: eu, supabaseAdmin } = auth;
    const { data: hotel } = await supabaseAdmin.from('hoteis').select('governanca_webhook_id').eq('id', eu.hotel_id).maybeSingle();
    const senha = await lerSegredo(supabaseAdmin, eu.hotel_id, CHAVE_SENHA);
    return Response.json({ ativo: !!hotel?.governanca_webhook_id, comSenha: !!senha });
  } catch (erro) {
    return Response.json({ erro: 'Erro inesperado no servidor: ' + erro.message }, { status: 500 });
  }
}

async function apagarInscricao(cb, id) {
  const resposta = await fetch(`${API_WEBHOOK}/deleteWebhook?subscriptionID=${encodeURIComponent(id)}&propertyID=${encodeURIComponent(cb.propertyId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${cb.apiKey}`, 'x-property-id': cb.propertyId, Accept: 'application/json' },
  });
  const dados = await resposta.json().catch(() => null);
  if (!resposta.ok || dados?.success === false) throw new Error(dados?.message || 'A Cloudbeds recusou o cancelamento da inscrição.');
}

export async function POST(request) {
  try {
    const { ativar } = await request.json().catch(() => ({}));
    const auth = await chamador(request);
    if (auth.resposta) return auth.resposta;
    const { chamador: eu, supabaseAdmin, segredoCripto } = auth;

    let cb;
    try { cb = await carregarCloudbeds(supabaseAdmin, eu.hotel_id, segredoCripto); }
    catch (e) { return Response.json({ erro: e.message }, { status: 400 }); }

    const { data: hotel } = await supabaseAdmin.from('hoteis').select('governanca_webhook_id').eq('id', eu.hotel_id).single();
    const antiga = hotel?.governanca_webhook_id || null;

    if (ativar) {
      const senha = novaSenhaWebhook();
      const parametros = new URLSearchParams({
        propertyID: cb.propertyId,
        endpointUrl: `${URL_ENDPOINT_WEBHOOK}?chave=${encodeURIComponent(senha)}`,
        object: 'housekeeping',
        action: 'room_condition_changed',
      });
      const resposta = await fetch(`${API_WEBHOOK}/postWebhook`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cb.apiKey}`, 'x-property-id': cb.propertyId, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: parametros.toString(),
      });
      const dados = await resposta.json().catch(() => null);
      if (!resposta.ok || dados?.success === false) {
        const mensagem = dados?.message || 'A Cloudbeds recusou a inscrição.';
        const dicaEscopo = /scope|permission|unauthorized/i.test(mensagem)
          ? ' — confira se os escopos "Housekeeping" (Ler e Escrever) foram adicionados à chave de API.'
          : '';
        return Response.json({ erro: `${mensagem}${dicaEscopo}` }, { status: 400 });
      }
      const idInscricao = dados?.data?.subscriptionID || dados?.data?.id || dados?.subscriptionID || dados?.id || 'ativo';
      // Primeiro a senha, depois o número da inscrição: a partir daqui só
      // avisos com a senha nova são aceitos.
      await gravarSegredo(supabaseAdmin, eu.hotel_id, CHAVE_SENHA, senha);
      await supabaseAdmin.from('hoteis').update({ governanca_webhook_id: String(idInscricao) }).eq('id', eu.hotel_id);

      let aviso = null;
      if (antiga && antiga !== 'ativo' && antiga !== String(idInscricao)) {
        try { await apagarInscricao(cb, antiga); }
        catch (e) { aviso = 'A inscrição antiga (sem senha) não pôde ser apagada na Cloudbeds, mas os avisos dela agora são recusados.'; }
      }
      return Response.json({ sucesso: true, aviso });
    }

    if (antiga && antiga !== 'ativo') {
      try { await apagarInscricao(cb, antiga); }
      catch (e) { return Response.json({ erro: e.message }, { status: 400 }); }
    }
    await supabaseAdmin.from('hoteis').update({ governanca_webhook_id: null }).eq('id', eu.hotel_id);
    await supabaseAdmin.from('atendimento_segredos').delete().eq('hotel_id', eu.hotel_id).eq('canal_id', 0).eq('chave', CHAVE_SENHA);
    return Response.json({ sucesso: true });
  } catch (erro) {
    return Response.json({ erro: 'Erro inesperado no servidor: ' + erro.message }, { status: 500 });
  }
}
