// ============================================================================
// GOVERNANÇA — rotina do dia: busca na Cloudbeds e aplica (só no SERVIDOR)
// ============================================================================
// 1) saídas de hoje (getReservations checkOutFrom/To = hoje, hóspede no quarto)
// 2) chegadas de hoje (getReservations checkInFrom/To = hoje, ainda não entrou)
//    Reserva que veio sem quarto na lista é completada com getReservation.
// 3) ocupação de cada quarto (getHousekeepingStatus)
// 4) regras em lib/governanca/rotina.js → grava os quartos, avisa a Cloudbeds
//    da limpeza (dirty) e anota o que foi feito hoje (governanca_rotina_marcas)
// 5) guarda o resumo (governanca_rotina_execucoes) para o Painel mostrar
// ============================================================================

import { chamarCloudbeds } from '../cloudbedsCaixa';
import { carregarCloudbeds, chamarV13, enviarSituacao, DICA_HOUSEKEEPING } from './cloudbeds';
import { hojeNoHotel } from './regras';
import { quartosDaReserva, acharQuarto, horaDaChegada, planoDoDia, camposPorQuarto, resumoDoPlano } from './rotina';

async function reservasDoDia(cb, campo, hoje) {
  const todas = [];
  for (let pagina = 1; pagina <= 5; pagina += 1) {
    const r = await chamarCloudbeds(cb, 'getReservations', {
      verbo: 'GET',
      params: { [`${campo}From`]: hoje, [`${campo}To`]: hoje, includeGuestsDetails: 'true', pageSize: '100', pageNumber: String(pagina) },
    });
    const lista = Array.isArray(r?.data) ? r.data : [];
    todas.push(...lista);
    if (lista.length < 100) break;
  }
  return todas;
}

// Reserva sem quarto na lista: pergunta o detalhe (até 25, de 5 em 5)
async function completarQuartos(cb, reservas) {
  const faltam = reservas.filter((r) => !quartosDaReserva(r).length || (!r.estimatedArrivalTime && r.__chegada)).slice(0, 25);
  for (let i = 0; i < faltam.length; i += 5) {
    await Promise.all(faltam.slice(i, i + 5).map(async (r) => {
      try {
        const d = await chamarCloudbeds(cb, 'getReservation', { verbo: 'GET', params: { reservationID: r.reservationID } });
        if (d?.data) {
          if (!quartosDaReserva(r).length) r.assigned = d.data.assigned || [];
          r.estimatedArrivalTime = r.estimatedArrivalTime || d.data.estimatedArrivalTime || null;
        }
      } catch (e) { /* fica sem quarto: conta em "sem quarto" */ }
    }));
  }
}

async function registrar(supabaseAdmin, hotelId, hoje, origem, quem, resumo, erro) {
  await supabaseAdmin.from('governanca_rotina_execucoes').insert({
    hotel_id: hotelId, data: hoje, origem, executado_por_nome: quem || null, resumo: resumo || {}, erro: erro || null,
  });
}

// origem: 'AGENDADA' | 'MANUAL'
export async function rodarRotina(supabaseAdmin, hotelId, { origem = 'MANUAL', quem = null, segredoCripto } = {}) {
  const hoje = hojeNoHotel();
  const { data: quartos } = await supabaseAdmin.from('quartos').select('*').eq('hotel_id', hotelId);
  if (!quartos?.length) return { ignorado: 'Nenhum quarto cadastrado na Governança.' };

  let cb;
  try { cb = await carregarCloudbeds(supabaseAdmin, hotelId, segredoCripto); }
  catch (e) { await registrar(supabaseAdmin, hotelId, hoje, origem, quem, null, e.message); return { erro: e.message }; }

  const { data: execucoes } = await supabaseAdmin.from('governanca_rotina_execucoes').select('id')
    .eq('hotel_id', hotelId).eq('data', hoje).is('erro', null).limit(1);
  const primeiraDoDia = !execucoes?.length;

  let partidas; let entradas;
  try {
    [partidas, entradas] = await Promise.all([reservasDoDia(cb, 'checkOut', hoje), reservasDoDia(cb, 'checkIn', hoje)]);
  } catch (e) {
    const msg = 'A Cloudbeds não mandou as reservas de hoje: ' + e.message;
    await registrar(supabaseAdmin, hotelId, hoje, origem, quem, null, msg);
    return { erro: msg };
  }
  partidas = partidas.filter((r) => r.status === 'checked_in' && String(r.endDate || '').slice(0, 10) === hoje);
  entradas = entradas.filter((r) => ['confirmed', 'not_confirmed'].includes(r.status) && String(r.startDate || '').slice(0, 10) === hoje);
  entradas.forEach((r) => { r.__chegada = true; });
  await completarQuartos(cb, [...partidas, ...entradas]);

  const saidas = new Set();
  for (const r of partidas) for (const rq of quartosDaReserva(r)) { const q = acharQuarto(quartos, rq); if (q) saidas.add(q.id); }
  const chegadas = new Map(); const listaChegadas = []; let semQuarto = 0;
  for (const r of entradas) {
    const qs = quartosDaReserva(r).map((rq) => acharQuarto(quartos, rq)).filter(Boolean);
    if (!qs.length) { semQuarto += 1; continue; }
    const hora = horaDaChegada(r.estimatedArrivalTime);
    for (const q of qs) { chegadas.set(q.id, { hora }); listaChegadas.push({ numero: q.numero, hora }); }
  }

  const ocupacao = new Map();
  try {
    const d = await chamarV13(cb, 'getHousekeepingStatus', { verbo: 'GET', campos: [['pageSize', 5000]], dica: DICA_HOUSEKEEPING });
    for (const rc of d.data || []) {
      const q = quartos.find((x) => x.cloudbeds_room_id && String(x.cloudbeds_room_id) === String(rc.roomID));
      if (q) ocupacao.set(q.id, !!rc.roomOccupied);
    }
  } catch (e) { /* sem a ocupação: as regras seguem pelo nosso estado */ }

  const { data: marcas } = await supabaseAdmin.from('governanca_rotina_marcas').select('quarto_id, tipo').eq('hotel_id', hotelId).eq('data', hoje);
  const jaFeitas = new Set((marcas || []).map((m) => `${m.quarto_id}:${m.tipo}`));
  const plano = planoDoDia({ quartos, hoje, saidas, chegadas, ocupacao, jaFeitas, primeiraDoDia });

  // Grava: quem já entrou no quarto (Em Arrumação) não é atropelado
  const aplicados = [];
  for (const m of camposPorQuarto(plano)) {
    const { data: ok } = await supabaseAdmin.from('quartos').update(m.campos).eq('id', m.quarto.id).neq('status', 'EM_ARRUMACAO').select('id');
    if (ok?.length) aplicados.push(m);
  }
  const avisarCloudbeds = aplicados.filter((m) => m.cloudbeds && m.quarto.cloudbeds_room_id);
  for (let i = 0; i < avisarCloudbeds.length; i += 5) {
    await Promise.all(avisarCloudbeds.slice(i, i + 5).map((m) => enviarSituacao(cb, m.quarto.cloudbeds_room_id, m.cloudbeds).catch(() => null)));
  }
  const idsAplicados = new Set(aplicados.map((m) => m.quarto.id));
  const novasMarcas = plano.filter((p) => idsAplicados.has(p.quarto.id)).map((p) => ({ hotel_id: hotelId, data: hoje, quarto_id: p.quarto.id, tipo: p.tipo }));
  if (novasMarcas.length) {
    await supabaseAdmin.from('governanca_rotina_marcas').upsert(novasMarcas, { onConflict: 'hotel_id,data,quarto_id,tipo', ignoreDuplicates: true });
  }

  const numeroDe = new Map(quartos.map((q) => [q.id, q.numero]));
  const resumo = {
    ...resumoDoPlano(plano.filter((p) => idsAplicados.has(p.quarto.id)), {
      saidas: [...saidas].map((id) => numeroDe.get(id)),
      chegadas: listaChegadas,
      semQuarto,
    }),
    primeiraDoDia,
    ocupacao: ocupacao.size > 0,
  };
  await registrar(supabaseAdmin, hotelId, hoje, origem, quem, resumo, null);
  return { sucesso: true, resumo };
}
