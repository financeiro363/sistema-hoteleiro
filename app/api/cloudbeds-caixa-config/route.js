// ============================================================================
// ROTA DE SERVIDOR: /api/cloudbeds-caixa-config   (SÓ ADMIN)
// ============================================================================
// GET  → configuração salva + listas vindas da Cloudbeds (formas de pagamento
//        e Contas da Casa), para o ADMIN escolher na tela.
// POST → salva a configuração: qual forma da Cloudbeds corresponde a cada
//        forma do sistema e quais Contas da Casa usar (Conveniência e Sala).
// ============================================================================

import {
  autenticarChamada, carregarCloudbeds, carregarConfigCaixa, listarFormasPagamento, listarContasDaCasa,
  FORMAS_SISTEMA, NOME_CONTA_PADRAO,
} from '../../../lib/cloudbedsCaixa';

async function soAdmin(request) {
  const auth = await autenticarChamada(request);
  if (auth.resposta) return auth;
  if (auth.chamador.papel !== 'ADMIN') {
    return { resposta: Response.json({ erro: 'Só administradores podem configurar isso.' }, { status: 403 }) };
  }
  return auth;
}

export async function GET(request) {
  try {
    const auth = await soAdmin(request);
    if (auth.resposta) return auth.resposta;
    const { chamador, supabaseAdmin, segredoCripto } = auth;

    let config;
    try { config = await carregarConfigCaixa(supabaseAdmin, chamador.hotel_id); }
    catch (e) { return Response.json({ erro: e.message }, { status: 400 }); }

    let formasCloudbeds = [];
    let contasCloudbeds = [];
    let avisoCloudbeds = null;
    try {
      const cb = await carregarCloudbeds(supabaseAdmin, chamador.hotel_id, segredoCripto);
      const [formas, contas] = await Promise.allSettled([listarFormasPagamento(cb), listarContasDaCasa(cb)]);
      if (formas.status === 'fulfilled') formasCloudbeds = formas.value;
      else avisoCloudbeds = 'Não foi possível buscar as formas de pagamento da Cloudbeds: ' + formas.reason?.message;
      if (contas.status === 'fulfilled') contasCloudbeds = contas.value.filter((c) => c.status !== 'closed');
      else avisoCloudbeds = (avisoCloudbeds ? avisoCloudbeds + ' ' : '') + 'Não foi possível buscar as Contas da Casa: ' + contas.reason?.message;
    } catch (e) {
      avisoCloudbeds = e.message;
    }

    return Response.json({
      config,
      formasSistema: FORMAS_SISTEMA,
      nomesPadrao: NOME_CONTA_PADRAO,
      formasCloudbeds,
      contasCloudbeds,
      avisoCloudbeds,
    });
  } catch (erro) {
    return Response.json({ erro: 'Erro inesperado no servidor: ' + erro.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const auth = await soAdmin(request);
    if (auth.resposta) return auth.resposta;
    const { chamador, supabaseAdmin } = auth;
    const corpo = await request.json().catch(() => ({}));

    // Só guarda as 4 formas conhecidas, cada uma com código / método / nome / cartão
    const formas = {};
    Object.keys(FORMAS_SISTEMA).forEach((chave) => {
      const f = corpo?.formas?.[chave];
      if (f && (f.codigo || f.metodo)) {
        formas[chave] = {
          codigo: String(f.codigo || '').slice(0, 80),
          metodo: String(f.metodo || '').slice(0, 80),
          nome: String(f.nome || '').slice(0, 120),
          cartao: f.cartao ? String(f.cartao).slice(0, 40) : null,
        };
      }
    });

    const texto = (v, max = 120) => (v ? String(v).trim().slice(0, max) : null);
    const registro = {
      hotel_id: chamador.hotel_id,
      formas,
      conta_pdv_id: texto(corpo.conta_pdv_id, 40),
      conta_pdv_nome: texto(corpo.conta_pdv_nome) || NOME_CONTA_PADRAO.pdv,
      conta_sala_id: texto(corpo.conta_sala_id, 40),
      conta_sala_nome: texto(corpo.conta_sala_nome) || NOME_CONTA_PADRAO.sala,
      enviar_pdv: corpo.enviar_pdv !== false,
      enviar_sala: corpo.enviar_sala !== false,
      atualizado_por_id: chamador.id,
      atualizado_em: new Date().toISOString(),
    };

    const { data, error } = await supabaseAdmin.from('cloudbeds_caixa_config').upsert(registro).select().single();
    if (error) {
      return Response.json({
        erro: /does not exist|schema cache|relation/i.test(error.message)
          ? 'O envio para a Cloudbeds ainda não foi ativado no banco de dados (falta rodar o SQL do caixa).'
          : 'Não foi possível salvar: ' + error.message,
      }, { status: 400 });
    }
    return Response.json({ sucesso: true, config: data });
  } catch (erro) {
    return Response.json({ erro: 'Erro inesperado no servidor: ' + erro.message }, { status: 500 });
  }
}
