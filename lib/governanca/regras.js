// ============================================================================
// GOVERNANÇA — regras sem segredo (usadas na tela e no servidor)
// ============================================================================
// Cada quarto tem dois campos que andam juntos:
//   estado_apartamento → a SITUAÇÃO, com os nomes que as camareiras usam
//                        ("Saída / Apt Sujo", "Interditado"...)
//   status             → a LIMPEZA: SUJO → EM_ARRUMACAO → LIMPO, ou MANUTENCAO
// Aqui fica como um puxa o outro, quem entra na lista da camareira, em que
// ordem, e o que vai para a Cloudbeds.
// ============================================================================

export const FUSO_HOTEL = 'America/Fortaleza';

export const STATUS_QUARTO_LABEL = {
  LIMPO: 'Limpo', SUJO: 'Sujo', EM_ARRUMACAO: 'Em Arrumação', MANUTENCAO: 'Manutenção',
};

// Os 8 nomes combinados com as camareiras — não mudar os textos.
export const ESTADO_APARTAMENTO_LABEL = {
  SAIDA_SUJO: 'Saída / Apt Sujo',
  ARRUMACAO_OCUPADO: 'Arrumação / Apt ocupado',
  VIROU_ARRUMACAO_OCUPADO: 'Virou arrumação / Apt ocupado',
  NAO_DESEJA_ARRUMACAO_OCUPADO: 'Não deseja arrumação / Apt ocupado',
  PREVISAO_SAIDA_OCUPADO: 'Previsão de saída / Apt ocupado',
  LIMPO: 'Limpo / Apt limpo',
  SERVICOS_GERAIS: 'Serviços gerais',
  INTERDITADO: 'Interditado',
};

// Mesmo sujo, estes não entram na lista da camareira
export const FORA_DA_LISTA = ['NAO_DESEJA_ARRUMACAO_OCUPADO', 'PREVISAO_SAIDA_OCUPADO', 'SERVICOS_GERAIS', 'INTERDITADO'];

// Só a equipe muda estes — os avisos da Cloudbeds não mexem neles
export const ESTADOS_MANUAIS = ['SERVICOS_GERAIS', 'INTERDITADO'];

export function diaNoHotel(valor) {
  if (!valor) return '';
  return new Date(valor).toLocaleDateString('en-CA', { timeZone: FUSO_HOTEL });
}

export function hojeNoHotel(agora = new Date()) {
  return diaNoHotel(agora);
}

// ---- Estado escolhido na tela → limpeza e Cloudbeds ------------------------

export function efeitoDoEstado(estado) {
  switch (estado) {
    case 'SAIDA_SUJO':
    case 'ARRUMACAO_OCUPADO':
    case 'VIROU_ARRUMACAO_OCUPADO':
      return { status: 'SUJO', cloudbeds: { roomCondition: 'dirty' } };
    case 'LIMPO':
      return { status: 'LIMPO', cloudbeds: { roomCondition: 'clean' } };
    case 'SERVICOS_GERAIS': // manutenção sem bloquear a venda
      return { status: 'MANUTENCAO', cloudbeds: { roomCondition: 'dirty' } };
    case 'INTERDITADO': // manutenção + bloqueio na Cloudbeds
      return { status: 'MANUTENCAO', cloudbeds: { roomCondition: 'dirty' } };
    case 'NAO_DESEJA_ARRUMACAO_OCUPADO': // na Cloudbeds: "Recusou serviço"
      return { status: null, cloudbeds: { refusedService: true } };
    default: // Previsão de saída: o hóspede ainda está no quarto
      return { status: null, cloudbeds: {} };
  }
}

// O que gravar quando a equipe troca o estado na aba Quartos.
// Se o estado não mudou, a limpeza fica como está (ex.: quarto ocupado que já
// foi arrumado hoje não volta para a lista só porque alguém trocou a camareira).
export function mudancaDeEstado(quarto, novoEstado) {
  const antes = quarto?.estado_apartamento || null;
  if (antes === novoEstado) {
    return { campos: { estado_apartamento: novoEstado }, cloudbeds: {}, mudou: false };
  }
  const efeito = efeitoDoEstado(novoEstado);
  let status = efeito.status;
  if (!status) status = quarto?.status === 'MANUTENCAO' || !quarto?.status ? 'SUJO' : quarto.status;
  // Camareira já está dentro do quarto: continua "Em Arrumação"
  if (quarto?.status === 'EM_ARRUMACAO' && status === 'SUJO') status = 'EM_ARRUMACAO';
  const cloudbeds = { ...efeito.cloudbeds };
  if (antes === 'NAO_DESEJA_ARRUMACAO_OCUPADO') cloudbeds.refusedService = false;
  return { campos: { estado_apartamento: novoEstado, status }, cloudbeds, mudou: true };
}

// ---- Lista da camareira -------------------------------------------------------

export function precisaArrumar(q) {
  return q?.status === 'SUJO' && !FORA_DA_LISTA.includes(q.estado_apartamento);
}

export function naoPerturbeAtivo(q, agora = new Date()) {
  return !!q?.nao_perturbe_em && diaNoHotel(q.nao_perturbe_em) === hojeNoHotel(agora);
}

// 0 = prioridade da recepção · 1 = saída · 2 = ocupado · 9 = não perturbe
export function grupoNaFila(q, agora = new Date()) {
  if (naoPerturbeAtivo(q, agora)) return 9;
  if (q.prioridade) return 0;
  const e = q.estado_apartamento;
  if (!e || e === 'SAIDA_SUJO' || e === 'LIMPO') return 1;
  return 2;
}

export const NOME_GRUPO = { 0: 'Prioridade da recepção', 1: 'Saída', 2: 'Hóspede no quarto', 9: 'Não perturbe' };

export function compararNumero(a, b) {
  return String(a ?? '').localeCompare(String(b ?? ''), 'pt-BR', { numeric: true, sensitivity: 'base' });
}

export function ordenarFila(lista, agora = new Date()) {
  return [...lista].sort((a, b) => (grupoNaFila(a, agora) - grupoNaFila(b, agora)) || compararNumero(a.numero, b.numero));
}

// O rótulo que a camareira vê. Um quarto sujo que ainda carrega
// "Limpo / Apt limpo" (dado antigo) aparece só como "Sujo".
export function rotuloDoEstado(q) {
  if (q?.status === 'SUJO' && (!q.estado_apartamento || q.estado_apartamento === 'LIMPO')) return 'Sujo';
  return ESTADO_APARTAMENTO_LABEL[q?.estado_apartamento] || STATUS_QUARTO_LABEL[q?.status] || '—';
}

// ---- Fim da arrumação ---------------------------------------------------------

// Saída arrumada vira "Limpo / Apt limpo"; quarto ocupado continua com o
// estado dele (o hóspede segue lá), mas a limpeza fica LIMPO.
export function estadoAoTerminar(estado) {
  return !estado || estado === 'SAIDA_SUJO' ? 'LIMPO' : estado;
}

// Cloudbeds: quarto arrumado é "clean" — vazio ou ocupado ("Ocupado e limpo").
export function cloudbedsAoTerminar(quarto) {
  const p = { roomCondition: 'clean' };
  if (quarto?.nao_perturbe_em) p.doNotDisturb = false;
  return p;
}

// ---- Aviso da Cloudbeds → nosso quarto ----------------------------------------
// condicao: dirty | clean | inspected   ocupado: true | false | null (não sei)
// Devolve só os campos que mudam, ou null.
export function estadoAposCloudbeds(q, { condicao, ocupado = null, bloqueado = false } = {}) {
  if (!q) return null;
  const estado = q.estado_apartamento || null;
  if (ESTADOS_MANUAIS.includes(estado)) return null; // Interditado / Serviços gerais: só a equipe muda
  if (q.status === 'EM_ARRUMACAO') return null;       // camareira lá dentro: ela termina

  let status = q.status;
  let novoEstado = estado;
  if (bloqueado) {
    status = 'MANUTENCAO';
  } else if (condicao === 'dirty') {
    status = 'SUJO';
    if (ocupado === false) novoEstado = 'SAIDA_SUJO';
    else if (!estado || estado === 'LIMPO') novoEstado = ocupado === true ? 'ARRUMACAO_OCUPADO' : 'SAIDA_SUJO';
  } else if (condicao === 'clean' || condicao === 'inspected') {
    status = 'LIMPO';
    if (ocupado === false) novoEstado = 'LIMPO';
    else if (ocupado === true) {
      if (!estado || estado === 'LIMPO' || estado === 'SAIDA_SUJO') novoEstado = 'ARRUMACAO_OCUPADO';
    } else if (!estado || estado === 'SAIDA_SUJO') novoEstado = 'LIMPO';
  } else {
    return null;
  }

  const campos = {};
  if (status !== q.status) campos.status = status;
  if (novoEstado !== estado) campos.estado_apartamento = novoEstado;
  // Hóspede saiu: o "não perturbe" de hoje não vale mais
  if (ocupado === false && q.nao_perturbe_em) campos.nao_perturbe_em = null;
  // Ficou limpo: a prioridade pedida pela recepção foi atendida
  if (status === 'LIMPO' && q.prioridade) { campos.prioridade = false; campos.prioridade_obs = null; }
  return Object.keys(campos).length ? campos : null;
}

// Quarto novo importado da Cloudbeds
export function estadoInicialDaCloudbeds(rc) {
  const base = { status: 'SUJO', estado_apartamento: null };
  const campos = estadoAposCloudbeds(base, {
    condicao: rc?.roomCondition, ocupado: typeof rc?.roomOccupied === 'boolean' ? rc.roomOccupied : null, bloqueado: !!rc?.roomBlocked,
  }) || {};
  return { status: campos.status || 'SUJO', estado_apartamento: campos.estado_apartamento ?? (rc?.roomBlocked ? null : 'SAIDA_SUJO') };
}

// ---- Interditado ----------------------------------------------------------------

export function dataDeVoltaInvalida(data, agora = new Date()) {
  if (!data) return 'Informe a previsão de volta do quarto.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || Number.isNaN(Date.parse(data + 'T12:00:00Z'))) return 'Data de volta inválida.';
  if (data < hojeNoHotel(agora)) return 'A previsão de volta não pode ser antes de hoje.';
  return null;
}

export function bloqueioVencido(q, agora = new Date()) {
  return !!q?.interditado_ate && q.interditado_ate < hojeNoHotel(agora);
}

export function formatarDia(data) {
  if (!data) return '';
  const [a, m, d] = String(data).slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}
