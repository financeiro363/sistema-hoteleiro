// ============================================================================
// LINHA DO TEMPO DA RESERVA NA CONVERSA (M9)
// ============================================================================
// Cotação → reserva → pagamento → ficha → check-in → check-out, num olhar.
// A reserva é a ligada à conversa (Contato e reserva), ou a que veio de uma
// cotação, ou a encontrada pelo telefone/e-mail. O saldo aparece para quem
// usa a Caixa de Entrada (ADMIN e recepção — decisão do dono, 05/11/2026).
// ============================================================================

import { conexaoCloudbeds, detalheReserva } from './cloudbeds';
import { fichaPreenchida } from './fichaLink';
import { dataBR, reais } from './cotacao';

const quando = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Fortaleza' });

const FUSO = 'America/Fortaleza';
const hojeLocal = () => new Date().toLocaleDateString('en-CA', { timeZone: FUSO });

// passos: [{ chave, rotulo, situacao: 'feito'|'atencao'|'pendente'|'cancelado', detalhe }]
export function montarLinhaDoTempo({ cotacoes = [], reserva = null, ficha = null, hoje = hojeLocal() }) {
  const passos = [];
  const cot = [...cotacoes].sort((a, b) => String(a.criado_em).localeCompare(String(b.criado_em)));
  const reservou = cot.find((c) => c.status === 'RESERVOU');
  const clicou = cot.find((c) => c.primeiro_clique_em || ['CLICOU', 'RESERVOU'].includes(c.status));
  if (cot.length) {
    const u = cot[cot.length - 1];
    passos.push({
      chave: 'COTACAO', rotulo: 'Cotação', situacao: 'feito',
      detalhe: `${cot.length} enviada(s); a última em ${quando(u.criado_em)}${clicou ? ' · clicou em Reservar agora' : ''}`, quando: u.criado_em,
    });
  } else if (!reserva) {
    passos.push({ chave: 'COTACAO', rotulo: 'Cotação', situacao: 'pendente', detalhe: 'nenhuma cotação nesta conversa' });
  }
  if (!reserva) {
    passos.push({ chave: 'RESERVA', rotulo: 'Reserva', situacao: 'pendente', detalhe: reservou ? `reserva ${reservou.reserva_id} (não foi possível ler na Cloudbeds)` : 'ainda sem reserva' });
    return { passos, reserva: null };
  }
  const cancelada = ['canceled', 'no_show'].includes(reserva.status);
  passos.push({
    chave: 'RESERVA', rotulo: 'Reserva', situacao: cancelada ? 'cancelado' : 'feito',
    detalhe: `nº ${reserva.reservationId} · ${reserva.statusTexto || reserva.status}${reserva.total != null ? ` · total ${reais(reserva.total)}` : ''}`,
    total: reserva.total,
  });
  if (cancelada) return { passos, reserva };
  const saldo = reserva.saldo;
  passos.push({
    chave: 'PAGAMENTO', rotulo: 'Pagamento',
    situacao: saldo == null ? 'pendente' : saldo <= 0 ? 'feito' : 'atencao',
    detalhe: saldo == null ? 'sem a informação da Cloudbeds' : saldo <= 0 ? 'pago' : `falta pagar ${reais(saldo)}`, saldo,
  });
  passos.push({
    chave: 'FICHA', rotulo: 'Ficha de hóspede',
    situacao: ficha === true ? 'feito' : ficha === false ? (reserva.checkin && reserva.checkin <= hoje ? 'atencao' : 'pendente') : 'pendente',
    detalhe: ficha === true ? 'preenchida' : ficha === false ? 'ainda não preenchida' : 'não verificada',
  });
  const entrou = ['checked_in', 'checked_out'].includes(reserva.status);
  passos.push({
    chave: 'CHECKIN', rotulo: 'Check-in', situacao: entrou ? 'feito' : (reserva.checkin && reserva.checkin < hoje ? 'atencao' : 'pendente'),
    detalhe: entrou ? `feito (entrada ${dataBR(reserva.checkin)})` : `previsto para ${dataBR(reserva.checkin)}`, data: reserva.checkin,
  });
  passos.push({
    chave: 'CHECKOUT', rotulo: 'Check-out', situacao: reserva.status === 'checked_out' ? 'feito' : 'pendente',
    detalhe: reserva.status === 'checked_out' ? `feito (saída ${dataBR(reserva.checkout)})` : `previsto para ${dataBR(reserva.checkout)}`, data: reserva.checkout,
  });
  return { passos, reserva };
}

// ---------------------------------------------------------------- servidor
export async function linhaDoTempo(supabaseAdmin, conversa) {
  const { data: cotacoes } = await supabaseAdmin.from('atendimento_cotacoes')
    .select('id, criado_em, status, primeiro_clique_em, reserva_id, reserva_valor, hotel_cotado_id, oferta_beneficio')
    .eq('conversa_id', conversa.id).order('criado_em').limit(50);
  let reservaId = conversa.cloudbeds_reservation_id || null;
  let hotelDaReserva = conversa.hotel_id;
  if (!reservaId) {
    const r = [...(cotacoes || [])].reverse().find((c) => c.status === 'RESERVOU' && c.reserva_id);
    if (r) { reservaId = r.reserva_id; hotelDaReserva = r.hotel_cotado_id || conversa.hotel_id; }
  }
  if (!reservaId) {
    const { data: det } = await supabaseAdmin.from('atendimento_reservas_detectadas').select('reserva_id')
      .eq('conversa_id', conversa.id).order('criado_em', { ascending: false }).limit(1).maybeSingle();
    if (det) reservaId = det.reserva_id;
  }
  let reserva = null;
  let erro = null;
  if (reservaId) {
    try { reserva = await detalheReserva(await conexaoCloudbeds(supabaseAdmin, hotelDaReserva), reservaId); }
    catch (e) { erro = e.message; }
  }
  let ficha = null;
  if (reserva && Number(hotelDaReserva) === Number(conversa.hotel_id)) {
    try { ficha = await fichaPreenchida(supabaseAdmin, hotelDaReserva, reserva.reservationId, { nome: reserva.nome, checkin: reserva.checkin }); }
    catch (e) { ficha = null; }
  }
  const oferta = (cotacoes || []).find((c) => c.oferta_beneficio && (!reservaId || c.reserva_id === reservaId || c.status === 'RESERVOU'));
  return { ...montarLinhaDoTempo({ cotacoes: cotacoes || [], reserva, ficha }), erro, oferta: oferta?.oferta_beneficio || null };
}
