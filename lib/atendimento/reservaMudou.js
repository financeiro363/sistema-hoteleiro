// ============================================================================
// RESERVA CANCELADA OU ALTERADA NA CLOUDBEDS (M10) — só no servidor
// ============================================================================
// A Cloudbeds avisa (webhook "reservation/status_changed" e
// "reservation/dates_changed") e o sistema procura as conversas ligadas a
// essa reserva. Decisão do dono (05/11/2026): só a equipe fica sabendo —
//   cancelada → nota na conversa, sai a etiqueta "Reservou", entra
//               "Reserva cancelada", o cartão volta para "Cotação" (ou
//               "Atendimentos iniciados") e a conversa reabre; o "vendido"
//               do Painel deixa de contar a reserva
//   voltou a valer → nota e o cartão volta para "Reservou"
//   datas mudaram → nota com as datas novas
// Nenhuma mensagem vai para o cliente. Aviso repetido não gera nota de novo.
// ============================================================================

import { gravarNota } from './envio';
import { dataBR } from './cotacao';

const CANCELADA = ['canceled'];

// Corpo do webhook → { tipo: 'STATUS'|'DATAS', reservaId, propertyId, status, inicio, fim } | null
export function lerEventoReserva(corpo) {
  const evento = String(corpo?.event || '');
  if (evento === 'reservation/status_changed') {
    const reservaId = corpo.reservationID ?? corpo.reservationId;
    const propertyId = corpo.propertyID ?? corpo.propertyId ?? corpo.propertyID_str;
    if (!reservaId || !propertyId || !corpo.status) return null;
    return { tipo: 'STATUS', reservaId: String(reservaId), propertyId: String(propertyId), status: String(corpo.status) };
  }
  if (evento === 'reservation/dates_changed') {
    const reservaId = corpo.reservationId ?? corpo.reservationID;
    const propertyId = corpo.propertyId ?? corpo.propertyID ?? corpo.propertyId_str;
    if (!reservaId || !propertyId) return null;
    return { tipo: 'DATAS', reservaId: String(reservaId), propertyId: String(propertyId), inicio: String(corpo.startDate || '').slice(0, 10), fim: String(corpo.endDate || '').slice(0, 10) };
  }
  return null;
}

async function conversasDaReserva(supabaseAdmin, hotelId, reservaId) {
  const ids = new Set();
  const { data: a } = await supabaseAdmin.from('atendimento_conversas').select('id').eq('hotel_id', hotelId).eq('cloudbeds_reservation_id', reservaId).limit(20);
  (a || []).forEach((c) => ids.add(c.id));
  const { data: b } = await supabaseAdmin.from('atendimento_reservas_detectadas').select('conversa_id').eq('hotel_id', hotelId).eq('reserva_id', reservaId).limit(20);
  (b || []).forEach((c) => c.conversa_id && ids.add(c.conversa_id));
  const { data: c } = await supabaseAdmin.from('atendimento_cotacoes').select('conversa_id').eq('reserva_id', reservaId).limit(20);
  (c || []).forEach((x) => x.conversa_id && ids.add(x.conversa_id));
  if (!ids.size) return [];
  const { data } = await supabaseAdmin.from('atendimento_conversas').select('*').in('id', [...ids]);
  return data || [];
}

async function moverEtapa(supabaseAdmin, conversa, nomes) {
  const { data: etapas } = await supabaseAdmin.from('atendimento_etapas').select('id, nome').eq('hotel_id', conversa.hotel_id);
  for (const nome of nomes) {
    const e = (etapas || []).find((x) => String(x.nome).toLowerCase() === nome.toLowerCase());
    if (e) return e.id;
  }
  return null;
}

async function marca(supabaseAdmin, hotelId, reservaId, conversaId) {
  const { data } = await supabaseAdmin.from('atendimento_reservas_detectadas').select('*').eq('hotel_id', hotelId).eq('reserva_id', reservaId).maybeSingle();
  if (data) return data;
  const linha = { hotel_id: hotelId, reserva_id: reservaId, conversa_id: conversaId, cancelada_em: null, datas: null };
  await supabaseAdmin.from('atendimento_reservas_detectadas').upsert(linha, { onConflict: 'hotel_id,reserva_id', ignoreDuplicates: true });
  return linha;
}

export async function processarMudancaReserva(supabaseAdmin, hotelId, ev) {
  const conversas = await conversasDaReserva(supabaseAdmin, hotelId, ev.reservaId);
  if (!conversas.length) return { ignorado: 'reserva sem conversa' };
  const m = await marca(supabaseAdmin, hotelId, ev.reservaId, conversas[0].id);
  const agora = new Date().toISOString();
  const autor = { id: null };

  if (ev.tipo === 'STATUS') {
    const cancelou = CANCELADA.includes(ev.status);
    if (cancelou && m.cancelada_em) return { ignorado: 'já avisado' };
    if (!cancelou && !m.cancelada_em) return { ignorado: 'nada a avisar' };
    await supabaseAdmin.from('atendimento_reservas_detectadas').update({ cancelada_em: cancelou ? agora : null }).eq('hotel_id', hotelId).eq('reserva_id', ev.reservaId);
    await supabaseAdmin.from('atendimento_cotacoes').update({ reserva_cancelada_em: cancelou ? agora : null }).eq('reserva_id', ev.reservaId);
    const { data: etqs } = await supabaseAdmin.from('atendimento_etiquetas').select('id, nome').eq('hotel_id', hotelId);
    const idDe = (nome) => (etqs || []).find((e) => String(e.nome).toLowerCase() === nome)?.id;
    for (const c of conversas) {
      const atuais = c.etiquetas || [];
      if (cancelou) {
        const { data: temCot } = await supabaseAdmin.from('atendimento_cotacoes').select('id').eq('conversa_id', c.id).limit(1);
        const etapa = await moverEtapa(supabaseAdmin, c, temCot?.length ? ['Cotação', 'Atendimentos iniciados'] : ['Atendimentos iniciados']);
        await supabaseAdmin.from('atendimento_conversas').update({
          etiquetas: atuais.filter((x) => x !== idDe('reservou')),
          ...(etapa ? { etapa_id: etapa } : {}),
          ...(['RESOLVIDA', 'ARQUIVADA'].includes(c.status) ? { status: 'ABERTA' } : {}),
          atualizado_em: agora,
        }).eq('id', c.id);
        try { await supabaseAdmin.rpc('atendimento_adicionar_etiqueta', { p_conversa: c.id, p_nome: 'Reserva cancelada' }); } catch (e) { /* extra */ }
        await gravarNota(supabaseAdmin, autor, c, `❌ A reserva ${ev.reservaId} foi cancelada na Cloudbeds. O cartão voltou para o funil; nenhuma mensagem foi enviada ao cliente.`);
      } else {
        const etapa = await moverEtapa(supabaseAdmin, c, ['Reservou']);
        await supabaseAdmin.from('atendimento_conversas').update({
          etiquetas: atuais.filter((x) => x !== idDe('reserva cancelada')), ...(etapa ? { etapa_id: etapa } : {}), atualizado_em: agora,
        }).eq('id', c.id);
        try { await supabaseAdmin.rpc('atendimento_adicionar_etiqueta', { p_conversa: c.id, p_nome: 'Reservou' }); } catch (e) { /* extra */ }
        await gravarNota(supabaseAdmin, autor, c, `✅ A reserva ${ev.reservaId} voltou a valer na Cloudbeds (situação: ${ev.status}).`);
      }
    }
    return { conversas: conversas.length, cancelou };
  }

  // Datas mudaram
  const datas = `${ev.inicio}/${ev.fim}`;
  if (!ev.inicio || !ev.fim || m.datas === datas) return { ignorado: 'já avisado' };
  await supabaseAdmin.from('atendimento_reservas_detectadas').update({ datas }).eq('hotel_id', hotelId).eq('reserva_id', ev.reservaId);
  for (const c of conversas) {
    await gravarNota(supabaseAdmin, autor, c, `📅 A reserva ${ev.reservaId} mudou de datas na Cloudbeds: entrada ${dataBR(ev.inicio)}, saída ${dataBR(ev.fim)}.`);
  }
  return { conversas: conversas.length, datas };
}
