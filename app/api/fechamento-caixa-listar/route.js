// ============================================================================
// ROTA DE SERVIDOR: /api/fechamento-caixa-listar
// ============================================================================
// Busca as transações do dia direto na Cloudbeds, usando a API de
// Contabilidade NOVA deles (accounting/v1.0/transactions) — a antiga
// (getTransactions/getPayments) foi desativada em dez/2025.
//
// ⚠️ MODO DIAGNÓSTICO: ainda não sabemos com certeza todos os nomes de
// campo que a Cloudbeds devolve pra forma de pagamento específica (Visa
// Crédito, Elo Débito, etc.) — por isso, por enquanto, esta rota devolve a
// resposta O MAIS CRUA POSSÍVEL, só filtrada por tipo (pagamento/estorno).
// Assim que confirmarmos o formato real, ela vira o mapeamento fino pros
// 14 tipos de pagamento.
//
// A parte de SEGURANÇA (permissão + trava de data pro colaborador) já é a
// versão definitiva, não muda quando ajustarmos o mapeamento.
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import { descriptografar } from '../../../lib/cloudbedsCrypto';

// Prefixos de código interno que representam PAGAMENTO ou ESTORNO (ver
// tabela oficial: developers.cloudbeds.com/docs/accounting).
// 9100=Dinheiro, 9200=Transferência Bancária, 9300=Cartão de Crédito.
// Sufixo "A" = estorno, sufixo "V" = pagamento anulado (void).
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

    // ---- Permissão e trava de data (regra definitiva, não muda) ----
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

    const respostaCloudbeds = await fetch('https://api.cloudbeds.com/accounting/v1.0/transactions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Property-ID': String(credencial.cloudbeds_property_id),
      },
      body: JSON.stringify({
        filters: { field: 'service_date', operator: 'equals', value: dataConsultada },
        limit: 1100,
      }),
    });
    const dadosCloudbeds = await respostaCloudbeds.json().catch(() => null);
    if (!respostaCloudbeds.ok) {
      return Response.json({
        erro: dadosCloudbeds?.message || dadosCloudbeds?.error || `A Cloudbeds recusou a chamada (status ${respostaCloudbeds.status}).`,
        detalheCru: dadosCloudbeds,
      }, { status: 502 });
    }

    const todasTransacoes = dadosCloudbeds?.transactions || dadosCloudbeds?.data || [];
    const somentePagamentosEEstornos = todasTransacoes.filter((t) =>
      CODIGOS_PAGAMENTO_E_ESTORNO.includes(t.internalTransactionCode)
    );

    return Response.json({
      modoDiagnostico: true,
      data: dataConsultada,
      totalBruto: todasTransacoes.length,
      transacoesPagamentoEEstorno: somentePagamentosEEstornos,
      respostaCompletaCrua: dadosCloudbeds,
    });
  } catch (erro) {
    return Response.json({ erro: 'Erro inesperado no servidor: ' + erro.message }, { status: 500 });
  }
}
