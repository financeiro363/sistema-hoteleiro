// ============================================================================
// BUSCAR TODAS AS LINHAS DE UMA TABELA (sem o limite de 1.000)
// ============================================================================
// O Supabase devolve no máximo 1.000 linhas por consulta. Quando uma tabela
// passa disso, o que sobra simplesmente não chega na tela — sem nenhum erro.
// Esta função busca em partes de 1.000 (0–999, 1000–1999, ...) até acabar,
// sempre na mesma ordem (pelo id), para não pular nem repetir nenhuma linha.
//
// Uso:
//   const { data, error } = await buscarTodos(() =>
//     supabase.from('contabilidade_lancamentos').select('*'));
// ============================================================================

const TAMANHO_PARTE = 1000;

export async function buscarTodos(montarConsulta) {
  const todas = [];
  for (let inicio = 0; ; inicio += TAMANHO_PARTE) {
    const { data, error } = await montarConsulta()
      .order('id', { ascending: true })
      .range(inicio, inicio + TAMANHO_PARTE - 1);
    if (error) return { data: todas, error };
    todas.push(...(data || []));
    if (!data || data.length < TAMANHO_PARTE) break;
  }
  return { data: todas, error: null };
}
