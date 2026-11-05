// ============================================================================
// ROTA DE SERVIDOR: /api/fichas-chegadas  (M1 — quem já preencheu a ficha)
// ============================================================================
// Chegadas de hoje e dos próximos 2 dias na Cloudbeds, com "ficha ok" ou
// "falta". Devolve só o nome do hóspede, a data de entrada e a situação —
// nenhum telefone, documento ou valor (LGPD). ADMIN e recepção.
// ============================================================================

import { autenticarChamada, carregarCloudbeds, chamarCloudbeds } from '../../../lib/cloudbedsCaixa';
import { fichasDasReservas } from '../../../lib/atendimento/fichaLink';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const hoje = (dias = 0) => new Date(Date.now() + dias * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Fortaleza' });
const VALIDOS = ['confirmed', 'not_confirmed', 'checked_in'];

export async function GET(request) {
  try {
    const auth = await autenticarChamada(request);
    if (auth.resposta) return auth.resposta;
    const { chamador, supabaseAdmin, segredoCripto } = auth;
    if (!['ADMIN', 'COLABORADOR'].includes(chamador.papel)) return Response.json({ erro: 'Só a recepção e a administração veem as chegadas.' }, { status: 403 });

    let cb;
    try { cb = await carregarCloudbeds(supabaseAdmin, chamador.hotel_id, segredoCripto); }
    catch (e) { return Response.json({ erro: 'Este hotel ainda não está ligado à Cloudbeds.' }, { status: 400 }); }

    const reservas = [];
    for (let pagina = 1; pagina <= 3; pagina += 1) {
      const r = await chamarCloudbeds(cb, 'getReservations', {
        verbo: 'GET', params: { checkInFrom: hoje(), checkInTo: hoje(2), pageSize: '100', pageNumber: String(pagina) },
      });
      const lista = Array.isArray(r?.data) ? r.data : [];
      reservas.push(...lista);
      if (lista.length < 100) break;
    }
    const validas = reservas.filter((r) => !r.status || VALIDOS.includes(r.status)).map((r) => ({
      id: String(r.reservationID), nome: r.guestName || '', checkin: String(r.startDate || '').slice(0, 10), situacao: r.status || '',
    }));
    const fichas = await fichasDasReservas(supabaseAdmin, chamador.hotel_id, validas);
    const chegadas = validas
      .map((r) => ({ nome: r.nome, checkin: r.checkin, jaChegou: r.situacao === 'checked_in', ficha: !!fichas.get(r.id) }))
      .sort((a, b) => (a.checkin === b.checkin ? a.nome.localeCompare(b.nome, 'pt-BR') : a.checkin < b.checkin ? -1 : 1));
    return Response.json({ chegadas, de: hoje(), ate: hoje(2) });
  } catch (e) {
    return Response.json({ erro: 'Erro inesperado no servidor: ' + e.message }, { status: 500 });
  }
}
