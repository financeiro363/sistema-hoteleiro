// ============================================================================
// ROTA DE SERVIDOR: /api/directd-cpf
// ============================================================================
// Consulta o CPF na DirectD e devolve nome, gênero e data de nascimento —
// usado pelo formulário PÚBLICO da Ficha FNRH (o hóspede não está logado).
// Por isso essa rota não pede login — mas o TOKEN da DirectD mesmo assim
// nunca aparece no navegador: a chamada para a DirectD acontece aqui, só
// no servidor.
//
// ⚠️ Como é uma rota pública, qualquer pessoa que souber o endereço dela
// poderia, em teoria, chamá-la repetidamente e gastar os créditos da
// conta DirectD do hotel. Não implementei um limite de tentativas aqui
// (isso exigiria uma infraestrutura extra tipo Redis) — se isso virar um
// problema no dia a dia, me avise que eu adiciono uma proteção depois.
// ============================================================================

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const cpf = (url.searchParams.get('cpf') || '').replace(/\D/g, '');

    if (cpf.length !== 11) {
      return Response.json({ erro: 'CPF inválido.' }, { status: 400 });
    }

    const token = process.env.DIRECTD_TOKEN;
    if (!token) {
      return Response.json({ erro: 'A consulta de CPF não está configurada no servidor (falta DIRECTD_TOKEN).' }, { status: 500 });
    }

    const respostaDirectD = await fetch(
      `https://apiv3.directd.com.br/api/CadastroReceitaPessoaFisica?CPF=${cpf}&Token=${token}`,
      { method: 'GET' }
    );
    const dados = await respostaDirectD.json().catch(() => null);

    if (!respostaDirectD.ok || !dados?.retorno) {
      return Response.json({ erro: 'Não foi possível consultar este CPF agora. Preencha os dados manualmente.' }, { status: 400 });
    }

    const cadastro = dados.retorno.cadastro || {};
    const receita = dados.retorno.receita || {};
    const enderecoPrincipal = (cadastro.enderecos || [])[0] || {};

    // Converte "DD/MM/AAAA" (formato da DirectD) para "AAAA-MM-DD" (formato
    // que o campo de data do formulário espera)
    function paraDataISO(dataBr) {
      if (!dataBr) return null;
      // Tira qualquer parte de hora junto (ex.: "11/11/1966 00:00:00" -> "11/11/1966")
      const texto = String(dataBr).trim().split(/[\sT]/)[0];
      // Já vem no formato "AAAA-MM-DD"
      if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;
      // Formato "DD/MM/AAAA"
      const partes = texto.split('/');
      if (partes.length !== 3) return null;
      const [dia, mes, ano] = partes;
      if (!/^\d{4}$/.test(ano)) return null;
      return `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
    }

    return Response.json({
      encontrado: true,
      nomeCompleto: cadastro.nome || receita.nomePessoaFisica || null,
      genero: (() => {
        const bruto = String(cadastro.sexo || receita.sexo || '').trim().toUpperCase();
        if (bruto === 'M' || bruto === 'MASCULINO') return 'Masculino';
        if (bruto === 'F' || bruto === 'FEMININO') return 'Feminino';
        return null;
      })(),
      dataNascimento: paraDataISO(cadastro.dataNascimento || receita.dataNascimento),
      endereco: enderecoPrincipal.logradouro || null,
      numeroEndereco: enderecoPrincipal.numero || null,
      bairro: enderecoPrincipal.bairro || null,
      cidade: enderecoPrincipal.cidade || null,
      estado: enderecoPrincipal.uf || null,
      cep: enderecoPrincipal.cep || null,
    });
  } catch (erro) {
    return Response.json({ erro: 'Erro inesperado no servidor: ' + erro.message }, { status: 500 });
  }
}
