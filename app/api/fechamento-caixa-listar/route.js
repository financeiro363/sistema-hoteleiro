// ============================================================================
// ROTA DE SERVIDOR: /api/fechamento-caixa-listar
// ============================================================================
// Busca as transações do dia na Cloudbeds (Accounting API nova) e devolve
// já organizadas: lançamentos de pagamento (com forma de pagamento, valor,
// horário, apartamento e usuário), separados dos estornos/abatimentos, e
// os totais somados por forma de pagamento.
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import { descriptografar } from '../../../lib/cloudbedsCrypto';

// 9100=Dinheiro, 9200=Transferência Bancária, 9300=Cartão (processado por
// gateway), 9000=Pagamento genérico (é o que a maioria dos métodos
// configurados manualmente usa, incluindo os vários tipos de cartão e
// Pix). 2000=Item consumido (diária, água, lavanderia, etc.).
const CODIGOS_BASE_PAGAMENTO = ['9000', '9100', '9200', '9300'];

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

function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function ontemISO() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
    const { data: credencial, error: erroCred } = await supabaseAdmin
      .from('cloudbeds_credenciais').select('*').eq('hotel_id', chamador.hotel_id).maybeSingle();
    if (erroCred || !credencial?.api_key_cifrada || !credencial?.cloudbeds_property_id) {
      return Response.json({ erro: 'A integração com a Cloudbeds ainda não foi configurada para este hotel.' }, { status: 400 });
    }
    let apiKey;
    try { apiKey = descriptografar(credencial.api_key_cifrada, segredoCripto); }
    catch (e) { return Response.json({ erro: 'Não foi possível ler a credencial salva.' }, { status: 500 }); }

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
      return Response.json({
        erro: dadosCloudbeds?.message || dadosCloudbeds?.error || `A Cloudbeds recusou a chamada (status ${respostaCloudbeds.status}).`,
      }, { status: 502 });
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

    // ---- 3) Busca o número do apartamento de cada reserva envolvida ----
    // (uma chamada por reserva ÚNICA, não por lançamento, pra não repetir à toa)
    const idsReservaUnicos = [...new Set(transacoes.map((t) => t.sourceIdentifier).filter(Boolean))];
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
      return {
        id: t.id,
        formaPagamento: extrairFormaPagamento(t.description),
        valor: Math.abs(t.amount),
        horario: (t.transactionDatetimePropertyTime || t.transactionDatetime || '').slice(11, 16),
        apartamento: mapaApartamentoPorReserva[t.sourceIdentifier] || '—',
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
    pagamentos.forEach((l) => {
      const sinal = l.tipo === 'ANULADO' ? -1 : 1;
      totaisPorForma[l.formaPagamento] = (totaisPorForma[l.formaPagamento] || 0) + sinal * l.valor;
    });

    return Response.json({
      data: dataConsultada,
      pagamentos,
      estornos,
      totaisPorForma,
      totalGeral: Object.values(totaisPorForma).reduce((soma, v) => soma + v, 0),
      totalEstornos: estornos.reduce((soma, l) => soma + l.valor, 0),
    });
  } catch (erro) {
    return Response.json({ erro: 'Erro inesperado no servidor: ' + erro.message }, { status: 500 });
  }
}
