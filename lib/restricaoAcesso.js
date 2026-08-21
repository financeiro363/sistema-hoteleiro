// ============================================================================
// RESTRIÇÃO DE ACESSO POR PAPEL
// ============================================================================
// Alguns papéis (Manutenção, Camareira) só podem acessar um punhado bem
// específico de páginas — o resto do site precisa ficar fora do alcance
// deles, mesmo se a pessoa digitar a URL direto no navegador.
//
// Papéis que NÃO aparecem aqui (ADMIN, COLABORADOR, CONTADOR) continuam
// exatamente como sempre foram — essa restrição não muda nada pra eles.
// ============================================================================

export const PAPEIS_RESTRITOS = {
  MANUTENCAO: {
    rotulo: 'Manutenção',
    paginas: ['/tarefas-pessoais', '/manutencao'],
    inicial: '/tarefas-pessoais',
  },
  CAMAREIRA: {
    rotulo: 'Camareira',
    paginas: ['/tarefas-pessoais', '/governanca'],
    inicial: '/tarefas-pessoais',
  },
};

// Chame isso logo depois de descobrir o papel da pessoa. Nas páginas que
// NÃO pertencem a nenhum papel restrito, chame sem o 3º argumento — sempre
// bloqueia. Já em páginas que pertencem à lista de ALGUM papel restrito
// (ex.: /manutencao, /governanca), passe o caminho atual como 3º argumento,
// pra só liberar quem realmente pode estar ali (ex.: Camareira não entra
// em /manutencao, mesmo essa página sendo permitida pra Manutenção).
//
// Redireciona e devolve true se bloqueou — a própria página deve parar de
// renderizar o resto do conteúdo quando isso acontecer.
export function bloquearSeNaoPermitido(papel, router, caminhoAtual) {
  const restricao = PAPEIS_RESTRITOS[papel];
  if (!restricao) return false; // papel sem restrição — nada a fazer
  if (caminhoAtual && restricao.paginas.includes(caminhoAtual)) return false; // esta página é permitida pra esse papel
  router.push(restricao.inicial);
  return true;
}
