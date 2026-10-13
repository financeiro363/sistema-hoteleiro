// ============================================================================
// BUSCAR TODAS AS LINHAS DE UMA TABELA (sem o limite de 1.000)
// ============================================================================
// O Supabase devolve no máximo 1.000 linhas por consulta. Quando uma tabela
// passa disso, o que sobra simplesmente não chega na tela — sem nenhum erro.
// Esta função busca em partes de 1.000 (0–999, 1000–1999, ...) até acabar.
//
// Para não pular nem repetir nenhuma linha entre uma parte e outra, ela
// acrescenta "e depois pelo id" à ordem que a consulta já tiver (a ordem
// que a tela pediu continua valendo). Se a tabela não tiver a coluna id,
// segue sem esse desempate em vez de dar erro.
//
// Uso:
//   const { data, error } = await buscarTodos(() =>
//     supabase.from('contabilidade_lancamentos').select('*').order('criado_em'));
//
// Importante: passe uma FUNÇÃO que monta a consulta do zero (o "() =>"),
// porque cada parte precisa de uma consulta nova.
// ============================================================================

const TAMANHO_PARTE = 1000;

export async function buscarTodos(montarConsulta, { desempate = 'id' } = {}) {
  let usarDesempate = !!desempate;
  let todas = [];
  let inicio = 0;
  for (;;) {
    let consulta = montarConsulta();
    if (usarDesempate) consulta = consulta.order(desempate, { ascending: true });
    const { data, error } = await consulta.range(inicio, inicio + TAMANHO_PARTE - 1);
    if (error) {
      // 42703 = coluna não existe (tabela sem "id"): recomeça sem o desempate
      if (usarDesempate && error.code === '42703') {
        usarDesempate = false;
        todas = [];
        inicio = 0;
        continue;
      }
      return { data: todas, error };
    }
    todas.push(...(data || []));
    if (!data || data.length < TAMANHO_PARTE) break;
    inicio += TAMANHO_PARTE;
  }
  return { data: todas, error: null };
}
