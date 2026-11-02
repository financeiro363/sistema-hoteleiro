// ============================================================================
// ROTA DE SERVIDOR: /api/telegram-webhook?canal=ID   (chamada pelo TELEGRAM)
// ============================================================================
// O sistema liga este endereço sozinho quando o administrador conecta o robô
// do Telegram em Caixa de Entrada → Canais. Cada chamada traz a senha
// (X-Telegram-Bot-Api-Secret-Token) que o sistema criou para o canal; sem ela,
// nada é gravado.
// Responde 200 mesmo quando uma mensagem não pôde ser processada (o erro fica
// registrado no canal), para o Telegram não reenviar sem parar.
// ============================================================================

import { clienteAdmin, lerSegredo, origemDoSite } from '../../../lib/atendimento/servidor';
import { processarAtualizacao, senhaConfere } from '../../../lib/atendimento/telegram';
import { responderPendentes } from '../../../lib/atendimento/robo';
import { aplicarFrases } from '../../../lib/atendimento/frases';

export const dynamic = 'force-dynamic';

const TEMPO_TOTAL_MS = 8500; // a Netlify encerra a função em 10 s

export async function POST(request) {
  const inicio = Date.now();
  const canalId = Math.trunc(Number(new URL(request.url).searchParams.get('canal')));
  if (!canalId) return new Response('Canal não informado', { status: 400 });

  let supabaseAdmin;
  try { supabaseAdmin = clienteAdmin(); } catch (e) { return new Response('Servidor não configurado', { status: 500 }); }

  const { data: canal } = await supabaseAdmin.from('atendimento_canais').select('*').eq('id', canalId).eq('tipo', 'TELEGRAM').maybeSingle();
  if (!canal) return new Response('Canal não encontrado', { status: 404 });
  const senha = await lerSegredo(supabaseAdmin, canal.hotel_id, 'telegram_senha_webhook', canal.id);
  if (!senhaConfere(request.headers.get('x-telegram-bot-api-secret-token') || '', senha || '')) {
    return new Response('Senha do webhook não confere', { status: 401 });
  }
  if (!canal.ativo) return Response.json({ ok: true, ignorado: 'canal desligado' });

  let update;
  try { update = await request.json(); } catch (e) { return new Response('JSON inválido', { status: 400 }); }

  const r = await processarAtualizacao(supabaseAdmin, canal, update);
  for (const e of r.entradas) {
    try { await aplicarFrases(supabaseAdmin, { conversaId: e.conversaId, canal, texto: e.texto, data: e.data }); } catch (erro) { /* a etiqueta é um extra */ }
  }
  await supabaseAdmin.from('atendimento_canais').update({
    status: r.erros.length ? 'ERRO' : 'OK',
    erro: r.erros.length ? r.erros.slice(0, 3).join(' | ').slice(0, 500) : null,
    ultima_sincronizacao: new Date().toISOString(),
  }).eq('id', canal.id);

  if (r.conversas.length) {
    try {
      await responderPendentes(supabaseAdmin, { origem: origemDoSite(request), prazo: inicio + TEMPO_TOTAL_MS, conversas: r.conversas });
    } catch (e) { /* a função agendada tenta de novo */ }
  }
  return Response.json({ ok: true });
}
