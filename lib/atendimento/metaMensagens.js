// ============================================================================
// CAIXA DE ENTRADA — INSTAGRAM (Direct) e FACEBOOK (Messenger)
// ============================================================================
// Só usado pelo servidor. As duas usam a mesma API da Meta (Messenger
// Platform) e a chave (token) da Página do Facebook:
//   - Facebook: a Página recebe e responde no Messenger
//   - Instagram: a conta profissional ligada a essa Página recebe e responde
//     no Direct
// O webhook é o mesmo do WhatsApp (/api/meta-webhook): objetos "page" e
// "instagram". "standby" = mensagem que chegou enquanto outro app (ex.: o
// Asksuite) está no controle da conversa: fica gravada, mas o robô não responde.
// ============================================================================

import { GRAPH } from './whatsapp';
import { guardarAnexo, lerSegredo, PASTA_ANEXOS } from './servidor';
import { LIMITE_TEXTO, partirTexto, semMarcacao } from './canaisTexto';

export class ErroMeta extends Error {
  constructor(mensagem, codigo) { super(mensagem); this.codigo = codigo; }
}

const NOME = { INSTAGRAM: 'Instagram', FACEBOOK: 'Facebook' };

function traduzirErro(erro, tipo) {
  const codigo = Number(erro?.code);
  const sub = Number(erro?.error_subcode);
  const canal = NOME[tipo] || 'Instagram/Facebook';
  const detalhe = erro?.error_user_msg || erro?.message || 'erro desconhecido';
  if (sub === 2018278 || sub === 2534022) return new ErroMeta(`Já passaram mais de 24 horas desde a última mensagem do cliente. Pela regra do ${canal}, não dá mais para responder por aqui.`, codigo);
  if (sub === 2018108 || sub === 2534014) return new ErroMeta(`O ${canal} não deixou entregar: a pessoa não está disponível (pode ter bloqueado ou apagado a conta).`, codigo);
  if (codigo === 551) return new ErroMeta(`Esta pessoa não está disponível no ${canal} agora.`, codigo);
  if (codigo === 190) return new ErroMeta(`A chave de acesso (token) do ${canal} expirou ou foi revogada. O administrador precisa conectar de novo em Canais.`, codigo);
  if (codigo === 10 || codigo === 200 || codigo === 230) return new ErroMeta(`O app da Meta ainda não tem permissão para mandar mensagens no ${canal} (${detalhe}). Confira as permissões e a análise do app (Acesso avançado).`, codigo);
  if (codigo === 613 || codigo === 4 || codigo === 32) return new ErroMeta(`Muitas mensagens seguidas no ${canal}. Aguarde um pouco e tente de novo.`, codigo);
  return new ErroMeta(`O ${canal} recusou: ${detalhe}`, codigo);
}

async function graph(token, caminho, { metodo = 'GET', json, tipo } = {}) {
  let resposta;
  try {
    resposta = await fetch(`${GRAPH}/${caminho}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${token}`, ...(json ? { 'Content-Type': 'application/json' } : {}) },
      body: json ? JSON.stringify(json) : undefined,
    });
  } catch (e) {
    throw new ErroMeta('Sem conexão com a Meta. Tente de novo em instantes.');
  }
  const dados = await resposta.json().catch(() => null);
  if (!resposta.ok || dados?.error) throw traduzirErro(dados?.error || { message: `status ${resposta.status}` }, tipo);
  return dados;
}

export async function tokenDaPagina(supabaseAdmin, canal) {
  const token = await lerSegredo(supabaseAdmin, canal.hotel_id, 'meta_page_token', canal.id);
  if (!token) throw new ErroMeta(`A chave da Página deste canal não foi encontrada. O administrador precisa conectar o ${NOME[canal.tipo] || 'canal'} de novo em Canais.`);
  return token;
}

// ---- Conectar ----------------------------------------------------------------
// Com o token do usuário do sistema: as Páginas a que ele tem acesso, com a
// chave de cada Página e o Instagram ligado a ela. Se colarem a chave de uma
// Página direto, devolve só ela.
export async function listarPaginas(token) {
  const campos = 'id,name,access_token,instagram_business_account{id,username,name}';
  try {
    const r = await graph(token, `me/accounts?fields=${encodeURIComponent(campos)}&limit=100`);
    const lista = (r.data || []).map((p) => ({
      id: String(p.id), nome: p.name, token: p.access_token || null,
      instagram: p.instagram_business_account ? { id: String(p.instagram_business_account.id), usuario: p.instagram_business_account.username || null, nome: p.instagram_business_account.name || null } : null,
    }));
    if (lista.length) return lista;
  } catch (e) {
    if (e.codigo === 190) throw e;
  }
  const p = await graph(token, `me?fields=${encodeURIComponent('id,name,instagram_business_account{id,username,name}')}`);
  if (!p?.id) throw new ErroMeta('Este token não dá acesso a nenhuma Página do Facebook.');
  return [{
    id: String(p.id), nome: p.name, token,
    instagram: p.instagram_business_account ? { id: String(p.instagram_business_account.id), usuario: p.instagram_business_account.username || null, nome: p.instagram_business_account.name || null } : null,
  }];
}

// Liga o app à Página (sem isso, a Meta não manda as mensagens do Messenger
// nem do Direct do Instagram ligado a ela)
export async function inscreverPagina(tokenPagina, pageId) {
  const campos = 'messages,messaging_postbacks,message_echoes,messaging_referrals,standby';
  return graph(tokenPagina, `${pageId}/subscribed_apps?subscribed_fields=${campos}`, { metodo: 'POST' });
}

// Assina os webhooks "page" e "instagram" no app (mesmo endereço e token de
// verificação do WhatsApp). Precisa do ID do app e da chave secreta.
export async function assinarWebhooksDoApp({ appId, appSecret, url, tokenVerificacao }) {
  const tokenApp = `${appId}|${appSecret}`;
  const assinar = (objeto, campos) => fetch(`${GRAPH}/${appId}/subscriptions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ object: objeto, callback_url: url, fields: campos, verify_token: tokenVerificacao, include_values: 'true', access_token: tokenApp }),
  }).then(async (r) => {
    const j = await r.json().catch(() => null);
    if (!r.ok || j?.error) throw traduzirErro(j?.error || { message: `status ${r.status}` });
    return j;
  });
  await assinar('page', 'messages,messaging_postbacks,message_echoes,messaging_referrals,standby');
  await assinar('instagram', 'messages,messaging_postbacks,messaging_referral');
  return true;
}

export async function informacoesCanal(supabaseAdmin, canal) {
  const token = await tokenDaPagina(supabaseAdmin, canal);
  if (canal.tipo === 'INSTAGRAM') return graph(token, `${canal.identificador}?fields=username,name`, { tipo: canal.tipo });
  return graph(token, `${canal.identificador}?fields=name`, { tipo: canal.tipo });
}

// ---- Receber ---------------------------------------------------------------
async function nomeDoCliente(token, tipo, id) {
  try {
    if (tipo === 'INSTAGRAM') {
      const r = await graph(token, `${id}?fields=name,username`, { tipo });
      return { nome: r.name || null, usuario: r.username || null };
    }
    const r = await graph(token, `${id}?fields=first_name,last_name`, { tipo });
    return { nome: [r.first_name, r.last_name].filter(Boolean).join(' ') || null, usuario: null };
  } catch (e) {
    return { nome: null, usuario: null };
  }
}

async function obterConversa(supabaseAdmin, canal, token, clienteId) {
  const { data: existente } = await supabaseAdmin.from('atendimento_conversas')
    .select('*').eq('canal_id', canal.id).eq('chave_externa', String(clienteId)).limit(1).maybeSingle();
  if (existente) return existente;
  const perfil = await nomeDoCliente(token, canal.tipo, clienteId);
  const nova = {
    hotel_id: canal.hotel_id, canal_id: canal.id, canal_tipo: canal.tipo, chave_externa: String(clienteId),
    contato_nome: perfil.nome || (perfil.usuario ? `@${perfil.usuario}` : null),
    contato_endereco: canal.tipo === 'INSTAGRAM' ? (perfil.usuario ? `@${perfil.usuario}` : 'Instagram') : 'Messenger',
    status: 'ABERTA',
  };
  const { data, error } = await supabaseAdmin.from('atendimento_conversas').insert(nova).select().single();
  if (!error) return data;
  const { data: deNovo } = await supabaseAdmin.from('atendimento_conversas')
    .select('*').eq('canal_id', canal.id).eq('chave_externa', String(clienteId)).limit(1).maybeSingle();
  if (deNovo) return deNovo;
  throw new Error('Não foi possível criar a conversa: ' + error.message);
}

const TIPO_ANEXO = { image: 'imagem', video: 'video', audio: 'audio', file: 'documento' };
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'video/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'application/pdf': 'pdf' };

async function baixarDaUrl(url) {
  let r;
  try { r = await fetch(url); } catch (e) { throw new ErroMeta('Sem conexão para baixar o arquivo.'); }
  if (!r.ok) throw new ErroMeta(`Não foi possível baixar o arquivo (status ${r.status}).`);
  return { dados: Buffer.from(await r.arrayBuffer()), mime: (r.headers.get('content-type') || 'application/octet-stream').split(';')[0] };
}

async function converterMensagem(supabaseAdmin, canal, message, mid) {
  const saida = { tipo: 'texto', texto: message.text || null, anexos: [] };
  if (message.quick_reply?.payload && !saida.texto) saida.texto = message.quick_reply.payload;
  const anexos = message.attachments || [];
  for (const [i, a] of anexos.entries()) {
    const url = a?.payload?.url;
    if (TIPO_ANEXO[a.type] && url) {
      if (saida.tipo === 'texto') saida.tipo = TIPO_ANEXO[a.type];
      try {
        const { dados, mime } = await baixarDaUrl(url);
        const nome = `${TIPO_ANEXO[a.type]}-${String(mid).slice(-8)}-${i + 1}.${EXT[mime] || 'bin'}`;
        const caminho = await guardarAnexo(supabaseAdmin, canal.hotel_id, { nome, mime, dados });
        saida.anexos.push({ nome, mime, tamanho: dados.length, caminho });
      } catch (e) {
        saida.anexos.push({ nome: `${TIPO_ANEXO[a.type]}-${i + 1}`, mime: '', erro: e.message });
      }
    } else if (a.type === 'story_mention') {
      saida.texto = [saida.texto, `📸 Marcou o hotel num story${url ? `: ${url}` : ''}`].filter(Boolean).join('\n');
    } else if (['share', 'ig_reel', 'reel', 'ig_post', 'template', 'fallback'].includes(a.type)) {
      const link = url || a?.payload?.link || a?.url || '';
      saida.texto = [saida.texto, `🔗 Compartilhou uma publicação${link ? `: ${link}` : ''}`].filter(Boolean).join('\n');
    } else if (a.type === 'location') {
      const c = a?.payload?.coordinates;
      saida.tipo = 'localizacao';
      saida.texto = c ? `📍 https://maps.google.com/?q=${c.lat},${c.long}` : '📍 Localização';
    }
  }
  if (message.reply_to?.story) saida.texto = [`↩️ Respondeu a um story${message.reply_to.story.url ? ` (${message.reply_to.story.url})` : ''}`, saida.texto].filter(Boolean).join('\n');
  if (!saida.texto && !saida.anexos.length) saida.texto = `[Mensagem que o sistema ainda não mostra. Veja no ${NOME[canal.tipo]}.]`;
  return saida;
}

// Cliente que chegou por anúncio ("Clique para o Messenger/Direct")
async function registrarAnuncio(supabaseAdmin, conversa, ref) {
  try {
    const ctx = ref.ads_context_data || {};
    const origem = {
      tipo: 'ANUNCIO', id: ref.ad_id || null, url: null,
      titulo: ctx.ad_title ? String(ctx.ad_title).slice(0, 200) : null, texto: null,
      midia: ctx.photo_url || ctx.video_url || null, ref: ref.ref || null, recebido_em: new Date().toISOString(),
    };
    await supabaseAdmin.from('atendimento_conversas').update({ origem }).eq('id', conversa.id);
    await supabaseAdmin.rpc('atendimento_adicionar_etiqueta', { p_conversa: conversa.id, p_nome: 'AD' });
  } catch (e) { /* a etiqueta é um extra */ }
}

// Um "entry" do webhook (objeto "page" ou "instagram"). Devolve as conversas
// com mensagem nova do cliente (para o robô) e os textos (etiquetas por frase).
export async function processarEntradaMeta(supabaseAdmin, canal, entrada) {
  const resultado = { mensagens: 0, erros: [], conversas: [], entradas: [] };
  const eventos = [
    ...(entrada.messaging || []).map((e) => ({ e, standby: false })),
    ...(entrada.standby || []).map((e) => ({ e, standby: true })),
  ];
  if (!eventos.length) return resultado;
  let token = null;
  let esperouEco = false;
  for (const { e, standby } of eventos) {
    try {
      const message = e.message;
      const ref = e.referral || e.postback?.referral || message?.referral || null;
      if (!message && !e.postback && !ref) continue; // leitura, entrega, reação…
      if (message?.is_deleted) continue;
      if (!token) token = await tokenDaPagina(supabaseAdmin, canal);
      const eco = !!message?.is_echo;
      const clienteId = eco ? e.recipient?.id : e.sender?.id;
      if (!clienteId || String(clienteId) === String(canal.identificador) || String(clienteId) === String(canal.config?.pageId)) continue;
      const conversa = await obterConversa(supabaseAdmin, canal, token, clienteId);
      const mid = message?.mid || (e.postback ? `pb:${clienteId}:${e.timestamp}` : `ref:${clienteId}:${e.timestamp}`);
      const dataOriginal = e.timestamp ? new Date(Number(e.timestamp)).toISOString() : new Date().toISOString();

      if (ref && (ref.source === 'ADS' || ref.ad_id)) await registrarAnuncio(supabaseAdmin, conversa, ref);
      if (!message && !e.postback) continue; // só a origem (anúncio), sem mensagem

      const { data: repetida } = await supabaseAdmin.from('atendimento_mensagens')
        .select('id').eq('hotel_id', canal.hotel_id).eq('id_externo', mid).maybeSingle();
      if (repetida) continue;

      const conteudo = e.postback
        ? { tipo: 'texto', texto: e.postback.title || e.postback.payload || '[botão]', anexos: [] }
        : await converterMensagem(supabaseAdmin, canal, message, mid);

      if (eco) {
        // A Meta também avisa as mensagens que o próprio sistema mandou: espera
        // um instante (uma vez por chamada) para a nossa já estar gravada
        if (!esperouEco) { esperouEco = true; await new Promise((ok) => setTimeout(ok, 2000)); }
        const { data: nossa } = await supabaseAdmin.from('atendimento_mensagens')
          .select('id').eq('hotel_id', canal.hotel_id).eq('id_externo', mid).maybeSingle();
        if (nossa) continue;
        // Resposta mandada fora do sistema (app do Instagram, caixa da Meta ou
        // outro app, como o Asksuite): fica no histórico como da empresa
        const { error } = await supabaseAdmin.from('atendimento_mensagens').upsert({
          hotel_id: canal.hotel_id, conversa_id: conversa.id, direcao: 'SAIDA', tipo: conteudo.tipo, texto: conteudo.texto,
          anexos: conteudo.anexos, id_externo: mid, status_envio: 'ENVIADA', data_original: dataOriginal,
        }, { onConflict: 'hotel_id,id_externo', ignoreDuplicates: true });
        if (error) throw new Error(error.message);
        continue;
      }

      const { error } = await supabaseAdmin.from('atendimento_mensagens').upsert({
        hotel_id: canal.hotel_id, conversa_id: conversa.id, direcao: 'ENTRADA', tipo: conteudo.tipo, texto: conteudo.texto,
        anexos: conteudo.anexos, de: conversa.contato_endereco || null, id_externo: mid, status_envio: 'NAO_LIDA', data_original: dataOriginal,
      }, { onConflict: 'hotel_id,id_externo', ignoreDuplicates: true });
      if (error) throw new Error(error.message);
      resultado.mensagens += 1;
      if (conteudo.texto) resultado.entradas.push({ conversaId: conversa.id, texto: conteudo.texto, data: dataOriginal });
      // Enquanto outro app controla a conversa (standby), o robô não responde
      if (!standby && !resultado.conversas.includes(conversa.id)) resultado.conversas.push(conversa.id);
    } catch (erro) {
      resultado.erros.push(erro.message);
    }
  }
  return resultado;
}

// ---- Enviar ----------------------------------------------------------------
const IMAGENS = ['image/jpeg', 'image/png', 'image/gif'];
function tipoDoArquivo(tipoCanal, mime) {
  if (IMAGENS.includes(mime)) return 'image';
  if (mime === 'video/mp4') return 'video';
  if (/^audio\//.test(mime)) return 'audio';
  if (tipoCanal === 'FACEBOOK') return 'file';
  return null;
}

async function linkTemporario(supabaseAdmin, caminho) {
  const { data, error } = await supabaseAdmin.storage.from(PASTA_ANEXOS).createSignedUrl(caminho, 900);
  if (error || !data?.signedUrl) throw new ErroMeta('Não foi possível preparar o arquivo para envio.');
  return data.signedUrl;
}

// Texto (cortado no limite do canal) e anexos. Cada pedaço enviado passa por
// aoEnviar na hora (para gravar), e a lista volta no fim: [{ idExterno, tipo, texto, anexo }]
export async function enviarMeta(supabaseAdmin, { canal, para, texto, arquivos = [], aoEnviar = async () => {} }) {
  const token = await tokenDaPagina(supabaseAdmin, canal);
  const enviar = (message) => graph(token, 'me/messages', {
    metodo: 'POST', tipo: canal.tipo,
    json: { recipient: { id: String(para) }, messaging_type: 'RESPONSE', message },
  });
  for (const a of arquivos) {
    if (!tipoDoArquivo(canal.tipo, a.mime)) {
      throw new ErroMeta(canal.tipo === 'INSTAGRAM'
        ? 'No Instagram dá para mandar foto (JPG ou PNG), vídeo MP4 e áudio. Envie outros arquivos por WhatsApp ou e-mail.'
        : 'Formato de arquivo não aceito pelo Messenger.');
    }
    if (canal.tipo === 'INSTAGRAM' && IMAGENS.includes(a.mime) && a.dados?.length > 8 * 1024 * 1024) throw new ErroMeta('Foto grande demais para o Instagram (máximo 8 MB).');
  }
  const feitos = [];
  for (const parte of partirTexto(semMarcacao(texto), LIMITE_TEXTO[canal.tipo] || 1000)) {
    const r = await enviar({ text: parte });
    const f = { idExterno: r.message_id || null, tipo: 'texto', texto: parte };
    feitos.push(f); await aoEnviar(f);
  }
  for (const a of arquivos) {
    const tipo = tipoDoArquivo(canal.tipo, a.mime);
    const url = await linkTemporario(supabaseAdmin, a.caminho);
    const r = await enviar({ attachment: { type: tipo, payload: { url, is_reusable: false } } });
    const f = { idExterno: r.message_id || null, tipo: TIPO_ANEXO[tipo] || 'documento', texto: null, anexo: a };
    feitos.push(f); await aoEnviar(f);
  }
  return feitos;
}
