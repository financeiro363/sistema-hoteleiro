// ============================================================================
// FICHAS DE EPI — regras e textos (usado pela tela e pela impressão)
// ============================================================================
// Uma ficha = um colaborador + os EPIs entregues numa data. Os dados do
// colaborador (nome, função, setor) e do hotel ficam copiados na ficha, para
// a reimpressão sair igual mesmo que o cadastro mude depois.
// ============================================================================

// Linhas da tabela de EPIs na folha (as que sobram saem em branco, como no modelo)
export const LINHAS_FICHA = 18;

export const BASE_LEGAL = [
  'Artigo 158 e 462 da lei 6.514/77',
  'NR – 1 Portaria nº 3.214/78',
  'NR – 6 Portaria nº 3.214/78',
];

export const TERMO_INICIO = 'Declaro, para os efeitos dos Artigos 158 e 462 da CLT e da NR-01 e NR-06 da Portaria 3.214/78, que recebi os Equipamentos de Proteção Individual (EPIs) abaixo relacionados, adequados ao risco de minha atividade e em perfeito estado de conservação:';
export const TERMO_ITENS = [
  'Usá-lo(s) apenas para os fins a que se destina(m);',
  'Mantê-lo(s) sob minha guarda e conservação;',
  'Comunicar à empresa quaisquer alterações que o(s) torne(m) impróprio(s) para uso;',
  'Reembolsar a empresa, em caso de dano ou extravio;',
  'Devolvê-lo(s) à empresa ao término do meu contrato, ou quando esta assim o julgar conveniente.',
];
export const TERMO_FIM = 'Declaro ainda ter recebido treinamento necessário para a perfeita utilização dos EPI abaixo relacionados.';

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

// "2026-09-25" → "25 de Setembro de 2026" (como na ficha modelo)
export function dataDaFicha(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return '';
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} de ${MESES[m - 1]} de ${a}`;
}

export const itemVazio = () => ({ quantidade: '', descricao: '', validade: '', ca: '', anvisa: '' });

const limpo = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// Data de validade: "122030" → "12/2030"; "31122030" → "31/12/2030"; o resto fica como digitado
export function normalizarValidade(texto) {
  const t = limpo(texto, 20);
  const d = t.replace(/\D/g, '');
  if (/^[\d\s./-]+$/.test(t)) {
    if (d.length === 6) return `${d.slice(0, 2)}/${d.slice(2)}`;
    if (d.length === 8) return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
  }
  return t;
}

// Validade com mês ou dia impossível (13/2030, 31/02/2030…)
export function validadeInvalida(texto) {
  const t = String(texto || '').trim();
  let m = t.match(/^(\d{2})\/(\d{4})$/);
  if (m) return Number(m[1]) < 1 || Number(m[1]) > 12;
  m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) {
    const [dia, mes, ano] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const data = new Date(Date.UTC(ano, mes - 1, dia));
    return data.getUTCMonth() !== mes - 1 || data.getUTCDate() !== dia;
  }
  return false;
}

export function linhaPreenchida(item) {
  return ['quantidade', 'descricao', 'validade', 'ca', 'anvisa'].some((k) => String(item?.[k] || '').trim());
}

// Itens prontos para salvar (sem linhas vazias, textos limpos)
export function itensParaSalvar(itens) {
  return (itens || []).filter(linhaPreenchida).map((i) => ({
    quantidade: limpo(i.quantidade, 40),
    descricao: limpo(i.descricao, 120),
    validade: normalizarValidade(i.validade),
    ca: limpo(i.ca, 20),
    anvisa: limpo(i.anvisa, 30),
  }));
}

// Confere a ficha antes de salvar. erros = não deixa salvar; faltando = só avisa
export function conferirFicha(ficha) {
  const erros = [];
  const faltando = [];
  if (!ficha?.funcionario_id && !String(ficha?.colaborador_nome || '').trim()) erros.push('Escolha o colaborador.');
  if (!ficha?.data_entrega) erros.push('Informe a data da entrega.');
  const itens = (ficha?.itens || []).filter(linhaPreenchida);
  if (!itens.length) erros.push('Preencha pelo menos um EPI.');
  if (itens.length > LINHAS_FICHA) erros.push(`A folha tem espaço para ${LINHAS_FICHA} EPIs. Faça outra ficha para os demais.`);
  itens.forEach((it, i) => {
    const n = (ficha.itens || []).indexOf(it) + 1 || i + 1;
    if (!String(it.descricao || '').trim()) erros.push(`EPI da linha ${n}: falta a descrição.`);
    if (!String(it.quantidade || '').trim()) erros.push(`EPI da linha ${n}: falta a quantidade.`);
    if (validadeInvalida(it.validade)) erros.push(`EPI da linha ${n}: a data de validade não existe.`);
    if (!String(it.validade || '').trim()) faltando.push(`a validade da linha ${n}`);
    if (!String(it.ca || '').trim()) faltando.push(`o CA da linha ${n}`);
  });
  return { erros, faltando };
}

// "15 pares Luvas para procedimento + 2 EPIs"
export function resumoItens(itens) {
  const lista = (itens || []).filter(linhaPreenchida);
  if (!lista.length) return 'Nenhum EPI';
  const primeiro = [lista[0].quantidade, lista[0].descricao].filter(Boolean).join(' ');
  return lista.length > 1 ? `${primeiro} + ${lista.length - 1} EPI${lista.length > 2 ? 's' : ''}` : primeiro;
}

export function situacaoFicha(f) {
  if (f?.devolvida_em) return 'DEVOLVIDA';
  if (f?.impresso_em) return 'AGUARDANDO';
  return 'NAO_IMPRESSA';
}

// Últimos dados usados de cada EPI (para sugerir CA, validade e ANVISA)
export function catalogoDeEpis(fichas) {
  const mapa = new Map();
  [...(fichas || [])]
    .sort((a, b) => String(a.criado_em || '').localeCompare(String(b.criado_em || '')))
    .forEach((f) => (f.itens || []).forEach((it) => {
      const chave = String(it.descricao || '').trim().toLowerCase();
      if (chave) mapa.set(chave, { descricao: it.descricao, validade: it.validade || '', ca: it.ca || '', anvisa: it.anvisa || '' });
    }));
  return mapa;
}
