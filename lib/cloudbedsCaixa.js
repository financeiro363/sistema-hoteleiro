// ============================================================================
// CLOUDBEDS — CAIXA (vendas avulsas do PDV e pagamentos da Sala de Reunião)
// ============================================================================
// Usado SÓ pelas rotas de servidor (app/api/...). Junta tudo o que é comum:
//   - conferir quem está chamando (token → usuário → hotel)
//   - ler a chave da Cloudbeds do hotel
//   - garantir a Conta da Casa (House Account) certa, criando se não existir
//   - lançar produto (postItem), pagamento (postPayment) e anular pagamento
//     (postVoidPayment) numa Conta da Casa
//
// Venda avulsa e Sala de Reunião não têm reserva de hóspede; por isso vão para
// uma Conta da Casa — é o caminho que a própria Cloudbeds indica para vendas a
// quem não está hospedado.
//
// A configuração (contas e formas de pagamento) fica na tabela
// cloudbeds_caixa_config e é feita pelo ADMIN em
// Operações → Fechamento de Caixa → ⚙️ Configurar Cloudbeds.
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import { descriptografar } from './cloudbedsCrypto';

export const CLOUDBEDS_V12 = 'https://api.cloudbeds.com/api/v1.2';
export const FUSO_HOTEL = 'America/Fortaleza';

// Formas de pagamento do sistema (iguais no PDV avulso e na Sala de Reunião)
export const FORMAS_SISTEMA = {
  DINHEIRO: 'Dinheiro',
  PIX: 'Pix',
  CARTAO_CREDITO: 'Cartão de crédito',
  CARTAO_DEBITO: 'Cartão de débito',
};

export const NOME_CONTA_PADRAO = {
  pdv: 'Conveniência – Vendas Avulsas',
  sala: 'Sala de Reunião',
};

export const ONDE_CONFIGURAR = 'Peça ao administrador para configurar em Operações → Fechamento de Caixa → ⚙️ Configurar Cloudbeds.';

export function hojeFortaleza() {
  return new Date().toLocaleDateString('en-CA', { timeZone: FUSO_HOTEL });
}

// ---- Quem está chamando --------------------------------------------------
// Devolve { chamador, supabaseAdmin, segredoCripto } ou { resposta } (erro pronto)
export async function autenticarChamada(request) {
  const tokenAcesso = (request.headers.get('authorization') || '').replace('Bearer ', '');
  if (!tokenAcesso) return { resposta: Response.json({ erro: 'Não autorizado — faça login novamente.' }, { status: 401 }) };

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chaveAnonima = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const chaveMestra = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const segredoCripto = process.env.CLOUDBEDS_CRYPTO_SECRET;
  if (!supabaseUrl || !chaveAnonima || !chaveMestra || !segredoCripto) {
    return { resposta: Response.json({ erro: 'O servidor não está configurado corretamente (faltam variáveis de ambiente).' }, { status: 500 }) };
  }

  const supabaseComoChamador = createClient(supabaseUrl, chaveAnonima, {
    global: { headers: { Authorization: `Bearer ${tokenAcesso}` } },
  });
  const { data: dadosAuth, error: erroAuth } = await supabaseComoChamador.auth.getUser(tokenAcesso);
  if (erroAuth || !dadosAuth?.user) return { resposta: Response.json({ erro: 'Sessão inválida ou expirada.' }, { status: 401 }) };

  const { data: chamador, error: erroChamador } = await supabaseComoChamador
    .from('usuarios').select('id, nome, hotel_id, papel').eq('auth_id', dadosAuth.user.id).single();
  if (erroChamador || !chamador) return { resposta: Response.json({ erro: 'Não foi possível confirmar seu usuário.' }, { status: 403 }) };

  return { chamador, supabaseAdmin: createClient(supabaseUrl, chaveMestra), segredoCripto };
}

// ---- Credencial e chamadas à Cloudbeds -----------------------------------
export async function carregarCloudbeds(supabaseAdmin, hotelId, segredoCripto) {
  const { data: credencial, error } = await supabaseAdmin
    .from('cloudbeds_credenciais').select('*').eq('hotel_id', hotelId).maybeSingle();
  if (error || !credencial?.api_key_cifrada || !credencial?.cloudbeds_property_id) {
    throw new Error('A integração com a Cloudbeds ainda não foi configurada para este hotel.');
  }
  let apiKey;
  try { apiKey = descriptografar(credencial.api_key_cifrada, segredoCripto); }
  catch (e) { throw new Error('Não foi possível ler a credencial da Cloudbeds salva.'); }
  return { apiKey, propertyId: String(credencial.cloudbeds_property_id) };
}

export class ErroCloudbeds extends Error {}

export async function chamarCloudbeds(cb, metodo, { verbo = 'POST', params = {} } = {}) {
  const campos = new URLSearchParams();
  campos.set('propertyID', cb.propertyId);
  Object.entries(params).forEach(([chave, valor]) => {
    if (valor !== undefined && valor !== null && valor !== '') campos.set(chave, String(valor));
  });
  const cabecalhos = { Authorization: `Bearer ${cb.apiKey}`, 'x-property-id': cb.propertyId };
  let resposta;
  try {
    resposta = verbo === 'GET'
      ? await fetch(`${CLOUDBEDS_V12}/${metodo}?${campos.toString()}`, { headers: cabecalhos })
      : await fetch(`${CLOUDBEDS_V12}/${metodo}`, {
        method: 'POST',
        headers: { ...cabecalhos, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: campos.toString(),
      });
  } catch (e) {
    throw new ErroCloudbeds('Sem conexão com a Cloudbeds. Tente de novo em instantes.');
  }
  const dados = await resposta.json().catch(() => null);
  if (!resposta.ok || !dados || dados.success === false) {
    const msg = dados?.message || dados?.error || `a Cloudbeds respondeu com erro (status ${resposta.status})`;
    throw new ErroCloudbeds(String(msg));
  }
  return dados;
}

// ---- Listas da Cloudbeds (para a tela de configuração) --------------------
export async function listarFormasPagamento(cb) {
  const dados = await chamarCloudbeds(cb, 'getPaymentMethods', { verbo: 'GET' });
  const lista = Array.isArray(dados?.data?.methods) ? dados.data.methods
    : Array.isArray(dados?.data) ? dados.data : [];
  return lista.map((m) => ({
    codigo: String(m.code ?? m.method ?? ''),
    metodo: String(m.method ?? m.code ?? ''),
    nome: String(m.name ?? m.method ?? m.code ?? ''),
    cartoes: (Array.isArray(m.cardTypes) ? m.cardTypes : [])
      .map((c) => ({ codigo: String(c.cardCode ?? ''), nome: String(c.cardName ?? c.cardCode ?? '') }))
      .filter((c) => c.codigo),
  })).filter((m) => m.codigo);
}

export async function listarContasDaCasa(cb) {
  const dados = await chamarCloudbeds(cb, 'getHouseAccountList', { verbo: 'GET' });
  const lista = Array.isArray(dados?.data) ? dados.data : [];
  return lista.map((c) => ({
    id: String(c.accountID ?? c.houseAccountID ?? ''),
    nome: String(c.accountName ?? ''),
    status: String(c.accountStatus ?? 'open').toLowerCase(),
    privada: c.isPrivate === true || c.isPrivate === 'true' || c.isPrivate === 1,
  })).filter((c) => c.id);
}

// ---- Configuração do hotel -------------------------------------------------
export async function carregarConfigCaixa(supabaseAdmin, hotelId) {
  const { data, error } = await supabaseAdmin
    .from('cloudbeds_caixa_config').select('*').eq('hotel_id', hotelId).maybeSingle();
  if (error) {
    if (/does not exist|schema cache|relation/i.test(error.message)) {
      throw new Error('O envio para a Cloudbeds ainda não foi ativado no banco de dados (falta rodar o SQL do caixa).');
    }
    throw new Error('Não foi possível ler a configuração da Cloudbeds: ' + error.message);
  }
  return data || { hotel_id: hotelId, formas: {}, enviar_pdv: true, enviar_sala: true };
}

const normalizar = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[–—-]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();

// Usa a Conta da Casa salva; se não houver, procura pelo nome na Cloudbeds e,
// se não achar, cria uma nova. O número fica salvo para as próximas vezes.
export async function garantirContaDaCasa({ cb, supabaseAdmin, hotelId, config, tipo }) {
  const campoId = tipo === 'pdv' ? 'conta_pdv_id' : 'conta_sala_id';
  const campoNome = tipo === 'pdv' ? 'conta_pdv_nome' : 'conta_sala_nome';
  if (config?.[campoId]) return String(config[campoId]);

  const nome = (config?.[campoNome] || NOME_CONTA_PADRAO[tipo]).trim();
  let id = null;
  try {
    const contas = await listarContasDaCasa(cb);
    const achada = contas.find((c) => normalizar(c.nome) === normalizar(nome) && c.status !== 'closed' && !c.privada);
    if (achada) id = achada.id;
  } catch (e) { /* se a lista falhar, tenta criar direto */ }

  if (!id) {
    const criada = await chamarCloudbeds(cb, 'postNewHouseAccount', { params: { accountName: nome, isPrivate: 'false' } });
    id = criada?.data?.houseAccountID ?? criada?.houseAccountID ?? null;
    if (!id) throw new ErroCloudbeds('a Cloudbeds não devolveu o número da Conta da Casa criada.');
  }
  id = String(id);
  await supabaseAdmin.from('cloudbeds_caixa_config')
    .upsert({ hotel_id: hotelId, [campoId]: id, [campoNome]: nome, atualizado_em: new Date().toISOString() });
  if (config) { config[campoId] = id; config[campoNome] = nome; }
  return id;
}

// Forma de pagamento da Cloudbeds ligada a uma forma do sistema
export function formaNaCloudbeds(config, formaSistema) {
  const chave = formaSistema === 'CARTAO' ? 'CARTAO_CREDITO' : formaSistema; // vendas antigas "Cartão"
  const forma = config?.formas?.[chave];
  if (!forma || (!forma.codigo && !forma.metodo)) {
    throw new Error(`A forma "${FORMAS_SISTEMA[chave] || formaSistema}" ainda não foi ligada a uma forma de pagamento da Cloudbeds. ${ONDE_CONFIGURAR}`);
  }
  return forma;
}

// ---- Lançamentos numa Conta da Casa ----------------------------------------
const pareceErroDeTipo = (mensagem) => /type|method|tipo|payment ?type|invalid/i.test(mensagem || '');

export async function lancarPagamento({ cb, contaId, forma, valor, descricao }) {
  const tipos = [...new Set([forma.codigo, forma.metodo].filter(Boolean))];
  let ultimoErro = null;
  for (const tipo of tipos) {
    try {
      const dados = await chamarCloudbeds(cb, 'postPayment', {
        params: {
          houseAccountID: contaId,
          type: tipo,
          amount: Number(valor).toFixed(2),
          cardType: forma.cartao || undefined,
          description: String(descricao || '').slice(0, 250),
        },
      });
      const id = dados.paymentID ?? dados.data?.paymentID ?? dados.transactionID ?? dados.data?.transactionID;
      return id ? String(id) : 'SEM_ID';
    } catch (e) {
      ultimoErro = e;
      // Só tenta o outro código se o erro foi sobre o tipo de pagamento
      // (nesse caso nada foi lançado; não há risco de duplicar).
      if (!pareceErroDeTipo(e.message)) break;
    }
  }
  throw ultimoErro || new ErroCloudbeds('não foi possível lançar o pagamento');
}

export async function anularPagamentoNaCloudbeds({ cb, contaId, paymentId }) {
  await chamarCloudbeds(cb, 'postVoidPayment', { params: { houseAccountID: contaId, paymentID: paymentId } });
}

export async function lancarItem({ cb, contaId, itemId, quantidade, precoUnitario, nota }) {
  const dados = await chamarCloudbeds(cb, 'postItem', {
    params: {
      houseAccountID: contaId,
      itemID: itemId,
      itemQuantity: String(Math.max(1, Math.round(Number(quantidade) || 1))),
      itemPrice: Number(precoUnitario).toFixed(2),
      itemNote: String(nota || '').slice(0, 250),
    },
  });
  const id = dados?.data?.soldProductID ?? dados?.soldProductID ?? dados?.data?.transactionID;
  return id ? String(id) : 'SEM_ID';
}
