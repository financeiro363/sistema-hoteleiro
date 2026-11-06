// ============================================================================
// CAIXA DE ENTRADA — AUTOMAÇÕES (Fase 5) — só usado no servidor
// ============================================================================
// A função agendada (a cada 2 minutos) faz duas coisas:
//  1. AGENDAR: procura o que aconteceu desde que cada automação foi ligada
//     (clique em "Reservar agora", cotação sem quarto, reserva nova, véspera
//     do check-in…) e cria um "disparo" com a hora certa de enviar. A chave do
//     disparo impede mandar duas vezes a mesma coisa.
//  2. ENVIAR: na hora marcada, confere de novo se ainda faz sentido (já
//     reservou? o cliente voltou a conversar? pediu para sair?), respeita o
//     horário de envio e o limite do dia, e manda o modelo aprovado.
// Tudo fica registrado em atendimento_disparos (enviado, não enviado e por quê).
// ============================================================================

import { chamarCloudbeds } from '../cloudbedsCaixa';
import { conexaoCloudbeds } from './cloudbeds';
import { buscarDisponibilidade, linkDoMotor, montarLinkMotor, dataBR, reais, noitesEntre } from './cotacao';
import { enviarWhatsApp, gravarNota } from './envio';
import { textoDoModelo, listarModelos, tokenDoCanal, normalizarNumero, celularValido, comPais } from './whatsapp';
import { AUTOMACAO_POR_TIPO, REGEX_SAIR, lerNota, AUTOMACOES_POR_HORA, AUTOMACOES_DA_FICHA, RETOMADA_MAX_SEM_MODELO_MIN, NOTA_BAIXA_ATE, respostaUpgrade } from './automacoesConfig';
import { detectarIdioma, idiomaDoPais } from './idiomas';
import { avisarAdmins } from './avisoGestor';
import { linkFicha, fichaPreenchida } from './fichaLink';
import { textoDoHotel } from './textosHospedagem';
import { baseDoLink } from './modelosTexto';
import { marcarSaidaCampanha } from './campanhas';

const FUSO = 'America/Fortaleza';
const MIN = 60000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;
const CONVERSA_EM_ANDAMENTO_MIN = 30;   // como no Asksuite: não interrompe uma conversa
const SEM_DISP_MAX_DIAS = 14;          // lista de espera: tenta por até 14 dias
const MAX_ENVIOS_POR_RODADA = 15;
const MAX_CONSULTAS_CLOUDBEDS = 3;     // reconsultas de disponibilidade por rodada

// ---------------------------------------------------------------- datas
function partes(data = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(data).map((x) => [x.type, x.value]));
  const hora = p.hour === '24' ? '00' : p.hour;
  return { dia: `${p.year}-${p.month}-${p.day}`, hhmm: `${hora}:${p.minute}` };
}
export const hojeLocal = (deslocamentoDias = 0) => partes(new Date(Date.now() + deslocamentoDias * DIA)).dia;
// "2026-10-25" + "10:00" no horário de João Pessoa (UTC-3, sem horário de verão) → Date
export const momentoLocal = (dia, hhmm) => new Date(`${dia}T${hhmm}:00-03:00`);

// Dentro do horário de envio? Se não, devolve o próximo início da janela
export function proximoHorarioPermitido(automacao, agora = new Date()) {
  const ini = automacao.janela_inicio || '08:00';
  const fim = automacao.janela_fim || '21:00';
  const { dia, hhmm } = partes(agora);
  if (hhmm >= ini && hhmm < fim) return null;
  const diaAlvo = hhmm < ini ? dia : partes(new Date(agora.getTime() + DIA)).dia;
  return momentoLocal(diaAlvo, ini);
}

// ---------------------------------------------------------------- variáveis
const primeiroNome = (n) => {
  const t = String(n || '').trim();
  return /\p{L}/u.test(t) ? t.split(/\s+/)[0] : '';
};
function pessoasTexto(adultos, criancas) {
  const a = Number(adultos) || 0;
  const c = Number(criancas) || 0;
  return [a ? `${a} adulto${a > 1 ? 's' : ''}` : '', c ? `${c} criança${c > 1 ? 's' : ''}` : ''].filter(Boolean).join(' e ');
}
export function valoresDasVariaveis(mapa, dados) {
  return (Array.isArray(mapa) ? mapa : []).map((campo) => {
    const v = dados?.[campo];
    return v === undefined || v === null || v === '' ? '-' : String(v).slice(0, 300);
  });
}

// Final do link de cada botão do modelo (o botão abre <base>{{1}}; o sistema
// manda só o final, ex.: "AB12CD-0" de https://…/r/AB12CD-0)
export function valoresDosBotoes(info, dados) {
  const valores = [];
  const semProtocolo = (u) => String(u || '').replace(/^https?:\/\//i, '');
  for (const b of info?.botoesLink || []) {
    const base = semProtocolo(baseDoLink(b.url));
    const link = [dados?.link_cotacao, dados?.link_reservar, dados?.link_ficha].map(semProtocolo)
      .find((l) => l && base && l.toLowerCase().startsWith(base.toLowerCase()) && l.length > base.length);
    if (!link) return { erro: `o botão “${b.texto}” do modelo abre outro endereço (${baseDoLink(b.url)}…)` };
    valores.push({ indice: b.indice, texto: link.slice(base.length) });
  }
  return { valores };
}

// ---------------------------------------------------------------- conversas
async function ultimaMensagem(supabaseAdmin, conversaId, direcoes = ['ENTRADA', 'SAIDA']) {
  const { data } = await supabaseAdmin.from('atendimento_mensagens').select('id, direcao, criado_em')
    .eq('conversa_id', conversaId).in('direcao', direcoes).order('criado_em', { ascending: false }).limit(1).maybeSingle();
  return data;
}
async function clienteEscreveuDepois(supabaseAdmin, conversaId, desde) {
  const { data } = await supabaseAdmin.from('atendimento_mensagens').select('id')
    .eq('conversa_id', conversaId).eq('direcao', 'ENTRADA').gt('criado_em', new Date(desde).toISOString()).limit(1);
  return !!data?.length;
}
async function jaReservou(supabaseAdmin, conversa) {
  if (!conversa) return false;
  const { data } = await supabaseAdmin.from('atendimento_etiquetas').select('id').eq('hotel_id', conversa.hotel_id).ilike('nome', 'reservou');
  const ids = (data || []).map((e) => e.id);
  return (conversa.etiquetas || []).some((e) => ids.includes(e));
}

// ============================================================================
// 1) AGENDAR
// ============================================================================
async function inserirDisparos(supabaseAdmin, linhas) {
  if (!linhas.length) return 0;
  const { data, error } = await supabaseAdmin.from('atendimento_disparos')
    .upsert(linhas, { onConflict: 'automacao_id,chave', ignoreDuplicates: true }).select('id');
  if (error) throw error;
  return data?.length || 0;
}

const desdeDe = (a, maxDias = 3) => new Date(Math.max(new Date(a.ligado_em || Date.now()).getTime(), Date.now() - maxDias * DIA)).toISOString();

async function agendarCotacoes(supabaseAdmin, a, { status, campoData }) {
  const { data } = await supabaseAdmin.from('atendimento_cotacoes')
    .select(`id, conversa_id, contato_id, ${campoData}`).eq('hotel_id', a.hotel_id).eq('status', status)
    .gte(campoData, desdeDe(a)).limit(300);
  return inserirDisparos(supabaseAdmin, (data || []).filter((c) => c[campoData]).map((c) => ({
    hotel_id: a.hotel_id, automacao_id: a.id, tipo: a.tipo, chave: `cot:${c.id}`, conversa_id: c.conversa_id,
    contato_id: c.contato_id, cotacao_id: c.id,
    agendado_para: new Date(new Date(c[campoData]).getTime() + (Number(a.espera_minutos) || 0) * MIN).toISOString(),
  })));
}

// Segunda tentativa: cotação enviada (com ou sem clique), sem reserva, chegada futura
async function agendarOfertas(supabaseAdmin, a) {
  const { data } = await supabaseAdmin.from('atendimento_cotacoes')
    .select('id, conversa_id, contato_id, criado_em, checkin').eq('hotel_id', a.hotel_id).in('status', ['ENVIADA', 'CLICOU'])
    .gte('criado_em', desdeDe(a, 7)).gt('checkin', hojeLocal()).limit(300);
  return inserirDisparos(supabaseAdmin, (data || []).map((c) => ({
    hotel_id: a.hotel_id, automacao_id: a.id, tipo: a.tipo, chave: `ofe:${c.id}`, conversa_id: c.conversa_id,
    contato_id: c.contato_id, cotacao_id: c.id,
    agendado_para: new Date(new Date(c.criado_em).getTime() + (Number(a.espera_minutos) || 0) * MIN).toISOString(),
  })));
}

// Ocupação das datas (0–100): quartos livres em todas as noites ÷ quartos do hotel
export function ocupacaoPercentual(livres, total) {
  if (!(total > 0)) return null;
  return Math.max(0, Math.min(100, Math.round((1 - Math.min(livres, total) / total) * 100)));
}
async function ocupacaoDasDatas(supabaseAdmin, cb, hotelId, checkin, checkout) {
  const r = await chamarCloudbeds(cb, 'getAvailableRoomTypes', { verbo: 'GET', params: { startDate: checkin, endDate: checkout, rooms: 1, adults: 1, children: 0, detailedRates: 'false' } });
  const dados = Array.isArray(r?.data) ? r.data : (r?.data ? [r.data] : []);
  const livres = dados.flatMap((x) => x.propertyRooms || []).reduce((s, q) => s + (Number(q.roomsAvailable) || 0), 0);
  const { count } = await supabaseAdmin.from('quartos').select('id', { count: 'exact', head: true }).eq('hotel_id', hotelId);
  let total = Number(count) || 0;
  if (!total) {
    try {
      const t = await chamarCloudbeds(cb, 'getRoomTypes', { verbo: 'GET', params: {} });
      total = (Array.isArray(t?.data) ? t.data : []).reduce((s, x) => s + (Number(x.roomTypeUnits) || 0), 0);
    } catch (e) { total = 0; }
  }
  return { livres, total, ocupacao: ocupacaoPercentual(livres, total) };
}

async function agendarSemDisponibilidade(supabaseAdmin, a) {
  const { data } = await supabaseAdmin.from('atendimento_cotacoes')
    .select('id, conversa_id, contato_id, checkin, criado_em').eq('hotel_id', a.hotel_id).eq('status', 'SEM_DISPONIBILIDADE')
    .gte('criado_em', desdeDe(a, 14)).gt('checkin', hojeLocal(1)).limit(300);
  const primeira = (c) => new Date(new Date(c.criado_em).getTime() + Math.max(Number(a.config?.reverificar_horas) || 6, 1) * HORA);
  return inserirDisparos(supabaseAdmin, (data || []).map((c) => ({
    hotel_id: a.hotel_id, automacao_id: a.id, tipo: a.tipo, chave: `sem:${c.id}`, conversa_id: c.conversa_id,
    contato_id: c.contato_id, cotacao_id: c.id, agendado_para: primeira(c).toISOString(),
  })));
}

async function agendarGrupos(supabaseAdmin, a) {
  const { data } = await supabaseAdmin.from('atendimento_solicitacoes')
    .select('id, conversa_id, contato_id, criado_em, dados').eq('hotel_id', a.hotel_id).eq('tipo', 'GRUPO')
    .gte('criado_em', desdeDe(a, 7)).limit(300);
  return inserirDisparos(supabaseAdmin, (data || []).filter((s) => s.conversa_id).map((s) => ({
    hotel_id: a.hotel_id, automacao_id: a.id, tipo: a.tipo, chave: `sol:${s.id}`, conversa_id: s.conversa_id,
    contato_id: s.contato_id, dados: { solicitacao_id: s.id, criado_em: s.criado_em, ...(s.dados || {}) },
    agendado_para: new Date(new Date(s.criado_em).getTime() + (Number(a.espera_minutos) || 0) * MIN).toISOString(),
  })));
}

async function agendarConfirmacoes(supabaseAdmin, a) {
  const { data } = await supabaseAdmin.from('atendimento_reservas_detectadas')
    .select('reserva_id, conversa_id, criado_em').eq('hotel_id', a.hotel_id).gte('criado_em', desdeDe(a, 2)).limit(300);
  return inserirDisparos(supabaseAdmin, (data || []).filter((r) => r.conversa_id).map((r) => ({
    hotel_id: a.hotel_id, automacao_id: a.id, tipo: a.tipo, chave: `res:${r.reserva_id}`, conversa_id: r.conversa_id,
    reserva_id: String(r.reserva_id),
    agendado_para: new Date(new Date(r.criado_em).getTime() + (Number(a.espera_minutos) || 0) * MIN).toISOString(),
  })));
}

async function agendarPesquisas(supabaseAdmin, a) {
  const { data } = await supabaseAdmin.from('atendimento_conversas')
    .select('id, contato_id, resolvida_em, responsavel_id, canal_tipo').eq('hotel_id', a.hotel_id).eq('status', 'RESOLVIDA')
    .gte('resolvida_em', desdeDe(a, 1)).limit(300);
  // Quem já recebeu pesquisa nos últimos 7 dias não entra de novo (ex.: a conversa
  // reabriu só porque o cliente mandou a nota e foi resolvida outra vez)
  const ids = (data || []).map((c) => c.id);
  let recentes = new Set();
  if (ids.length) {
    const { data: ja } = await supabaseAdmin.from('atendimento_disparos').select('conversa_id').eq('tipo', 'PESQUISA')
      .in('conversa_id', ids).gte('criado_em', new Date(Date.now() - 7 * DIA).toISOString()).limit(1000);
    recentes = new Set((ja || []).map((d) => d.conversa_id));
  }
  return inserirDisparos(supabaseAdmin, (data || []).filter((c) => c.resolvida_em && !recentes.has(c.id)).map((c) => ({
    hotel_id: a.hotel_id, automacao_id: a.id, tipo: a.tipo, chave: `pesq:${c.id}:${new Date(c.resolvida_em).getTime()}`,
    conversa_id: c.id, contato_id: c.contato_id, dados: { responsavel_id: c.responsavel_id },
    agendado_para: new Date(new Date(c.resolvida_em).getTime() + (Number(a.espera_minutos) || 0) * MIN).toISOString(),
  })));
}

function hospedesDe(r) {
  const lista = r.guestList || r.guests || {};
  return Array.isArray(lista) ? lista : Object.values(lista);
}

// Consultas na Cloudbeds por dia (véspera, lembrete da ficha, dia da saída,
// depois da saída): qual data olhar e quais situações da reserva valem
const MODOS_CLOUDBEDS = {
  PRE_CHECKIN: { prefixo: 'pre', campo: 'in', sinal: 1, validos: ['confirmed', 'not_confirmed'] },
  FICHA_VESPERA: { prefixo: 'fic', campo: 'in', sinal: 1, validos: ['confirmed', 'not_confirmed'] },
  UPGRADE: { prefixo: 'upg', campo: 'in', sinal: 1, validos: ['confirmed', 'not_confirmed'] },
  POS_CHECKOUT: { prefixo: 'pos', campo: 'out', sinal: -1, validos: ['checked_out'] },
  DIA_SAIDA: { prefixo: 'sd', campo: 'out', sinal: 0, validos: ['checked_in'] },
  BOAS_VINDAS: { prefixo: 'bv', campo: 'in', sinal: 0, validos: ['checked_in'] },
};

async function reservasDaCloudbeds(cb, params) {
  const reservas = [];
  for (let pagina = 1; pagina <= 3; pagina += 1) {
    const r = await chamarCloudbeds(cb, 'getReservations', { verbo: 'GET', params: { ...params, includeGuestsDetails: 'true', pageSize: '100', pageNumber: String(pagina) } });
    const lista = Array.isArray(r?.data) ? r.data : [];
    reservas.push(...lista);
    if (lista.length < 100) break;
  }
  return reservas;
}

// Reserva da Cloudbeds → linha de disparo (sem celular com DDD: não há para quem mandar)
function disparoDaReserva(a, r, prefixo, quando) {
  const hospedes = hospedesDe(r);
  const principal = hospedes.find((h) => h.isMainGuest) || hospedes[0] || {};
  const fone = normalizarNumero(principal.guestCellPhone || principal.guestPhone || r.guestCellPhone || r.guestPhone || '');
  if (!celularValido(fone)) return null;
  return {
    hotel_id: a.hotel_id, automacao_id: a.id, tipo: a.tipo, chave: `${prefixo}:${r.reservationID}`,
    reserva_id: String(r.reservationID), telefone: fone,
    nome: r.guestName || [principal.guestFirstName, principal.guestLastName].filter(Boolean).join(' ') || null,
    dados: { checkin: r.startDate, checkout: r.endDate, adultos: r.adults, criancas: r.children, pais: principal.guestCountry || r.guestCountry || null },
    agendado_para: quando,
  };
}

// Uma consulta por dia, na hora do envio
async function agendarPelaCloudbeds(supabaseAdmin, a, ctx) {
  const hoje = hojeLocal();
  if (a.config?.ultimo_dia === hoje) return 0;
  // Consulta na hora do envio (ex.: 08:00), e não de madrugada: assim entram
  // também as reservas feitas até essa hora
  const horaEnvio = /^\d\d:\d\d$/.test(a.config?.hora || '') ? a.config.hora : (AUTOMACAO_POR_TIPO[a.tipo]?.configPadrao?.hora || '08:00');
  if (partes().hhmm < horaEnvio) return 0;
  const modo = MODOS_CLOUDBEDS[a.tipo];
  const dias = modo.sinal === 0 ? 0 : Math.max(0, Number(a.config?.dias ?? 1));
  const alvo = hojeLocal(modo.sinal * dias);
  let cb;
  try { cb = await ctx.cloudbeds(a.hotel_id); } catch (e) { return 0; }
  const params = modo.campo === 'in'
    ? { checkInFrom: alvo, checkInTo: alvo }
    : { checkOutFrom: alvo, checkOutTo: alvo };
  const reservas = await reservasDaCloudbeds(cb, params);
  const quando = new Date().toISOString();
  const linhas = reservas.filter((r) => !r.status || modo.validos.includes(r.status))
    .map((r) => disparoDaReserva(a, r, modo.prefixo, quando)).filter(Boolean);
  const n = await inserirDisparos(supabaseAdmin, linhas);
  await supabaseAdmin.from('atendimento_automacoes').update({ config: { ...(a.config || {}), ultimo_dia: hoje } }).eq('id', a.id);
  return n;
}

// Aniversário e reativação (M20): uma vez por dia, na hora marcada, pela ficha
// de hóspede (funções do banco: só nome, telefone e a última estadia).
// Chave por telefone e ano: a mesma pessoa recebe no máximo 1 vez por ano.
async function agendarPelaFicha(supabaseAdmin, a) {
  const hoje = hojeLocal();
  if (a.config?.ultimo_dia === hoje) return 0;
  const horaEnvio = /^\d\d:\d\d$/.test(a.config?.hora || '') ? a.config.hora : (AUTOMACAO_POR_TIPO[a.tipo]?.configPadrao?.hora || '10:00');
  if (partes().hhmm < horaEnvio) return 0;
  const ano = hoje.slice(0, 4);
  const { data, error } = a.tipo === 'ANIVERSARIO'
    ? await supabaseAdmin.rpc('atendimento_aniversariantes', { p_hotel: a.hotel_id, p_dia: hoje })
    : await supabaseAdmin.rpc('atendimento_para_reativar', { p_hotel: a.hotel_id, p_de: hojeLocal(-395), p_ate: hojeLocal(-365) });
  if (error) throw new Error(/function|atendimento_(aniversariantes|para_reativar)/i.test(error.message) ? 'falta o SQL da Etapa 4 (sql/clientes_etapa4.sql)' : error.message);
  const quando = new Date().toISOString();
  const vistos = new Set();
  const linhas = [];
  for (const p of data || []) {
    const fone = normalizarNumero(p.telefone || '');
    if (!celularValido(fone) || vistos.has(fone)) continue;
    vistos.add(fone);
    linhas.push({
      hotel_id: a.hotel_id, automacao_id: a.id, tipo: a.tipo, chave: `${a.tipo === 'ANIVERSARIO' ? 'aniv' : 'reat'}:${ano}:${fone}`,
      telefone: fone, nome: p.nome || null, dados: { ultima: p.ultima || null }, agendado_para: quando,
    });
  }
  const n = await inserirDisparos(supabaseAdmin, linhas);
  await supabaseAdmin.from('atendimento_automacoes').update({ config: { ...(a.config || {}), ultimo_dia: hoje } }).eq('id', a.id);
  return n;
}

// Boas-vindas: olha a Cloudbeds a cada 20 minutos (check-ins de ontem e de
// hoje: quem entrou tarde da noite recebe de manhã, no horário de envio)
const BOAS_VINDAS_INTERVALO_MIN = 20;
async function agendarBoasVindas(supabaseAdmin, a, ctx) {
  const ultima = a.config?.ultima_consulta ? new Date(a.config.ultima_consulta).getTime() : 0;
  if (Date.now() - ultima < BOAS_VINDAS_INTERVALO_MIN * MIN) return 0;
  let cb;
  try { cb = await ctx.cloudbeds(a.hotel_id); } catch (e) { return 0; }
  const reservas = await reservasDaCloudbeds(cb, { checkInFrom: hojeLocal(-1), checkInTo: hojeLocal(), status: 'checked_in' });
  const ligado = new Date(a.ligado_em || 0).getTime();
  const quando = new Date(Date.now() + (Number(a.espera_minutos) || 0) * MIN).toISOString();
  const linhas = reservas.filter((r) => r.status === 'checked_in' && r.endDate > hojeLocal())
    // Ao ligar, quem já estava hospedado antes não recebe
    .filter((r) => !r.startDate || momentoLocal(r.startDate, '23:59').getTime() >= ligado)
    .map((r) => disparoDaReserva(a, r, 'bv', quando)).filter(Boolean);
  const n = await inserirDisparos(supabaseAdmin, linhas);
  await supabaseAdmin.from('atendimento_automacoes').update({ config: { ...(a.config || {}), ultima_consulta: new Date().toISOString() } }).eq('id', a.id);
  return n;
}

// "HH:MM" − minutos
function horaMenos(hhmm, minutos) {
  const [h, m] = String(hhmm).split(':').map(Number);
  const t = Math.max(0, h * 60 + m - minutos);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

// Retomada: hora de mandar. Se cair fora do horário de envio, adianta para o
// fim do horário anterior (para ainda pegar a janela de 24 h aberta), desde
// que fique pelo menos 3 h depois da última mensagem do cliente
export function horarioDaRetomada(entradaEm, esperaMin, a) {
  const entrada = new Date(entradaEm).getTime();
  const alvo = new Date(entrada + esperaMin * MIN);
  if (!proximoHorarioPermitido(a, alvo)) return alvo;
  const ini = a.janela_inicio || '08:00';
  const fim = a.janela_fim || '21:00';
  const { dia, hhmm } = partes(alvo);
  const diaAntes = hhmm < ini ? partes(new Date(alvo.getTime() - DIA)).dia : dia;
  const antes = momentoLocal(diaAntes, horaMenos(fim, 15));
  if (antes.getTime() >= entrada + 3 * HORA && antes.getTime() < alvo.getTime()) return antes;
  return alvo; // vai no próximo horário de envio (com modelo, se a janela fechar)
}

// Conversas paradas: o cliente escreveu, o hotel respondeu e faz pelo menos
// 1 hora que ninguém fala (cada nova mensagem do cliente gera um disparo novo
// e cancela o anterior)
async function agendarRetomadas(supabaseAdmin, a) {
  const espera = Number(a.espera_minutos) || 0;
  const { data } = await supabaseAdmin.from('atendimento_conversas')
    .select('id, contato_id, ultima_entrada_em, ultima_mensagem_em, status, canal_tipo, cloudbeds_reservation_id')
    .eq('hotel_id', a.hotel_id).eq('canal_tipo', 'WHATSAPP').in('status', ['ABERTA', 'PENDENTE'])
    .gte('ultima_entrada_em', desdeDe(a, 2)).limit(500);
  const paradas = (data || []).filter((c) => c.ultima_entrada_em && !c.cloudbeds_reservation_id
    && Date.now() - new Date(c.ultima_mensagem_em || c.ultima_entrada_em).getTime() >= HORA);
  if (!paradas.length) return 0;
  const linhas = paradas.map((c) => ({
    hotel_id: a.hotel_id, automacao_id: a.id, tipo: a.tipo, chave: `ret:${c.id}:${new Date(c.ultima_entrada_em).getTime()}`,
    conversa_id: c.id, contato_id: c.contato_id, dados: { entrada_em: c.ultima_entrada_em },
    agendado_para: horarioDaRetomada(c.ultima_entrada_em, espera, a).toISOString(),
  }));
  const n = await inserirDisparos(supabaseAdmin, linhas);
  if (n) {
    // O cliente voltou a escrever: a retomada da mensagem anterior não vale mais
    for (const l of linhas) {
      await supabaseAdmin.from('atendimento_disparos').update({ situacao: 'CANCELADO', motivo: 'o cliente voltou a conversar', atualizado_em: new Date().toISOString() })
        .eq('automacao_id', a.id).eq('conversa_id', l.conversa_id).eq('situacao', 'AGENDADO').neq('chave', l.chave);
    }
  }
  return n;
}

async function agendar(supabaseAdmin, a, ctx) {
  switch (a.tipo) {
    case 'FUP_RESERVAR': return agendarCotacoes(supabaseAdmin, a, { status: 'CLICOU', campoData: 'primeiro_clique_em' });
    case 'FUP_COTACAO': return agendarCotacoes(supabaseAdmin, a, { status: 'ENVIADA', campoData: 'criado_em' });
    case 'OFERTA': return agendarOfertas(supabaseAdmin, a);
    case 'SEM_DISPONIBILIDADE': return agendarSemDisponibilidade(supabaseAdmin, a);
    case 'GRUPO': return agendarGrupos(supabaseAdmin, a);
    case 'CONFIRMACAO_RESERVA': return agendarConfirmacoes(supabaseAdmin, a);
    case 'PESQUISA': return agendarPesquisas(supabaseAdmin, a);
    case 'RETOMADA': return agendarRetomadas(supabaseAdmin, a);
    case 'BOAS_VINDAS': return agendarBoasVindas(supabaseAdmin, a, ctx);
    default:
      if (AUTOMACOES_POR_HORA.includes(a.tipo)) return agendarPelaCloudbeds(supabaseAdmin, a, ctx);
      if (AUTOMACOES_DA_FICHA.includes(a.tipo)) return agendarPelaFicha(supabaseAdmin, a);
      return 0;
  }
}

// ============================================================================
// 2) ENVIAR
// ============================================================================
// Mensagens de quem tem reserva (não entram na retomada de venda)
// Resposta à nota da estadia, no idioma do hóspede (M7)
const RESPOSTA_NOTA = {
  pt: { baixa: 'Obrigado pela sinceridade. Sentimos muito que a estadia não foi como você esperava: um responsável do hotel vai falar com você.', boa: 'Obrigado pela avaliação! 😊' },
  en: { baixa: 'Thank you for your honesty. We are very sorry your stay was not what you expected: a hotel manager will contact you.', boa: 'Thank you for your rating! 😊' },
  es: { baixa: 'Gracias por su sinceridad. Lamentamos mucho que la estadía no haya sido como esperaba: un responsable del hotel se comunicará con usted.', boa: '¡Gracias por su evaluación! 😊' },
};
const TIPOS_HOSPEDE = ['CONFIRMACAO_RESERVA', 'PRE_CHECKIN', 'FICHA_VESPERA', 'UPGRADE', 'BOAS_VINDAS', 'DIA_SAIDA', 'POS_CHECKOUT'];

// Idioma do cliente para escolher o modelo traduzido (M7): o da conversa,
// o das últimas mensagens dele, o país da reserva na Cloudbeds, ou português
async function idiomaDoDisparo(supabaseAdmin, d, conversa) {
  if (conversa?.idioma) return conversa.idioma;
  if (conversa?.id) {
    const { data } = await supabaseAdmin.from('atendimento_mensagens').select('texto').eq('conversa_id', conversa.id).eq('direcao', 'ENTRADA')
      .order('criado_em', { ascending: false }).limit(5);
    const visto = detectarIdioma((data || []).map((m) => m.texto).reverse());
    if (visto) return visto;
  }
  return idiomaDoPais(d?.dados?.pais) || 'pt';
}

// "R$ 80" a partir do que foi digitado ("80", "80,50")
const precoTela = (v) => { const n = Number(String(v ?? '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : null; };
const normalNome = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Upgrade na véspera (M19): o que dá para oferecer nesta reserva
// Texto da oferta no idioma do modelo que vai ser usado (português, inglês, espanhol)
const FRASES_OFERTA = {
  pt: { up: (q, p) => `upgrade para o ${q} por ${p} por noite`, late: (h, p) => `late check-out até as ${h} por ${p}`, ou: ' ou ' },
  en: { up: (q, p) => `upgrade to the ${q} for ${p} per night`, late: (h, p) => `late check-out until ${h} for ${p}`, ou: ' or ' },
  es: { up: (q, p) => `upgrade a la habitación ${q} por ${p} por noche`, late: (h, p) => `late check-out hasta las ${h} por ${p}`, ou: ' o ' },
};
export function textoDaOferta(ofertas, idioma = 'pt') {
  const f = FRASES_OFERTA[idioma] || FRASES_OFERTA.pt;
  const partes = [];
  if (ofertas?.upgrade) partes.push(f.up(ofertas.upgrade.quarto, reais(ofertas.upgrade.preco)));
  if (ofertas?.late) partes.push(f.late(idioma === 'en' ? ofertas.late.hora : ofertas.late.hora.replace(':00', 'h').replace(':', 'h'), reais(ofertas.late.preco)));
  return partes.join(f.ou);
}
async function ofertaDeUpgrade(cb, a, d, info, idioma = 'pt') {
  const cfg = a.config || {};
  const precoUp = precoTela(cfg.upgrade_preco);
  const precoLate = precoTela(cfg.late_preco);
  const ofertas = {};
  if (precoUp && cfg.upgrade_quarto) {
    const alvo = normalNome(cfg.upgrade_quarto);
    const det = (await chamarCloudbeds(cb, 'getReservation', { verbo: 'GET', params: { reservationID: d.reserva_id } }))?.data || {};
    const quartos = [...(det.assigned || []), ...(det.unassigned || [])];
    const jaTem = quartos.some((q) => normalNome(q.roomTypeName) === alvo);
    if (!jaTem) {
      const r = await chamarCloudbeds(cb, 'getAvailableRoomTypes', { verbo: 'GET', params: { startDate: info.checkin, endDate: info.checkout, rooms: 1, adults: 1, children: 0, detailedRates: 'false' } });
      const dados = Array.isArray(r?.data) ? r.data : (r?.data ? [r.data] : []);
      const livre = dados.flatMap((x) => x.propertyRooms || []).some((q) => normalNome(q.roomTypeName) === alvo && Number(q.roomsAvailable) > 0);
      if (livre) ofertas.upgrade = { quarto: cfg.upgrade_quarto, preco: precoUp };
    }
  }
  if (precoLate) {
    const hora = /^\d\d:\d\d$/.test(cfg.late_hora || '') ? cfg.late_hora : '14:00';
    ofertas.late = { hora, preco: precoLate };
  }
  return { texto: textoDaOferta(ofertas, idioma), ofertas };
}

// Texto da mensagem normal: {nome}, {hotel}… Sem o nome, "Oi, !" vira "Oi!"
export function montarTextoLivre(modelo, dados) {
  return String(modelo || '').replace(/\{(\w+)\}/g, (_, k) => dados?.[k] ?? '')
    .replace(/,\s*([!?.])/g, '$1').replace(/[ \t]+([!?.,])/g, '$1').replace(/[ \t]{2,}/g, ' ').trim();
}

// Confere se ainda faz sentido mandar e junta os dados das variáveis.
// Devolve { ok, dados } | { pular: motivo } | { reagendar: Date, motivo }
async function conferir(supabaseAdmin, d, a, conversa, ctx) {
  const base = { hotel: ctx.nomeHotel(a.hotel_id), nome: primeiroNome(d.nome || conversa?.contato_nome), nome_completo: d.nome || conversa?.contato_nome || '' };
  const emAndamento = async () => {
    if (!conversa) return false;
    const ult = await ultimaMensagem(supabaseAdmin, conversa.id);
    return ult && Date.now() - new Date(ult.criado_em).getTime() < CONVERSA_EM_ANDAMENTO_MIN * MIN;
  };

  if (['FUP_RESERVAR', 'FUP_COTACAO', 'SEM_DISPONIBILIDADE', 'OFERTA'].includes(d.tipo)) {
    const { data: cot } = await supabaseAdmin.from('atendimento_cotacoes').select('*').eq('id', d.cotacao_id).maybeSingle();
    if (!cot) return { pular: 'a cotação não existe mais' };
    const dadosCot = {
      // Cotação de outro hotel do grupo: a mensagem fala do hotel cotado
      ...base, ...(cot.hotel_cotado_id ? { hotel: ctx.nomeHotel(cot.hotel_cotado_id) || base.hotel } : {}),
      checkin: dataBR(cot.checkin), checkout: dataBR(cot.checkout), noites: noitesEntre(cot.checkin, cot.checkout),
      pessoas: pessoasTexto(cot.adultos, cot.criancas), valor: cot.valor_minimo ? reais(cot.valor_minimo) : '',
      link_reservar: `${ctx.origem}/r/${cot.codigo}-0`,
      link_cotacao: `${ctx.origem}/r/${cot.codigo}-0`,
    };
    if (await jaReservou(supabaseAdmin, conversa)) return { pular: 'o cliente já reservou' };
    if (d.tipo === 'OFERTA') {
      if (!['ENVIADA', 'CLICOU'].includes(cot.status)) return { pular: cot.status === 'RESERVOU' ? 'o cliente já reservou' : 'a cotação mudou' };
      if (cot.oferta_em) return { pular: 'a oferta já foi enviada para esta cotação' };
      if (cot.checkin <= hojeLocal()) return { pular: 'a data de entrada já chegou' };
      const beneficio = String(a.config?.beneficio || '').trim();
      if (!beneficio) return { pular: 'falta escrever o benefício da oferta' };
      if (await clienteEscreveuDepois(supabaseAdmin, conversa?.id, cot.criado_em)) return { pular: 'o cliente voltou a conversar' };
      if (await emAndamento()) return { pular: 'conversa em andamento' };
      if (ctx.consultas >= MAX_CONSULTAS_CLOUDBEDS) return { reagendar: new Date(Date.now() + 5 * MIN), motivo: 'aguardando a vez de consultar a Cloudbeds', semContar: true };
      ctx.consultas += 1;
      const hotelDaCotacao = cot.hotel_cotado_id || a.hotel_id;
      const o = await ocupacaoDasDatas(supabaseAdmin, await ctx.cloudbeds(hotelDaCotacao), hotelDaCotacao, cot.checkin, cot.checkout);
      const limite = Number(a.config?.ocupacao_max ?? 60);
      if (!o.livres) return { pular: 'não há mais vaga nessas datas' };
      if (o.ocupacao === null) return { pular: 'não deu para saber a ocupação (cadastre os quartos na Governança)' };
      if (o.ocupacao >= limite) return { pular: `ocupação de ${o.ocupacao}% nessas datas (a oferta só vai abaixo de ${limite}%)` };
      return {
        ok: true, dados: { ...dadosCot, beneficio: beneficio.slice(0, 120) },
        nota: `🎁 Oferta: “${beneficio}” (ocupação ${o.ocupacao}%). Se o cliente reservar, a recepção vê o benefício na tela de chegadas.`,
        depois: async () => { await supabaseAdmin.from('atendimento_cotacoes').update({ oferta_em: new Date().toISOString(), oferta_beneficio: beneficio.slice(0, 120) }).eq('id', cot.id); },
      };
    }
    if (d.tipo === 'FUP_RESERVAR') {
      if (cot.status !== 'CLICOU') return { pular: cot.status === 'RESERVOU' ? 'o cliente já reservou' : 'a cotação mudou' };
      if (await emAndamento()) return { pular: 'conversa em andamento' };
      return { ok: true, dados: dadosCot };
    }
    if (d.tipo === 'FUP_COTACAO') {
      if (cot.status !== 'ENVIADA') return { pular: cot.status === 'CLICOU' ? 'o cliente já clicou em Reservar agora' : 'o cliente já reservou' };
      if (await clienteEscreveuDepois(supabaseAdmin, conversa?.id, cot.criado_em)) return { pular: 'o cliente voltou a conversar' };
      if (await emAndamento()) return { pular: 'conversa em andamento' };
      return { ok: true, dados: dadosCot };
    }
    // Lista de espera: abriu vaga?
    if (cot.checkin <= hojeLocal()) return { pular: 'a data de entrada já chegou e não abriu vaga' };
    if (Date.now() - new Date(cot.criado_em).getTime() > SEM_DISP_MAX_DIAS * DIA) return { pular: `não abriu vaga em ${SEM_DISP_MAX_DIAS} dias` };
    if (ctx.consultas >= MAX_CONSULTAS_CLOUDBEDS) return { reagendar: new Date(Date.now() + 5 * MIN), motivo: 'aguardando a vez de consultar a Cloudbeds', semContar: true };
    ctx.consultas += 1;
    const cb = await ctx.cloudbeds(a.hotel_id);
    const r = await buscarDisponibilidade(cb, { checkin: cot.checkin, checkout: cot.checkout, adultos: cot.adultos, criancas: cot.criancas, quartos: cot.quartos || 1 });
    const proxima = new Date(Date.now() + Math.max(Number(a.config?.reverificar_horas) || 6, 1) * HORA);
    if (!r.itens.length) return { reagendar: proxima, motivo: 'ainda sem quarto; vai consultar de novo', semContar: true };
    const motor = await linkDoMotor(supabaseAdmin, cb, a.hotel_id);
    return {
      ok: true,
      dados: { ...dadosCot, valor: reais(r.itens[0].total), link_reservar: montarLinkMotor(motor, { checkin: cot.checkin, checkout: cot.checkout, adultos: cot.adultos, criancas: cot.criancas }) || dadosCot.link_reservar },
      nota: `🔔 Abriu vaga para ${dataBR(cot.checkin)} a ${dataBR(cot.checkout)} (a partir de ${reais(r.itens[0].total)}).`,
    };
  }

  if (d.tipo === 'GRUPO') {
    const desde = d.dados?.criado_em || d.criado_em;
    if (d.dados?.solicitacao_id) {
      const { data: sol } = await supabaseAdmin.from('atendimento_solicitacoes').select('*').eq('id', d.dados.solicitacao_id).maybeSingle();
      if (!sol) return { pular: 'o pedido de grupo não existe mais' };
      if (sol.resultado === 'FECHOU') return { pular: 'o grupo já fechou' };
      if (sol.resultado === 'NAO_FECHOU') return { pular: 'o grupo foi marcado como “não fechou”' };
      if (sol.situacao === 'CONCLUIDA') return { pular: 'o pedido de grupo já foi concluído' };
    }
    if (await jaReservou(supabaseAdmin, conversa)) return { pular: 'o cliente já reservou' };
    if (await clienteEscreveuDepois(supabaseAdmin, conversa?.id, desde)) return { pular: 'o cliente voltou a conversar' };
    if (await emAndamento()) return { pular: 'conversa em andamento' };
    return { ok: true, dados: { ...base, checkin: dataBR(d.dados?.checkin), checkout: dataBR(d.dados?.checkout), pessoas: d.dados?.pessoas || '' } };
  }

  if (d.tipo === 'RETOMADA') {
    if (!conversa) return { pular: 'a conversa não existe mais' };
    if (['RESOLVIDA', 'ARQUIVADA'].includes(conversa.status)) return { pular: 'a conversa foi resolvida ou arquivada' };
    if (await clienteEscreveuDepois(supabaseAdmin, conversa.id, d.dados?.entrada_em || d.criado_em)) return { pular: 'o cliente voltou a conversar' };
    const ult = await ultimaMensagem(supabaseAdmin, conversa.id);
    if (ult?.direcao === 'ENTRADA') return { pular: 'o cliente está esperando resposta da equipe' };
    if (conversa.cloudbeds_reservation_id || await jaReservou(supabaseAdmin, conversa)) return { pular: 'o cliente já tem reserva' };
    const ha = (dias) => new Date(Date.now() - dias * DIA).toISOString();
    const { data: cot } = await supabaseAdmin.from('atendimento_cotacoes').select('id').eq('conversa_id', conversa.id).gte('criado_em', ha(30)).limit(1);
    if (cot?.length) return { pular: 'o cliente já recebeu cotação (quem cuida é o lembrete da cotação)' };
    const { data: grupo } = await supabaseAdmin.from('atendimento_solicitacoes').select('id').eq('conversa_id', conversa.id).eq('tipo', 'GRUPO').gte('criado_em', ha(30)).limit(1);
    if (grupo?.length) return { pular: 'o cliente pediu cotação de grupo' };
    const { data: hospede } = await supabaseAdmin.from('atendimento_disparos').select('id').eq('conversa_id', conversa.id).eq('situacao', 'ENVIADO')
      .in('tipo', TIPOS_HOSPEDE).gte('enviado_em', ha(60)).limit(1);
    if (hospede?.length) return { pular: 'é hóspede (já recebeu mensagem da reserva)' };
    const { data: antes } = await supabaseAdmin.from('atendimento_disparos').select('id').eq('conversa_id', conversa.id).eq('tipo', 'RETOMADA')
      .eq('situacao', 'ENVIADO').gte('enviado_em', ha(7)).limit(1);
    if (antes?.length) return { pular: 'já recebeu uma retomada nesta semana' };
    return { ok: true, dados: base };
  }

  if (TIPOS_HOSPEDE.includes(d.tipo)) {
    let info = d.dados || {};
    if (d.tipo === 'CONFIRMACAO_RESERVA' || !info.checkin) {
      try {
        const cb = await ctx.cloudbeds(a.hotel_id);
        const r = await chamarCloudbeds(cb, 'getReservation', { verbo: 'GET', params: { reservationID: d.reserva_id } });
        const x = r?.data || {};
        if (x.status === 'canceled') return { pular: 'a reserva foi cancelada' };
        info = { checkin: x.startDate, checkout: x.endDate, total: x.total, adultos: x.adults, criancas: x.children, status: x.status };
      } catch (e) { /* segue com o que tem */ }
    }
    if (d.tipo === 'BOAS_VINDAS' && info.checkout && String(info.checkout).slice(0, 10) <= hojeLocal()) return { pular: 'o hóspede já está saindo (dia do check-out)' };
    // Lembrete da ficha: só para quem ainda não preencheu; ligado, ele vai no
    // lugar da mensagem da véspera (uma mensagem só por hóspede)
    if (d.tipo === 'FICHA_VESPERA' || d.tipo === 'PRE_CHECKIN') {
      const lembreteLigado = d.tipo === 'FICHA_VESPERA' || await ctx.lembreteFichaLigado(a.hotel_id);
      if (lembreteLigado) {
        const preencheu = await fichaPreenchida(supabaseAdmin, a.hotel_id, d.reserva_id, { nome: d.nome, checkin: info.checkin });
        if (d.tipo === 'FICHA_VESPERA' && preencheu) return { pular: 'o hóspede já preencheu a ficha (vai a mensagem normal da véspera)' };
        if (d.tipo === 'PRE_CHECKIN' && !preencheu) return { pular: 'falta a ficha: vai o lembrete da ficha no lugar desta' };
      }
    }
    if (d.tipo === 'UPGRADE') {
      if (!info.checkin || !info.checkout) return { pular: 'sem as datas da reserva' };
      if (ctx.consultas >= MAX_CONSULTAS_CLOUDBEDS) return { reagendar: new Date(Date.now() + 5 * MIN), motivo: 'aguardando a vez de consultar a Cloudbeds', semContar: true };
      ctx.consultas += 1;
      // Inglês/espanhol só se houver o modelo traduzido (senão a mensagem vai em português)
      const idiomaCliente = await idiomaDoDisparo(supabaseAdmin, d, conversa);
      const idiomaOferta = a.config?.modelos_idioma?.[idiomaCliente] ? idiomaCliente : 'pt';
      const o = await ofertaDeUpgrade(await ctx.cloudbeds(a.hotel_id), a, d, info, idiomaOferta);
      o.textoPt = textoDaOferta(o.ofertas, 'pt');
      if (!o.texto) return { pular: 'nada para oferecer (sem vaga no quarto melhor e sem preço de late check-out)' };
      info.oferta = o;
    }
    return {
      ok: true,
      ...(info.oferta ? {
        nota: `🛎️ Oferta da véspera: ${info.oferta.textoPt || info.oferta.texto}.`,
        depois: async () => { await supabaseAdmin.from('atendimento_disparos').update({ dados: { ...(d.dados || {}), ofertas: info.oferta.ofertas } }).eq('id', d.id); },
      } : {}),
      dados: {
        ...base, checkin: dataBR(info.checkin), checkout: dataBR(info.checkout), noites: info.checkin && info.checkout ? noitesEntre(info.checkin, info.checkout) : '',
        oferta_upgrade: info.oferta?.texto || '',
        numero_reserva: d.reserva_id || '', valor: info.total ? reais(Number(info.total)) : '', pessoas: pessoasTexto(info.adultos, info.criancas),
        link_ficha: d.reserva_id ? linkFicha(ctx.origem, a.hotel_id, d.reserva_id) : '',
      },
    };
  }

  if (AUTOMACOES_DA_FICHA.includes(d.tipo)) {
    // Quem conversou com o hotel nos últimos 30 dias não recebe a reativação
    if (d.tipo === 'REATIVACAO' && d.telefone) {
      const { data: recente } = await supabaseAdmin.from('atendimento_conversas').select('id').eq('hotel_id', a.hotel_id).eq('chave_externa', d.telefone)
        .gte('ultima_mensagem_em', new Date(Date.now() - 30 * DIA).toISOString()).limit(1);
      if (recente?.length) return { pular: 'conversou com o hotel nos últimos 30 dias' };
    }
    return { ok: true, dados: base };
  }

  if (d.tipo === 'PESQUISA') {
    if (!conversa || conversa.status !== 'RESOLVIDA') return { pular: 'a conversa foi reaberta' };
    const { data: anterior } = await supabaseAdmin.from('atendimento_disparos').select('id').eq('conversa_id', conversa.id).eq('tipo', 'PESQUISA')
      .eq('situacao', 'ENVIADO').gte('enviado_em', new Date(Date.now() - 7 * DIA).toISOString()).limit(1);
    if (anterior?.length) return { pular: 'já recebeu uma pesquisa nos últimos 7 dias' };
    const respId = d.dados?.responsavel_id || conversa.responsavel_id;
    return { ok: true, dados: { ...base, atendente: respId ? ctx.nomePessoa(respId) : '' } };
  }
  return { pular: 'tipo desconhecido' };
}

async function canalParaEnviar(supabaseAdmin, a, conversa) {
  if (conversa?.canal_tipo === 'WHATSAPP' && conversa.canal_id) {
    const { data } = await supabaseAdmin.from('atendimento_canais').select('*').eq('id', conversa.canal_id).maybeSingle();
    if (data?.ativo) return data;
  }
  if (a.canal_id) {
    const { data } = await supabaseAdmin.from('atendimento_canais').select('*').eq('id', a.canal_id).maybeSingle();
    if (data?.ativo && data.tipo === 'WHATSAPP') return data;
  }
  const { data } = await supabaseAdmin.from('atendimento_canais').select('*').eq('hotel_id', a.hotel_id).eq('tipo', 'WHATSAPP').eq('ativo', true).order('id').limit(1).maybeSingle();
  return data || null;
}

async function telefoneDoContato(supabaseAdmin, d, conversa) {
  if (d.telefone) return d.telefone;
  if (conversa?.canal_tipo === 'WHATSAPP') return conversa.chave_externa;
  const contatoId = d.contato_id || conversa?.contato_id;
  if (!contatoId) return null;
  const { data } = await supabaseAdmin.from('atendimento_contatos').select('telefone').eq('id', contatoId).maybeSingle();
  return data?.telefone || null;
}

async function contatoNaoQuer(supabaseAdmin, d, conversa, telefone) {
  const ids = [d.contato_id, conversa?.contato_id].filter(Boolean);
  if (ids.length) {
    const { data } = await supabaseAdmin.from('atendimento_contatos').select('id').in('id', ids).eq('sem_automacoes', true).limit(1);
    if (data?.length) return true;
  }
  if (telefone) {
    const { data } = await supabaseAdmin.from('atendimento_contatos').select('id').eq('hotel_id', d.hotel_id).eq('telefone', telefone).eq('sem_automacoes', true).limit(1);
    if (data?.length) return true;
  }
  return false;
}

async function atualizarDisparo(supabaseAdmin, id, campos) {
  await supabaseAdmin.from('atendimento_disparos').update({ ...campos, atualizado_em: new Date().toISOString() }).eq('id', id);
}

const JANELA_24H = 24 * HORA;

// Envia um disparo (ou explica por que não). Também usado no teste da tela.
async function processarDisparo(supabaseAdmin, d, a, ctx) {
  if (!a?.ativo) return atualizarDisparo(supabaseAdmin, d.id, { situacao: 'CANCELADO', motivo: 'a automação foi desligada' });

  // Horário de envio e limite do dia
  const proximo = proximoHorarioPermitido(a);
  if (proximo) return atualizarDisparo(supabaseAdmin, d.id, { agendado_para: proximo.toISOString(), motivo: 'fora do horário de envio; reagendado' });
  const inicioDia = momentoLocal(hojeLocal(), '00:00').toISOString();
  const { count } = await supabaseAdmin.from('atendimento_disparos').select('id', { count: 'exact', head: true })
    .eq('automacao_id', a.id).eq('situacao', 'ENVIADO').gte('enviado_em', inicioDia);
  if ((count || 0) >= (Number(a.limite_dia) || 100)) {
    return atualizarDisparo(supabaseAdmin, d.id, { agendado_para: momentoLocal(hojeLocal(1), a.janela_inicio || '08:00').toISOString(), motivo: 'limite do dia atingido; reagendado' });
  }

  let conversa = null;
  if (d.conversa_id) {
    const { data } = await supabaseAdmin.from('atendimento_conversas').select('*').eq('id', d.conversa_id).maybeSingle();
    conversa = data;
  }
  const telefone = await telefoneDoContato(supabaseAdmin, d, conversa);
  if (!telefone) return atualizarDisparo(supabaseAdmin, d.id, { situacao: 'PULADO', motivo: 'o cliente não tem WhatsApp cadastrado' });
  if (await contatoNaoQuer(supabaseAdmin, d, conversa, telefone)) return atualizarDisparo(supabaseAdmin, d.id, { situacao: 'PULADO', motivo: 'o cliente pediu para não receber mensagens automáticas' });

  let r;
  try { r = await conferir(supabaseAdmin, d, a, conversa, ctx); }
  catch (e) { return atualizarDisparo(supabaseAdmin, d.id, { agendado_para: new Date(Date.now() + 30 * MIN).toISOString(), motivo: `erro ao conferir (${String(e.message || e).slice(0, 150)}); tenta de novo` }); }
  if (r.pular) return atualizarDisparo(supabaseAdmin, d.id, { situacao: 'PULADO', motivo: r.pular });
  if (r.reagendar) return atualizarDisparo(supabaseAdmin, d.id, { agendado_para: r.reagendar.toISOString(), motivo: r.motivo });

  const canal = await canalParaEnviar(supabaseAdmin, a, conversa);
  if (!canal) return atualizarDisparo(supabaseAdmin, d.id, { situacao: 'FALHOU', motivo: 'nenhum número de WhatsApp ligado no hotel' });

  // Conversa do WhatsApp com esse número (a do e-mail não serve para mandar WhatsApp).
  // Hóspede da Cloudbeds que já conversou com o hotel: usa a conversa dele
  let conversaWhats = conversa?.canal_tipo === 'WHATSAPP' && conversa.canal_id === canal.id ? conversa : null;
  if (!conversaWhats && !conversa && d.telefone) {
    const { data: existente } = await supabaseAdmin.from('atendimento_conversas').select('*').eq('canal_id', canal.id).eq('chave_externa', d.telefone).maybeSingle();
    if (existente) conversaWhats = existente;
  }
  const janelaAberta = conversaWhats?.ultima_entrada_em && Date.now() - new Date(conversaWhats.ultima_entrada_em).getTime() < JANELA_24H - 10 * MIN;

  let envio;
  const autor = { id: null };
  const def = AUTOMACAO_POR_TIPO[a.tipo];
  const temTraducao = a.config?.modelos_idioma && Object.keys(a.config.modelos_idioma).length > 0;
  const idiomaTexto = temTraducao ? await idiomaDoDisparo(supabaseAdmin, d, conversaWhats || conversa) : 'pt';
  if (def?.textoLivre && janelaAberta && String(a.texto_livre || '').trim() && (idiomaTexto === 'pt' || !a.config?.modelos_idioma?.[idiomaTexto])) {
    // Conversa aberta: mensagem normal (mais barata que modelo)
    const texto = montarTextoLivre(a.texto_livre, r.dados);
    envio = await enviarWhatsApp(supabaseAdmin, autor, { canal, conversa: conversaWhats, corpo: { semPrevia: true }, texto });
  } else {
    if (!a.modelo_nome) {
      return atualizarDisparo(supabaseAdmin, d.id, { situacao: 'PULADO', motivo: def?.textoLivre ? 'a janela de 24 h do WhatsApp já fechou e não há modelo escolhido' : 'falta escolher o modelo do WhatsApp' });
    }
    // Cliente em inglês/espanhol: a versão traduzida do modelo, se houver (M7)
    const idiomaCliente = await idiomaDoDisparo(supabaseAdmin, d, conversaWhats || conversa);
    const variante = idiomaCliente !== 'pt' ? a.config?.modelos_idioma?.[idiomaCliente] : null;
    const info = variante?.modelo || a.config?.modelo || {};
    const botoes = valoresDosBotoes(info, r.dados);
    if (botoes.erro) return atualizarDisparo(supabaseAdmin, d.id, { situacao: 'PULADO', motivo: botoes.erro });
    const modelo = {
      nome: variante?.nome || a.modelo_nome, idioma: variante?.idioma || a.modelo_idioma || 'pt_BR',
      variaveisCorpo: valoresDasVariaveis(a.variaveis, r.dados),
      variaveisCabecalho: valoresDasVariaveis(a.variaveis_cabecalho, r.dados),
      nomesCorpo: info.nomesCorpo || null, nomesCabecalho: info.nomesCabecalho || null, variaveisBotao: botoes.valores,
    };
    modelo.textoFinal = textoDoModelo(modelo, info);
    envio = await enviarWhatsApp(supabaseAdmin, autor, {
      canal, conversa: conversaWhats,
      corpo: { modelo, ...(conversaWhats ? {} : { para: comPais(telefone), nome: d.nome || conversa?.contato_nome || r.dados.nome_completo || '' }) },
    });
  }
  if (envio.erro) return atualizarDisparo(supabaseAdmin, d.id, { situacao: 'FALHOU', motivo: String(envio.erro).slice(0, 300) });
  if (r.depois) { try { await r.depois(); } catch (e) { /* o envio já saiu */ } }

  const msg = (envio.lista || [])[0];
  const conv = envio.conversa || conversaWhats;
  if (msg?.id) await supabaseAdmin.from('atendimento_mensagens').update({ automacao_id: a.id }).eq('id', msg.id);
  if (conv) {
    const titulo = AUTOMACAO_POR_TIPO[a.tipo]?.titulo || a.tipo;
    await gravarNota(supabaseAdmin, autor, conv, `🔁 Automação “${titulo}” enviou a mensagem.${r.nota ? ` ${r.nota}` : ''}`);
    if (['FUP_RESERVAR', 'FUP_COTACAO', 'SEM_DISPONIBILIDADE', 'GRUPO', 'RETOMADA', 'OFERTA'].includes(a.tipo)) {
      try { await supabaseAdmin.rpc('atendimento_adicionar_etiqueta', { p_conversa: conv.id, p_nome: 'Follow-up automático' }); } catch (e) { /* extra */ }
    }
    // Como no Asksuite ("Parar robô"): a resposta do hóspede fica com a equipe
    if (a.config?.parar_robo) {
      await supabaseAdmin.from('atendimento_conversas')
        .update({ robo_pausado_em: new Date().toISOString(), robo_pausa_motivo: `${titulo}: a equipe responde` }).eq('id', conv.id);
    }
  }
  return atualizarDisparo(supabaseAdmin, d.id, {
    situacao: 'ENVIADO', enviado_em: new Date().toISOString(), mensagem_id: msg?.id || null, motivo: null,
    conversa_id: conv?.id || d.conversa_id, telefone,
  });
}

// Contexto de uma rodada: Cloudbeds e nomes guardados para não buscar de novo
async function novoContexto(supabaseAdmin, origem) {
  const cloud = {};
  const { data: hoteis } = await supabaseAdmin.from('hoteis').select('id, nome_fantasia');
  const nomes = Object.fromEntries((hoteis || []).map((h) => [h.id, h.nome_fantasia]));
  const pessoas = {};
  const lembretes = {};
  return {
    origem,
    consultas: 0,
    lembreteFichaLigado: async (hotelId) => {
      if (!(hotelId in lembretes)) {
        const { data } = await supabaseAdmin.from('atendimento_automacoes').select('id').eq('hotel_id', hotelId).eq('tipo', 'FICHA_VESPERA').eq('ativo', true).limit(1);
        lembretes[hotelId] = !!data?.length;
      }
      return lembretes[hotelId];
    },
    nomeHotel: (id) => nomes[id] || '',
    nomePessoa: (id) => pessoas[id] || '',
    carregarPessoas: async (ids) => {
      const faltam = ids.filter((i) => i && !(i in pessoas));
      if (!faltam.length) return;
      const { data } = await supabaseAdmin.from('usuarios').select('id, nome').in('id', faltam);
      (data || []).forEach((u) => { pessoas[u.id] = primeiroNome(u.nome); });
    },
    cloudbeds: async (hotelId) => {
      if (!cloud[hotelId]) cloud[hotelId] = conexaoCloudbeds(supabaseAdmin, hotelId);
      return cloud[hotelId];
    },
  };
}

// ============================================================================
// RODADA (função agendada)
// ============================================================================
export async function rodarAutomacoes(supabaseAdmin, { origem, prazo }) {
  const { data: ativas, error } = await supabaseAdmin.from('atendimento_automacoes').select('*').eq('ativo', true);
  if (error) return { pulou: 'falta o SQL da Fase 5' };
  const resultado = { agendados: 0, enviados: 0, pulados: 0, falhas: 0, reagendados: 0, erros: [] };
  if (!ativas?.length) return { ...resultado, ativas: 0 };
  const ctx = await novoContexto(supabaseAdmin, origem);

  // 1) Agendar (no máximo uma vez por minuto por automação)
  for (const a of ativas) {
    if (prazo - Date.now() < 5000) break;
    if (a.ultima_rodada && Date.now() - new Date(a.ultima_rodada).getTime() < MIN) continue;
    try {
      resultado.agendados += await agendar(supabaseAdmin, a, ctx);
      await supabaseAdmin.from('atendimento_automacoes').update({ ultima_rodada: new Date().toISOString() }).eq('id', a.id);
    } catch (e) { resultado.erros.push(`${a.tipo}: ${String(e.message || e).slice(0, 150)}`); }
  }

  // 2) Enviar o que chegou a hora
  const porId = Object.fromEntries(ativas.map((a) => [a.id, a]));
  const { data: fila } = await supabaseAdmin.from('atendimento_disparos').select('*')
    .eq('situacao', 'AGENDADO').lte('agendado_para', new Date().toISOString()).order('agendado_para').limit(MAX_ENVIOS_POR_RODADA);
  const idsPessoas = (fila || []).map((d) => d.dados?.responsavel_id).filter(Boolean);
  await ctx.carregarPessoas(idsPessoas);
  for (const d of fila || []) {
    if (prazo - Date.now() < 2500) break;
    let a = porId[d.automacao_id];
    if (!a) {
      const { data } = await supabaseAdmin.from('atendimento_automacoes').select('*').eq('id', d.automacao_id).maybeSingle();
      a = data;
    }
    try {
      await processarDisparo(supabaseAdmin, d, a, ctx);
      const { data: depois } = await supabaseAdmin.from('atendimento_disparos').select('situacao').eq('id', d.id).maybeSingle();
      if (depois?.situacao === 'ENVIADO') resultado.enviados += 1;
      else if (depois?.situacao === 'PULADO' || depois?.situacao === 'CANCELADO') resultado.pulados += 1;
      else if (depois?.situacao === 'FALHOU') resultado.falhas += 1;
      else resultado.reagendados += 1;
    } catch (e) {
      resultado.erros.push(`disparo ${d.id}: ${String(e.message || e).slice(0, 150)}`);
      await atualizarDisparo(supabaseAdmin, d.id, { agendado_para: new Date(Date.now() + 15 * MIN).toISOString(), motivo: `erro: ${String(e.message || e).slice(0, 150)}` });
    }
  }
  return resultado;
}

// ============================================================================
// RESPOSTAS DO CLIENTE: "SAIR" e nota da pesquisa
// ============================================================================
// Chamado pelo webhook com as conversas que receberam mensagem nova. Devolve
// as conversas já tratadas aqui (o robô não precisa responder "5" ou "SAIR").
export async function tratarRespostas(supabaseAdmin, conversaIds) {
  const tratadas = [];
  for (const id of conversaIds || []) {
    try {
      const { data: conversa } = await supabaseAdmin.from('atendimento_conversas').select('*').eq('id', id).maybeSingle();
      if (!conversa || conversa.canal_tipo !== 'WHATSAPP') continue;
      const { data: msg } = await supabaseAdmin.from('atendimento_mensagens').select('id, texto, criado_em')
        .eq('conversa_id', id).eq('direcao', 'ENTRADA').order('criado_em', { ascending: false }).limit(1).maybeSingle();
      const texto = String(msg?.texto || '');
      const { data: canal } = await supabaseAdmin.from('atendimento_canais').select('*').eq('id', conversa.canal_id).maybeSingle();
      if (!canal) continue;

      if (REGEX_SAIR.test(texto)) {
        // Só vale para quem já recebeu automação ou campanha (senão é conversa normal)
        const { data: recebeu } = await supabaseAdmin.from('atendimento_disparos').select('id').eq('conversa_id', id).eq('situacao', 'ENVIADO').limit(1);
        let deCampanha = false;
        try { deCampanha = await marcarSaidaCampanha(supabaseAdmin, id); } catch (e) { /* sem o SQL da Fase 6 */ }
        if (!recebeu?.length && !deCampanha) continue;
        if (conversa.contato_id) {
          await supabaseAdmin.from('atendimento_contatos').update({ sem_automacoes: true, sem_automacoes_em: new Date().toISOString() }).eq('id', conversa.contato_id);
        }
        await supabaseAdmin.from('atendimento_disparos').update({ situacao: 'CANCELADO', motivo: 'o cliente pediu para sair', atualizado_em: new Date().toISOString() })
          .eq('conversa_id', id).eq('situacao', 'AGENDADO');
        await gravarNota(supabaseAdmin, { id: null }, conversa, '🚫 O cliente respondeu SAIR: não recebe mais mensagens automáticas nem campanhas.');
        await enviarWhatsApp(supabaseAdmin, { id: null }, { canal, conversa, corpo: { semPrevia: true }, texto: 'Pronto! Você não vai mais receber mensagens automáticas nem promoções. Se precisar de algo, é só escrever aqui. 😊' });
        await supabaseAdmin.from('atendimento_conversas').update({ robo_respondeu_ate: conversa.ultima_entrada_em }).eq('id', id);
        tratadas.push(id);
        continue;
      }

      // Resposta à oferta de upgrade da véspera (M19)
      const escolha = respostaUpgrade(texto);
      if (escolha) {
        const { data: upg } = await supabaseAdmin.from('atendimento_disparos').select('*').eq('conversa_id', id).eq('tipo', 'UPGRADE').eq('situacao', 'ENVIADO')
          .gte('enviado_em', new Date(Date.now() - 48 * HORA).toISOString()).order('enviado_em', { ascending: false }).limit(1).maybeSingle();
        const ofertas = upg?.dados?.ofertas || {};
        if (upg && !upg.dados?.resposta && (escolha === 'NAO' || (escolha === 'UPGRADE' && ofertas.upgrade) || (escolha === 'LATE' && ofertas.late))) {
          await supabaseAdmin.from('atendimento_disparos').update({ dados: { ...(upg.dados || {}), resposta: escolha, resposta_em: new Date().toISOString() }, atualizado_em: new Date().toISOString() }).eq('id', upg.id);
          const idioma = await idiomaDoDisparo(supabaseAdmin, upg, conversa);
          const frases = {
            sim: { pt: 'Perfeito! Já avisei a recepção, que confirma com você. 😊', en: 'Perfect! I have let the front desk know and they will confirm with you. 😊', es: '¡Perfecto! Ya avisé a la recepción, que lo confirmará con usted. 😊' },
            nao: { pt: 'Tudo bem! Até amanhã. 😊', en: 'No problem! See you tomorrow. 😊', es: '¡Está bien! Hasta mañana. 😊' },
          };
          if (escolha === 'NAO') {
            await gravarNota(supabaseAdmin, { id: null }, conversa, '🛎️ O hóspede não quis a oferta da véspera.');
            await enviarWhatsApp(supabaseAdmin, { id: null }, { canal, conversa, corpo: { semPrevia: true }, texto: frases.nao[idioma] || frases.nao.pt });
            await supabaseAdmin.from('atendimento_conversas').update({ robo_respondeu_ate: conversa.ultima_entrada_em }).eq('id', id);
          } else {
            const o = escolha === 'UPGRADE' ? ofertas.upgrade : ofertas.late;
            const oque = escolha === 'UPGRADE' ? `upgrade para o ${o.quarto} (${reais(o.preco)} por noite)` : `late check-out até as ${o.hora} (${reais(o.preco)})`;
            await gravarNota(supabaseAdmin, { id: null }, conversa, `🛎️ O hóspede aceitou: ${oque}. Confirme com ele e lance o valor na reserva ${upg.reserva_id || ''} na Cloudbeds.`);
            await enviarWhatsApp(supabaseAdmin, { id: null }, { canal, conversa, corpo: { semPrevia: true }, texto: frases.sim[idioma] || frases.sim.pt });
            await supabaseAdmin.from('atendimento_conversas').update({
              status: 'PENDENTE', robo_respondeu_ate: conversa.ultima_entrada_em,
              robo_pausado_em: new Date().toISOString(), robo_pausa_motivo: 'Oferta da véspera aceita: a equipe confirma',
            }).eq('id', id);
          }
          tratadas.push(id);
          continue;
        }
      }

      const nota = lerNota(texto);
      if (nota) {
        const { data: pesquisa } = await supabaseAdmin.from('atendimento_disparos').select('*').eq('conversa_id', id).in('tipo', ['PESQUISA', 'POS_CHECKOUT'])
          .eq('situacao', 'ENVIADO').is('nota', null).gte('enviado_em', new Date(Date.now() - 48 * HORA).toISOString())
          .order('enviado_em', { ascending: false }).limit(1).maybeSingle();
        if (!pesquisa) continue;
        // Só vale se a pesquisa foi a última coisa que o hotel mandou (senão "bom" pode ser resposta a outra pergunta)
        const ultimaSaida = await ultimaMensagem(supabaseAdmin, id, ['SAIDA']);
        if (ultimaSaida && new Date(ultimaSaida.criado_em).getTime() > new Date(pesquisa.enviado_em).getTime() + MIN) continue;
        await supabaseAdmin.from('atendimento_disparos').update({ nota, nota_em: new Date().toISOString(), atualizado_em: new Date().toISOString() }).eq('id', pesquisa.id);
        const estadia = pesquisa.tipo === 'POS_CHECKOUT';
        const baixa = estadia && nota <= NOTA_BAIXA_ATE;
        await gravarNota(supabaseAdmin, { id: null }, conversa, estadia ? `⭐ Nota da estadia: ${nota} de 5.` : `⭐ Nota da pesquisa de satisfação: ${nota} de 5.`);
        await enviarWhatsApp(supabaseAdmin, { id: null }, {
          canal, conversa, corpo: { semPrevia: true },
          texto: (RESPOSTA_NOTA[await idiomaDoDisparo(supabaseAdmin, pesquisa, conversa)] || RESPOSTA_NOTA.pt)[baixa ? 'baixa' : 'boa'],
        });
        if (baixa) {
          // Nota baixa (M18): conversa pendente, robô em silêncio e aviso aos administradores
          await supabaseAdmin.from('atendimento_conversas').update({
            status: 'PENDENTE', robo_respondeu_ate: conversa.ultima_entrada_em,
            robo_pausado_em: new Date().toISOString(), robo_pausa_motivo: 'Nota baixa na estadia: a equipe responde',
          }).eq('id', id);
          const nome = conversa.contato_nome || conversa.chave_externa || 'Hóspede';
          const { data: hotel } = await supabaseAdmin.from('hoteis').select('nome_fantasia').eq('id', conversa.hotel_id).maybeSingle();
          const aviso = await avisarAdmins(supabaseAdmin, conversa.hotel_id, {
            titulo: `⚠️ Nota ${nota} de 5 na estadia`, corpo: `${nome} deu nota ${nota}. Fale com o hóspede antes de ele avaliar no Google.`,
            url: `/atendimento?conversa=${id}`, tag: `nota-${id}`,
            assunto: `Nota baixa na estadia: ${nota} de 5 — ${nome} (${hotel?.nome_fantasia || 'hotel'})`,
            texto: `${nome} deu nota ${nota} de 5 na pesquisa depois da estadia${pesquisa.reserva_id ? ` (reserva ${pesquisa.reserva_id})` : ''}.\n\nA conversa ficou como "Pendente" na Caixa de Entrada e o robô não responde nela. Fale com o hóspede o quanto antes.`,
          });
          await gravarNota(supabaseAdmin, { id: null }, conversa, `⚠️ Nota baixa: a conversa ficou pendente e o robô em silêncio. Avisei os administradores${aviso.celulares ? ` (${aviso.celulares} celular(es))` : ''}${aviso.emails.length ? ` e por e-mail (${aviso.emails.join(', ')})` : ''}.`);
        } else {
          // Conversa resolvida continua resolvida; o robô não responde à nota
          await supabaseAdmin.from('atendimento_conversas').update({ status: 'RESOLVIDA', robo_respondeu_ate: conversa.ultima_entrada_em }).eq('id', id);
        }
        tratadas.push(id);
      }
    } catch (e) { /* uma conversa com problema não atrapalha as outras */ }
  }
  return tratadas;
}

// ============================================================================
// TELA (ADMIN): salvar e testar
// ============================================================================
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function salvarAutomacao(supabaseAdmin, chamador, hotelId, entrada, origem) {
  const def = AUTOMACAO_POR_TIPO[entrada?.tipo];
  if (!def) return { erro: 'Automação desconhecida.' };
  const espera = Math.trunc(Number(entrada.espera_minutos ?? def.espera));
  const limite = Math.trunc(Number(entrada.limite_dia ?? 100));
  const ini = String(entrada.janela_inicio || '08:00');
  const fim = String(entrada.janela_fim || '21:00');
  if (!(espera >= 0 && espera <= 43200)) return { erro: 'A espera tem que ser entre 0 e 30 dias.' };
  if (!(limite >= 1 && limite <= 5000)) return { erro: 'O limite por dia tem que ser entre 1 e 5.000.' };
  if (!HHMM.test(ini) || !HHMM.test(fim) || ini >= fim) return { erro: 'Confira o horário de envio (ex.: das 08:00 às 21:00).' };

  const config = { ...(def.configPadrao || {}) };
  config.parar_robo = entrada.config?.parar_robo !== undefined ? !!entrada.config.parar_robo : !!def.pararRobo;
  if (entrada.config?.hora !== undefined) {
    if (!HHMM.test(String(entrada.config.hora))) return { erro: 'Confira a hora do envio (ex.: 10:00).' };
    config.hora = String(entrada.config.hora);
  }
  if (entrada.config?.dias !== undefined) {
    const dias = Math.trunc(Number(entrada.config.dias));
    if (!(dias >= 0 && dias <= 7)) return { erro: 'Os dias têm que ser entre 0 e 7.' };
    config.dias = dias;
  }
  if (def.tipo === 'UPGRADE') {
    const c = entrada.config || {};
    const quarto = String(c.upgrade_quarto || '').trim().slice(0, 80);
    const pUp = String(c.upgrade_preco ?? '').trim();
    const pLate = String(c.late_preco ?? '').trim();
    const ok = (v) => v === '' || precoTela(v) !== null;
    if (!ok(pUp) || !ok(pLate)) return { erro: 'Confira os preços do upgrade e do late check-out (só números, ex.: 80 ou 80,50).' };
    if (pUp && !quarto) return { erro: 'Escreva o nome do quarto do upgrade, como está na Cloudbeds.' };
    if (entrada.ativo && !pUp && !pLate) return { erro: 'Para ligar, coloque o preço do upgrade e/ou do late check-out.' };
    if (c.late_hora && !/^\d\d:\d\d$/.test(c.late_hora)) return { erro: 'Hora do late check-out inválida.' };
    Object.assign(config, { upgrade_quarto: quarto, upgrade_preco: pUp, late_preco: pLate, late_hora: c.late_hora || '14:00' });
  }
  if (def.tipo === 'OFERTA') {
    const ben = String(entrada.config?.beneficio ?? '').trim();
    if (ben.length > 120) return { erro: 'O benefício pode ter no máximo 120 letras.' };
    config.beneficio = ben;
    const oc = Math.trunc(Number(entrada.config?.ocupacao_max ?? 60));
    if (!(oc >= 10 && oc <= 100)) return { erro: 'A ocupação máxima tem que ser entre 10% e 100%.' };
    config.ocupacao_max = oc;
    if (entrada.ativo && !ben) return { erro: 'Para ligar, escreva o benefício da oferta (ex.: late check-out até as 14h).' };
  }
  if (entrada.config?.reverificar_horas !== undefined) {
    const h = Math.trunc(Number(entrada.config.reverificar_horas));
    if (!(h >= 1 && h <= 48)) return { erro: 'Consultar de novo a cada 1 a 48 horas.' };
    config.reverificar_horas = h;
  }

  // Canal e modelo: confere na Meta (nome, idioma e quantas variáveis tem)
  let canalId = entrada.canal_id ? Number(entrada.canal_id) : null;
  let modeloNome = String(entrada.modelo_nome || '').trim() || null;
  let modeloIdioma = String(entrada.modelo_idioma || '').trim() || null;
  const variaveis = (Array.isArray(entrada.variaveis) ? entrada.variaveis : []).map(String);
  const variaveisCab = (Array.isArray(entrada.variaveis_cabecalho) ? entrada.variaveis_cabecalho : []).map(String);
  if (canalId) {
    const { data: canal } = await supabaseAdmin.from('atendimento_canais').select('*').eq('id', canalId).maybeSingle();
    if (!canal || Number(canal.hotel_id) !== Number(hotelId) || canal.tipo !== 'WHATSAPP') return { erro: 'Escolha um número de WhatsApp deste hotel.' };
    if (modeloNome) {
      if (!canal.config?.wabaId) return { erro: 'Falta o "ID da conta do WhatsApp Business" na configuração do número.' };
      let modelos;
      try { modelos = await listarModelos({ token: await tokenDoCanal(supabaseAdmin, canal), wabaId: canal.config.wabaId }); }
      catch (e) { return { erro: `Não foi possível ler os modelos na Meta: ${e.message}` }; }
      const m = modelos.find((x) => x.nome === modeloNome && (!modeloIdioma || x.idioma === modeloIdioma));
      if (!m) return { erro: `O modelo “${modeloNome}” não está aprovado neste número.` };
      if (m.cabecalhoMidia) return { erro: 'Este modelo tem foto, vídeo ou documento no cabeçalho; escolha um modelo só de texto.' };
      modeloIdioma = m.idioma;
      if (variaveis.length !== m.variaveisCorpo || variaveis.some((v) => !v)) return { erro: `Escolha o que vai em cada uma das ${m.variaveisCorpo} variável(is) do modelo.` };
      if (variaveisCab.length !== m.variaveisCabecalho || variaveisCab.some((v) => !v)) return { erro: 'Escolha o que vai na variável do título do modelo.' };
      // Botão com link variável: só serve se o link for o do sistema
      // (…/r/código da cotação ou …/f/código da ficha)
      const caminhos = [def.campos.includes('link_reservar') ? '/r/' : null, def.campos.includes('link_ficha') ? '/f/' : null].filter(Boolean);
      for (const b of m.botoesLink || []) {
        const base = baseDoLink(b.url);
        if (!caminhos.length) return { erro: `O botão “${b.texto}” deste modelo tem link variável, e esta automação não tem link para mandar. Escolha um modelo sem link variável.` };
        const semProtocolo = (u) => String(u || '').replace(/^https?:\/\//i, '').toLowerCase();
        if (!origem || !caminhos.some((c) => semProtocolo(base) === `${semProtocolo(origem)}${c}`)) {
          return { erro: `O botão “${b.texto}” deste modelo abre ${base}… (outro site). Crie um modelo novo na Meta com o botão abrindo ${origem || 'o endereço do sistema'}${caminhos[0]}{{1}}.` };
        }
      }
      config.modelo = {
        corpo: m.corpo, cabecalho: m.cabecalho, rodape: m.rodape, categoria: m.categoria,
        nomesCorpo: m.nomesCorpo || null, nomesCabecalho: m.nomesCabecalho || null, botoesLink: m.botoesLink || [],
      };
      // Versões em inglês/espanhol (M7): mesmas variáveis e mesmos botões de link
      const variantes = {};
      for (const [k, rotulo] of [['en', 'inglês'], ['es', 'espanhol']]) {
        const pedido = entrada.modelos_idioma?.[k];
        if (!pedido?.nome) continue;
        const m2 = modelos.find((x) => x.nome === pedido.nome && (!pedido.idioma || x.idioma === pedido.idioma));
        if (!m2) return { erro: `O modelo em ${rotulo} “${pedido.nome}” não está aprovado neste número.` };
        if (m2.cabecalhoMidia) return { erro: `O modelo em ${rotulo} tem foto ou vídeo no cabeçalho; escolha um só de texto.` };
        if (m2.variaveisCorpo !== m.variaveisCorpo || m2.variaveisCabecalho !== m.variaveisCabecalho) {
          return { erro: `O modelo em ${rotulo} precisa ter as mesmas variáveis do modelo em português (${m.variaveisCorpo} no texto${m.variaveisCabecalho ? ` e ${m.variaveisCabecalho} no título` : ''}).` };
        }
        const bases = (x) => (x.botoesLink || []).map((b) => baseDoLink(b.url)).join('|');
        if (bases(m2) !== bases(m)) return { erro: `O modelo em ${rotulo} precisa ter os mesmos botões com link do modelo em português.` };
        variantes[k] = {
          nome: m2.nome, idioma: m2.idioma,
          modelo: { corpo: m2.corpo, cabecalho: m2.cabecalho, rodape: m2.rodape, categoria: m2.categoria, nomesCorpo: m2.nomesCorpo || null, nomesCabecalho: m2.nomesCabecalho || null, botoesLink: m2.botoesLink || [] },
        };
      }
      if (Object.keys(variantes).length) config.modelos_idioma = variantes;
    }
  } else {
    canalId = null;
    modeloNome = null;
    modeloIdioma = null;
  }

  const textoLivre = def.textoLivre ? String(entrada.texto_livre ?? textoDoHotel(def.tipo, hotelId) ?? def.textoPadrao).trim().slice(0, 1000) || null : null;
  const ativo = !!entrada.ativo;
  if (ativo && !modeloNome && !(def.textoLivre && textoLivre)) return { erro: 'Para ligar, escolha o número e o modelo do WhatsApp.' };
  if (def.tipo === 'RETOMADA' && espera > RETOMADA_MAX_SEM_MODELO_MIN && !modeloNome) {
    return { erro: 'Com mais de 23h30 de espera a janela de 24 h do WhatsApp já fechou: escolha um modelo aprovado ou espere menos.' };
  }

  const { data: atual } = await supabaseAdmin.from('atendimento_automacoes').select('ativo, ligado_em, config').eq('hotel_id', hotelId).eq('tipo', def.tipo).maybeSingle();
  const registro = {
    hotel_id: hotelId, tipo: def.tipo, ativo, canal_id: canalId, modelo_nome: modeloNome, modelo_idioma: modeloIdioma,
    variaveis: modeloNome ? variaveis : [], variaveis_cabecalho: modeloNome ? variaveisCab : [], texto_livre: textoLivre,
    espera_minutos: espera, janela_inicio: ini, janela_fim: fim, limite_dia: limite,
    config: { ...config, ...(atual?.config?.ultimo_dia ? { ultimo_dia: atual.config.ultimo_dia } : {}) },
    // Ao ligar: só vale para o que acontecer daqui para frente (não manda para cotações antigas)
    ligado_em: ativo ? (atual?.ativo ? atual.ligado_em : new Date().toISOString()) : atual?.ligado_em || null,
    atualizado_por_id: chamador.id, atualizado_em: new Date().toISOString(),
  };
  const { data, error } = await supabaseAdmin.from('atendimento_automacoes').upsert(registro, { onConflict: 'hotel_id,tipo' }).select().single();
  if (error) return { erro: /atendimento_automacoes/i.test(error.message) ? 'Falta rodar no Supabase o SQL da Fase 5 (sql/caixa_de_entrada_fase5.sql).' : error.message };
  // Desligou: o que estava agendado não sai mais
  if (!ativo && atual?.ativo) {
    await supabaseAdmin.from('atendimento_disparos').update({ situacao: 'CANCELADO', motivo: 'a automação foi desligada', atualizado_em: new Date().toISOString() })
      .eq('automacao_id', data.id).eq('situacao', 'AGENDADO');
  }
  return { automacao: data };
}

// Teste: manda o modelo com dados de exemplo para um número escolhido pelo ADMIN
export async function testarAutomacao(supabaseAdmin, hotelId, { tipo, telefone, origem }) {
  const { data: a } = await supabaseAdmin.from('atendimento_automacoes').select('*').eq('hotel_id', hotelId).eq('tipo', tipo).maybeSingle();
  if (!a?.modelo_nome || !a.canal_id) return { erro: 'Salve primeiro o número e o modelo desta automação.' };
  const para = normalizarNumero(telefone);
  if (para.length < 12) return { erro: 'Informe o número com DDD (ex.: 83 98888-7777).' };
  const { data: canal } = await supabaseAdmin.from('atendimento_canais').select('*').eq('id', a.canal_id).maybeSingle();
  if (!canal?.ativo) return { erro: 'O número de WhatsApp escolhido está desligado.' };
  const { data: hotel } = await supabaseAdmin.from('hoteis').select('nome_fantasia').eq('id', hotelId).maybeSingle();
  const exemplo = {
    nome: 'Maria', nome_completo: 'Maria da Silva', hotel: hotel?.nome_fantasia || 'Hotel', checkin: dataBR(hojeLocal(10)), checkout: dataBR(hojeLocal(12)),
    noites: 2, pessoas: '2 adultos', valor: reais(600), link_reservar: `${origem}/r/EXEMPLO-0`, link_cotacao: `${origem}/r/EXEMPLO-0`,
    numero_reserva: '1234567890', atendente: 'Ana', beneficio: a.config?.beneficio || 'late check-out até as 14h', link_ficha: `${origem}/f/${Number(hotelId)}-EXEMPLO123`,
  };
  const info = a.config?.modelo || {};
  const botoes = valoresDosBotoes(info, exemplo);
  if (botoes.erro) return { erro: botoes.erro };
  const modelo = {
    nome: a.modelo_nome, idioma: a.modelo_idioma || 'pt_BR',
    variaveisCorpo: valoresDasVariaveis(a.variaveis, exemplo), variaveisCabecalho: valoresDasVariaveis(a.variaveis_cabecalho, exemplo),
    nomesCorpo: info.nomesCorpo || null, nomesCabecalho: info.nomesCabecalho || null, variaveisBotao: botoes.valores,
  };
  modelo.textoFinal = `[TESTE] ${textoDoModelo(modelo, info)}`;
  const envio = await enviarWhatsApp(supabaseAdmin, { id: null }, { canal, conversa: null, corpo: { modelo, para, nome: 'Teste de automação' } });
  if (envio.erro) return { erro: envio.erro };
  return { sucesso: true, texto: modelo.textoFinal };
}
