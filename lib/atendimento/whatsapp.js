// ============================================================================
// CAIXA DE ENTRADA — WHATSAPP (API oficial da Meta: WhatsApp Cloud API)
// ============================================================================
// Só usado pelo servidor. Conversa com a Graph API da Meta:
//   - receber mensagens (webhook) e baixar fotos/áudios/documentos
//   - enviar texto, anexos e modelos aprovados (templates)
//   - marcar como lida (os dois risquinhos azuis para o cliente)
// Versão da Graph API num lugar só (GRAPH): quando a Meta pedir para
// atualizar, a troca é só aqui.
// ============================================================================

import crypto from 'crypto';
import { guardarAnexo, lerSegredo, soDigitos } from './servidor';

export const GRAPH = 'https://graph.facebook.com/v25.0';

export class ErroWhatsApp extends Error {
  constructor(mensagem, codigo) { super(mensagem); this.codigo = codigo; }
}

// Tradução dos erros mais comuns da Meta para português simples
function traduzirErro(erro) {
  const codigo = Number(erro?.code);
  const detalhe = erro?.error_data?.details || erro?.error_user_msg || erro?.message || 'erro desconhecido';
  const mapa = {
    131047: 'Já passaram mais de 24 horas desde a última mensagem do cliente. Pela regra do WhatsApp, agora só é possível enviar um modelo aprovado (botão "Modelo").',
    131026: 'O WhatsApp não conseguiu entregar: o número pode não ter WhatsApp ou o cliente não aceitou os termos novos.',
    131030: 'Este número não está na lista de números de teste do app da Meta. Adicione-o em developers.facebook.com → seu app → WhatsApp → Configuração da API.',
    131056: 'Muitas mensagens seguidas para o mesmo cliente. Aguarde um pouco e tente de novo.',
    131048: 'O WhatsApp limitou os envios deste número (muitos bloqueios ou denúncias). Aguarde e revise as mensagens.',
    131049: 'A Meta segurou esta mensagem de marketing para não cansar o cliente. Tente mais tarde.',
    131051: 'Tipo de mensagem não aceito pelo WhatsApp.',
    131052: 'Não foi possível baixar o arquivo enviado pelo cliente.',
    131053: 'Não foi possível enviar o arquivo (formato ou tamanho não aceito pelo WhatsApp).',
    132000: 'O número de variáveis do modelo não confere com o modelo aprovado.',
    132001: 'Este modelo não existe (ou não está aprovado) no idioma escolhido.',
    132012: 'As variáveis do modelo estão em formato errado.',
    133010: 'O número de WhatsApp ainda não está registrado na API. Use "Registrar número" na configuração do canal.',
    190: 'A chave de acesso (token) do WhatsApp expirou ou foi revogada. O administrador precisa colocar uma nova em Canais.',
    10: 'O token não tem permissão para este número. Confira as permissões whatsapp_business_messaging e whatsapp_business_management.',
    200: 'O token não tem permissão para esta ação.',
    368: 'A conta foi bloqueada temporariamente pela Meta por violação de política.',
    100: `Dado inválido enviado ao WhatsApp: ${detalhe}`,
  };
  return new ErroWhatsApp(mapa[codigo] || `O WhatsApp recusou: ${detalhe}`, codigo || null);
}

async function graph(token, caminho, { metodo = 'GET', json, form } = {}) {
  let resposta;
  try {
    resposta = await fetch(`${GRAPH}/${caminho}`, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(json ? { 'Content-Type': 'application/json' } : {}),
      },
      body: json ? JSON.stringify(json) : form || undefined,
    });
  } catch (e) {
    throw new ErroWhatsApp('Sem conexão com o WhatsApp (Meta). Tente de novo em instantes.');
  }
  const dados = await resposta.json().catch(() => null);
  if (!resposta.ok || dados?.error) throw traduzirErro(dados?.error || { message: `status ${resposta.status}` });
  return dados;
}

export async function tokenDoCanal(supabaseAdmin, canal) {
  const token = await lerSegredo(supabaseAdmin, canal.hotel_id, 'whatsapp_token', canal.id);
  if (!token) throw new ErroWhatsApp('O token do WhatsApp deste canal não foi encontrado. O administrador precisa configurar o canal de novo.');
  return token;
}

// ---- Números brasileiros com e sem o 9 -------------------------------------
// Contas antigas do WhatsApp às vezes vêm sem o 9 (55 83 8888-7777). Para não
// abrir duas conversas para a mesma pessoa, procura as duas formas.
export function variantesNumero(numero) {
  const d = soDigitos(numero);
  const lista = new Set([d]);
  if (d.startsWith('55') && d.length === 13 && d[4] === '9') lista.add(d.slice(0, 4) + d.slice(5));
  if (d.startsWith('55') && d.length === 12 && /[6-9]/.test(d[4])) lista.add(`${d.slice(0, 4)}9${d.slice(4)}`);
  return [...lista];
}

// Número digitado pela equipe → formato internacional (Brasil por padrão)
export function normalizarNumero(texto) {
  let d = soDigitos(texto);
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d;
}

export function formatarNumero(numero) {
  const d = soDigitos(numero);
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
    const ddd = d.slice(2, 4);
    const resto = d.slice(4);
    return `+55 (${ddd}) ${resto.slice(0, resto.length - 4)}-${resto.slice(-4)}`;
  }
  return d ? `+${d}` : '';
}

// ---- Assinatura do webhook (garante que veio mesmo da Meta) ----------------
export function assinaturaValida(corpoBruto, cabecalho, appSecret) {
  if (!cabecalho || !appSecret) return false;
  const esperado = `sha256=${crypto.createHmac('sha256', appSecret).update(corpoBruto, 'utf8').digest('hex')}`;
  return esperado.length === cabecalho.length && crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(cabecalho));
}

// ---- Conversas -------------------------------------------------------------
export async function obterConversaWhatsApp(supabaseAdmin, canal, numero, nome) {
  const variantes = variantesNumero(numero);
  const { data: existente } = await supabaseAdmin.from('atendimento_conversas')
    .select('*').eq('canal_id', canal.id).in('chave_externa', variantes)
    .order('id', { ascending: true }).limit(1).maybeSingle();
  if (existente) {
    if (nome && !existente.contato_nome) {
      await supabaseAdmin.from('atendimento_conversas').update({ contato_nome: nome }).eq('id', existente.id);
      existente.contato_nome = nome;
    }
    return existente;
  }
  const nova = {
    hotel_id: canal.hotel_id, canal_id: canal.id, canal_tipo: 'WHATSAPP', chave_externa: soDigitos(numero),
    contato_nome: nome || null, contato_endereco: formatarNumero(numero), status: 'ABERTA',
  };
  const { data, error } = await supabaseAdmin.from('atendimento_conversas').insert(nova).select().single();
  if (!error) return data;
  // Duas mensagens chegaram juntas e a outra criou primeiro: usa a que existe
  const { data: deNovo } = await supabaseAdmin.from('atendimento_conversas')
    .select('*').eq('canal_id', canal.id).in('chave_externa', variantes).limit(1).maybeSingle();
  if (deNovo) return deNovo;
  throw new Error('Não foi possível criar a conversa: ' + error.message);
}

// ---- Receber ---------------------------------------------------------------
const TIPOS_MIDIA = ['image', 'video', 'audio', 'document', 'sticker'];
const NOME_TIPO = { image: 'imagem', video: 'video', audio: 'audio', document: 'documento', sticker: 'figurinha' };
const EXTENSAO = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/3gpp': '3gp',
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/amr': 'amr',
  'application/pdf': 'pdf',
};

export async function baixarMidia(token, mediaId) {
  const info = await graph(token, mediaId);
  if (!info?.url) throw new ErroWhatsApp('A Meta não informou o endereço do arquivo.');
  let resposta;
  try { resposta = await fetch(info.url, { headers: { Authorization: `Bearer ${token}` } }); }
  catch (e) { throw new ErroWhatsApp('Sem conexão para baixar o arquivo do WhatsApp.'); }
  if (!resposta.ok) throw new ErroWhatsApp(`Não foi possível baixar o arquivo (status ${resposta.status}).`);
  return { dados: Buffer.from(await resposta.arrayBuffer()), mime: (info.mime_type || '').split(';')[0] || 'application/octet-stream' };
}

async function converterMensagem({ supabaseAdmin, canal, token, msg }) {
  const base = { tipo: 'texto', texto: null, anexos: [] };
  const t = msg.type;
  if (t === 'text') return { ...base, texto: msg.text?.body || '' };
  if (TIPOS_MIDIA.includes(t)) {
    const m = msg[t] || {};
    const saida = { ...base, tipo: NOME_TIPO[t], texto: m.caption || null };
    const mimeInformado = (m.mime_type || '').split(';')[0];
    const nome = m.filename || `${NOME_TIPO[t]}-${msg.id.slice(-8)}.${EXTENSAO[mimeInformado] || 'bin'}`;
    try {
      const { dados, mime } = await baixarMidia(token, m.id);
      const caminho = await guardarAnexo(supabaseAdmin, canal.hotel_id, { nome, mime, dados });
      saida.anexos = [{ nome, mime, tamanho: dados.length, caminho, voz: t === 'audio' && m.voice === true }];
    } catch (e) {
      saida.anexos = [{ nome, mime: mimeInformado, erro: e.message, mediaId: m.id }];
    }
    return saida;
  }
  if (t === 'location') {
    const l = msg.location || {};
    const local = [l.name, l.address].filter(Boolean).join(' — ');
    return { ...base, tipo: 'localizacao', texto: `📍 ${local || 'Localização'}\nhttps://maps.google.com/?q=${l.latitude},${l.longitude}` };
  }
  if (t === 'contacts') {
    const linhas = (msg.contacts || []).map((c) => {
      const tel = (c.phones || []).map((p) => p.phone || p.wa_id).filter(Boolean).join(', ');
      return `👤 ${c.name?.formatted_name || 'Contato'}${tel ? ` — ${tel}` : ''}`;
    });
    return { ...base, tipo: 'contato', texto: linhas.join('\n') || 'Contato compartilhado' };
  }
  if (t === 'reaction') {
    return { ...base, tipo: 'reacao', texto: msg.reaction?.emoji ? `Reagiu com ${msg.reaction.emoji}` : 'Removeu a reação', silenciosa: true };
  }
  if (t === 'button') return { ...base, texto: msg.button?.text || msg.button?.payload || '' };
  if (t === 'interactive') {
    const i = msg.interactive || {};
    return { ...base, texto: i.button_reply?.title || i.list_reply?.title || i.nfm_reply?.body || '[resposta interativa]' };
  }
  const detalhe = msg.errors?.[0]?.title || msg.errors?.[0]?.message;
  return { ...base, tipo: 'outro', texto: `[Mensagem que o sistema ainda não mostra${t ? ` (${t})` : ''}${detalhe ? ` — ${detalhe}` : ''}. Veja no celular do WhatsApp.]` };
}

// Cliente que chegou por um anúncio da Meta ("Clique para o WhatsApp"):
// guarda de qual anúncio veio e coloca a etiqueta "AD" sozinho.
async function registrarAnuncio(supabaseAdmin, conversa, ref) {
  try {
    const origem = {
      tipo: ref.source_type === 'post' ? 'PUBLICACAO' : 'ANUNCIO',
      id: ref.source_id || null,
      url: ref.source_url || null,
      titulo: ref.headline ? String(ref.headline).slice(0, 200) : null,
      texto: ref.body ? String(ref.body).slice(0, 500) : null,
      midia: ref.image_url || ref.video_url || ref.thumbnail_url || null,
      ctwa_clid: ref.ctwa_clid || null,
      recebido_em: new Date().toISOString(),
    };
    await supabaseAdmin.from('atendimento_conversas').update({ origem }).eq('id', conversa.id);
    await supabaseAdmin.rpc('atendimento_adicionar_etiqueta', { p_conversa: conversa.id, p_nome: 'AD' });
  } catch (e) { /* a mensagem já foi gravada; a etiqueta é um extra */ }
}

const ORDEM_STATUS = { ENVIANDO: 0, ENVIADA: 1, ENTREGUE: 2, VISTA: 3, FALHOU: 9 };
const STATUS_META = { sent: 'ENVIADA', delivered: 'ENTREGUE', read: 'VISTA', failed: 'FALHOU' };

// Processa um "value" do webhook (mensagens novas e atualizações de entrega)
export async function processarValorWebhook(supabaseAdmin, canal, valor) {
  const resultado = { mensagens: 0, status: 0, erros: [], conversas: [] };
  const nomes = {};
  (valor.contacts || []).forEach((c) => { if (c?.wa_id) nomes[c.wa_id] = c.profile?.name || null; });

  let token = null;
  for (const msg of valor.messages || []) {
    try {
      if (!token) token = await tokenDoCanal(supabaseAdmin, canal);
      const conversa = await obterConversaWhatsApp(supabaseAdmin, canal, msg.from, nomes[msg.from]);
      // Já recebida antes? (a Meta às vezes manda a mesma mensagem duas vezes)
      const { data: repetida } = await supabaseAdmin.from('atendimento_mensagens')
        .select('id').eq('hotel_id', canal.hotel_id).eq('id_externo', msg.id).maybeSingle();
      if (repetida) continue;
      const conteudo = await converterMensagem({ supabaseAdmin, canal, token, msg });
      const { error } = await supabaseAdmin.from('atendimento_mensagens').upsert({
        hotel_id: canal.hotel_id, conversa_id: conversa.id, direcao: 'ENTRADA', tipo: conteudo.tipo,
        texto: conteudo.texto, anexos: conteudo.anexos, de: formatarNumero(msg.from), id_externo: msg.id,
        status_envio: conteudo.silenciosa ? 'LIDA' : 'NAO_LIDA',
        data_original: msg.timestamp ? new Date(Number(msg.timestamp) * 1000).toISOString() : new Date().toISOString(),
      }, { onConflict: 'hotel_id,id_externo', ignoreDuplicates: true });
      if (error) throw new Error(error.message);
      if (msg.referral) await registrarAnuncio(supabaseAdmin, conversa, msg.referral);
      resultado.mensagens += 1;
      // Mensagem nova do cliente: o robô (Fase 4) pode responder
      if (!conteudo.silenciosa && !resultado.conversas.includes(conversa.id)) resultado.conversas.push(conversa.id);
    } catch (e) {
      resultado.erros.push(e.message);
    }
  }

  for (const st of valor.statuses || []) {
    const novo = STATUS_META[st.status];
    if (!novo || !st.id) continue;
    const { data: atual } = await supabaseAdmin.from('atendimento_mensagens')
      .select('id, status_envio').eq('hotel_id', canal.hotel_id).eq('id_externo', st.id).maybeSingle();
    if (!atual) continue;
    const campos = {};
    if ((ORDEM_STATUS[novo] ?? 0) > (ORDEM_STATUS[atual.status_envio] ?? -1) || novo === 'FALHOU') {
      campos.status_envio = novo;
      campos.erro = novo === 'FALHOU' ? traduzirErro(st.errors?.[0] || {}).message : null;
    }
    const cobranca = camposCobranca(st.pricing);
    if (!Object.keys(campos).length && !cobranca) continue;
    let { error } = await supabaseAdmin.from('atendimento_mensagens').update({ ...campos, ...(cobranca || {}) }).eq('id', atual.id);
    // Sem o SQL da economia ainda: grava só a situação da entrega
    if (error && cobranca && Object.keys(campos).length && /cobrad|cobranca|column/i.test(error.message || '')) {
      ({ error } = await supabaseAdmin.from('atendimento_mensagens').update(campos).eq('id', atual.id));
    }
    if (!error && campos.status_envio) resultado.status += 1;
  }
  return resultado;
}

// O que a Meta informa sobre a cobrança da mensagem (vem junto com "sent" e
// "delivered"): billable = cobrada; type = regular (cobrada),
// free_customer_service (franquia grátis), free_entry_point (veio de anúncio)…
export function camposCobranca(pricing) {
  if (!pricing || typeof pricing !== 'object') return null;
  const tipo = pricing.type ? String(pricing.type).slice(0, 60) : null;
  const categoria = pricing.category ? String(pricing.category).slice(0, 60) : null;
  let cobrada = typeof pricing.billable === 'boolean' ? pricing.billable : null;
  if (cobrada === null && tipo) cobrada = tipo === 'regular';
  if (cobrada === null && !tipo && !categoria) return null;
  return { cobrada, cobranca_tipo: tipo, cobranca_categoria: categoria };
}

// ---- Enviar ----------------------------------------------------------------
function idEnviado(resposta) {
  return { idExterno: resposta?.messages?.[0]?.id || null, waId: resposta?.contacts?.[0]?.wa_id || null };
}

export async function enviarTexto({ token, canal, para, texto, previa = true }) {
  const r = await graph(token, `${canal.identificador}/messages`, {
    metodo: 'POST',
    json: { messaging_product: 'whatsapp', recipient_type: 'individual', to: para, type: 'text', text: { preview_url: previa, body: texto } },
  });
  return idEnviado(r);
}

// Limites do WhatsApp por tipo (MB)
const LIMITE_MB = { image: 5, video: 16, audio: 16, document: 100 };
const IMAGENS_ACEITAS = ['image/jpeg', 'image/png'];
const VIDEOS_ACEITOS = ['video/mp4', 'video/3gpp'];
const AUDIOS_ACEITOS = ['audio/aac', 'audio/amr', 'audio/mpeg', 'audio/mp4', 'audio/ogg'];

function tipoParaEnvio(mime, tamanho) {
  let tipo = 'document';
  if (IMAGENS_ACEITAS.includes(mime)) tipo = 'image';
  else if (VIDEOS_ACEITOS.includes(mime)) tipo = 'video';
  else if (AUDIOS_ACEITOS.includes(mime)) tipo = 'audio';
  if (tipo !== 'document' && tamanho > LIMITE_MB[tipo] * 1024 * 1024) tipo = 'document';
  if (tamanho > LIMITE_MB.document * 1024 * 1024) throw new ErroWhatsApp('Arquivo grande demais para o WhatsApp (máximo 100 MB).');
  return tipo;
}

export async function enviarArquivo({ token, canal, para, arquivo, legenda }) {
  const tipo = tipoParaEnvio(arquivo.mime, arquivo.dados.length);
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', arquivo.mime || 'application/octet-stream');
  form.append('file', new Blob([arquivo.dados], { type: arquivo.mime || 'application/octet-stream' }), arquivo.nome);
  const subido = await graph(token, `${canal.identificador}/media`, { metodo: 'POST', form });

  const conteudo = { id: subido.id };
  if (tipo === 'document') conteudo.filename = arquivo.nome;
  if (legenda && tipo !== 'audio') conteudo.caption = legenda;
  const r = await graph(token, `${canal.identificador}/messages`, {
    metodo: 'POST',
    json: { messaging_product: 'whatsapp', recipient_type: 'individual', to: para, type: tipo, [tipo]: conteudo },
  });
  return { ...idEnviado(r), tipo };
}

export async function enviarModelo({ token, canal, para, modelo }) {
  const componentes = [];
  if (modelo.variaveisCabecalho?.length) {
    componentes.push({ type: 'header', parameters: modelo.variaveisCabecalho.map((v) => ({ type: 'text', text: String(v) })) });
  }
  if (modelo.variaveisCorpo?.length) {
    componentes.push({ type: 'body', parameters: modelo.variaveisCorpo.map((v) => ({ type: 'text', text: String(v) })) });
  }
  const r = await graph(token, `${canal.identificador}/messages`, {
    metodo: 'POST',
    json: {
      messaging_product: 'whatsapp', recipient_type: 'individual', to: para, type: 'template',
      template: { name: modelo.nome, language: { code: modelo.idioma }, ...(componentes.length ? { components: componentes } : {}) },
    },
  });
  return idEnviado(r);
}

export async function marcarComoLida({ token, canal, idExterno }) {
  await graph(token, `${canal.identificador}/messages`, {
    metodo: 'POST', json: { messaging_product: 'whatsapp', status: 'read', message_id: idExterno },
  });
}

// ---- Modelos (templates) aprovados -----------------------------------------
function contarVariaveis(texto) {
  const numeros = [...String(texto || '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1]));
  return numeros.length ? Math.max(...numeros) : 0;
}

export async function listarModelos({ token, wabaId }) {
  const lista = [];
  let caminho = `${wabaId}/message_templates?fields=name,language,status,category,components&limit=200`;
  for (let pagina = 0; pagina < 5 && caminho; pagina += 1) {
    const r = await graph(token, caminho);
    (r.data || []).forEach((m) => {
      if (String(m.status).toUpperCase() !== 'APPROVED') return;
      const cab = (m.components || []).find((c) => c.type === 'HEADER');
      const corpo = (m.components || []).find((c) => c.type === 'BODY');
      const rodape = (m.components || []).find((c) => c.type === 'FOOTER');
      const botoes = (m.components || []).find((c) => c.type === 'BUTTONS');
      lista.push({
        nome: m.name,
        idioma: m.language,
        categoria: m.category,
        cabecalho: cab?.format === 'TEXT' ? cab.text : null,
        cabecalhoMidia: cab && cab.format && cab.format !== 'TEXT' ? cab.format : null,
        variaveisCabecalho: cab?.format === 'TEXT' ? contarVariaveis(cab.text) : 0,
        corpo: corpo?.text || '',
        variaveisCorpo: contarVariaveis(corpo?.text),
        rodape: rodape?.text || null,
        botoes: (botoes?.buttons || []).map((b) => b.text).filter(Boolean),
      });
    });
    const proximo = r.paging?.next;
    caminho = proximo ? proximo.replace(`${GRAPH}/`, '') : null;
  }
  return lista.sort((a, b) => a.nome.localeCompare(b.nome));
}

// Texto do modelo com as variáveis preenchidas (para mostrar na conversa)
export function textoDoModelo(modelo, info) {
  const trocar = (texto, valores) => String(texto || '').replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => valores?.[Number(n) - 1] ?? `{{${n}}}`);
  const partes = [];
  if (info?.cabecalho) partes.push(`*${trocar(info.cabecalho, modelo.variaveisCabecalho)}*`);
  partes.push(trocar(info?.corpo || `[Modelo: ${modelo.nome}]`, modelo.variaveisCorpo));
  if (info?.rodape) partes.push(`_${info.rodape}_`);
  return partes.join('\n');
}

// ---- Configuração do canal -------------------------------------------------
export async function informacoesNumero({ token, phoneNumberId }) {
  return graph(token, `${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,code_verification_status,platform_type,throughput,status`);
}

export async function inscreverAppNaConta({ token, wabaId }) {
  return graph(token, `${wabaId}/subscribed_apps`, { metodo: 'POST' });
}

export async function registrarNumero({ token, phoneNumberId, pin }) {
  return graph(token, `${phoneNumberId}/register`, { metodo: 'POST', json: { messaging_product: 'whatsapp', pin: String(pin) } });
}
