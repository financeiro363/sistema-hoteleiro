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
// Pix). Sufixo "A"=estorno, "V"=pagamento anulado.
const CODIGOS_PAGAMENTO_E_ESTORNO = [
  '9000', '9000A', '9000V',
  '9100', '9100A', '9100V',
  '9200', '9200A', '9200V',
  '9300', '9300A', '9300V',
];

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

function ehEstorno(codigo) { return codigo.endsWith('A'); }
function ehAnulado(codigo) { return codigo.endsWith('V'); }

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
    const transacoes = todasTransacoes.filter((t) => CODIGOS_PAGAMENTO_E_ESTORNO.includes(t.internalTransactionCode));

    // ---- 2) Busca os nomes dos usuários (1 chamada só, pra todo mundo) ----
    const mapaNomeUsuario = {};
    try {
      const respostaUsuarios = await fetch(`https://api.cloudbeds.com/api/v1.2/getUsers?propertyID=${propertyId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const dadosUsuarios = await respostaUsuarios.json().catch(() => null);
      if (respostaUsuarios.ok && Array.isArray(dadosUsuarios?.data)) {
        dadosUsuarios.data.forEach((u) => {
          mapaNomeUsuario[String(u.userID)] = [u.userFirstName, u.userLastName].filter(Boolean).join(' ') || u.userEmail || `Usuário #${u.userID}`;
        });
      }
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
          const quartos = (dadosReserva.data.rooms || [])
            .map((r) => r.roomName)
            .filter(Boolean);
          mapaApartamentoPorReserva[idReserva] = quartos.join(', ') || '—';
        }
      } catch (e) {
        mapaApartamentoPorReserva[idReserva] = '—';
      }
    }

    // ---- 4) Monta a lista final, já enriquecida ----
    const lancamentos = transacoes.map((t) => ({
      id: t.id,
      formaPagamento: extrairFormaPagamento(t.description),
      valor: Math.abs(t.amount),
      horario: (t.transactionDatetimePropertyTime || t.transactionDatetime || '').slice(11, 16),
      apartamento: mapaApartamentoPorReserva[t.sourceIdentifier] || '—',
      usuario: mapaNomeUsuario[t.userId] || `Usuário #${t.userId}`,
      tipo: ehEstorno(t.internalTransactionCode) ? 'ESTORNO' : ehAnulado(t.internalTransactionCode) ? 'ANULADO' : 'PAGAMENTO',
      descricaoOriginal: t.description,
    }));

    const pagamentos = lancamentos.filter((l) => l.tipo === 'PAGAMENTO' || l.tipo === 'ANULADO');
    const estornos = lancamentos.filter((l) => l.tipo === 'ESTORNO');

    // Totais por forma de pagamento (pagamentos anulados entram com o
    // valor negativo, pra cancelar certinho o lançamento original)
    const totaisPorForma = {};
    lancamentos.forEach((l) => {
      if (l.tipo === 'ESTORNO') return;
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
