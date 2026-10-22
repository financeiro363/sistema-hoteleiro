// ============================================================================
// CAIXA DE ENTRADA — E-MAIL (Gmail do Google Workspace do hotel)
// ============================================================================
// Só usado pelo servidor.
// - Conexão: OAuth do Google como "app interno" do Workspace (sem auditoria do
//   Google e sem a conexão cair a cada 7 dias). Cada caixa (reservas@,
//   eventos@...) é conectada uma vez em Caixa de Entrada → Canais.
// - Receber: a cada sincronização, busca no Gmail só o que mudou desde a
//   última vez (historyId). Cada fio de e-mail (thread) vira uma conversa.
// - Responder: envia pelo próprio Gmail, no mesmo fio, com a assinatura da
//   caixa — a mensagem aparece também em "Enviados" no Gmail.
// ============================================================================

import { guardarAnexo, lerSegredo, gravarSegredo, resumoTexto } from './servidor';

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const GMAIL_UPLOAD = 'https://gmail.googleapis.com/upload/gmail/v1/users/me';
export const ESCOPOS_GMAIL = ['https://www.googleapis.com/auth/gmail.modify'];

const DIAS_IMPORTACAO_INICIAL = 3;
const MAX_MENSAGENS_POR_SINCRONIZACAO = 40;

export class ErroGmail extends Error {
  constructor(mensagem, codigo) { super(mensagem); this.codigo = codigo; }
}

// ---- OAuth -----------------------------------------------------------------
export function urlAutorizacao({ clientId, redirectUri, estado, email }) {
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: ESCOPOS_GMAIL.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: estado,
  });
  if (email) p.set('login_hint', email);
  return `${GOOGLE_AUTH}?${p.toString()}`;
}

async function chamarToken(parametros) {
  let resposta;
  try {
    resposta = await fetch(GOOGLE_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(parametros).toString(),
    });
  } catch (e) { throw new ErroGmail('Sem conexão com o Google. Tente de novo.'); }
  const dados = await resposta.json().catch(() => null);
  if (!resposta.ok || !dados?.access_token) {
    const codigo = dados?.error || `status ${resposta.status}`;
    const mensagens = {
      invalid_grant: 'A conexão com o Gmail foi desfeita (senha trocada ou acesso removido). O administrador precisa conectar a caixa de novo.',
      invalid_client: 'O "ID do cliente" ou a "Chave secreta do cliente" do Google estão errados. Confira em Canais → Google.',
      redirect_uri_mismatch: 'O endereço de retorno não está cadastrado no Google Cloud. Confira o passo "URIs de redirecionamento autorizados".',
    };
    throw new ErroGmail(mensagens[codigo] || `O Google recusou: ${dados?.error_description || codigo}`, codigo);
  }
  return dados;
}

export async function trocarCodigo({ clientId, clientSecret, redirectUri, code }) {
  return chamarToken({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' });
}

export async function credenciaisGoogle(supabaseAdmin, hotelId) {
  const { data: config } = await supabaseAdmin.from('atendimento_config')
    .select('google_client_id').eq('hotel_id', hotelId).maybeSingle();
  const clientSecret = await lerSegredo(supabaseAdmin, hotelId, 'google_client_secret');
  if (!config?.google_client_id || !clientSecret) {
    throw new ErroGmail('O acesso do Google ainda não foi configurado. O administrador precisa preencher "ID do cliente" e "Chave secreta" em Canais.');
  }
  return { clientId: config.google_client_id, clientSecret };
}

// Token de acesso válido para a caixa (renova sozinho a cada ~1 hora)
export async function tokenDaCaixa(supabaseAdmin, canal) {
  const guardado = await lerSegredo(supabaseAdmin, canal.hotel_id, 'gmail_acesso', canal.id);
  if (guardado) {
    try {
      const { token, expira } = JSON.parse(guardado);
      if (token && expira > Date.now() + 60000) return token;
    } catch (e) { /* renova abaixo */ }
  }
  const refresh = await lerSegredo(supabaseAdmin, canal.hotel_id, 'gmail_refresh', canal.id);
  if (!refresh) throw new ErroGmail('Esta caixa de e-mail não está conectada. O administrador precisa conectá-la em Canais.');
  const { clientId, clientSecret } = await credenciaisGoogle(supabaseAdmin, canal.hotel_id);
  const novo = await chamarToken({ refresh_token: refresh, client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token' });
  await gravarSegredo(supabaseAdmin, canal.hotel_id, 'gmail_acesso',
    JSON.stringify({ token: novo.access_token, expira: Date.now() + (Number(novo.expires_in) || 3600) * 1000 }), canal.id);
  return novo.access_token;
}

// ---- Chamadas ao Gmail -----------------------------------------------------
export async function gmail(token, caminho, { metodo = 'GET', json, corpo, tipoConteudo, base = GMAIL } = {}) {
  let resposta;
  try {
    resposta = await fetch(`${base}/${caminho}`, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(json ? { 'Content-Type': 'application/json' } : {}),
        ...(tipoConteudo ? { 'Content-Type': tipoConteudo } : {}),
      },
      body: json ? JSON.stringify(json) : corpo,
    });
  } catch (e) { throw new ErroGmail('Sem conexão com o Gmail. Tente de novo em instantes.'); }
  if (resposta.status === 204) return {};
  const dados = await resposta.json().catch(() => null);
  if (!resposta.ok) {
    const msg = dados?.error?.message || `status ${resposta.status}`;
    if (resposta.status === 401) throw new ErroGmail('O Gmail recusou o acesso. Conecte a caixa de novo em Canais.', 401);
    if (resposta.status === 403) throw new ErroGmail(`O Gmail não permitiu: ${msg}. Confira se a API do Gmail está ativada no Google Cloud.`, 403);
    throw new ErroGmail(`O Gmail recusou: ${msg}`, resposta.status);
  }
  return dados;
}

export async function perfilDaCaixa(token) {
  return gmail(token, 'profile'); // { emailAddress, historyId }
}

export async function remetentesDaCaixa(token) {
  try {
    const r = await gmail(token, 'settings/sendAs');
    return r.sendAs || [];
  } catch (e) { return []; }
}

// ---- Ler um e-mail ---------------------------------------------------------
function decodificarBase64Url(dados) {
  return Buffer.from(String(dados || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function cabecalho(cabecalhos, nome) {
  const h = (cabecalhos || []).find((x) => String(x.name).toLowerCase() === nome.toLowerCase());
  return h ? h.value : '';
}

function charsetDe(parte) {
  const tipo = cabecalho(parte.headers, 'Content-Type');
  const m = /charset="?([^";]+)"?/i.exec(tipo);
  return (m ? m[1] : 'utf-8').toLowerCase();
}

function textoDaParte(parte) {
  const bytes = decodificarBase64Url(parte.body?.data);
  try { return new TextDecoder(charsetDe(parte)).decode(bytes); }
  catch (e) { return bytes.toString('utf8'); }
}

export function htmlParaTexto(html) {
  return String(html || '')
    .replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h\d|li|blockquote)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function lerMensagem(msg) {
  const cabs = msg.payload?.headers || [];
  const saida = {
    id: msg.id,
    threadId: msg.threadId,
    labels: msg.labelIds || [],
    de: cabecalho(cabs, 'From'),
    para: cabecalho(cabs, 'To'),
    cc: cabecalho(cabs, 'Cc'),
    assunto: cabecalho(cabs, 'Subject'),
    messageId: cabecalho(cabs, 'Message-ID') || cabecalho(cabs, 'Message-Id'),
    referencias: cabecalho(cabs, 'References'),
    respondeA: cabecalho(cabs, 'Reply-To'),
    data: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : new Date().toISOString(),
    texto: '',
    html: '',
    anexos: [],
  };
  const percorrer = (parte) => {
    if (!parte) return;
    const tipo = String(parte.mimeType || '').toLowerCase();
    if (parte.filename && (parte.body?.attachmentId || parte.body?.data)) {
      saida.anexos.push({
        nome: parte.filename, mime: tipo, tamanho: parte.body?.size || 0,
        gmail: { messageId: msg.id, attachmentId: parte.body?.attachmentId || null },
        inline: /inline/i.test(cabecalho(parte.headers, 'Content-Disposition')),
      });
      return;
    }
    if (tipo === 'text/plain' && !saida.texto && parte.body?.data) saida.texto = textoDaParte(parte);
    else if (tipo === 'text/html' && !saida.html && parte.body?.data) saida.html = textoDaParte(parte);
    (parte.parts || []).forEach(percorrer);
  };
  percorrer(msg.payload);
  if (!saida.texto && saida.html) saida.texto = htmlParaTexto(saida.html);
  if (!saida.texto && msg.snippet) saida.texto = msg.snippet;
  return saida;
}

// "Maria Silva <maria@x.com>" → { nome: 'Maria Silva', email: 'maria@x.com' }
export function separarEndereco(texto) {
  const t = String(texto || '').trim();
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>/.exec(t);
  if (m) return { nome: m[1].trim(), email: m[2].trim().toLowerCase() };
  const so = /([^\s<>,;]+@[^\s<>,;]+)/.exec(t);
  return { nome: '', email: so ? so[1].toLowerCase() : t.toLowerCase() };
}

export function listaDeEnderecos(texto) {
  return String(texto || '').split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((x) => separarEndereco(x).email).filter((e) => e.includes('@'));
}

// ---- Sincronizar uma caixa -------------------------------------------------
function enderecosDaCaixa(canal) {
  return new Set([canal.identificador, ...((canal.config?.enderecos) || [])].map((e) => String(e).toLowerCase()));
}

async function processarMensagem(supabaseAdmin, canal, token, idGmail, resultado) {
  const idExterno = `gmail:${idGmail}`;
  let bruto;
  try { bruto = await gmail(token, `messages/${idGmail}?format=full`); }
  catch (e) { if (e.codigo === 404) return; throw e; }
  const labels = bruto.labelIds || [];
  if (labels.some((l) => ['DRAFT', 'SPAM', 'TRASH', 'CHAT'].includes(l))) return;

  const m = lerMensagem(bruto);
  const meus = enderecosDaCaixa(canal);
  const remetente = separarEndereco(m.de);
  const doHotel = meus.has(remetente.email) || labels.includes('SENT');
  const naEntrada = labels.includes('INBOX');
  const propaganda = labels.includes('CATEGORY_PROMOTIONS') || labels.includes('CATEGORY_SOCIAL');

  let { data: conversa } = await supabaseAdmin.from('atendimento_conversas')
    .select('*').eq('canal_id', canal.id).eq('chave_externa', m.threadId).maybeSingle();

  if (!conversa) {
    // Só abre conversa nova para e-mail que chegou na caixa de entrada,
    // de fora do hotel, e que não é propaganda/rede social.
    if (doHotel || !naEntrada || propaganda) return;
    const contato = separarEndereco(m.respondeA || m.de);
    const { data: nova, error } = await supabaseAdmin.from('atendimento_conversas').insert({
      hotel_id: canal.hotel_id, canal_id: canal.id, canal_tipo: 'EMAIL', chave_externa: m.threadId,
      contato_nome: remetente.nome || contato.nome || null, contato_endereco: contato.email,
      assunto: m.assunto || '(sem assunto)', status: 'ABERTA',
    }).select().single();
    if (error) {
      const { data: deNovo } = await supabaseAdmin.from('atendimento_conversas')
        .select('*').eq('canal_id', canal.id).eq('chave_externa', m.threadId).maybeSingle();
      if (!deNovo) throw new Error('Não foi possível criar a conversa: ' + error.message);
      conversa = deNovo;
    } else {
      conversa = nova;
    }
  }

  const anexos = m.anexos.filter((a) => !a.inline || !/^image\//.test(a.mime) || a.tamanho > 20000);
  const { error } = await supabaseAdmin.from('atendimento_mensagens').upsert({
    hotel_id: canal.hotel_id, conversa_id: conversa.id,
    direcao: doHotel ? 'SAIDA' : 'ENTRADA', tipo: 'email',
    texto: m.texto, html: m.html || null, de: m.de, para: m.para, cc: m.cc || null, assunto: m.assunto,
    anexos, id_externo: idExterno,
    status_envio: doHotel ? 'ENVIADA' : (labels.includes('UNREAD') ? 'NAO_LIDA' : 'LIDA'),
    data_original: m.data,
  }, { onConflict: 'hotel_id,id_externo', ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  resultado.novas += 1;
}

export async function sincronizarCaixa(supabaseAdmin, canal) {
  const resultado = { novas: 0, erros: [] };
  const token = await tokenDaCaixa(supabaseAdmin, canal);
  const config = { ...(canal.config || {}) };
  const ids = [];
  let novoHistory = null;

  const importarRecentes = async () => {
    const perfil = await perfilDaCaixa(token);
    novoHistory = perfil.historyId;
    const q = encodeURIComponent(`in:inbox newer_than:${DIAS_IMPORTACAO_INICIAL}d -category:promotions -category:social`);
    const lista = await gmail(token, `messages?q=${q}&maxResults=${MAX_MENSAGENS_POR_SINCRONIZACAO}`);
    // O Gmail devolve da mais nova para a mais antiga: inverte para gravar em ordem
    (lista.messages || []).slice().reverse().forEach((x) => ids.push(x.id));
  };

  if (!config.historyId) {
    await importarRecentes();
  } else {
    try {
      let pagina = null;
      for (let i = 0; i < 4; i += 1) {
        const p = new URLSearchParams({ startHistoryId: String(config.historyId), historyTypes: 'messageAdded', maxResults: '500' });
        if (pagina) p.set('pageToken', pagina);
        const h = await gmail(token, `history?${p.toString()}`);
        (h.history || []).forEach((item) => (item.messagesAdded || []).forEach((x) => {
          if (x.message?.id) ids.push(x.message.id);
        }));
        novoHistory = h.historyId || novoHistory;
        pagina = h.nextPageToken;
        if (!pagina) break;
      }
    } catch (e) {
      if (e.codigo !== 404) throw e;
      await importarRecentes(); // histórico antigo demais: recomeça pelos últimos dias
    }
  }

  // Pula as que já estão no sistema (uma consulta só) e processa as novas em
  // ordem, no máximo MAX por rodada; o resto fica para a próxima sincronização.
  const unicos = [...new Set(ids)];
  const jaGravadas = new Set();
  for (let i = 0; i < unicos.length; i += 200) {
    const { data } = await supabaseAdmin.from('atendimento_mensagens').select('id_externo')
      .eq('hotel_id', canal.hotel_id).in('id_externo', unicos.slice(i, i + 200).map((id) => `gmail:${id}`));
    (data || []).forEach((r) => jaGravadas.add(r.id_externo));
  }
  let lidas = 0;
  let completo = true;
  for (const id of unicos) {
    if (jaGravadas.has(`gmail:${id}`)) continue;
    if (lidas >= MAX_MENSAGENS_POR_SINCRONIZACAO) { completo = false; break; }
    lidas += 1;
    try { await processarMensagem(supabaseAdmin, canal, token, id, resultado); }
    catch (e) { resultado.erros.push(e.message); }
  }
  resultado.pendentes = !completo;

  // Só avança o marcador quando tudo desta rodada foi lido
  if (novoHistory && (completo || !config.historyId)) config.historyId = String(novoHistory);
  await supabaseAdmin.from('atendimento_canais').update({
    config, ultima_sincronizacao: new Date().toISOString(),
    status: resultado.erros.length ? 'ERRO' : 'OK',
    erro: resultado.erros.length ? resultado.erros.slice(0, 3).join(' | ').slice(0, 500) : null,
  }).eq('id', canal.id);
  return resultado;
}

// ---- Escrever e enviar -----------------------------------------------------
function palavraCodificada(texto) {
  const t = String(texto || '');
  return /^[\x20-\x7E]*$/.test(t) ? t : `=?UTF-8?B?${Buffer.from(t, 'utf8').toString('base64')}?=`;
}

function enderecoFormatado(nome, email) {
  if (!nome) return email;
  const n = /^[\x20-\x7E]*$/.test(nome) ? `"${nome.replace(/"/g, '')}"` : palavraCodificada(nome);
  return `${n} <${email}>`;
}

function base64EmLinhas(buffer) {
  return buffer.toString('base64').replace(/(.{76})/g, '$1\r\n');
}

function escaparHtml(t) {
  return String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function montarEmail({ de, nomeRemetente, para, cc, assunto, texto, assinaturaHtml, emResposta, referencias, anexos = [] }) {
  const corpoHtml = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5">${escaparHtml(texto).replace(/\r?\n/g, '<br>')}</div>`
    + (assinaturaHtml ? `<br><div class="gmail_signature">${assinaturaHtml}</div>` : '');
  const corpoTexto = texto + (assinaturaHtml ? `\n\n--\n${htmlParaTexto(assinaturaHtml)}` : '');

  const b1 = `misto_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const b2 = `alt_${Math.random().toString(36).slice(2)}`;
  const linhas = [
    `From: ${enderecoFormatado(nomeRemetente, de)}`,
    `To: ${para}`,
    ...(cc ? [`Cc: ${cc}`] : []),
    `Subject: ${palavraCodificada(assunto)}`,
    ...(emResposta ? [`In-Reply-To: ${emResposta}`, `References: ${[referencias, emResposta].filter(Boolean).join(' ')}`] : []),
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${b1}"`,
    '',
    `--${b1}`,
    `Content-Type: multipart/alternative; boundary="${b2}"`,
    '',
    `--${b2}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    base64EmLinhas(Buffer.from(corpoTexto, 'utf8')),
    `--${b2}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    base64EmLinhas(Buffer.from(corpoHtml, 'utf8')),
    `--${b2}--`,
  ];
  for (const a of anexos) {
    const nome = palavraCodificada(a.nome);
    linhas.push(
      `--${b1}`,
      `Content-Type: ${a.mime || 'application/octet-stream'}; name="${nome}"`,
      `Content-Disposition: attachment; filename="${nome}"`,
      'Content-Transfer-Encoding: base64',
      '',
      base64EmLinhas(a.dados),
    );
  }
  linhas.push(`--${b1}--`, '');
  return { mime: linhas.join('\r\n'), html: corpoHtml };
}

// Dados para responder no mesmo fio (Message-ID e References da última mensagem)
export async function dadosParaResponder(token, threadId) {
  const fio = await gmail(token, `threads/${threadId}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References&metadataHeaders=Subject`);
  const ultima = (fio.messages || []).slice(-1)[0];
  const cabs = ultima?.payload?.headers || [];
  return {
    emResposta: cabecalho(cabs, 'Message-ID') || cabecalho(cabs, 'Message-Id') || null,
    referencias: cabecalho(cabs, 'References') || null,
    assunto: cabecalho(cabs, 'Subject') || '',
  };
}

export function assuntoDeResposta(assunto) {
  const a = String(assunto || '').trim() || '(sem assunto)';
  return /^(re|res|resp)\s*:/i.test(a) ? a : `Re: ${a}`;
}

export async function enviarEmail({ token, threadId, mime }) {
  const bruto = Buffer.from(mime, 'utf8');
  if (bruto.length < 4.5 * 1024 * 1024) {
    return gmail(token, 'messages/send', { metodo: 'POST', json: { raw: bruto.toString('base64url'), ...(threadId ? { threadId } : {}) } });
  }
  // E-mails grandes (anexos): envio por upload (o Gmail agrupa pelo In-Reply-To)
  if (bruto.length > 34 * 1024 * 1024) throw new ErroGmail('O e-mail ficou grande demais (máximo de 25 MB em anexos).');
  return gmail(token, 'messages/send?uploadType=media', { metodo: 'POST', corpo: bruto, tipoConteudo: 'message/rfc822', base: GMAIL_UPLOAD });
}

export async function marcarFioComoLido(token, threadId) {
  await gmail(token, `threads/${threadId}/modify`, { metodo: 'POST', json: { removeLabelIds: ['UNREAD'] } });
}

export async function baixarAnexoGmail(token, { messageId, attachmentId }) {
  const r = await gmail(token, `messages/${messageId}/attachments/${attachmentId}`);
  return decodificarBase64Url(r.data);
}

export function resumoEmail(m) {
  return resumoTexto(m.texto || m.assunto || '');
}
