// ============================================================================
// ROTA DE SERVIDOR (WEBHOOK): /api/governanca-webhook-cloudbeds?chave=...
// ============================================================================
// A Cloudbeds chama esta rota sozinha toda vez que a limpeza de um quarto muda
// por lá — evento oficial "housekeeping/room_condition_changed"
// (https://developers.cloudbeds.com/docs/webhooks-1), inclusive o "sujo" que
// ela marca sozinha depois de um check-out.
//
// Formato do aviso: { "roomId": "128837-7", "propertyId": "12345",
//   "condition": "clean", "event": "housekeeping/room_condition_changed" }
//
// Senha: ao ativar as notificações, o sistema cria uma senha e a coloca no
// endereço (?chave=...). Ela fica guardada criptografada e só o servidor lê.
// Aviso sem a senha certa é recusado. (Inscrições antigas, feitas antes da
// senha existir, continuam aceitas até o administrador reativar — a tela de
// Configurações avisa.)
//
// Além da limpeza (status), acerta o estado do apartamento: pergunta à
// Cloudbeds se o quarto está ocupado e aplica as regras de
// lib/governanca/regras.js (ex.: saída feita → "Saída / Apt Sujo").
// "Interditado" e "Serviços gerais" só a equipe muda.
//
// Bloqueio feito direto na Cloudbeds (roomblock/created, details_changed,
// removed): o quarto vira "Interditado" com a data de volta e, ao desbloquear
// lá, volta como "Saída / Apt Sujo" (lib/governanca/bloqueiosExternos.js).
//
// Reserva cancelada ou com datas novas (reservation/status_changed e
// dates_changed): nota na conversa do cliente (lib/atendimento/reservaMudou.js).
// ============================================================================

import { clienteAdmin, lerSegredo } from '../../../lib/atendimento/servidor';
import { carregarCloudbeds, situacaoNaCloudbeds, senhaWebhookConfere } from '../../../lib/governanca/cloudbeds';
import { estadoAposCloudbeds, hojeNoHotel } from '../../../lib/governanca/regras';
import { lerEventoBloqueio, processarBloqueio } from '../../../lib/governanca/bloqueiosExternos';
import { lerEventoReserva, processarMudancaReserva } from '../../../lib/atendimento/reservaMudou';

export const dynamic = 'force-dynamic';

const ok = () => Response.json({ recebido: true }, { status: 200 });

export async function POST(request) {
  try {
    const corpo = await request.json().catch(() => null);
    // Bloqueio feito direto na Cloudbeds (M23): roomblock/created, details_changed, removed
    const bloqueio = lerEventoBloqueio(corpo);
    if (bloqueio) return await tratarBloqueio(request, bloqueio);
    // Reserva cancelada ou com datas novas (M10): nota na conversa do cliente
    const reserva = lerEventoReserva(corpo);
    if (reserva) return await tratarReserva(request, reserva);
    if (!corpo || corpo.event !== 'housekeeping/room_condition_changed') return ok();

    const propertyId = String(corpo.propertyId ?? corpo.propertyID ?? '');
    const roomId = String(corpo.roomId ?? corpo.roomID ?? '');
    const condicao = String(corpo.condition ?? '');
    if (!propertyId || !roomId || !['dirty', 'clean', 'inspected'].includes(condicao)) return ok();

    let supabaseAdmin;
    try { supabaseAdmin = clienteAdmin(); } catch (e) { return ok(); }

    const { data: credencial } = await supabaseAdmin
      .from('cloudbeds_credenciais').select('hotel_id')
      .eq('cloudbeds_property_id', propertyId).maybeSingle();
    if (!credencial) return ok();
    const hotelId = credencial.hotel_id;

    const senha = await lerSegredo(supabaseAdmin, hotelId, 'governanca_webhook_senha');
    if (senha && !senhaWebhookConfere(new URL(request.url).searchParams.get('chave'), senha)) {
      return Response.json({ erro: 'Senha do aviso não confere.' }, { status: 401 });
    }

    const { data: quartos } = await supabaseAdmin.from('quartos').select('*')
      .eq('hotel_id', hotelId).eq('cloudbeds_room_id', roomId);
    if (!quartos?.length) return ok();

    // Ocupado ou vago? Se a Cloudbeds não responder, segue só com a limpeza.
    let ocupado = null;
    try {
      const cb = await carregarCloudbeds(supabaseAdmin, hotelId, process.env.CLOUDBEDS_CRYPTO_SECRET);
      const s = await situacaoNaCloudbeds(cb, roomId);
      if (s) ocupado = s.ocupado;
    } catch (e) { /* sem a ocupação */ }

    for (const quarto of quartos) {
      const campos = estadoAposCloudbeds(quarto, { condicao, ocupado });
      if (campos) await supabaseAdmin.from('quartos').update(campos).eq('id', quarto.id);
    }
    return ok();
  } catch (erro) {
    // Erro inesperado: a Cloudbeds tenta de novo em 1 minuto (até 5 vezes)
    return Response.json({ erro: erro.message }, { status: 500 });
  }
}

async function hotelComSenha(request, propertyId) {
  let supabaseAdmin;
  try { supabaseAdmin = clienteAdmin(); } catch (e) { return {}; }
  const { data: credencial } = await supabaseAdmin.from('cloudbeds_credenciais').select('hotel_id').eq('cloudbeds_property_id', propertyId).maybeSingle();
  if (!credencial) return {};
  const senha = await lerSegredo(supabaseAdmin, credencial.hotel_id, 'governanca_webhook_senha');
  if (!senha || !senhaWebhookConfere(new URL(request.url).searchParams.get('chave'), senha)) return { recusado: true };
  return { supabaseAdmin, hotelId: credencial.hotel_id };
}

async function tratarReserva(request, ev) {
  const h = await hotelComSenha(request, ev.propertyId);
  if (h.recusado) return Response.json({ erro: 'Senha do aviso não confere.' }, { status: 401 });
  if (!h.supabaseAdmin) return ok();
  await processarMudancaReserva(h.supabaseAdmin, h.hotelId, ev);
  return ok();
}

async function tratarBloqueio(request, b) {
  let supabaseAdmin;
  try { supabaseAdmin = clienteAdmin(); } catch (e) { return ok(); }
  const { data: credencial } = await supabaseAdmin.from('cloudbeds_credenciais').select('hotel_id')
    .eq('cloudbeds_property_id', b.propertyId).maybeSingle();
  if (!credencial) return ok();
  const hotelId = credencial.hotel_id;
  // Bloqueio só é aceito com a senha (inscrições de bloqueio sempre têm senha)
  const senha = await lerSegredo(supabaseAdmin, hotelId, 'governanca_webhook_senha');
  if (!senha || !senhaWebhookConfere(new URL(request.url).searchParams.get('chave'), senha)) {
    return Response.json({ erro: 'Senha do aviso não confere.' }, { status: 401 });
  }
  await processarBloqueio(supabaseAdmin, hotelId, b, hojeNoHotel());
  return ok();
}
