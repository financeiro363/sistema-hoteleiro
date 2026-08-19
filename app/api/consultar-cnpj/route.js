// ============================================================================
// ROTA DE SERVIDOR: /api/consultar-cnpj
// ============================================================================
// Consulta um CNPJ e devolve os dados ABERTOS e PÚBLICOS da Receita Federal —
// usada pelo cadastro de Clientes/Fornecedores no módulo Financeiro, pra
// preencher automaticamente razão social, endereço, atividade (CNAE),
// capital social, natureza jurídica e quadro societário a partir do CNPJ.
//
// Usa DUAS fontes gratuitas, uma como reserva da outra: primeiro tenta a
// BrasilAPI; se ela estiver bloqueando/fora do ar, tenta a ReceitaWS antes
// de desistir. As duas são gratuitas, não precisam de token, e devolvem os
// mesmos dados públicos — só a "casa" que organiza é diferente.
//
// Não exige login (o mesmo dado está disponível a qualquer pessoa que
// consulte o CNPJ direto no site da Receita Federal).
//
// ⚠️ DUAS COISAS QUE OS DADOS DA RECEITA FEDERAL NÃO TRAZEM, POR LEI/PRIVA-
// CIDADE — não é limitação nossa, é limitação da fonte (nenhum provedor,
// pago ou gratuito, expõe isso):
//  1) O CPF completo dos sócios: só vem PARCIALMENTE MASCARADO
//     (ex.: "***444444**") — proteção por causa da LGPD.
//  2) Se a empresa é "Lucro Presumido" ou "Lucro Real": só é público se ela
//     optou pelo Simples Nacional/MEI. A escolha entre Presumido/Real não
//     faz parte do cadastro do CNPJ — só o contador da empresa sabe.
// ============================================================================

const CABECALHOS_PADRAO = {
  'Accept': 'application/json',
  'User-Agent': 'Mozilla/5.0 (compatible; SistemaHoteleiroJR/1.0; +https://chokmahsystem.netlify.app)',
};

async function buscarComTimeout(url, headers, ms) {
  const controlador = new AbortController();
  const tempoLimite = setTimeout(() => controlador.abort(), ms);
  try {
    return await fetch(url, { method: 'GET', headers, signal: controlador.signal });
  } finally {
    clearTimeout(tempoLimite);
  }
}

// ---------------------------------------------------------------------------
// Fonte 1: BrasilAPI
// ---------------------------------------------------------------------------
async function buscarNaBrasilAPI(cnpj) {
  let resposta = await buscarComTimeout(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, CABECALHOS_PADRAO, 9000);
  if (!resposta.ok && resposta.status !== 404) {
    await new Promise((r) => setTimeout(r, 700));
    resposta = await buscarComTimeout(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, CABECALHOS_PADRAO, 9000);
  }
  if (resposta.status === 404) return { status: 404 };
  if (!resposta.ok) return { status: resposta.status };

  const dados = await resposta.json().catch(() => null);
  if (!dados || !dados.razao_social) return { status: resposta.status };

  return {
    status: 200,
    normalizado: {
      encontrado: true,
      razaoSocial: dados.razao_social || null,
      nomeFantasia: dados.nome_fantasia || null,
      situacaoCadastral: dados.descricao_situacao_cadastral || null,
      endereco: {
        cep: dados.cep || null,
        logradouro: dados.logradouro || null,
        numero: dados.numero || null,
        complemento: dados.complemento || null,
        bairro: dados.bairro || null,
        cidade: dados.municipio || null,
        estado: dados.uf || null,
      },
      cnaePrincipal: dados.cnae_fiscal
        ? { codigo: String(dados.cnae_fiscal), descricao: dados.cnae_fiscal_descricao || null }
        : null,
      cnaesSecundarios: Array.isArray(dados.cnaes_secundarios)
        ? dados.cnaes_secundarios.map((c) => ({ codigo: String(c.codigo || ''), descricao: c.descricao || null }))
        : [],
      capitalSocial: dados.capital_social != null ? Number(dados.capital_social) : null,
      naturezaJuridica: dados.natureza_juridica || null,
      porte: dados.descricao_porte || dados.porte || null,
      optanteSimples: !!dados.opcao_pelo_simples,
      optanteMei: !!dados.opcao_pelo_mei,
      socios: Array.isArray(dados.qsa)
        ? dados.qsa.map((s) => ({
            nome: s.nome_socio || null,
            qualificacao: s.qualificacao_socio || null,
            documentoMascarado: s.cnpj_cpf_do_socio || null,
          }))
        : [],
    },
  };
}

// ---------------------------------------------------------------------------
// Fonte 2 (plano B): ReceitaWS — só é chamada se a BrasilAPI falhar.
// Os campos de endereço/atividade/situação são bem documentados; já
// capital social, sócios e Simples/MEI variam mais entre versões do
// serviço, então aqui a leitura é "defensiva" (tenta mais de um nome de
// campo, e se não achar nenhum, deixa em branco em vez de quebrar).
// ---------------------------------------------------------------------------
async function buscarNaReceitaWS(cnpj) {
  const resposta = await buscarComTimeout(`https://www.receitaws.com.br/v1/cnpj/${cnpj}`, CABECALHOS_PADRAO, 9000);
  if (!resposta.ok) return { status: resposta.status };

  const dados = await resposta.json().catch(() => null);
  if (!dados || dados.status === 'ERROR' || !dados.nome) {
    return { status: dados?.status === 'ERROR' ? 404 : (resposta.status || 502) };
  }

  const principal = Array.isArray(dados.atividade_principal) ? dados.atividade_principal[0] : null;

  return {
    status: 200,
    normalizado: {
      encontrado: true,
      razaoSocial: dados.nome || null,
      nomeFantasia: dados.fantasia || null,
      situacaoCadastral: dados.situacao || null,
      endereco: {
        cep: dados.cep || null,
        logradouro: dados.logradouro || null,
        numero: dados.numero || null,
        complemento: dados.complemento || null,
        bairro: dados.bairro || null,
        cidade: dados.municipio || null,
        estado: dados.uf || null,
      },
      cnaePrincipal: principal ? { codigo: principal.code || '', descricao: principal.text || null } : null,
      cnaesSecundarios: Array.isArray(dados.atividades_secundarias)
        ? dados.atividades_secundarias.map((c) => ({ codigo: c.code || '', descricao: c.text || null }))
        : [],
      capitalSocial: dados.capital_social != null
        ? Number(String(dados.capital_social).replace(/\./g, '').replace(',', '.')) || Number(dados.capital_social) || null
        : null,
      naturezaJuridica: dados.natureza_juridica || null,
      porte: dados.porte || null,
      optanteSimples: !!(dados.simples?.optante ?? dados.opcao_pelo_simples),
      optanteMei: !!(dados.mei?.optante ?? dados.opcao_pelo_mei),
      socios: Array.isArray(dados.qsa)
        ? dados.qsa.map((s) => ({
            nome: s.nome || s.nome_socio || null,
            qualificacao: s.qual || s.qualificacao_socio || null,
            documentoMascarado: s.cnpj_cpf_socio || s.cnpj_cpf_do_socio || null,
          }))
        : [],
    },
  };
}

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const cnpj = (url.searchParams.get('cnpj') || '').replace(/\D/g, '');

    if (cnpj.length !== 14) {
      return Response.json({ erro: 'CNPJ inválido.' }, { status: 400 });
    }

    const brasilApi = await buscarNaBrasilAPI(cnpj).catch(() => ({ status: 0 }));
    if (brasilApi.status === 200) {
      return Response.json(brasilApi.normalizado);
    }
    if (brasilApi.status === 404) {
      return Response.json(
        { erro: 'CNPJ não encontrado na Receita Federal. Confira o número ou preencha os dados manualmente.' },
        { status: 404 }
      );
    }

    // BrasilAPI falhou por outro motivo (bloqueio, fora do ar, etc.) — tenta o plano B.
    const receitaWs = await buscarNaReceitaWS(cnpj).catch(() => ({ status: 0 }));
    if (receitaWs.status === 200) {
      return Response.json(receitaWs.normalizado);
    }
    if (receitaWs.status === 404) {
      return Response.json(
        { erro: 'CNPJ não encontrado na Receita Federal. Confira o número ou preencha os dados manualmente.' },
        { status: 404 }
      );
    }

    return Response.json(
      {
        erro: `Não foi possível consultar a Receita Federal agora (BrasilAPI: ${brasilApi.status || 'falhou'}; ReceitaWS: ${receitaWs.status || 'falhou'}). Preencha os dados manualmente ou tente de novo em alguns instantes.`,
      },
      { status: 502 }
    );
  } catch (erro) {
    const mensagem = erro?.name === 'AbortError'
      ? 'A consulta à Receita Federal demorou demais e foi cancelada. Preencha os dados manualmente.'
      : 'Erro inesperado no servidor: ' + erro.message;
    return Response.json({ erro: mensagem }, { status: 500 });
  }
}
