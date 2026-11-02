// ============================================================================
// CAIXA DE ENTRADA — TELEGRAM (robô do hotel no Telegram, Bot API)
// ============================================================================
// Só usado pelo servidor. O hotel cria um robô no Telegram (@BotFather) e cola
// o token em Canais. O sistema confere o token, liga o webhook
// (/api/telegram-webhook?canal=ID) com uma senha própria e passa a receber e
// responder as conversas. O cliente fala com o robô do hotel (ex.:
// @jrhotel_bot); o link t.me/… pode ir no site e no Instagram.
// Só conversas particulares (grupos e canais do Telegram são ignorados).
// ============================================================================

import crypto from 'crypto';
import { guardarAnexo, lerSegredo } from './servidor';
import { LIMITE_TEXTO, htmlTelegram, partirTexto } from './canaisTexto';

const API = 'https://api.telegram.org';

export class ErroTelegram extends Error {
  constructor(mensagem, codigo) { super(mensagem); this.codigo = codigo; }
}

function traduzir(status, descricao) {
  const d = String(descricao || '');
  if (status === 401 || /unauthorized/i.test(d)) return new ErroTelegram('O token do Telegram não vale (foi trocado ou digitado errado). Pegue o token de novo no @BotFather.', 401);
  if (/blocked by the user/i.test(d)) return new ErroTelegram('O cliente bloqueou o robô do hotel no Telegram. Não dá para mandar mensagem.', 403);
  if (/chat not found/i.test(d)) return new ErroTelegram('O Telegram não achou esta conversa.', 400);
  if (status === 429) return new ErroTelegram('Muitas mensagens seguidas no Telegram. Aguarde um pouco e tente de novo.', 429);
  if (/file is too big/i.test(d)) return new ErroTelegram('Arquivo grande demais para o Telegram.', 400);
  return new ErroTelegram(`O Telegram recusou: ${d || `status ${status}`}`, status);
}

async function chamar(token, metodo, { json, form } = {}) {
  let r;
  try {
    r = await fetch(`${API}/bot${token}/${metodo}`, {
      method: 'POST',
      headers: json ? { 'Content-Type': 'application/json' } : undefined,
      body: json ? JSON.stringify(json) : form,
    });
  } catch (e) {
    throw new ErroTelegram('Sem conexão com o Telegram. Tente de novo em instantes.');
  }
  const dados = await r.json().catch(() => null);
  if (!r.ok || !dados?.ok) throw traduzir(r.status, dados?.description);
  return dados.result;
}

export const tokenParece = (t) => /^\d{5,15}:[A-Za-z0-9_-]{30,60}$/.test(String(t || '').trim());

export async function tokenDoTelegram(supabaseAdmin, canal) {
  const token = await lerSegredo(supabaseAdmin, canal.hotel_id, 'telegram_token', canal.id);
  if (!token) throw new ErroTelegram('O token do Telegram deste canal não foi encontrado. O administrador precisa conectar de novo em Canais.');
  return token;
}

export async function dadosDoRobo(token) {
  return chamar(token, 'getMe');
}

export function novaSenhaWebhook() {
  return crypto.randomBytes(24).toString('hex');
}

export async function ligarWebhook(token, url, senha) {
  return chamar(token, 'setWebhook', {
    json: { url, secret_token: senha, allowed_updates: ['message', 'edited_message'], drop_pending_updates: false, max_connections: 10 },
  });
}

export async function desligarWebhook(token) {
  return chamar(token, 'deleteWebhook', { json: { drop_pending_updates: false } });
}

export async function situacaoWebhook(token) {
  return chamar(token, 'getWebhookInfo');
}

export function senhaConfere(recebida, esperada) {
  if (!recebida || !esperada || recebida.length !== esperada.length) return false;
  return crypto.timingSafeEqual(Buffer.from(recebida), Buffer.from(esperada));
}

// ---- Receber ---------------------------------------------------------------
async function baixarArquivo(token, fileId) {
  const info = await chamar(token, 'getFile', { json: { file_id: fileId } });
  if (!info?.file_path) throw new ErroTelegram('O Telegram não informou o arquivo.');
  let r;
  try { r = await fetch(`${API}/file/bot${token}/${info.file_path}`); } catch (e) { throw new ErroTelegram('Sem conexão para baixar o arquivo do Telegram.'); }
  if (!r.ok) throw new ErroTelegram(`Não foi possível baixar o arquivo (status ${r.status}).`);
  return { dados: Buffer.from(await r.arrayBuffer()), caminhoTelegram: info.file_path };
}

const EXT_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', mp4: 'video/mp4', oga: 'audio/ogg', ogg: 'audio/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4', pdf: 'application/pdf' };

async function converter(supabaseAdmin, canal, token, msg) {
  const base = { tipo: 'texto', texto: msg.text ?? msg.caption ?? null, anexos: [] };
  if (msg.text === '/start') return { ...base, texto: 'Olá! (começou a conversa pelo Telegram)' };
  let arquivo = null;
  if (msg.photo?.length) arquivo = { id: msg.photo[msg.photo.length - 1].file_id, tipo: 'imagem', nome: `foto-${msg.message_id}.jpg`, mime: 'image/jpeg' };
  else if (msg.document) arquivo = { id: msg.document.file_id, tipo: 'documento', nome: msg.document.file_name || `arquivo-${msg.message_id}`, mime: msg.document.mime_type };
  else if (msg.voice) arquivo = { id: msg.voice.file_id, tipo: 'audio', nome: `audio-${msg.message_id}.ogg`, mime: msg.voice.mime_type || 'audio/ogg', voz: true };
  else if (msg.audio) arquivo = { id: msg.audio.file_id, tipo: 'audio', nome: msg.audio.file_name || `audio-${msg.message_id}.mp3`, mime: msg.audio.mime_type };
  else if (msg.video) arquivo = { id: msg.video.file_id, tipo: 'video', nome: msg.video.file_name || `video-${msg.message_id}.mp4`, mime: msg.video.mime_type || 'video/mp4' };
  else if (msg.video_note) arquivo = { id: msg.video_note.file_id, tipo: 'video', nome: `video-${msg.message_id}.mp4`, mime: 'video/mp4' };
  if (arquivo) {
    const saida = { ...base, tipo: arquivo.tipo };
    try {
      const { dados, caminhoTelegram } = await baixarArquivo(token, arquivo.id);
      const mime = arquivo.mime || EXT_MIME[String(caminhoTelegram).split('.').pop().toLowerCase()] || 'application/octet-stream';
      const caminho = await guardarAnexo(supabaseAdmin, canal.hotel_id, { nome: arquivo.nome, mime, dados });
      saida.anexos = [{ nome: arquivo.nome, mime, tamanho: dados.length, caminho, ...(arquivo.voz ? { voz: true } : {}) }];
    } catch (e) {
      saida.anexos = [{ nome: arquivo.nome, mime: arquivo.mime || '', erro: e.message }];
    }
    return saida;
  }
  if (msg.sticker) return { ...base, tipo: 'texto', texto: `${msg.sticker.emoji || '🙂'} (figurinha)` };
  if (msg.location) return { ...base, tipo: 'localizacao', texto: `📍 https://maps.google.com/?q=${msg.location.latitude},${msg.location.longitude}` };
  if (msg.contact) return { ...base, tipo: 'contato', texto: `👤 ${[msg.contact.first_name, msg.contact.last_name].filter(Boolean).join(' ')} — ${msg.contact.phone_number || ''}`.trim() };
  if (base.texto == null) return { ...base, texto: '[Mensagem que o sistema ainda não mostra. Veja no Telegram.]' };
  return base;
}

async function obterConversa(supabaseAdmin, canal, msg) {
  const chave = String(msg.chat.id);
  const { data: existente } = await supabaseAdmin.from('atendimento_conversas')
    .select('*').eq('canal_id', canal.id).eq('chave_externa', chave).limit(1).maybeSingle();
  if (existente) return existente;
  const nome = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || null;
  const { data, error } = await supabaseAdmin.from('atendimento_conversas').insert({
    hotel_id: canal.hotel_id, canal_id: canal.id, canal_tipo: 'TELEGRAM', chave_externa: chave,
    contato_nome: nome, contato_endereco: msg.from?.username ? `@${msg.from.username}` : 'Telegram', status: 'ABERTA',
  }).select().single();
  if (!error) return data;
  const { data: deNovo } = await supabaseAdmin.from('atendimento_conversas')
    .select('*').eq('canal_id', canal.id).eq('chave_externa', chave).limit(1).maybeSingle();
  if (deNovo) return deNovo;
  throw new Error('Não foi possível criar a conversa: ' + error.message);
}

export async function processarAtualizacao(supabaseAdmin, canal, update) {
  const resultado = { mensagens: 0, erros: [], conversas: [], entradas: [] };
  const msg = update.message || update.edited_message;
  if (!msg || msg.chat?.type !== 'private' || msg.from?.is_bot) return resultado;
  try {
    const token = await tokenDoTelegram(supabaseAdmin, canal);
    const conversa = await obterConversa(supabaseAdmin, canal, msg);
    const editada = !!update.edited_message;
    const idExterno = `tg:${msg.chat.id}:${msg.message_id}${editada ? `:e${msg.edit_date || ''}` : ''}`;
    const { data: repetida } = await supabaseAdmin.from('atendimento_mensagens')
      .select('id').eq('hotel_id', canal.hotel_id).eq('id_externo', idExterno).maybeSingle();
    if (repetida) return resultado;
    const conteudo = await converter(supabaseAdmin, canal, token, msg);
    if (editada && conteudo.texto) conteudo.texto = `✏️ (mensagem editada) ${conteudo.texto}`;
    const dataOriginal = new Date((msg.edit_date || msg.date || Date.now() / 1000) * 1000).toISOString();
    const { error } = await supabaseAdmin.from('atendimento_mensagens').upsert({
      hotel_id: canal.hotel_id, conversa_id: conversa.id, direcao: 'ENTRADA', tipo: conteudo.tipo, texto: conteudo.texto,
      anexos: conteudo.anexos, de: conversa.contato_endereco || null, id_externo: idExterno, status_envio: 'NAO_LIDA', data_original: dataOriginal,
    }, { onConflict: 'hotel_id,id_externo', ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    resultado.mensagens = 1;
    if (conteudo.texto) resultado.entradas.push({ conversaId: conversa.id, texto: conteudo.texto, data: dataOriginal });
    resultado.conversas.push(conversa.id);
  } catch (e) {
    resultado.erros.push(e.message);
  }
  return resultado;
}

// ---- Enviar ----------------------------------------------------------------
const METODO_ARQUIVO = (mime) => {
  if (['image/jpeg', 'image/png', 'image/webp'].includes(mime)) return ['sendPhoto', 'photo', 'imagem'];
  if (mime === 'video/mp4') return ['sendVideo', 'video', 'video'];
  if (/^audio\/(mpeg|mp4|m4a)/.test(mime)) return ['sendAudio', 'audio', 'audio'];
  return ['sendDocument', 'document', 'documento'];
};

export async function enviarTelegram(supabaseAdmin, { canal, para, texto, arquivos = [], semPrevia = false, aoEnviar = async () => {} }) {
  const token = await tokenDoTelegram(supabaseAdmin, canal);
  const total = arquivos.reduce((t, a) => t + (a.dados?.length || 0), 0);
  if (total > 50 * 1024 * 1024) throw new ErroTelegram('Arquivo grande demais para o Telegram (máximo 50 MB).');
  const feitos = [];
  for (const parte of partirTexto(texto, LIMITE_TEXTO.TELEGRAM)) {
    const r = await chamar(token, 'sendMessage', {
      json: { chat_id: para, text: htmlTelegram(parte), parse_mode: 'HTML', link_preview_options: { is_disabled: !!semPrevia } },
    });
    const f = { idExterno: `tg:${para}:${r.message_id}`, tipo: 'texto', texto: parte };
    feitos.push(f); await aoEnviar(f);
  }
  for (const a of arquivos) {
    const [metodo, campo, tipo] = METODO_ARQUIVO(a.mime);
    const form = new FormData();
    form.append('chat_id', String(para));
    form.append(campo, new Blob([a.dados], { type: a.mime || 'application/octet-stream' }), a.nome);
    const r = await chamar(token, metodo, { form });
    const f = { idExterno: `tg:${para}:${r.message_id}`, tipo, texto: null, anexo: a };
    feitos.push(f); await aoEnviar(f);
  }
  return feitos;
}
