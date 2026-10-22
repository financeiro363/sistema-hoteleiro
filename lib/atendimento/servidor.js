// ============================================================================
// CAIXA DE ENTRADA — funções do SERVIDOR (só usadas em app/api/...)
// ============================================================================
// - quem está chamando e se pode atender (ADMIN ou COLABORADOR com permissão)
// - segredos criptografados (tokens do WhatsApp, senhas do Google)
// - assinatura de textos (link de conexão do Gmail, chamada agendada)
// - anexos no Storage (pasta privada "atendimento-anexos")
// ============================================================================

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { criptografar, descriptografar } from '../cloudbedsCrypto';

export const PASTA_ANEXOS = 'atendimento-anexos';
export const FUSO_HOTEL = 'America/Fortaleza';

export function variaveisAmbiente() {
  const v = {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    chaveAnonima: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    chaveMestra: process.env.SUPABASE_SERVICE_ROLE_KEY,
    segredoCripto: process.env.CLOUDBEDS_CRYPTO_SECRET,
  };
  if (!v.supabaseUrl || !v.chaveAnonima || !v.chaveMestra || !v.segredoCripto) {
    throw new Error('O servidor não está configurado corretamente (faltam variáveis de ambiente).');
  }
  return v;
}

export function clienteAdmin() {
  const v = variaveisAmbiente();
  return createClient(v.supabaseUrl, v.chaveMestra, { auth: { persistSession: false } });
}

export function respostaErro(mensagem, status = 400, extra = {}) {
  return Response.json({ erro: mensagem, ...extra }, { status });
}

// Mensagem amigável quando o SQL ainda não foi rodado
export function erroBanco(error, prefixo = 'Não foi possível concluir') {
  const m = String(error?.message || error || '');
  if (/(relation|table|column).*(atendimento_|pode_acessar_atendimento)|atendimento_\w+.*(does not exist|schema cache)|could not find the table/i.test(m)) {
    return 'A Caixa de Entrada ainda não foi ativada no banco de dados (falta rodar o SQL da Caixa de Entrada no Supabase).';
  }
  // Erros do banco (têm código do Postgres/PostgREST) ganham o prefixo; os
  // demais já vêm com uma mensagem pronta em português.
  return error?.code && !error?.codigo ? `${prefixo}: ${m}` : m;
}

// ---- Quem está chamando ----------------------------------------------------
// Devolve { chamador, supabaseAdmin } ou { resposta } com o erro pronto.
export async function autenticar(request, { soAdmin = false } = {}) {
  let v;
  try { v = variaveisAmbiente(); } catch (e) { return { resposta: respostaErro(e.message, 500) }; }
  const token = (request.headers.get('authorization') || '').replace('Bearer ', '').trim();
  if (!token) return { resposta: respostaErro('Não autorizado — faça login novamente.', 401) };

  const comoChamador = createClient(v.supabaseUrl, v.chaveAnonima, {
    global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false },
  });
  const { data: dadosAuth, error: erroAuth } = await comoChamador.auth.getUser(token);
  if (erroAuth || !dadosAuth?.user) return { resposta: respostaErro('Sessão inválida ou expirada.', 401) };

  const supabaseAdmin = createClient(v.supabaseUrl, v.chaveMestra, { auth: { persistSession: false } });
  const { data: chamador, error } = await supabaseAdmin
    .from('usuarios').select('*').eq('auth_id', dadosAuth.user.id).maybeSingle();
  if (error || !chamador) return { resposta: respostaErro('Não foi possível confirmar seu usuário.', 403) };
  if (chamador.ativo === false) return { resposta: respostaErro('Seu acesso está desativado.', 403) };

  const souAdmin = chamador.papel === 'ADMIN';
  const podeAtender = souAdmin || (chamador.papel === 'COLABORADOR' && chamador.pode_acessar_atendimento === true);
  if (soAdmin && !souAdmin) return { resposta: respostaErro('Só administradores podem fazer isso.', 403) };
  if (!podeAtender) return { resposta: respostaErro('Você não tem permissão para usar a Caixa de Entrada.', 403) };

  return { chamador: { ...chamador, souAdmin }, supabaseAdmin };
}

// ---- Segredos criptografados -----------------------------------------------
export async function lerSegredo(supabaseAdmin, hotelId, chave, canalId = 0) {
  const { data } = await supabaseAdmin.from('atendimento_segredos')
    .select('valor_cifrado').eq('hotel_id', hotelId).eq('canal_id', canalId || 0).eq('chave', chave).maybeSingle();
  if (!data?.valor_cifrado) return null;
  try { return descriptografar(data.valor_cifrado, variaveisAmbiente().segredoCripto); }
  catch (e) { return null; }
}

export async function gravarSegredo(supabaseAdmin, hotelId, chave, valor, canalId = 0) {
  const { error } = await supabaseAdmin.from('atendimento_segredos').upsert({
    hotel_id: hotelId, canal_id: canalId || 0, chave,
    valor_cifrado: criptografar(String(valor), variaveisAmbiente().segredoCripto),
    atualizado_em: new Date().toISOString(),
  }, { onConflict: 'hotel_id,canal_id,chave' });
  if (error) throw new Error(erroBanco(error, 'Não foi possível guardar a chave'));
}

export async function apagarSegredos(supabaseAdmin, hotelId, canalId) {
  await supabaseAdmin.from('atendimento_segredos').delete().eq('hotel_id', hotelId).eq('canal_id', canalId);
}

// ---- Assinaturas (HMAC) ----------------------------------------------------
function hmac(texto) {
  return crypto.createHmac('sha256', variaveisAmbiente().segredoCripto).update(texto).digest('base64url');
}

// Texto assinado e com validade (usado no "Conectar Gmail")
export function assinarEstado(dados, validadeMin = 15) {
  const corpo = Buffer.from(JSON.stringify({ ...dados, exp: Date.now() + validadeMin * 60000 })).toString('base64url');
  return `${corpo}.${hmac(corpo)}`;
}

export function verificarEstado(estado) {
  const [corpo, assinatura] = String(estado || '').split('.');
  if (!corpo || !assinatura) return null;
  const esperado = hmac(corpo);
  if (esperado.length !== assinatura.length || !crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(assinatura))) return null;
  try {
    const dados = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8'));
    if (!dados.exp || dados.exp < Date.now()) return null;
    return dados;
  } catch (e) { return null; }
}

// Senha da chamada agendada (Netlify) — derivada do segredo que já existe,
// assim não é preciso criar outra variável de ambiente.
export function segredoAgendamento() {
  return hmac('atendimento-sincronizacao-agendada');
}

export function chamadaAgendadaValida(request) {
  const recebido = request.headers.get('x-atendimento-agendado') || '';
  const esperado = segredoAgendamento();
  return recebido.length === esperado.length && crypto.timingSafeEqual(Buffer.from(recebido), Buffer.from(esperado));
}

// ---- Endereço do site (para links de retorno) ------------------------------
export function origemDoSite(request) {
  const cabecalhoHost = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const protocolo = request.headers.get('x-forwarded-proto') || 'https';
  if (cabecalhoHost) return `${protocolo.split(',')[0]}://${cabecalhoHost.split(',')[0]}`;
  return new URL(request.url).origin;
}

// ---- Anexos no Storage -----------------------------------------------------
function nomeSeguro(nome) {
  const limpo = String(nome || 'arquivo').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').slice(-80);
  return limpo || 'arquivo';
}

export function caminhoAnexo(hotelId, nome) {
  const dia = new Date().toISOString().slice(0, 10);
  return `${hotelId}/${dia}/${crypto.randomUUID()}-${nomeSeguro(nome)}`;
}

export async function guardarAnexo(supabaseAdmin, hotelId, { nome, mime, dados }) {
  const caminho = caminhoAnexo(hotelId, nome);
  const { error } = await supabaseAdmin.storage.from(PASTA_ANEXOS)
    .upload(caminho, dados, { contentType: mime || 'application/octet-stream', upsert: false });
  if (error) throw new Error('Não foi possível guardar o anexo: ' + error.message);
  return caminho;
}

export async function lerAnexo(supabaseAdmin, caminho) {
  const { data, error } = await supabaseAdmin.storage.from(PASTA_ANEXOS).download(caminho);
  if (error || !data) throw new Error('Não foi possível ler o anexo guardado.');
  return Buffer.from(await data.arrayBuffer());
}

// ---- Textos ----------------------------------------------------------------
export function resumoTexto(texto, max = 160) {
  const t = String(texto || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function soDigitos(texto) {
  return String(texto || '').replace(/\D/g, '');
}
