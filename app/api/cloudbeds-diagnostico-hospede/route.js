// ============================================================================
// ROTA DE SERVIDOR: /api/cloudbeds-diagnostico-hospede?reservationId=...
// ============================================================================
// Só ADMINISTRADOR. Mostra, para cada hóspede de uma reserva, como a
// Cloudbeds guarda os CAMPOS DO GOVERNO (Raça, Possui uma necessidade
// especial, Necessidades especiais, Motivo da viagem, Meio de transporte...)
// e os campos personalizados. A Cloudbeds não publica os nomes internos
// desses campos — esta consulta mostra os nomes reais da conta do hotel,
// para o envio das fichas usar exatamente esses nomes.
//
// Não altera nada na Cloudbeds: só lê.
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import { descriptografar } from '../../../lib/cloudbedsCrypto';
import { lerVagas, NOME_CAMPO_PT } from '../../../lib/cloudbedsRequisitos';

const CLOUDBEDS_BASE_URL = 'https://api.cloudbeds.com/api/v1.2';

export async function GET(request) {
  try {
    const reservationId = (new URL(request.url).searchParams.get('reservationId') || '').trim();
    if (!reservationId) return Response.json({ erro: 'Informe o número da reserva na Cloudbeds.' }, { status: 400 });

    const tokenAcesso = (request.headers.get('authorization') || '').replace('Bearer ', '');
    if (!tokenAcesso) return Response.json({ erro: 'Não autorizado — faça login novamente.' }, { status: 401 });

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const chaveAnonima = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const chaveMestra = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const segredoCripto = process.env.CLOUDBEDS_CRYPTO_SECRET;
    if (!supabaseUrl || !chaveAnonima || !chaveMestra || !segredoCripto) {
      return Response.json({ erro: 'O servidor não está configurado corretamente.' }, { status: 500 });
    }

    const supabaseComoChamador = createClient(supabaseUrl, chaveAnonima, {
      global: { headers: { Authorization: `Bearer ${tokenAcesso}` } },
    });
    const { data: dadosAuth, error: erroAuth } = await supabaseComoChamador.auth.getUser(tokenAcesso);
    if (erroAuth || !dadosAuth?.user) return Response.json({ erro: 'Sessão inválida ou expirada.' }, { status: 401 });
    const { data: chamador } = await supabaseComoChamador
      .from('usuarios').select('id, hotel_id, papel').eq('auth_id', dadosAuth.user.id).single();
    if (!chamador) return Response.json({ erro: 'Não foi possível confirmar seu usuário.' }, { status: 403 });
    if (chamador.papel !== 'ADMIN') return Response.json({ erro: 'Só administradores podem usar o diagnóstico.' }, { status: 403 });

    const supabaseAdmin = createClient(supabaseUrl, chaveMestra);
    const { data: credencial } = await supabaseAdmin
      .from('cloudbeds_credenciais').select('*').eq('hotel_id', chamador.hotel_id).maybeSingle();
    if (!credencial?.api_key_cifrada) {
      return Response.json({ erro: 'A integração com a Cloudbeds ainda não foi configurada para este hotel.' }, { status: 400 });
    }
    let apiKey;
    try { apiKey = descriptografar(credencial.api_key_cifrada, segredoCripto); } catch (e) {
      return Response.json({ erro: 'Não foi possível ler a credencial salva.' }, { status: 500 });
    }
    const cabecalhos = {
      Authorization: `Bearer ${apiKey}`,
      ...(credencial.cloudbeds_property_id ? { 'x-property-id': credencial.cloudbeds_property_id } : {}),
    };

    // 1) Hóspedes da reserva
    const respReserva = await fetch(
      `${CLOUDBEDS_BASE_URL}/getReservations?reservationID=${encodeURIComponent(reservationId)}&includeGuestsDetails=true`,
      { headers: cabecalhos }
    );
    const dadosReserva = await respReserva.json().catch(() => null);
    if (!respReserva.ok || dadosReserva?.success === false) {
      return Response.json({ erro: `A Cloudbeds recusou a consulta: ${dadosReserva?.message || 'reserva não encontrada'}` }, { status: 400 });
    }
    const reserva = (dadosReserva?.data || []).find((r) => String(r.reservationID) === reservationId) || null;
    if (!reserva) return Response.json({ erro: 'Reserva não encontrada na Cloudbeds.' }, { status: 404 });
    const hospedesObj = reserva.guestList || reserva.guests || {};
    const hospedes = Array.isArray(hospedesObj) ? hospedesObj : Object.values(hospedesObj);

    // 2) Campos do governo de cada hóspede
    const resultado = [];
    for (const h of hospedes.slice(0, 8)) {
      const guestId = h.guestID || h.guestId || h.id;
      if (!guestId) continue;
      const resp = await fetch(
        `${CLOUDBEDS_BASE_URL}/getGuest?guestID=${encodeURIComponent(guestId)}&includeGuestRequirements=true`,
        { headers: cabecalhos }
      );
      const dados = await resp.json().catch(() => null);
      const requisitos = dados?.data?.guestRequirements ?? null;
      resultado.push({
        guestId: String(guestId),
        nome: [h.guestFirstName, h.guestLastName].filter(Boolean).join(' ') || h.guestName || '—',
        // Só os NOMES e valores dos campos do governo e personalizados —
        // é o que precisamos para acertar o envio.
        camposGoverno: requisitos,
        reconhecidos: lerVagas(requisitos).map((v) => ({ nosso: NOME_CAMPO_PT[v.campo], nomeNaCloudbeds: v.nome, valorAtual: v.valorAtual })),
        camposPersonalizados: (dados?.data?.customFields || []).map((c) => ({
          id: c.customFieldID, nome: c.customFieldName, valor: c.customFieldValue,
        })),
        erroConsulta: !resp.ok || dados?.success === false ? (dados?.message || `HTTP ${resp.status}`) : null,
      });
    }

    return Response.json({ reservationId, hospedes: resultado });
  } catch (erro) {
    return Response.json({ erro: 'Erro inesperado no servidor: ' + erro.message }, { status: 500 });
  }
}
