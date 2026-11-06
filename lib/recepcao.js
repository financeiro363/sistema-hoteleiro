// ============================================================================
// RECEPÇÃO — chegadas e saídas de hoje numa tela só (M3) — só no SERVIDOR
// ============================================================================
// Para cada chegada de hoje: quarto e se está pronto (limpo; vistoriado
// hoje), hora prevista, ficha de hóspede, saldo a pagar e o benefício da
// oferta (se a reserva veio de uma "segunda tentativa com oferta").
// Para cada saída: quarto, se já saiu e saldo.
// O saldo aparece para ADMIN e recepção (decisão do dono, 05/11/2026).
// ============================================================================

import { chamarCloudbeds } from './cloudbedsCaixa';
import { quartosDaReserva, acharQuarto, horaDaChegada } from './governanca/rotina';
import { STATUS_QUARTO_LABEL, ESTADO_APARTAMENTO_LABEL, diaNoHotel } from './governanca/regras';
import { fichasDasReservas } from './atendimento/fichaLink';

const CHEGADAS_VALIDAS = ['confirmed', 'not_confirmed', 'checked_in'];
const SAIDAS_VALIDAS = ['checked_in', 'checked_out'];

const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

// Situação do quarto para quem chega: pronto = limpo e fora de manutenção
export function situacaoDoQuarto(q, vistoriadoHoje = false) {
  if (!q) return { pronto: false, texto: 'quarto ainda não definido' };
  if (q.estado_apartamento === 'INTERDITADO' || q.status === 'MANUTENCAO') return { pronto: false, texto: ESTADO_APARTAMENTO_LABEL[q.estado_apartamento] || 'Manutenção' };
  if (q.status === 'LIMPO') return { pronto: true, texto: vistoriadoHoje ? 'limpo e vistoriado' : 'limpo' };
  return { pronto: false, texto: STATUS_QUARTO_LABEL[q.status] || q.status || '—' };
}

// reservas (lista + detalhe já juntos) → linhas da tela (puro: testável)
export function montarDia({ chegadas = [], saidas = [], quartos = [], fichas = new Map(), vistoriados = new Set(), ofertas = new Map(), aceites = new Map(), mostrarSaldo = true }) {
  const quartosDe = (r) => quartosDaReserva(r).map((rq) => ({ rq, q: acharQuarto(quartos, rq) }));
  const saldoDe = (r) => (mostrarSaldo ? num(r.balance) : undefined);
  const linhasChegada = chegadas.map((r) => {
    const qs = quartosDe(r).map(({ rq, q }) => ({ numero: q?.numero || rq.roomName || '?', ...situacaoDoQuarto(q, q ? vistoriados.has(q.id) : false) }));
    return {
      id: String(r.reservationID), nome: r.guestName || '—', chegou: r.status === 'checked_in',
      hora: horaDaChegada(r.estimatedArrivalTime), quartos: qs, ficha: !!fichas.get(String(r.reservationID)),
      saldo: saldoDe(r), total: mostrarSaldo ? num(r.total) : undefined,
      adultos: num(r.adults), criancas: num(r.children), oferta: ofertas.get(String(r.reservationID)) || null,
      aceitou: aceites.get(String(r.reservationID)) || null,
      fonte: r.sourceName || null,
    };
  }).sort((a, b) => Number(a.chegou) - Number(b.chegou) || String(a.hora || '99').localeCompare(String(b.hora || '99')) || a.nome.localeCompare(b.nome, 'pt-BR'));
  const linhasSaida = saidas.map((r) => ({
    id: String(r.reservationID), nome: r.guestName || '—', saiu: r.status === 'checked_out',
    quartos: quartosDe(r).map(({ rq, q }) => ({ numero: q?.numero || rq.roomName || '?' })), saldo: saldoDe(r),
  })).sort((a, b) => Number(a.saiu) - Number(b.saiu) || a.nome.localeCompare(b.nome, 'pt-BR'));
  return { chegadas: linhasChegada, saidas: linhasSaida };
}

async function reservasDoDia(cb, campo, hoje) {
  const todas = [];
  for (let pagina = 1; pagina <= 5; pagina += 1) {
    const r = await chamarCloudbeds(cb, 'getReservations', {
      verbo: 'GET', params: { [`${campo}From`]: hoje, [`${campo}To`]: hoje, includeGuestsDetails: 'true', pageSize: '100', pageNumber: String(pagina) },
    });
    const lista = Array.isArray(r?.data) ? r.data : [];
    todas.push(...lista);
    if (lista.length < 100) break;
  }
  return todas;
}

// Detalhe de cada reserva (saldo, quarto e hora prevista), de 5 em 5, até 60
async function completar(cb, reservas) {
  const lista = reservas.slice(0, 60);
  for (let i = 0; i < lista.length; i += 5) {
    await Promise.all(lista.slice(i, i + 5).map(async (r) => {
      try {
        const d = (await chamarCloudbeds(cb, 'getReservation', { verbo: 'GET', params: { reservationID: r.reservationID } }))?.data;
        if (!d) return;
        if (r.balance == null && d.balance != null) r.balance = d.balance;
        if (r.total == null && d.total != null) r.total = d.total;
        if (!quartosDaReserva(r).length) r.assigned = d.assigned || [];
        r.estimatedArrivalTime = r.estimatedArrivalTime || d.estimatedArrivalTime || null;
      } catch (e) { /* segue sem o detalhe */ }
    }));
  }
}

export async function diaDaRecepcao(supabaseAdmin, cb, hotelId, { hoje, mostrarSaldo = true }) {
  const [entram, saem] = await Promise.all([reservasDoDia(cb, 'checkIn', hoje), reservasDoDia(cb, 'checkOut', hoje)]);
  const chegadas = entram.filter((r) => (!r.status || CHEGADAS_VALIDAS.includes(r.status)) && String(r.startDate || '').slice(0, 10) === hoje);
  const saidas = saem.filter((r) => (!r.status || SAIDAS_VALIDAS.includes(r.status)) && String(r.endDate || '').slice(0, 10) === hoje);
  await completar(cb, [...chegadas, ...saidas]);

  const { data: quartos } = await supabaseAdmin.from('quartos').select('*').eq('hotel_id', hotelId);
  const fichas = await fichasDasReservas(supabaseAdmin, hotelId, chegadas.map((r) => ({ id: String(r.reservationID), nome: r.guestName, checkin: hoje })));
  const vistoriados = new Set();
  const { data: vist } = await supabaseAdmin.from('governanca_vistorias').select('quarto_id, resultado, criado_em')
    .eq('hotel_id', hotelId).eq('resultado', 'APROVADO').gte('criado_em', new Date(Date.now() - 36 * 3600000).toISOString()).limit(500);
  (vist || []).filter((v) => diaNoHotel(v.criado_em) === hoje && v.quarto_id).forEach((v) => vistoriados.add(v.quarto_id));
  const ofertas = new Map();
  const ids = chegadas.map((r) => String(r.reservationID));
  if (ids.length) {
    const { data: cots, error } = await supabaseAdmin.from('atendimento_cotacoes').select('reserva_id, oferta_beneficio')
      .in('reserva_id', ids).not('oferta_beneficio', 'is', null);
    if (!error) (cots || []).forEach((c) => ofertas.set(String(c.reserva_id), c.oferta_beneficio));
  }
  // Aceitou o upgrade ou o late check-out na véspera (M19): lançar na reserva
  const aceites = new Map();
  if (ids.length) {
    const { data: upg } = await supabaseAdmin.from('atendimento_disparos').select('reserva_id, dados').eq('hotel_id', hotelId).eq('tipo', 'UPGRADE').in('reserva_id', ids).limit(200);
    for (const x of upg || []) {
      const o = x.dados?.ofertas || {};
      const reais = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      if (x.dados?.resposta === 'UPGRADE' && o.upgrade) aceites.set(String(x.reserva_id), `upgrade para o ${o.upgrade.quarto} (${reais(o.upgrade.preco)} por noite)`);
      if (x.dados?.resposta === 'LATE' && o.late) aceites.set(String(x.reserva_id), `late check-out até as ${o.late.hora} (${reais(o.late.preco)})`);
    }
  }
  return montarDia({ chegadas, saidas, quartos: quartos || [], fichas, vistoriados, ofertas, aceites, mostrarSaldo });
}
