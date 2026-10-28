// ============================================================================
// CAIXA DE ENTRADA — COTAÇÃO E RESERVA (Fase 3) — só usado no servidor
// ============================================================================
// - preço e disponibilidade da Cloudbeds (tarifa padrão do motor)
// - link do motor de reservas com datas e hóspedes já preenchidos
// - texto (WhatsApp) e HTML (e-mail) da cotação
// - verificação de reservas novas na Cloudbeds → etapa "Reservou"
// ============================================================================

import crypto from 'crypto';
import { carregarCloudbeds, chamarCloudbeds } from '../cloudbedsCaixa';
import { soDigitos } from './servidor';
import { dataBR, reais } from './cotacaoTexto';

export { dataBR, reais };

const FUSO = 'America/Fortaleza';
const DIA_MS = 86400000;
export const MAX_NOITES = 30;

// ---- Datas e números -------------------------------------------------------
export function hojeLocal() {
  return new Date().toLocaleDateString('en-CA', { timeZone: FUSO });
}

export function noitesEntre(checkin, checkout) {
  return Math.round((Date.parse(`${checkout}T12:00:00Z`) - Date.parse(`${checkin}T12:00:00Z`)) / DIA_MS);
}

function numero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Confere o pedido de cotação e devolve os valores limpos (ou lança erro)
export function validarPedido({ checkin, checkout, adultos, criancas, quartos }) {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(checkin || '') || !iso.test(checkout || '')) throw erroAmigavel('Escolha as datas de entrada e de saída.');
  if (checkin < hojeLocal()) throw erroAmigavel('A data de entrada já passou.');
  const noites = noitesEntre(checkin, checkout);
  if (noites < 1) throw erroAmigavel('A saída tem que ser depois da entrada.');
  if (noites > MAX_NOITES) throw erroAmigavel(`Cotação de no máximo ${MAX_NOITES} noites.`);
  const a = Math.trunc(Number(adultos));
  const c = Math.trunc(Number(criancas || 0));
  const q = Math.trunc(Number(quartos || 1));
  if (!(a >= 1 && a <= 30)) throw erroAmigavel('Informe quantos adultos (1 a 30).');
  if (!(c >= 0 && c <= 20)) throw erroAmigavel('Número de crianças inválido.');
  if (!(q >= 1 && q <= 10)) throw erroAmigavel('Número de quartos inválido (1 a 10).');
  return { checkin, checkout, noites, adultos: a, criancas: c, quartos: q };
}

function erroAmigavel(mensagem) {
  return Object.assign(new Error(mensagem), { codigo: 'COTACAO' });
}

// Mensagem clara quando falta permissão na chave da Cloudbeds
function traduzirErroCloudbeds(e, oque) {
  const m = String(e?.message || e || '');
  if (/scope|permission|not authorized|unauthorized|access denied|forbidden/i.test(m)) {
    return erroAmigavel(`A chave de API da Cloudbeds não tem permissão para ${oque}. Na Cloudbeds, em Configurações → API, edite a chave e marque a leitura de "Rates/Tarifas", "Rooms/Quartos", "Hotel" e "Reservations/Reservas". (Detalhe: ${m})`);
  }
  return erroAmigavel(`A Cloudbeds não respondeu como esperado ao buscar ${oque}: ${m}`);
}

// Valor extra por adulto/criança: a Cloudbeds manda { "3": 50 } ou [{ "3": 50 }]
function extraPara(campo, quantidade) {
  if (!campo) return 0;
  const lista = Array.isArray(campo) ? campo : [campo];
  for (const item of lista) {
    if (item && typeof item === 'object' && item[String(quantidade)] !== undefined) return numero(item[String(quantidade)]) || 0;
  }
  return 0;
}

// ---- Disponibilidade e preço (tarifa padrão) --------------------------------
export async function buscarDisponibilidade(cb, pedido) {
  const p = validarPedido(pedido);
  const porQuartoAdultos = Math.max(1, Math.ceil(p.adultos / p.quartos));
  const porQuartoCriancas = Math.ceil(p.criancas / p.quartos);

  let resposta;
  try {
    resposta = await chamarCloudbeds(cb, 'getAvailableRoomTypes', {
      verbo: 'GET',
      params: {
        startDate: p.checkin, endDate: p.checkout, rooms: p.quartos,
        adults: porQuartoAdultos, children: porQuartoCriancas, detailedRates: 'false',
      },
    });
  } catch (e) { throw traduzirErroCloudbeds(e, 'a disponibilidade'); }

  const dados = Array.isArray(resposta?.data) ? resposta.data : (resposta?.data ? [resposta.data] : []);
  const quartosCb = dados.flatMap((d) => (Array.isArray(d.propertyRooms) ? d.propertyRooms : []));
  const moeda = dados[0]?.propertyCurrency?.[0]?.currencyCode || dados[0]?.propertyCurrency?.currencyCode || 'BRL';

  // Total exato da tarifa padrão (quando a chave tem permissão de tarifas)
  const totais = {};
  try {
    const planos = await chamarCloudbeds(cb, 'getRatePlans', {
      verbo: 'GET',
      params: { startDate: p.checkin, endDate: p.checkout, adults: porQuartoAdultos, children: porQuartoCriancas },
    });
    for (const r of Array.isArray(planos?.data) ? planos.data : []) {
      const ehPadrao = !r.ratePlanID || String(r.ratePlanID) === '0';
      const total = numero(r.totalRate);
      if (ehPadrao && r.roomTypeID && total !== null) totais[String(r.roomTypeID)] = total;
    }
  } catch (e) { /* sem permissão de tarifas: usa o valor de getAvailableRoomTypes */ }

  const capacidadeNecessaria = porQuartoAdultos + porQuartoCriancas;
  const itens = quartosCb
    .filter((q) => (numero(q.roomsAvailable) ?? 0) >= p.quartos)
    .filter((q) => !numero(q.maxGuests) || numero(q.maxGuests) >= capacidadeNecessaria)
    .map((q) => {
      const tipoId = String(q.roomTypeID);
      const base = totais[tipoId] ?? ((numero(q.roomRate) || 0)
        + extraPara(q.adultsExtraCharge, porQuartoAdultos) + extraPara(q.childrenExtraCharge, porQuartoCriancas));
      const total = Math.round(base * p.quartos * 100) / 100;
      const foto = (q.roomTypePhotos || [])[0];
      return {
        tipoId,
        nome: String(q.roomTypeName || 'Quarto'),
        abreviacao: q.roomTypeNameShort ? String(q.roomTypeNameShort) : null,
        descricao: q.roomTypeDescription ? String(q.roomTypeDescription).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300) : null,
        capacidade: numero(q.maxGuests),
        disponiveis: numero(q.roomsAvailable),
        total,
        porNoite: Math.round((total / p.noites) * 100) / 100,
        foto: foto ? String(foto.thumb || foto.image || '') || null : null,
        tarifa: q.ratePlanNamePublic ? String(q.ratePlanNamePublic) : null,
      };
    })
    .filter((i) => i.total > 0)
    .sort((a, b) => a.total - b.total);

  return { ...p, moeda, itens };
}

// ---- Link do motor -----------------------------------------------------------
export async function linkDoMotor(supabaseAdmin, cb, hotelId) {
  const { data: pref } = await supabaseAdmin.from('atendimento_preferencias').select('motor_url').eq('hotel_id', hotelId).maybeSingle();
  if (pref?.motor_url) return pref.motor_url;
  const achado = await detectarMotor(cb);
  if (achado) {
    await supabaseAdmin.from('atendimento_preferencias').upsert({ hotel_id: hotelId, motor_url: achado }, { onConflict: 'hotel_id' });
  }
  return achado;
}

export async function detectarMotor(cb) {
  try {
    const r = await chamarCloudbeds(cb, 'getHotelDetails', { verbo: 'GET' });
    const url = r?.data?.propertyBookingUrl || r?.data?.propertyBookingURL || null;
    return url && /^https:\/\//.test(url) ? url : null;
  } catch (e) { return null; }
}

export function montarLinkMotor(motorUrl, { checkin, checkout, adultos, criancas, abreviacao }) {
  if (!motorUrl) return null;
  const [semHash] = String(motorUrl).split('#');
  const [base, consulta = ''] = semHash.split('?');
  const params = new URLSearchParams(consulta);
  params.set('checkin', checkin);
  params.set('checkout', checkout);
  if (adultos) params.set('adults', String(adultos));
  params.set('kids', String(criancas || 0));
  return `${base}?${params.toString()}${abreviacao ? `#room_type=${encodeURIComponent(abreviacao)}` : ''}`;
}

// Código do link (8 letras/números, difícil de adivinhar)
export function novoCodigo() {
  const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(10);
  return Array.from(bytes).map((b) => letras[b % letras.length]).join('');
}

// ---- Texto e HTML da cotação: em cotacaoTexto.js (a tela usa a mesma prévia)
export {
  textoCotacao, htmlCotacao, preencher, descreverHospedes, escaparHtml, ABERTURA_PADRAO, FINAL_PADRAO,
} from './cotacaoTexto';

// ---- Limpeza de HTML de modelos (e-mail) -------------------------------------
export function limparHtml(html) {
  return String(html || '')
    .replace(/<\s*(script|style|iframe|object|embed|form|input|button|textarea|select|meta|link|base)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed|form|input|button|textarea|select|meta|link|base)[^>]*\/?>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("|')\s*(javascript|vbscript|data:text)[^"']*\2/gi, '$1="#"')
    .slice(0, 200000);
}

// ---- Reservas novas na Cloudbeds → "Reservou" --------------------------------
// Chave do telefone: DDD + últimos 8 dígitos (Brasil) ou o número inteiro
export function chaveTelefone(t) {
  let d = soDigitos(t).replace(/^0+/, '');
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2);
  if (d.length === 10 || d.length === 11) return `${d.slice(0, 2)}${d.slice(-8)}`;
  if (d.length === 8 || d.length === 9) return `*${d.slice(-8)}`;
  return d.length >= 8 ? d : '';
}

function hospedesDe(r) {
  const lista = r.guestList || r.guests || {};
  return Array.isArray(lista) ? lista : Object.values(lista);
}

function formatoCloudbeds(data) {
  // "2026-10-23 08:15:00" no horário do hotel
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(data);
  const v = Object.fromEntries(p.map((x) => [x.type, x.value]));
  return `${v.year}-${v.month}-${v.day} ${v.hour === '24' ? '00' : v.hour}:${v.minute}:${v.second}`;
}

const STATUS_VALIDOS = ['confirmed', 'not_confirmed', 'checked_in', 'checked_out'];

// Cotações abertas (60 dias) deste hotel e as que outros hotéis do grupo
// mandaram deste hotel. Sem o SQL do outro hotel, só as deste hotel.
async function cotacoesAbertas(supabaseAdmin, hotelId) {
  const desde = new Date(Date.now() - 60 * DIA_MS).toISOString();
  const h = Number(hotelId);
  const r = await supabaseAdmin.from('atendimento_cotacoes')
    .select('conversa_id, hotel_id, hotel_cotado_id').in('status', ['ENVIADA', 'CLICOU']).gte('criado_em', desde)
    .or(`and(hotel_id.eq.${h},hotel_cotado_id.is.null),hotel_cotado_id.eq.${h}`);
  if (!r.error) return r.data || [];
  const { data } = await supabaseAdmin.from('atendimento_cotacoes')
    .select('conversa_id, hotel_id').eq('hotel_id', h).in('status', ['ENVIADA', 'CLICOU']).gte('criado_em', desde);
  return data || [];
}

export async function verificarReservasHotel(supabaseAdmin, hotelId, { segredoCripto, intervaloMin = 5, forcar = false } = {}) {
  const { data: pref, error: erroPref } = await supabaseAdmin.from('atendimento_preferencias')
    .select('verificar_reservas, reservas_verificadas_ate').eq('hotel_id', hotelId).maybeSingle();
  if (erroPref) return { hotelId, pulou: 'falta o SQL da Fase 3' };
  if (pref && pref.verificar_reservas === false && !forcar) return { hotelId, pulou: 'desligado' };
  const agora = new Date();
  const ultima = pref?.reservas_verificadas_ate ? new Date(pref.reservas_verificadas_ate) : null;
  if (!forcar && ultima && agora - ultima < intervaloMin * 60000) return { hotelId, pulou: 'recente' };

  let cb;
  try { cb = await carregarCloudbeds(supabaseAdmin, hotelId, segredoCripto); }
  catch (e) { return { hotelId, pulou: 'sem cloudbeds' }; }

  // Marca o horário antes de começar (duas chamadas juntas não repetem o trabalho)
  await supabaseAdmin.from('atendimento_preferencias')
    .upsert({ hotel_id: hotelId, reservas_verificadas_ate: agora.toISOString() }, { onConflict: 'hotel_id' });

  // Conversas recentes (45 dias) e os contatos delas
  const desdeConversas = new Date(Date.now() - 45 * DIA_MS).toISOString();
  const campos = 'id, hotel_id, contato_id, canal_tipo, chave_externa, contato_endereco, ultima_mensagem_em';
  const { data: daqui } = await supabaseAdmin.from('atendimento_conversas')
    .select(campos)
    .eq('hotel_id', hotelId).gte('ultima_mensagem_em', desdeConversas).order('ultima_mensagem_em', { ascending: false }).limit(3000);
  const cotacoes = await cotacoesAbertas(supabaseAdmin, hotelId);
  const comCotacao = new Set(cotacoes.map((c) => c.conversa_id));

  // Conversas de outro hotel do grupo que mandaram cotação DESTE hotel (não havia quarto lá)
  const idsDeFora = [...new Set(cotacoes.filter((c) => Number(c.hotel_id) !== Number(hotelId)).map((c) => c.conversa_id).filter(Boolean))];
  const deFora = [];
  for (let i = 0; i < idsDeFora.length; i += 300) {
    const { data } = await supabaseAdmin.from('atendimento_conversas').select(campos).in('id', idsDeFora.slice(i, i + 300));
    deFora.push(...(data || []));
  }
  const conversas = [...(daqui || []), ...deFora];
  if (!conversas.length) return { hotelId, reservas: 0, marcadas: 0 };

  const idsContatos = [...new Set(conversas.map((c) => c.contato_id).filter(Boolean))];
  const contatos = [];
  for (let i = 0; i < idsContatos.length; i += 300) {
    const { data } = await supabaseAdmin.from('atendimento_contatos').select('id, telefone, email').in('id', idsContatos.slice(i, i + 300));
    contatos.push(...(data || []));
  }

  // Telefone/e-mail → conversa (a com cotação aberta primeiro; senão a mais recente)
  const contatoPorId = Object.fromEntries(contatos.map((c) => [c.id, c]));
  const porChave = new Map();
  const registrar = (chave, conversa) => {
    if (!chave) return;
    const atual = porChave.get(chave);
    if (!atual || (!comCotacao.has(atual.id) && comCotacao.has(conversa.id))) porChave.set(chave, conversa);
  };
  for (const c of conversas) {
    const ct = contatoPorId[c.contato_id] || {};
    const fones = [ct.telefone, c.canal_tipo === 'WHATSAPP' ? c.chave_externa : null].map(chaveTelefone).filter(Boolean);
    fones.forEach((f) => { registrar(`f:${f}`, c); registrar(`f8:${f.slice(-8)}`, c); });
    [ct.email, c.canal_tipo === 'EMAIL' ? c.contato_endereco : null].filter(Boolean)
      .forEach((e) => registrar(`e:${String(e).trim().toLowerCase()}`, c));
  }

  // Reservas criadas desde a última verificação (com folga de 4 h por causa do fuso)
  const desde = new Date((ultima ? ultima.getTime() : Date.now() - DIA_MS) - 4 * 3600000);
  const reservas = [];
  try {
    for (let pagina = 1; pagina <= 3; pagina += 1) {
      const r = await chamarCloudbeds(cb, 'getReservations', {
        verbo: 'GET',
        params: { resultsFrom: formatoCloudbeds(desde), includeGuestsDetails: 'true', pageSize: '100', pageNumber: String(pagina) },
      });
      const lista = Array.isArray(r?.data) ? r.data : [];
      reservas.push(...lista);
      if (lista.length < 100) break;
    }
  } catch (e) {
    return { hotelId, erro: traduzirErroCloudbeds(e, 'as reservas novas').message };
  }

  let marcadas = 0;
  let nomeHotel;
  for (const r of reservas) {
    if (r.status && !STATUS_VALIDOS.includes(r.status)) continue;
    const hospedes = hospedesDe(r);
    const fones = [r.guestPhone, r.guestCellPhone, ...hospedes.flatMap((h) => [h.guestPhone, h.guestCellPhone])].map(chaveTelefone).filter(Boolean);
    const emails = [r.guestEmail, ...hospedes.map((h) => h.guestEmail)].filter(Boolean).map((e) => String(e).trim().toLowerCase());
    let conversa = null;
    for (const e of emails) { conversa = conversa || porChave.get(`e:${e}`); }
    for (const f of fones) { conversa = conversa || porChave.get(`f:${f}`); }
    for (const f of fones) { if (!conversa && f.startsWith('*')) conversa = porChave.get(`f8:${f.slice(-8)}`); }
    if (!conversa) continue;

    let total = numero(r.total);
    let detalhe = r;
    try {
      const d = await chamarCloudbeds(cb, 'getReservation', { verbo: 'GET', params: { reservationID: r.reservationID } });
      if (d?.data) { detalhe = d.data; total = numero(d.data.total) ?? total; }
    } catch (e) { /* usa o que veio na lista */ }
    // Reserva neste hotel vinda da conversa de outro hotel do grupo
    const deOutro = conversa.hotel_id && Number(conversa.hotel_id) !== Number(hotelId);
    if (deOutro && nomeHotel === undefined) {
      const { data: h } = await supabaseAdmin.from('hoteis').select('nome_fantasia').eq('id', hotelId).maybeSingle();
      nomeHotel = h?.nome_fantasia || null;
    }
    const texto = `🎉 Reservou${deOutro ? ` no ${nomeHotel || 'outro hotel do grupo'}` : ''}! Reserva ${r.reservationID} na Cloudbeds: ${dataBR(detalhe.startDate || r.startDate)} a ${dataBR(detalhe.endDate || r.endDate)}`
      + `${total ? `, total ${reais(total)}` : ''}${detalhe.sourceName || r.sourceName ? ` (origem: ${detalhe.sourceName || r.sourceName})` : ''}.`;
    const { data: marcou } = await supabaseAdmin.rpc('atendimento_marcar_reserva', {
      p_conversa: conversa.id, p_reserva: String(r.reservationID), p_valor: total, p_texto: texto,
      ...(deOutro ? { p_hotel_reserva: Number(hotelId) } : {}),
    });
    if (marcou) marcadas += 1;
  }
  return { hotelId, reservas: reservas.length, marcadas };
}
