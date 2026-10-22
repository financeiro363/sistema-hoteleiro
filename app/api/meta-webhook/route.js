// ============================================================================
// ROTA DE SERVIDOR: /api/meta-webhook   (chamada pela META, não pela tela)
// ============================================================================
// Endereço que vai no app da Meta (developers.facebook.com → seu app →
// WhatsApp → Configuração → Webhook):
//   https://chokmahsystem.netlify.app/api/meta-webhook
//
// GET  → a Meta confere o "token de verificação" (gerado em Caixa de Entrada →
//        Canais) e esta rota devolve o "hub.challenge".
// POST → mensagens novas e avisos de entrega/leitura. Cada chamada é conferida
//        pela assinatura (X-Hub-Signature-256) com a "Chave secreta do app".
//
// Responde 200 mesmo quando uma mensagem não pôde ser processada (o erro fica
// registrado no canal), para a Meta não reenviar sem parar.
// Instagram e Facebook (Parte B) vão usar esta mesma rota.
// ============================================================================

import { clienteAdmin, lerSegredo } from '../../../lib/atendimento/servidor';
import { assinaturaValida, processarValorWebhook } from '../../../lib/atendimento/whatsapp';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const url = new URL(request.url);
  const modo = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const desafio = url.searchParams.get('hub.challenge');
  if (modo !== 'subscribe' || !token || !desafio) return new Response('Requisição inválida', { status: 400 });

  try {
    const supabaseAdmin = clienteAdmin();
    const { data } = await supabaseAdmin.from('atendimento_config')
      .select('hotel_id').eq('meta_verify_token', token).limit(1).maybeSingle();
    if (!data) return new Response('Token de verificação não confere', { status: 403 });
    return new Response(desafio, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  } catch (e) {
    return new Response('Erro no servidor', { status: 500 });
  }
}

export async function POST(request) {
  const corpoBruto = await request.text();
  let corpo;
  try { corpo = JSON.parse(corpoBruto); } catch (e) { return new Response('JSON inválido', { status: 400 }); }

  let supabaseAdmin;
  try { supabaseAdmin = clienteAdmin(); } catch (e) { return new Response('Servidor não configurado', { status: 500 }); }

  if (corpo?.object !== 'whatsapp_business_account') {
    return Response.json({ ok: true, ignorado: corpo?.object || 'desconhecido' });
  }

  const assinatura = request.headers.get('x-hub-signature-256') || '';
  const segredosConferidos = {}; // hotel_id → true/false
  let algumaInvalida = false;

  for (const entrada of corpo.entry || []) {
    for (const mudanca of entrada.changes || []) {
      if (mudanca.field !== 'messages') continue;
      const valor = mudanca.value || {};
      const phoneNumberId = valor.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      const { data: canal } = await supabaseAdmin.from('atendimento_canais')
        .select('*').eq('tipo', 'WHATSAPP').eq('identificador', String(phoneNumberId)).maybeSingle();
      if (!canal || !canal.ativo) continue;

      // Confere a assinatura com a chave secreta do app (uma vez por hotel)
      if (segredosConferidos[canal.hotel_id] === undefined) {
        const appSecret = await lerSegredo(supabaseAdmin, canal.hotel_id, 'meta_app_secret');
        segredosConferidos[canal.hotel_id] = assinaturaValida(corpoBruto, assinatura, appSecret);
      }
      if (!segredosConferidos[canal.hotel_id]) {
        algumaInvalida = true;
        await supabaseAdmin.from('atendimento_canais').update({
          status: 'ERRO',
          erro: 'Chegou uma mensagem com assinatura que não confere. Confira a "Chave secreta do app" (App Secret) em Canais.',
          atualizado_em: new Date().toISOString(),
        }).eq('id', canal.id);
        continue;
      }

      try {
        const r = await processarValorWebhook(supabaseAdmin, canal, valor);
        await supabaseAdmin.from('atendimento_canais').update({
          status: r.erros.length ? 'ERRO' : 'OK',
          erro: r.erros.length ? r.erros.slice(0, 3).join(' | ').slice(0, 500) : null,
          ultima_sincronizacao: new Date().toISOString(),
        }).eq('id', canal.id);
      } catch (e) {
        await supabaseAdmin.from('atendimento_canais').update({ status: 'ERRO', erro: String(e.message).slice(0, 500) }).eq('id', canal.id);
      }
    }
  }

  if (algumaInvalida) return new Response('Assinatura inválida', { status: 401 });
  return Response.json({ ok: true });
}
