// ============================================================================
// CAIXA DE ENTRADA — CHAT DO SITE (Fase 1B) — só usado no servidor
// ============================================================================
// O site do hotel carrega /chat-site.js (janela do chat) e fala com
// /api/chat-site. Não há login: cada visitante recebe um "passe" aleatório,
// guardado no navegador dele; no banco fica só o resumo (hash) do passe, como
// chave da conversa. Assim ninguém da equipe consegue se passar pelo visitante.
//
// Proteções:
//   - só responde para os endereços de site cadastrados no canal (e para o
//     próprio sistema, na página de teste);
//   - limite de conversas novas por IP e de mensagens por conversa;
//   - o IP não é guardado: só um resumo (hash) com a chave do servidor, para
//     contar o limite; a cidade é aproximada.
// ============================================================================

import crypto from 'crypto';
import { situacaoEquipe, carregarRobo } from './robo';
import { enviarEmailAvulso, gravarNota } from './envio';

export const TIPO_SITE = 'SITE';
export const LIMITE_TEXTO = 2000;
export const LIMITE_MENSAGENS_10MIN = 30;   // por conversa
export const LIMITE_CONVERSAS_HORA = 6;     // novas por IP, por hotel
export const MINUTOS_AVISO_EMAIL = 10;

export const PADRAO_CHAT = {
  saudacao: 'Olá! 👋 Como podemos ajudar?',
  cor: '#2a1160',
  dominios: [],
  pedirContato: true,
};

// ---------------------------------------------------------------- PASSE DO VISITANTE
export const novoPasse = () => crypto.randomBytes(24).toString('base64url');
export const resumoPasse = (passe) => `v1:${crypto.createHash('sha256').update(String(passe)).digest('hex')}`;
export const passeValido = (p) => typeof p === 'string' && /^[A-Za-z0-9_-]{30,64}$/.test(p);

// ---------------------------------------------------------------- ENDEREÇOS PERMITIDOS
// Aceita "www.hotel.com", "https://www.hotel.com/qualquer" ou "*.hotel.com" e
// "*--site.netlify.app" (prévias da Netlify). Devolve só o nome do site.
export function normalizarDominio(d) {
  let t = String(d || '').trim().toLowerCase();
  if (!t) return '';
  t = t.replace(/^[a-z]+:\/\//, '').split('/')[0].split('?')[0].split('#')[0];
  t = t.replace(/:\d+$/, '');
  if (t === 'localhost') return t; // teste no computador
  if (!/^(\*\.|\*--)?[a-z0-9.-]+$/.test(t) || !t.includes('.')) return '';
  return t;
}

export function listaDominios(texto) {
  const itens = Array.isArray(texto) ? texto : String(texto || '').split(/[\s,;]+/);
  return [...new Set(itens.map(normalizarDominio).filter(Boolean))].slice(0, 20);
}

function nomeDoSite(origem) {
  try { return new URL(origem).hostname.toLowerCase(); } catch (e) { return ''; }
}

export function origemPermitida(origem, canal, origemSistema) {
  if (!origem) return false;
  let url;
  try { url = new URL(origem); } catch (e) { return false; }
  // O próprio sistema (página de teste do chat)
  try { if (origemSistema && url.host === new URL(origemSistema).host) return true; } catch (e) { /* segue */ }
  // Só https (a não ser no computador de quem testa)
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !local) return false;
  const host = nomeDoSite(origem);
  return (canal?.config?.dominios || []).some((d) => {
    if (d.startsWith('*.')) return host.endsWith(d.slice(1)) && host.length > d.length - 1;
    if (d.startsWith('*--')) return host.endsWith(d.slice(1)) && host.length > d.length - 1;
    return host === d;
  });
}

// ---------------------------------------------------------------- VISITANTE
const curto = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

function urlSegura(v, max = 300) {
  const t = curto(v, 1000);
  try {
    const u = new URL(t);
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    return u.toString().slice(0, max);
  } catch (e) { return null; }
}

export function resumoIp(request) {
  const ip = (request.headers.get('x-nf-client-connection-ip') || request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || '')
    .split(',')[0].trim();
  if (!ip) return null;
  const segredo = process.env.CLOUDBEDS_CRYPTO_SECRET || 'chat-site';
  return crypto.createHmac('sha256', segredo).update(`ip:${ip}`).digest('hex').slice(0, 24);
}

// Cidade aproximada (pelo IP, quando a hospedagem informa)
export function localDaRequisicao(request) {
  const bruto = request.headers.get('x-nf-geo');
  if (bruto) {
    let geo = null;
    try { geo = JSON.parse(bruto); } catch (e) {
      try { geo = JSON.parse(Buffer.from(bruto, 'base64').toString('utf8')); } catch (x) { geo = null; }
    }
    if (geo) {
      return {
        cidade: curto(geo.city, 80) || null,
        estado: curto(geo.subdivision?.code || geo.subdivision?.name, 40) || null,
        pais: curto(geo.country?.code || geo.country?.name, 40) || null,
      };
    }
  }
  const pais = curto(request.headers.get('x-country') || request.headers.get('x-vercel-ip-country'), 8);
  return pais ? { cidade: null, estado: null, pais } : {};
}

export function aparelhoDe(agente) {
  const a = String(agente || '');
  if (/iPad|Tablet/i.test(a)) return 'tablet';
  if (/Mobi|Android|iPhone/i.test(a)) return 'celular';
  return a ? 'computador' : null;
}

// O que a própria janela do chat informa (página, de onde veio, idioma…)
export function dadosDoVisitante(v, request) {
  const d = v && typeof v === 'object' ? v : {};
  const utm = {};
  ['source', 'medium', 'campaign', 'term', 'content'].forEach((k) => {
    const x = curto(d.utm?.[k], 80);
    if (x) utm[k] = x;
  });
  const idioma = curto(d.idioma, 20);
  const fuso = curto(d.fuso, 60);
  return {
    pagina: urlSegura(d.pagina),
    titulo: curto(d.titulo, 120) || null,
    referencia: urlSegura(d.referencia),
    ...(Object.keys(utm).length ? { utm } : {}),
    idioma: /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(idioma) ? idioma : null,
    fuso: /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(fuso) ? fuso : null,
    aparelho: aparelhoDe(request.headers.get('user-agent')),
    ...localDaRequisicao(request),
  };
}

// ---------------------------------------------------------------- CONTATO
// Telefone do Brasil sem o 55 ganha o 55; com "+" na frente vale como está.
export function telefoneDoVisitante(texto) {
  const bruto = String(texto || '').trim();
  if (!bruto) return '';
  let d = bruto.replace(/\D/g, '');
  if (!bruto.startsWith('+')) {
    d = d.replace(/^0+/, '');
    if (d.length === 10 || d.length === 11) d = `55${d}`;
  }
  return d.length >= 10 && d.length <= 15 ? d : null;
}

export function emailValido(email) {
  const e = String(email || '').trim();
  return e.length <= 120 && /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[A-Za-z]{2,}$/.test(e);
}

// ---------------------------------------------------------------- CANAL
export async function canalDoSite(supabaseAdmin, hotelId) {
  const id = Number(hotelId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const { data } = await supabaseAdmin.from('atendimento_canais').select('*')
    .eq('hotel_id', id).eq('tipo', TIPO_SITE).order('id').limit(1).maybeSingle();
  return data || null;
}

export async function configPublica(supabaseAdmin, canal) {
  const robo = await carregarRobo(supabaseAdmin, canal.hotel_id);
  const equipe = situacaoEquipe(robo.horario);
  const roboLigado = !!robo.config?.ligado && (robo.config.canais || []).includes(TIPO_SITE)
    && Array.isArray(robo.conteudo?.publicado) && robo.conteudo.publicado.length > 0;
  const cfg = { ...PADRAO_CHAT, ...(canal.config || {}) };
  return {
    ativo: !!canal.ativo,
    titulo: curto(cfg.titulo, 60) || robo.nomeHotel,
    saudacao: curto(cfg.saudacao, 300) || PADRAO_CHAT.saudacao,
    cor: /^#[0-9a-fA-F]{6}$/.test(cfg.cor || '') ? cfg.cor : PADRAO_CHAT.cor,
    pedirContato: cfg.pedirContato !== false,
    robo: roboLigado,
    assistente: roboLigado ? (curto(robo.config?.nome_assistente, 40) || null) : null,
    equipe: { aberta: equipe.aberto, volta: equipe.volta || null },
  };
}

// ---------------------------------------------------------------- MENSAGENS
export const primeiroNome = (n) => String(n || '').trim().split(/\s+/)[0] || '';

// Só o que o visitante pode ver (nunca notas internas nem envios que falharam)
export function mensagemParaVisitante(m, nomes = {}) {
  const deCliente = m.direcao === 'ENTRADA';
  return {
    id: m.id,
    de: deCliente ? 'cliente' : (m.enviado_pelo_robo ? 'robo' : 'equipe'),
    autor: deCliente || m.enviado_pelo_robo ? null : (primeiroNome(nomes[m.enviado_por_id]) || null),
    texto: String(m.texto || '').slice(0, 4000),
    em: m.data_original || m.criado_em,
  };
}

export async function mensagensDaConversa(supabaseAdmin, conversa, { depois = 0, limite = 60 } = {}) {
  let consulta = supabaseAdmin.from('atendimento_mensagens')
    .select('id, direcao, tipo, texto, status_envio, enviado_por_id, enviado_pelo_robo, data_original, criado_em')
    .eq('conversa_id', conversa.id).in('direcao', ['ENTRADA', 'SAIDA']);
  if (Number(depois) > 0) consulta = consulta.gt('id', Number(depois));
  const { data } = await consulta.order('id', { ascending: false }).limit(limite);
  return (data || []).filter((m) => m.status_envio !== 'FALHOU' && String(m.texto || '').trim()).reverse();
}

export async function nomesDaEquipe(supabaseAdmin, lista) {
  const ids = [...new Set(lista.map((m) => m.enviado_por_id).filter(Boolean))];
  if (!ids.length) return {};
  const { data } = await supabaseAdmin.from('usuarios').select('id, nome').in('id', ids);
  return Object.fromEntries((data || []).map((p) => [p.id, p.nome]));
}

// O visitante recebeu as respostas: com a janela aberta conta como vista
export async function marcarEntregues(supabaseAdmin, conversa, lista, aberta) {
  const ids = lista.filter((m) => m.direcao === 'SAIDA' && (m.status_envio === 'ENVIADA' || (aberta && m.status_envio === 'ENTREGUE'))).map((m) => m.id);
  if (ids.length) {
    await supabaseAdmin.from('atendimento_mensagens').update({ status_envio: aberta ? 'VISTA' : 'ENTREGUE' }).in('id', ids);
    lista.forEach((m) => { if (ids.includes(m.id)) m.status_envio = aberta ? 'VISTA' : 'ENTREGUE'; });
  }
  // "No site agora": grava no máximo 1 vez por minuto (cada gravação avisa as telas abertas)
  const visto = conversa.site_visto_em ? new Date(conversa.site_visto_em).getTime() : 0;
  if (Date.now() - visto > 60000) {
    await supabaseAdmin.from('atendimento_conversas').update({ site_visto_em: new Date().toISOString() }).eq('id', conversa.id);
  }
}

// ---------------------------------------------------------------- AVISO POR E-MAIL
// Respostas que o visitante não leu em 10 minutos vão para o e-mail que ele
// deixou, pela primeira caixa de e-mail ligada do hotel. Chamada pela função
// agendada (a cada 2 minutos).
export async function avisarVisitantesPorEmail(supabaseAdmin, { prazo }) {
  const { data: lista, error } = await supabaseAdmin.rpc('atendimento_site_para_avisar', { p_minutos: MINUTOS_AVISO_EMAIL, p_limite: 10 });
  if (error) return { erro: /atendimento_site_para_avisar|function|schema cache/i.test(error.message || '') ? 'falta o SQL da Fase 1B' : error.message };
  const resultado = { enviados: 0, semCaixa: 0, erros: [] };
  const caixas = {};
  const hoteis = {};
  for (const item of lista || []) {
    if (prazo - Date.now() < 2500) break;
    const conversa = { id: item.conversa_id, hotel_id: item.hotel_id };
    // Marca antes de enviar: nunca manda o mesmo aviso duas vezes
    await supabaseAdmin.from('atendimento_conversas').update({ site_email_msg_id: item.ate_id }).eq('id', item.conversa_id);
    if (caixas[item.hotel_id] === undefined) {
      const { data: caixa } = await supabaseAdmin.from('atendimento_canais').select('*')
        .eq('hotel_id', item.hotel_id).eq('tipo', 'EMAIL').eq('ativo', true).order('id').limit(1).maybeSingle();
      caixas[item.hotel_id] = caixa || null;
      const { data: hotel } = await supabaseAdmin.from('hoteis').select('nome_fantasia').eq('id', item.hotel_id).maybeSingle();
      hoteis[item.hotel_id] = hotel?.nome_fantasia || 'hotel';
    }
    const caixa = caixas[item.hotel_id];
    if (!caixa) {
      resultado.semCaixa += 1;
      await gravarNota(supabaseAdmin, null, conversa, '✉️ O visitante saiu do site sem ler a resposta, mas o hotel não tem caixa de e-mail ligada para avisar. Responda pelo contato que ele deixou.');
      continue;
    }
    const nomeHotel = hoteis[item.hotel_id];
    const primeiro = primeiroNome(item.nome);
    const textos = (item.mensagens || []).map((m) => String(m.texto || '').trim()).filter(Boolean);
    const linhas = [
      `Olá${primeiro ? `, ${primeiro}` : ''}!`, '',
      `Você conversou com o ${nomeHotel} pelo chat do site e chegou esta resposta:`, '',
      ...textos.flatMap((t) => [t, '']),
      'Para continuar, é só responder este e-mail.',
      // ?chat=abrir: o site já abre a janela do chat (no mesmo aparelho, a conversa continua)
      ...(item.pagina ? [`Ou volte ao chat no site: ${item.pagina}${item.pagina.includes('?') ? '&' : '?'}chat=abrir`] : []),
    ];
    try {
      await enviarEmailAvulso(supabaseAdmin, {
        canal: caixa, para: item.email, assunto: `Resposta do ${nomeHotel} à sua mensagem no site`, texto: linhas.join('\n'),
      });
      resultado.enviados += 1;
      await gravarNota(supabaseAdmin, null, conversa, `✉️ O visitante saiu do site sem ler a resposta: ela foi enviada por e-mail para ${item.email}.`);
    } catch (e) {
      resultado.erros.push(String(e.message || e).slice(0, 200));
      await gravarNota(supabaseAdmin, null, conversa, `✉️ Não foi possível mandar a resposta por e-mail para ${item.email}: ${String(e.message || e).slice(0, 200)}`);
    }
  }
  return resultado;
}
