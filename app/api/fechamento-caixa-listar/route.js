// ============================================================================
// ROTA DE SERVIDOR: /api/fechamento-caixa-listar
// ============================================================================
// Busca as transações do dia na Cloudbeds (Accounting API nova) e devolve
// já organizadas: lançamentos de pagamento (com forma de pagamento, valor,
// horário, apartamento e usuário), separados dos estornos/abatimentos, e
// os totais somados por forma de pagamento.
//
// SEM DUPLICIDADE (Sala de Reunião e Conveniência avulsa):
// - O que já foi enviado para a Cloudbeds (Contas da Casa "Sala de Reunião" e
//   "Conveniência – Vendas Avulsas") entra UMA vez só, vindo da Cloudbeds,
//   identificado como "Sala de Reunião" / "Conveniência".
// - O que NÃO está na Cloudbeds (falhou, data passada, ou é antigo) continua
//   sendo somado à parte, pelo sistema — e mesmo que a Cloudbeds falhe, aparece.
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import { descriptografar } from '../../../lib/cloudbedsCrypto';

// Rótulos das formas de pagamento do PDV avulso (código no banco -> nome)
const FORMAS_PDV = {
  DINHEIRO: 'Dinheiro',
  PIX: 'Pix',
  CARTAO: 'Cartão',
  CARTAO_CREDITO: 'Cartão de crédito',
  CARTAO_DEBITO: 'Cartão de débito',
};

// 9100=Dinheiro, 9200=Transferência Bancária, 9300=Cartão (processado por
// gateway), 9000=Pagamento genérico (é o que a maioria dos métodos
// configurados manualmente usa, incluindo os vários tipos de cartão e
// Pix). 2000=Item consumido (diária, água, lavanderia, etc.).
const CODIGOS_BASE_PAGAMENTO = ['9000', '9100', '9200', '9300'];

// Formas de pagamento da Sala de Reunião (código guardado no banco -> nome)
const FORMAS_SALA = {
  PIX: 'Pix',
  DINHEIRO: 'Dinheiro',
  CARTAO_CREDITO: 'Cartão de crédito',
  CARTAO_DEBITO: 'Cartão de débito',
};

const ROTULO_ORIGEM = { SALA: 'Sala de Reunião', PDV: 'Conveniência (avulso)' };

// Sufixo "A" = estorno (dinheiro devolvido/abatido), "V" = lançamento
// anulado. Isso vale tanto pra pagamento quanto pra item consumido — por
// isso a classificação é pelo SUFIXO, não por uma lista fixa de códigos:
// assim, um estorno de diária ou de um item do frigobar entra no relatório
// do mesmo jeito que um estorno de pagamento, sem eu precisar saber o
// código exato de cada tipo de item.
function classificarTransacao(codigo) {
  // Comissão de canal (Booking, Expedia, etc.) é um lançamento interno
  // entre o hotel e o canal de venda — não passa pelo caixa nem afeta o
  // que o hóspede pagou, então não entra nem em pagamentos nem em estornos.
  if (codigo.startsWith('8800')) return 'CONSUMO_NORMAL';

  const ehCodigoPagamento = CODIGOS_BASE_PAGAMENTO.some((base) => codigo.startsWith(base));
  if (codigo.endsWith('A')) return ehCodigoPagamento ? 'ESTORNO_PAGAMENTO' : 'ESTORNO_ITEM';
  if (codigo.endsWith('V')) return ehCodigoPagamento ? 'PAGAMENTO_ANULADO' : 'ITEM_ANULADO';
  if (ehCodigoPagamento) return 'PAGAMENTO';
  return 'CONSUMO_NORMAL'; // item comprado sem cancelamento — não interessa pro caixa
}

// "Hoje" e "ontem" sempre no horário de Fortaleza/Paraíba (UTC-3), igual
// para a tela e para o servidor — assim os dois nunca discordam, não
// importa o relógio de onde o código esteja rodando.
const FUSO_HOTEL = 'America/Fortaleza';
function hojeISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: FUSO_HOTEL });
}
function ontemISO() {
  const [a, m, d] = hojeISO().split('-').map(Number);
  const ontem = new Date(Date.UTC(a, m - 1, d - 1));
  return ontem.toISOString().slice(0, 10);
}

// A "description" vem tipo "Cartão Mastercard Credito - Pagamento
// Registrado" ou "Cartão de crédito - Mastercard x1914 - Pagamento
// Processado pelo(a) Stripe" — pega só a parte de antes do " - Pagamento"
// ou " - Estorno", que é o nome real da forma de pagamento.
function extrairFormaPagamento(descricao) {
  if (!descricao) return 'Não identificado';
  const partes = descricao.split(/ - (Pagamento|Estorno)/i);
  return (partes[0] || descricao).trim();
}


// ---- Parte Cloudbeds (hóspedes do hotel) -----------------------------------
// Se algo falhar aqui (integração não configurada, Cloudbeds fora do ar...),
// quem chama mostra um aviso mas ainda entrega os pagamentos da Sala de
// Reunião, que não dependem da Cloudbeds.
async function buscarCloudbeds({ supabaseAdmin, hotelId, dataConsultada, segredoCripto, contasConhecidas }) {
    const { data: credencial, error: erroCred } = await supabaseAdmin
      .from('cloudbeds_credenciais').select('*').eq('hotel_id', hotelId).maybeSingle();
    if (erroCred || !credencial?.api_key_cifrada || !credencial?.cloudbeds_property_id) {
      throw new Error('A integração com a Cloudbeds ainda não foi configurada para este hotel.');
    }
    let apiKey;
    try { apiKey = descriptografar(credencial.api_key_cifrada, segredoCripto); }
    catch (e) { throw new Error('Não foi possível ler a credencial salva.'); }

    const propertyId = String(credencial.cloudbeds_property_id);
    const cabecalhosCloudbeds = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-Property-ID': propertyId,
    };

    // ---- 1) Busca as transações do dia ----
    const respostaCloudbeds = await fetch('https://api.cloudbeds.com/accounting/v1.0/transactions', {
      method: 'POST',
      headers: cabecalhosCloudbeds,
      body: JSON.stringify({
        filters: { field: 'service_date', operator: 'equals', value: dataConsultada },
        limit: 1100,
      }),
    });
    const dadosCloudbeds = await respostaCloudbeds.json().catch(() => null);
    if (!respostaCloudbeds.ok) {
      throw new Error(dadosCloudbeds?.message || dadosCloudbeds?.error || `A Cloudbeds recusou a chamada (status ${respostaCloudbeds.status}).`);
    }

    const todasTransacoes = dadosCloudbeds?.transactions || [];
    const transacoes = todasTransacoes.filter((t) => classificarTransacao(t.internalTransactionCode) !== 'CONSUMO_NORMAL');

    // ---- 2) Busca os nomes dos usuários (1 chamada só, pra todo mundo) ----
    const mapaNomeUsuario = {};
    try {
      const respostaUsuarios = await fetch(`https://api.cloudbeds.com/api/v1.2/getUsers?propertyID=${propertyId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const dadosUsuarios = await respostaUsuarios.json().catch(() => null);
      const listaUsuarios = dadosUsuarios?.data?.[propertyId] || [];
      listaUsuarios.forEach((u) => {
        const sobrenome = (u.lastName || '').toLowerCase() === 'notprovided' ? '' : u.lastName;
        mapaNomeUsuario[String(u.userID)] = [u.firstName, sobrenome].filter(Boolean).join(' ') || u.email || `Usuário #${u.userID}`;
      });
    } catch (e) { /* segue sem nome, mostra o ID */ }

    // ---- 2b) Contas da Casa (Sala de Reunião, Conveniência e outras) ----
    // As do sistema já vêm da configuração; as demais, pelo nome na Cloudbeds.
    const nomesContas = {};
    try {
      const respostaContas = await fetch(`https://api.cloudbeds.com/api/v1.2/getHouseAccountList?propertyID=${propertyId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const dadosContas = await respostaContas.json().catch(() => null);
      (Array.isArray(dadosContas?.data) ? dadosContas.data : []).forEach((c) => {
        if (c?.accountID) nomesContas[String(c.accountID)] = c.accountName || `Conta da casa #${c.accountID}`;
      });
    } catch (e) { /* segue sem os nomes */ }

    const origemDe = (t) => {
      const ids = [t.sourceIdentifier, t.sourceId].filter((v) => v !== undefined && v !== null).map(String);
      for (const id of ids) {
        if (contasConhecidas?.[id]) return { origem: contasConhecidas[id], idOrigem: id };
      }
      for (const id of ids) {
        if (nomesContas[id]) return { origem: 'CONTA_CASA', idOrigem: id, nomeConta: nomesContas[id] };
      }
      if (/house/i.test(String(t.sourceKind || ''))) return { origem: 'CONTA_CASA', idOrigem: ids[0] || '' };
      return { origem: 'RESERVA', idOrigem: t.sourceIdentifier };
    };

    // ---- 3) Busca o número do apartamento de cada reserva envolvida ----
    // (uma chamada por reserva ÚNICA, não por lançamento, pra não repetir à toa;
    // Contas da Casa não são reserva, então ficam de fora)
    const idsReservaUnicos = [...new Set(transacoes
      .filter((t) => origemDe(t).origem === 'RESERVA')
      .map((t) => t.sourceIdentifier).filter(Boolean))];
    const mapaApartamentoPorReserva = {};
    for (const idReserva of idsReservaUnicos) {
      try {
        const respostaReserva = await fetch(
          `https://api.cloudbeds.com/api/v1.2/getReservation?propertyID=${propertyId}&reservationID=${idReserva}`,
          { headers: { Authorization: `Bearer ${apiKey}` } }
        );
        const dadosReserva = await respostaReserva.json().catch(() => null);
        if (respostaReserva.ok && dadosReserva?.data) {
          const quartos = (dadosReserva.data.assigned || [])
            .map((r) => r.roomName)
            .filter(Boolean);
          mapaApartamentoPorReserva[idReserva] = [...new Set(quartos)].join(', ') || '—';
        }
      } catch (e) {
        mapaApartamentoPorReserva[idReserva] = '—';
      }
    }

    // ---- 4) Monta a lista final, já enriquecida ----
    const lancamentos = transacoes.map((t) => {
      const classificacao = classificarTransacao(t.internalTransactionCode);
      const { origem, nomeConta } = origemDe(t);
      return {
        id: t.id,
        formaPagamento: extrairFormaPagamento(t.description),
        valor: Math.abs(t.amount),
        horario: (t.transactionDatetimePropertyTime || t.transactionDatetime || '').slice(11, 16),
        origem,
        apartamento: ROTULO_ORIGEM[origem]
          || (origem === 'CONTA_CASA' ? `Conta da casa${nomeConta ? `: ${nomeConta}` : ''}` : null)
          || mapaApartamentoPorReserva[t.sourceIdentifier] || '—',
        usuario: mapaNomeUsuario[t.userId] || `Usuário #${t.userId}`,
        classificacao,
        // "ANULADO" cobre tanto pagamento anulado quanto item anulado —
        // aparece riscado na lista de pagamentos, do mesmo jeito nos dois casos.
        tipo: classificacao === 'ESTORNO_PAGAMENTO' || classificacao === 'ESTORNO_ITEM' ? 'ESTORNO'
          : classificacao === 'PAGAMENTO_ANULADO' || classificacao === 'ITEM_ANULADO' ? 'ANULADO'
          : 'PAGAMENTO',
        descricaoOriginal: t.description,
      };
    });

    // Só entram na lista de "Pagamentos" os lançamentos que são de fato
    // pagamento (dinheiro/cartão/pix) — os itens consumidos (diária, água,
    // etc.) não aparecem aqui, só quando cancelados (ver estornos abaixo).
    const pagamentos = lancamentos.filter((l) =>
      l.classificacao === 'PAGAMENTO' || l.classificacao === 'PAGAMENTO_ANULADO'
    );
    // Estornos e abatimentos juntam os dois tipos: devolução de pagamento
    // E cancelamento de item consumido (diária, água, lavanderia, etc.).
    const estornos = lancamentos.filter((l) =>
      l.classificacao === 'ESTORNO_PAGAMENTO' || l.classificacao === 'ESTORNO_ITEM'
      || l.classificacao === 'ITEM_ANULADO'
    );

    // Totais por forma de pagamento (pagamentos anulados entram com o
    // valor negativo, pra cancelar certinho o lançamento original) — só
    // considera a lista de PAGAMENTOS, os itens cancelados não entram aqui.
    const totaisPorForma = {};
    const totaisPorOrigem = { SALA: 0, PDV: 0 };
    pagamentos.forEach((l) => {
      const sinal = l.tipo === 'ANULADO' ? -1 : 1;
      totaisPorForma[l.formaPagamento] = (totaisPorForma[l.formaPagamento] || 0) + sinal * l.valor;
      if (totaisPorOrigem[l.origem] !== undefined) totaisPorOrigem[l.origem] += sinal * l.valor;
    });

    return { pagamentos, estornos, totaisPorForma, totaisPorOrigem };
}

// ---- Contas da Casa configuradas (Sala de Reunião e Conveniência) ----------
async function buscarContasConhecidas(supabaseAdmin, hotelId) {
  const contas = {};
  try {
    const { data } = await supabaseAdmin.from('cloudbeds_caixa_config')
      .select('conta_pdv_id, conta_sala_id').eq('hotel_id', hotelId).maybeSingle();
    if (data?.conta_sala_id) contas[String(data.conta_sala_id)] = 'SALA';
    if (data?.conta_pdv_id) contas[String(data.conta_pdv_id)] = 'PDV';
  } catch (e) { /* tabela ainda não criada — segue sem */ }
  return contas;
}

// ---- Parte Sala de Reunião (pagamentos lançados no sistema) ----------------
// Soma só o que NÃO foi anulado; os anulados aparecem na lista (riscados).
async function buscarSalaReuniao({ supabaseAdmin, hotelId, dataConsultada }) {
  const vazio = { pagamentos: [], totaisPorForma: {}, total: 0, aviso: null };
  const { data: linhas, error } = await supabaseAdmin
    .from('reservas_sala_pagamentos').select('*')
    .eq('hotel_id', hotelId).eq('data_pagamento', dataConsultada)
    .order('criado_em', { ascending: true });
  if (error) {
    return {
      ...vazio,
      aviso: /does not exist|schema cache|relation/i.test(error.message)
        ? 'Os pagamentos da Sala de Reunião ainda não foram ativados no banco de dados (falta rodar o script SQL).'
        : 'Não foi possível ler os pagamentos da Sala de Reunião: ' + error.message,
    };
  }

  const idsUsuarios = [...new Set((linhas || []).flatMap((l) => [l.criado_por_id, l.anulado_por_id]).filter(Boolean))];
  const nomes = {};
  if (idsUsuarios.length) {
    const { data: pessoas } = await supabaseAdmin.from('usuarios').select('id, nome').in('id', idsUsuarios);
    (pessoas || []).forEach((u) => { nomes[u.id] = u.nome; });
  }

  const pagamentos = (linhas || []).map((l) => ({
    id: l.id,
    // Já está na Cloudbeds → é contado lá (nos lançamentos da Cloudbeds), não aqui
    naCloudbeds: !!l.cloudbeds_payment_id,
    cloudbedsStatus: l.cloudbeds_status || null,
    cloudbedsErro: l.cloudbeds_erro || null,
    horario: new Date(l.criado_em).toLocaleTimeString('pt-BR', { timeZone: FUSO_HOTEL, hour: '2-digit', minute: '2-digit' }),
    forma: l.forma_pagamento,
    formaPagamento: FORMAS_SALA[l.forma_pagamento] || l.forma_pagamento,
    valor: Number(l.valor),
    sala: l.sala_nome || 'Sala de Reunião',
    cliente: l.pagador_nome,
    recibo: l.numero_recibo,
    usuario: nomes[l.criado_por_id] || `Usuário #${l.criado_por_id}`,
    anulado: !!l.anulado_em,
    motivoAnulacao: l.motivo_anulacao || null,
    anuladoPor: l.anulado_em ? (nomes[l.anulado_por_id] || `Usuário #${l.anulado_por_id}`) : null,
  }));

  // Somados à parte: só os que NÃO estão na Cloudbeds (e não foram anulados)
  const totaisPorForma = {};
  pagamentos.filter((p) => !p.anulado && !p.naCloudbeds).forEach((p) => {
    totaisPorForma[p.formaPagamento] = Math.round(((totaisPorForma[p.formaPagamento] || 0) + p.valor) * 100) / 100;
  });
  const total = Math.round(Object.values(totaisPorForma).reduce((soma, v) => soma + v, 0) * 100) / 100;
  const totalDoDia = Math.round(pagamentos.filter((p) => !p.anulado).reduce((soma, p) => soma + p.valor, 0) * 100) / 100;
  const anuladosAindaNaCloudbeds = pagamentos.filter((p) => p.anulado && p.cloudbedsStatus === 'FALHA_ANULACAO');
  return { pagamentos, totaisPorForma, total, totalDoDia, anuladosAindaNaCloudbeds, aviso: null };
}

// ---- Conveniência: vendas avulsas que NÃO chegaram à Cloudbeds -------------
// (as que chegaram já aparecem nos lançamentos da Cloudbeds). Vendas antigas,
// de antes do envio automático, ficam de fora, como sempre foi.
async function buscarPdvForaDaCloudbeds({ supabaseAdmin, hotelId, dataConsultada }) {
  const vazio = { vendas: [], totaisPorForma: {}, total: 0, aviso: null };
  const inicio = new Date(`${dataConsultada}T03:00:00Z`); // 00:00 em Fortaleza
  const fim = new Date(inicio.getTime() + 24 * 60 * 60 * 1000);
  const { data: linhas, error } = await supabaseAdmin
    .from('pdv_vendas')
    .select('id, numero_venda, criado_em, forma_pagamento_avulso, valor_total, vendido_por_id, cloudbeds_status, cloudbeds_erro, cloudbeds_payment_id')
    .eq('hotel_id', hotelId).eq('tipo_pagamento', 'AVULSO').eq('status', 'CONCLUIDA')
    .is('cloudbeds_payment_id', null)
    .in('cloudbeds_status', ['PENDENTE', 'FALHOU'])
    .gte('criado_em', inicio.toISOString()).lt('criado_em', fim.toISOString())
    .order('criado_em', { ascending: true });
  if (error) {
    if (/cloudbeds_payment_id|column/i.test(error.message)) return vazio; // SQL novo ainda não rodado
    return { ...vazio, aviso: 'Não foi possível ler as vendas da Conveniência: ' + error.message };
  }

  const ids = [...new Set((linhas || []).map((l) => l.vendido_por_id).filter(Boolean))];
  const nomes = {};
  if (ids.length) {
    const { data: pessoas } = await supabaseAdmin.from('usuarios').select('id, nome').in('id', ids);
    (pessoas || []).forEach((u) => { nomes[u.id] = u.nome; });
  }
  const vendas = (linhas || []).map((l) => ({
    id: l.id,
    numero: l.numero_venda,
    horario: new Date(l.criado_em).toLocaleTimeString('pt-BR', { timeZone: FUSO_HOTEL, hour: '2-digit', minute: '2-digit' }),
    formaPagamento: FORMAS_PDV[l.forma_pagamento_avulso] || l.forma_pagamento_avulso || '—',
    valor: Number(l.valor_total),
    usuario: nomes[l.vendido_por_id] || `Usuário #${l.vendido_por_id}`,
    erro: l.cloudbeds_erro || null,
  }));
  const totaisPorForma = {};
  vendas.forEach((v) => {
    totaisPorForma[v.formaPagamento] = Math.round(((totaisPorForma[v.formaPagamento] || 0) + v.valor) * 100) / 100;
  });
  const total = Math.round(vendas.reduce((soma, v) => soma + v.valor, 0) * 100) / 100;
  return { vendas, totaisPorForma, total, aviso: null };
}

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const dataConsultada = url.searchParams.get('data') || hojeISO();

    const tokenAcesso = (request.headers.get('authorization') || '').replace('Bearer ', '');
    if (!tokenAcesso) return Response.json({ erro: 'Não autorizado — faça login novamente.' }, { status: 401 });

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const chaveAnonima = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const chaveMestra = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const segredoCripto = process.env.CLOUDBEDS_CRYPTO_SECRET;
    if (!supabaseUrl || !chaveAnonima || !chaveMestra || !segredoCripto) {
      return Response.json({ erro: 'O servidor não está configurado corretamente.' }, { status: 500 });
    }

    const supabaseComoChamador = createClient(supabaseUrl, chaveAnonima, {
      global: { headers: { Authorization: `Bearer ${tokenAcesso}` } },
    });
    const { data: dadosAuth, error: erroAuth } = await supabaseComoChamador.auth.getUser(tokenAcesso);
    if (erroAuth || !dadosAuth?.user) return Response.json({ erro: 'Sessão inválida ou expirada.' }, { status: 401 });
    const { data: chamador, error: erroChamador } = await supabaseComoChamador
      .from('usuarios').select('id, hotel_id, papel, pode_acessar_fechamento_caixa').eq('auth_id', dadosAuth.user.id).single();
    if (erroChamador || !chamador) return Response.json({ erro: 'Não foi possível confirmar seu usuário.' }, { status: 403 });

    // ---- Permissão e trava de data ----
    if (chamador.papel === 'COLABORADOR') {
      if (!chamador.pode_acessar_fechamento_caixa) {
        return Response.json({ erro: 'Você não tem permissão pra acessar o Fechamento de Caixa.' }, { status: 403 });
      }
      const permitidas = [hojeISO(), ontemISO()];
      if (!permitidas.includes(dataConsultada)) {
        return Response.json({ erro: 'Colaboradores só podem consultar o dia atual e o dia anterior.' }, { status: 403 });
      }
    } else if (chamador.papel !== 'ADMIN') {
      return Response.json({ erro: 'Sem acesso.' }, { status: 403 });
    }

    const supabaseAdmin = createClient(supabaseUrl, chaveMestra);

    // ---- 1) Cloudbeds (se falhar, segue só com a Sala de Reunião + aviso) ----
    let cloudbeds = { pagamentos: [], estornos: [], totaisPorForma: {}, totaisPorOrigem: { SALA: 0, PDV: 0 } };
    let avisoCloudbeds = null;
    const contasConhecidas = await buscarContasConhecidas(supabaseAdmin, chamador.hotel_id);
    try {
      cloudbeds = await buscarCloudbeds({
        supabaseAdmin, hotelId: chamador.hotel_id, dataConsultada, segredoCripto, contasConhecidas,
      });
    } catch (e) {
      avisoCloudbeds = e.message;
    }
    const { pagamentos, estornos, totaisPorForma, totaisPorOrigem } = cloudbeds;

    // ---- 2) Sala de Reunião e Conveniência que NÃO estão na Cloudbeds ----
    const [sala, pdv] = await Promise.all([
      buscarSalaReuniao({ supabaseAdmin, hotelId: chamador.hotel_id, dataConsultada }),
      buscarPdvForaDaCloudbeds({ supabaseAdmin, hotelId: chamador.hotel_id, dataConsultada }),
    ]);

    const arred = (v) => Math.round(v * 100) / 100;
    const totalCloudbeds = arred(Object.values(totaisPorForma).reduce((soma, v) => soma + v, 0));

    return Response.json({
      data: dataConsultada,
      pagamentos,
      estornos,
      totaisPorForma,
      // Sala de Reunião: lista do dia (com a situação na Cloudbeds). Os totais
      // "Sala" abaixo são SÓ dos pagamentos que não estão na Cloudbeds.
      salaReuniao: sala.pagamentos,
      totaisSalaPorForma: sala.totaisPorForma,
      totalSalaReuniao: sala.total,
      totalSalaDoDia: sala.totalDoDia ?? sala.total,
      salaAnuladosAindaNaCloudbeds: sala.anuladosAindaNaCloudbeds || [],
      avisoSalaReuniao: sala.aviso,
      // Conveniência avulsa que não chegou à Cloudbeds (somada à parte)
      pdvForaCloudbeds: pdv.vendas,
      totaisPdvPorForma: pdv.totaisPorForma,
      totalPdvFora: pdv.total,
      avisoPdv: pdv.aviso,
      // O que veio da Cloudbeds pelas Contas da Casa do sistema
      totalSalaNaCloudbeds: arred(totaisPorOrigem?.SALA || 0),
      totalPdvNaCloudbeds: arred(totaisPorOrigem?.PDV || 0),
      contasConfiguradas: Object.keys(contasConhecidas).length > 0,
      avisoCloudbeds,
      totalCloudbeds,
      totalGeral: arred(totalCloudbeds + sala.total + pdv.total),
      totalEstornos: estornos.reduce((soma, l) => soma + l.valor, 0),
    });
  } catch (erro) {
    return Response.json({ erro: 'Erro inesperado no servidor: ' + erro.message }, { status: 500 });
  }
}
