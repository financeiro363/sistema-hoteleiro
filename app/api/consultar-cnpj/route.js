// ============================================================================
// ROTA DE SERVIDOR: /api/consultar-cnpj
// ============================================================================
// Consulta um CNPJ na BrasilAPI (https://brasilapi.com.br), que organiza em
// JSON os dados ABERTOS e PÚBLICOS da Receita Federal — usada pelo cadastro
// de Clientes/Fornecedores no módulo Financeiro, para preencher automatico-
// mente razão social, endereço, atividade (CNAE), capital social, natureza
// jurídica e quadro societário a partir do CNPJ digitado.
//
// Não precisa de token/chave — é uma fonte pública e gratuita. Por isso essa
// rota não exige login (o mesmo dado está disponível a qualquer pessoa que
// consulte o CNPJ direto no site da Receita Federal).
//
// ⚠️ DUAS COISAS QUE OS DADOS DA RECEITA FEDERAL NÃO TRAZEM, POR LEI/PRIVA-
// CIDADE — não é limitação nossa, é limitação da fonte:
//  1) O CPF completo dos sócios: a Receita só libera o CPF deles PARCIAL-
//     MENTE MASCARADO (ex.: "***444444**") em qualquer consulta pública,
//     paga ou gratuita — o CPF completo de terceiros nunca é exposto assim,
//     por causa da LGPD.
//  2) Se a empresa é "Lucro Presumido" ou "Lucro Real": a Receita só expõe
//     publicamente se a empresa optou pelo Simples Nacional/MEI (isso sim
//     é público). A escolha entre Presumido/Real não faz parte do cadastro
//     do CNPJ — é uma informação apurada nas declarações fiscais da própria
//     empresa, então quem sabe é o contador dela. O formulário deixa esse
//     campo pré-marcado quando dá (Simples/MEI) e, nos outros casos, pede
//     pra pessoa escolher manualmente.
// ============================================================================

async function buscarNaBrasilAPI(cnpj) {
  const controlador = new AbortController();
  const tempoLimite = setTimeout(() => controlador.abort(), 10000);
  try {
    return await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
      method: 'GET',
      signal: controlador.signal,
    });
  } finally {
    clearTimeout(tempoLimite);
  }
}

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const cnpj = (url.searchParams.get('cnpj') || '').replace(/\D/g, '');

    if (cnpj.length !== 14) {
      return Response.json({ erro: 'CNPJ inválido.' }, { status: 400 });
    }

    // A BrasilAPI é gratuita e comunitária — às vezes soluça. Tenta uma vez,
    // e se não for "não encontrado" (404, que é uma resposta definitiva),
    // tenta mais uma vez antes de desistir e pedir preenchimento manual.
    let resposta = await buscarNaBrasilAPI(cnpj);
    if (!resposta.ok && resposta.status !== 404) {
      await new Promise((r) => setTimeout(r, 800));
      resposta = await buscarNaBrasilAPI(cnpj);
    }

    if (resposta.status === 404) {
      return Response.json(
        { erro: 'CNPJ não encontrado na Receita Federal. Confira o número ou preencha os dados manualmente.' },
        { status: 404 }
      );
    }
    if (!resposta.ok) {
      return Response.json(
        { erro: `Não foi possível consultar a Receita Federal agora (código ${resposta.status}). Preencha os dados manualmente ou tente de novo em alguns instantes.` },
        { status: 502 }
      );
    }

    const dados = await resposta.json().catch(() => null);
    if (!dados || !dados.razao_social) {
      return Response.json(
        { erro: 'A consulta não devolveu dados válidos. Preencha os dados manualmente.' },
        { status: 502 }
      );
    }

    return Response.json({
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
      // Só isso é público sobre tributação — ver aviso no topo do arquivo.
      optanteSimples: !!dados.opcao_pelo_simples,
      optanteMei: !!dados.opcao_pelo_mei,
      // CPF/CNPJ do sócio já vem mascarado pela própria Receita Federal.
      socios: Array.isArray(dados.qsa)
        ? dados.qsa.map((s) => ({
            nome: s.nome_socio || null,
            qualificacao: s.qualificacao_socio || null,
            documentoMascarado: s.cnpj_cpf_do_socio || null,
          }))
        : [],
    });
  } catch (erro) {
    const mensagem = erro?.name === 'AbortError'
      ? 'A consulta à Receita Federal demorou demais e foi cancelada. Preencha os dados manualmente.'
      : 'Erro inesperado no servidor: ' + erro.message;
    return Response.json({ erro: mensagem }, { status: 500 });
  }
}