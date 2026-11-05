// ============================================================================
// LINK DA FICHA DE HÓSPEDE POR RESERVA (M1) — só usado no servidor
// ============================================================================
// Cada reserva ganha um código curto (ex.: "4-k3J9aQ2xZp"): o número do hotel
// e uma assinatura do nº da reserva. O link é <site>/f/<código>, que abre a
// ficha do hotel com o código guardado junto da ficha preenchida. Assim o
// sistema sabe quem já preencheu sem pôr o nº da reserva no link.
// O código não revela nada da reserva e não dá acesso a nada: só marca a ficha.
// ============================================================================

import crypto from 'crypto';

export const CODIGO_FICHA = /^(\d{1,9})-([A-Za-z0-9_-]{10})$/;

export function codigoFicha(hotelId, reservaId) {
  const segredo = process.env.CLOUDBEDS_CRYPTO_SECRET || '';
  if (!segredo || !hotelId || !reservaId) return null;
  const assinatura = crypto.createHmac('sha256', segredo).update(`ficha:${hotelId}:${reservaId}`).digest('base64url').slice(0, 10);
  return `${Number(hotelId)}-${assinatura}`;
}

export function linkFicha(origem, hotelId, reservaId) {
  const codigo = codigoFicha(hotelId, reservaId);
  return codigo && origem ? `${origem}/f/${codigo}` : '';
}

const normal = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);

// Mesmo hóspede? Primeiro e último nome iguais (sem acento, sem maiúscula)
export function mesmoNome(a, b) {
  const x = normal(a);
  const y = normal(b);
  if (!x.length || !y.length) return false;
  return x[0] === y[0] && x[x.length - 1] === y[y.length - 1];
}

// A ficha desta reserva já foi preenchida?
//  1) pelo código do link (ficha aberta pelo link da mensagem)
//  2) pelo nº da reserva (ficha já ligada à reserva na exportação)
//  3) pelo nome do hóspede + data de entrada (ficha aberta pelo link geral)
export async function fichaPreenchida(supabaseAdmin, hotelId, reservaId, { nome, checkin } = {}) {
  const id = String(reservaId || '');
  const codigo = codigoFicha(hotelId, id);
  const seguro = /^[\w-]+$/.test(id);
  if (codigo && seguro) {
    const { data, error } = await supabaseAdmin.from('fichas_fnrh').select('id').eq('hotel_id', hotelId)
      .or(`codigo_reserva.eq.${codigo},cloudbeds_reservation_id.eq.${id}`).limit(1);
    if (!error && data?.length) return true;
    if (error) {
      // Sem o SQL novo (coluna codigo_reserva): só pelo nº da reserva
      const { data: d2 } = await supabaseAdmin.from('fichas_fnrh').select('id').eq('hotel_id', hotelId).eq('cloudbeds_reservation_id', id).limit(1);
      if (d2?.length) return true;
    }
  }
  if (nome && checkin) {
    const { data } = await supabaseAdmin.from('fichas_fnrh').select('id, nome_completo').eq('hotel_id', hotelId).eq('data_checkin', String(checkin).slice(0, 10)).limit(200);
    if ((data || []).some((f) => mesmoNome(f.nome_completo, nome))) return true;
  }
  return false;
}

// Várias reservas de uma vez (lista de chegadas): Map nº da reserva → true/false
// reservas: [{ id, nome, checkin }]
export async function fichasDasReservas(supabaseAdmin, hotelId, reservas) {
  const resultado = new Map(reservas.map((r) => [String(r.id), false]));
  if (!reservas.length) return resultado;
  const codigos = new Map(reservas.map((r) => [codigoFicha(hotelId, r.id), String(r.id)]).filter(([c]) => c));
  const ids = reservas.map((r) => String(r.id)).filter((id) => /^[\w-]+$/.test(id));
  const marcar = (id) => { if (id && resultado.has(id)) resultado.set(id, true); };

  const { data: porCodigo, error } = codigos.size
    ? await supabaseAdmin.from('fichas_fnrh').select('codigo_reserva').eq('hotel_id', hotelId).in('codigo_reserva', [...codigos.keys()])
    : { data: [] };
  if (!error) (porCodigo || []).forEach((f) => marcar(codigos.get(f.codigo_reserva)));
  if (ids.length) {
    const { data: porId } = await supabaseAdmin.from('fichas_fnrh').select('cloudbeds_reservation_id').eq('hotel_id', hotelId).in('cloudbeds_reservation_id', ids);
    (porId || []).forEach((f) => marcar(String(f.cloudbeds_reservation_id)));
  }
  const datas = [...new Set(reservas.map((r) => String(r.checkin || '').slice(0, 10)).filter(Boolean))];
  if (datas.length) {
    const { data: porData } = await supabaseAdmin.from('fichas_fnrh').select('nome_completo, data_checkin').eq('hotel_id', hotelId).in('data_checkin', datas).limit(1000);
    for (const r of reservas) {
      if (resultado.get(String(r.id))) continue;
      if ((porData || []).some((f) => String(f.data_checkin).slice(0, 10) === String(r.checkin).slice(0, 10) && mesmoNome(f.nome_completo, r.nome))) marcar(String(r.id));
    }
  }
  return resultado;
}
