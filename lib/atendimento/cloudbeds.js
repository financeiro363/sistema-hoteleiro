// ============================================================================
// CAIXA DE ENTRADA — RESERVAS DA CLOUDBEDS ao lado da conversa
// ============================================================================
// - procura reservas atuais e futuras pelo telefone, e-mail ou nome do cliente
// - mostra o resumo de uma reserva (datas, quarto, status, saldo)
// A Cloudbeds não filtra por telefone/e-mail, então busca as reservas com
// saída de 3 dias atrás até 1 ano à frente e compara aqui.
// ============================================================================

import { carregarCloudbeds, chamarCloudbeds } from '../cloudbedsCaixa';

export const STATUS_RESERVA = {
  not_confirmed: 'Não confirmada',
  confirmed: 'Confirmada',
  canceled: 'Cancelada',
  checked_in: 'Hospedado',
  checked_out: 'Check-out feito',
  no_show: 'Não compareceu',
};

function dataISO(deslocamentoDias) {
  const d = new Date(Date.now() + deslocamentoDias * 86400000);
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Fortaleza' });
}

const final8 = (t) => String(t || '').replace(/\D/g, '').slice(-8);
const normal = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

function hospedesDe(r) {
  const lista = r.guestList || r.guests || {};
  return Array.isArray(lista) ? lista : Object.values(lista);
}

function resumoReserva(r, propertyId) {
  const hospedes = hospedesDe(r);
  const principal = hospedes.find((h) => h.isMainGuest) || hospedes[0] || {};
  const quartos = [...new Set([
    ...(r.assigned || []).map((q) => q.roomName || q.roomTypeName),
    ...(r.unassigned || []).map((q) => q.roomTypeName),
    ...hospedes.flatMap((h) => (h.rooms || []).map((q) => q.roomName || q.roomTypeName)),
  ].filter(Boolean))];
  return {
    reservationId: String(r.reservationID),
    nome: r.guestName || [principal.guestFirstName, principal.guestLastName].filter(Boolean).join(' ') || '—',
    email: r.guestEmail || principal.guestEmail || '',
    telefone: principal.guestCellPhone || principal.guestPhone || r.guestPhone || '',
    checkin: r.startDate || null,
    checkout: r.endDate || null,
    status: r.status,
    statusTexto: STATUS_RESERVA[r.status] || r.status || '—',
    total: r.total != null ? Number(r.total) : null,
    saldo: r.balance != null ? Number(r.balance) : null,
    adultos: r.adults != null ? Number(r.adults) : (r.assigned || []).reduce((s, q) => s + Number(q.adults || 0), 0) || null,
    criancas: r.children != null ? Number(r.children) : null,
    origem: r.sourceName || r.source || null,
    quartos,
    link: `https://hotels.cloudbeds.com/connect/${propertyId}#/reservations/${r.reservationID}`,
  };
}

export async function conexaoCloudbeds(supabaseAdmin, hotelId) {
  return carregarCloudbeds(supabaseAdmin, hotelId, process.env.CLOUDBEDS_CRYPTO_SECRET);
}

export async function detalheReserva(cb, reservationId) {
  const r = await chamarCloudbeds(cb, 'getReservation', { verbo: 'GET', params: { reservationID: reservationId } });
  if (!r?.data) throw new Error('Reserva não encontrada na Cloudbeds.');
  return resumoReserva(r.data, cb.propertyId);
}

// Procura por telefone/e-mail do contato (automático) ou por um texto digitado
export async function procurarReservas(cb, { telefone, email, nome, busca }) {
  const texto = String(busca || '').trim();

  // Número da reserva digitado
  if (/^[A-Za-z0-9-]{6,}$/.test(texto) && /\d{5,}/.test(texto)) {
    try { return [await detalheReserva(cb, texto)]; } catch (e) { /* segue procurando por nome */ }
  }

  const todas = [];
  for (let pagina = 1; pagina <= 5; pagina += 1) {
    const r = await chamarCloudbeds(cb, 'getReservations', {
      verbo: 'GET',
      params: {
        checkOutFrom: dataISO(-3), checkOutTo: dataISO(365), includeGuestsDetails: 'true',
        pageSize: '100', pageNumber: String(pagina),
      },
    });
    const lista = Array.isArray(r?.data) ? r.data : [];
    todas.push(...lista);
    if (lista.length < 100) break;
  }

  const alvoFone = final8(telefone);
  const alvoEmail = normal(email);
  const alvoTexto = normal(texto);
  const alvoNome = normal(nome);
  const encontradas = todas.filter((r) => {
    if (r.status === 'canceled') return false;
    const hospedes = hospedesDe(r);
    const fones = [r.guestPhone, ...hospedes.flatMap((h) => [h.guestPhone, h.guestCellPhone])].map(final8).filter((f) => f.length === 8);
    const emails = [r.guestEmail, ...hospedes.map((h) => h.guestEmail)].map(normal).filter(Boolean);
    const nomes = [r.guestName, ...hospedes.map((h) => `${h.guestFirstName || ''} ${h.guestLastName || ''}`)].map(normal).filter(Boolean);
    if (alvoTexto) {
      return nomes.some((n) => n.includes(alvoTexto)) || emails.some((e) => e.includes(alvoTexto))
        || (final8(alvoTexto).length === 8 && fones.includes(final8(alvoTexto)));
    }
    if (alvoFone.length === 8 && fones.includes(alvoFone)) return true;
    if (alvoEmail && emails.includes(alvoEmail)) return true;
    if (alvoNome && alvoNome.split(' ').length >= 2 && nomes.includes(alvoNome)) return true;
    return false;
  });

  return encontradas
    .map((r) => resumoReserva(r, cb.propertyId))
    .sort((a, b) => String(a.checkin).localeCompare(String(b.checkin)))
    .slice(0, 15);
}
