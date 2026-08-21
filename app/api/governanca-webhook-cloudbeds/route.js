// ============================================================================
// ROTA DE SERVIDOR (WEBHOOK): /api/governanca-webhook-cloudbeds
// ============================================================================
// A Cloudbeds chama essa rota sozinha, automaticamente, toda vez que o
// status de limpeza de um quarto muda por lá — evento oficial confirmado:
// "housekeeping/room_condition_changed" (documentação:
// https://developers.cloudbeds.com/docs/webhooks-1). Isso cobre tanto
// mudanças manuais feitas na Cloudbeds quanto o que ela já marca sozinha
// (ex.: deixar "sujo" automaticamente após um check-out).
//
// Formato esperado do aviso (conforme documentação oficial):
// { "roomId": "128837-7", "propertyId": "12345", "condition": "clean",
//   "event": "housekeeping/room_condition_changed", ... }
//
// ⚠️ Não exige login — quem chama é a Cloudbeds, não uma pessoa logada no
// nosso site. A documentação da Cloudbeds não define uma assinatura/segredo
// pra validar que o aviso é legítimo (ao contrário de alguns outros
// serviços) — então essa rota confirma o quarto pelo cloudbeds_room_id já
// salvo e ignora silenciosamente qualquer aviso que não bata com um quarto
// conhecido nosso, em vez de aceitar cegamente.
// ============================================================================

import { createClient } from '@supabase/supabase-js';

function mapearCondicaoParaStatus(condicao) {
  if (condicao === 'dirty') return 'SUJO';
  if (condicao === 'clean' || condicao === 'inspected') return 'LIMPO';
  return null; // valor desconhecido — não faz nada, por segurança
}

export async function POST(request) {
  try {
    const corpo = await request.json().catch(() => null);
    if (!corpo || corpo.event !== 'housekeeping/room_condition_changed') {
      // Evento que não nos interessa (ou payload vazio) — confirma
      // recebimento mesmo assim, pra Cloudbeds não ficar reenviando à toa.
      return Response.json({ recebido: true }, { status: 200 });
    }

    const propertyId = String(corpo.propertyId ?? corpo.propertyID ?? '');
    const roomId = String(corpo.roomId ?? '');
    const novoStatus = mapearCondicaoParaStatus(corpo.condition);
    if (!propertyId || !roomId || !novoStatus) {
      return Response.json({ recebido: true }, { status: 200 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const chaveMestra = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !chaveMestra) {
      return Response.json({ recebido: true }, { status: 200 });
    }
    const supabaseAdmin = createClient(supabaseUrl, chaveMestra);

    // Descobre a qual dos nossos hotéis esse propertyID pertence.
    const { data: credencial } = await supabaseAdmin
      .from('cloudbeds_credenciais').select('hotel_id')
      .eq('cloudbeds_property_id', propertyId).maybeSingle();
    if (!credencial) {
      return Response.json({ recebido: true }, { status: 200 });
    }

    await supabaseAdmin.from('quartos')
      .update({ status: novoStatus })
      .eq('hotel_id', credencial.hotel_id)
      .eq('cloudbeds_room_id', roomId);

    return Response.json({ recebido: true }, { status: 200 });
  } catch (erro) {
    // Erro de verdade e inesperado — devolve status de erro pra Cloudbeds
    // tentar de novo em 1 minuto (ela reenvia até 5 vezes).
    return Response.json({ erro: erro.message }, { status: 500 });
  }
}
