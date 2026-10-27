// ============================================================================
// CAMPANHAS DO WHATSAPP (Fase 6) — nomes e regras usados na tela e no servidor
// ============================================================================

export const LIMITE_CAMPANHA = 5000;          // clientes por campanha
export const ENVIOS_POR_RODADA = 40;          // a cada 2 minutos (≈ 1.200 por hora)

export const SITUACOES_CAMPANHA = {
  AGENDADA: { rotulo: 'Agendada', cor: { background: '#EAF2FC', color: '#1B4F8A' } },
  ENVIANDO: { rotulo: 'Enviando', cor: { background: '#FFF4D6', color: '#7A5600' } },
  PAUSADA: { rotulo: 'Pausada', cor: { background: '#F1F1EE', color: '#5B6762' } },
  CONCLUIDA: { rotulo: 'Concluída', cor: { background: '#E5F4EA', color: '#14532D' } },
  CANCELADA: { rotulo: 'Cancelada', cor: { background: '#F1F1EE', color: '#5B6762' } },
};
export const SITUACOES_ENVIO = { PENDENTE: 'Na fila', ENVIADO: 'Enviado', FALHOU: 'Falhou', PULADO: 'Não enviado', CANCELADO: 'Cancelado' };

// De onde vem cada variável {{1}}, {{2}}… do modelo
export const FONTES_VARIAVEL = {
  primeiro_nome: 'Primeiro nome do cliente',
  nome_completo: 'Nome completo do cliente',
  hotel: 'Nome do hotel',
  fixo: 'Texto igual para todos',
  coluna: 'Coluna da planilha',
};

export const FILTROS_CONTATOS = {
  mostrar: { '': 'Todos com WhatsApp', conversaram: 'Que já conversaram', importados: 'Importados de planilha', reservaram: '⭐ Já reservaram', nao_reservaram: 'Nunca reservaram' },
  periodo: { '': 'Qualquer data', 30: 'Últimos 30 dias', 90: 'Últimos 90 dias', 180: 'Últimos 6 meses', 365: 'Últimos 12 meses' },
};

// Primeiro nome "bonito": "MARIA DA SILVA" → "Maria"
export function primeiroNomeBonito(nome) {
  const p = String(nome || '').trim().split(/\s+/)[0] || '';
  if (!p || /\d|@/.test(p)) return '';
  return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
}

// Valor de uma variável para um cliente
export function valorDaVariavel(v, pessoa, hotelNome) {
  const fonte = v?.fonte;
  let r = '';
  if (fonte === 'primeiro_nome') r = primeiroNomeBonito(pessoa?.nome) || 'cliente';
  else if (fonte === 'nome_completo') r = String(pessoa?.nome || '').trim() || 'cliente';
  else if (fonte === 'hotel') r = hotelNome || '';
  else if (fonte === 'fixo') r = String(v.valor || '');
  else if (fonte === 'coluna') r = String(pessoa?.colunas?.[v.valor] ?? '');
  return r.replace(/\s+/g, ' ').trim().slice(0, 300);
}

// Todas as variáveis prontas para um cliente
export function valoresDaPessoa(campanha, pessoa, hotelNome) {
  const info = campanha.modelo_info || {};
  return {
    corpo: (campanha.variaveis || []).map((v) => valorDaVariavel(v, pessoa, hotelNome)),
    cabecalho: (campanha.variaveis_cabecalho || []).map((v) => valorDaVariavel(v, pessoa, hotelNome)),
    botoes: (info.botoesLink || []).map((b, i) => ({ indice: b.indice, texto: valorDaVariavel((campanha.botoes || [])[i], pessoa, hotelNome) })),
  };
}
