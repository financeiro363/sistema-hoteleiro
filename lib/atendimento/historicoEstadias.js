// ============================================================================
// HISTÓRICO DE ESTADIAS DO CONTATO (M11) — só no servidor
// ============================================================================
// Quantas vezes o cliente se hospedou, a última estadia, a próxima e quanto
// gastou, para o atendente reconhecer quem volta. Fontes:
//   - fichas de hóspede (FNRH) com o mesmo telefone ou e-mail (toda estadia
//     tem ficha) — daqui saem só as datas
//   - reservas da Cloudbeds ligadas às conversas deste contato (valor e situação)
// Nenhum documento, endereço ou dado da ficha sai daqui além das datas.
// ============================================================================

import { conexaoCloudbeds, detalheReserva } from './cloudbeds';

const FUSO = 'America/Fortaleza';
const hojeLocal = () => new Date().toLocaleDateString('en-CA', { timeZone: FUSO });
const final8 = (t) => String(t || '').replace(/\D/g, '').slice(-8);
const dia = (v) => (v ? String(v).slice(0, 10) : null);
const VALIDAS = ['confirmed', 'not_confirmed', 'checked_in', 'checked_out'];

// fichas: [{ data_checkin, data_checkout }] · reservas: [resumoReserva]
export function montarHistorico({ fichas = [], reservas = [], hoje = hojeLocal() }) {
  const porEntrada = new Map();
  for (const r of reservas) {
    if (!r?.checkin || !VALIDAS.includes(r.status)) continue;
    porEntrada.set(dia(r.checkin), { checkin: dia(r.checkin), checkout: dia(r.checkout), total: r.total ?? null, status: r.status, reserva: r.reservationId, fonte: 'reserva' });
  }
  for (const f of fichas) {
    const ci = dia(f.data_checkin);
    if (!ci || porEntrada.has(ci)) continue;
    porEntrada.set(ci, { checkin: ci, checkout: dia(f.data_checkout), total: null, status: null, reserva: null, fonte: 'ficha' });
  }
  const todas = [...porEntrada.values()].sort((a, b) => b.checkin.localeCompare(a.checkin));
  // Estadia feita: check-in/out na Cloudbeds, ou ficha com entrada até hoje
  const feita = (e) => ['checked_in', 'checked_out'].includes(e.status) || (!e.status && e.checkin <= hoje);
  const passadas = todas.filter(feita);
  // Próxima: reserva confirmada com entrada de hoje em diante
  const futuras = todas.filter((e) => ['confirmed', 'not_confirmed'].includes(e.status) && e.checkin >= hoje).sort((a, b) => a.checkin.localeCompare(b.checkin));
  const gasto = passadas.reduce((s, e) => s + (Number(e.total) || 0), 0);
  return {
    vezes: passadas.length,
    volta: passadas.length >= 2 || (passadas.length >= 1 && futuras.length >= 1),
    ultima: passadas[0] || null,
    primeira: passadas[passadas.length - 1] || null,
    proxima: futuras[0] || null,
    gasto: Math.round(gasto * 100) / 100,
    gasto_parcial: passadas.some((e) => e.total == null),
    estadias: todas.slice(0, 10),
  };
}

export async function historicoDoContato(supabaseAdmin, conversa) {
  let contato = null;
  if (conversa.contato_id) {
    const { data } = await supabaseAdmin.from('atendimento_contatos').select('id, telefone, email').eq('id', conversa.contato_id).maybeSingle();
    contato = data;
  }
  const fone = final8(contato?.telefone || (conversa.canal_tipo === 'WHATSAPP' ? conversa.chave_externa : ''));
  const email = String(contato?.email || (conversa.canal_tipo === 'EMAIL' ? conversa.contato_endereco : '') || '').trim().toLowerCase();

  // Fichas pelo telefone (final de 8 dígitos) e pelo e-mail
  const fichas = [];
  if (fone.length === 8) {
    const { data } = await supabaseAdmin.from('fichas_fnrh').select('id, telefone, data_checkin, data_checkout')
      .eq('hotel_id', conversa.hotel_id).ilike('telefone', `%${fone.slice(-4)}%`).limit(300);
    fichas.push(...(data || []).filter((f) => final8(f.telefone) === fone));
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const { data } = await supabaseAdmin.from('fichas_fnrh').select('id, email, data_checkin, data_checkout')
      .eq('hotel_id', conversa.hotel_id).ilike('email', email).limit(100);
    for (const f of data || []) if (!fichas.some((x) => x.id === f.id)) fichas.push(f);
  }

  // Reservas ligadas às conversas deste contato
  const ids = new Set();
  let conversas = [conversa];
  if (conversa.contato_id) {
    const { data } = await supabaseAdmin.from('atendimento_conversas').select('id, cloudbeds_reservation_id').eq('contato_id', conversa.contato_id).limit(50);
    conversas = data?.length ? data : conversas;
  }
  conversas.forEach((c) => c.cloudbeds_reservation_id && ids.add(String(c.cloudbeds_reservation_id)));
  const idsConversas = conversas.map((c) => c.id);
  const { data: det } = await supabaseAdmin.from('atendimento_reservas_detectadas').select('reserva_id').eq('hotel_id', conversa.hotel_id).in('conversa_id', idsConversas).limit(50);
  (det || []).forEach((r) => ids.add(String(r.reserva_id)));
  const { data: cots } = await supabaseAdmin.from('atendimento_cotacoes').select('reserva_id, hotel_cotado_id').in('conversa_id', idsConversas).eq('status', 'RESERVOU').limit(50);
  (cots || []).filter((c) => c.reserva_id && !c.hotel_cotado_id).forEach((c) => ids.add(String(c.reserva_id)));

  const reservas = [];
  if (ids.size) {
    let cb = null;
    try { cb = await conexaoCloudbeds(supabaseAdmin, conversa.hotel_id); } catch (e) { cb = null; }
    if (cb) {
      const lista = [...ids].slice(0, 8);
      const r = await Promise.allSettled(lista.map((id) => detalheReserva(cb, id)));
      r.forEach((x) => { if (x.status === 'fulfilled') reservas.push(x.value); });
    }
  }
  return montarHistorico({ fichas, reservas });
}
