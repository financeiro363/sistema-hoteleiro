// ============================================================================
// RECEBIMENTO DE DOCUMENTOS DOS COLABORADORES — regras e textos
// ============================================================================
// A cada pagamento (do mês ou da quinzena) o administrador cria uma "rodada":
// a data, os documentos que precisam voltar e os colaboradores. Cada
// colaborador × documento é uma "célula" com a situação (OK, Falta, Férias,
// Licença, Demitido) ou vazia (ainda não conferida).
// ============================================================================

export const DOCUMENTOS = [
  { codigo: 'EMAIL_CONTRACHEQUE', nome: 'E-mail do contracheque', curto: 'E-mail' },
  { codigo: 'FOLHA_PONTO', nome: 'Folha de ponto', curto: 'Ponto' },
  { codigo: 'FOLHA_ALIMENTACAO', nome: 'Folha de alimentação', curto: 'Alimentação' },
  { codigo: 'BANCO_HORAS', nome: 'Banco de horas', curto: 'Banco de horas' },
];
const DOC = Object.fromEntries(DOCUMENTOS.map((d) => [d.codigo, d]));
export const nomeDocumento = (codigo) => DOC[codigo]?.nome || codigo;
export const nomeCurtoDocumento = (codigo) => DOC[codigo]?.curto || codigo;
export const ordenarDocumentos = (lista) => DOCUMENTOS.map((d) => d.codigo).filter((c) => (lista || []).includes(c));

// Documentos que já vêm marcados em cada tipo de pagamento (decidido em 30/10/2026)
export const TIPOS_PAGAMENTO = {
  MES: { nome: 'Pagamento do mês', documentos: ['EMAIL_CONTRACHEQUE', 'FOLHA_PONTO', 'FOLHA_ALIMENTACAO', 'BANCO_HORAS'] },
  QUINZENA: { nome: 'Quinzena', documentos: ['EMAIL_CONTRACHEQUE'] },
};
export const nomeTipo = (tipo) => TIPOS_PAGAMENTO[tipo]?.nome || tipo;

// As mesmas opções da planilha. "Resolve" = não precisa mais cobrar.
export const SITUACOES = [
  { codigo: 'OK', nome: 'OK', resolve: true },
  { codigo: 'FALTA', nome: 'Falta', resolve: false },
  { codigo: 'FERIAS', nome: 'Férias', resolve: true },
  { codigo: 'LICENCA', nome: 'Licença', resolve: true },
  { codigo: 'DEMITIDO', nome: 'Demitido', resolve: true },
];
const SIT = Object.fromEntries(SITUACOES.map((s) => [s.codigo, s]));
export const nomeSituacao = (codigo) => SIT[codigo]?.nome || 'Pendente';
export const resolvida = (situacao) => !!SIT[situacao]?.resolve;

// Pagamento do começo do mês → "do mês"; da metade em diante → quinzena
export function tipoSugerido(dataIso) {
  const dia = Number(String(dataIso || '').slice(8, 10));
  return dia && dia > 12 ? 'QUINZENA' : 'MES';
}

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
export function mesDaData(dataIso) {
  const [a, m] = String(dataIso || '').split('-').map(Number);
  return a && m ? `${MESES[m - 1]} ${a}` : '';
}

// Chave de uma pessoa na rodada (o id do cadastro; se ele foi excluído, o nome)
export const chavePessoa = (c) => (c.funcionario_id != null ? `f${c.funcionario_id}` : `n${String(c.colaborador_nome || '').toLowerCase()}`);

// Células de uma rodada → pessoas em ordem alfabética, cada uma com {documento: célula}
export function pessoasDaRodada(celulas) {
  const mapa = new Map();
  (celulas || []).forEach((c) => {
    const k = chavePessoa(c);
    if (!mapa.has(k)) mapa.set(k, { chave: k, funcionario_id: c.funcionario_id ?? null, nome: c.colaborador_nome, celulas: {} });
    mapa.get(k).celulas[c.documento] = c;
  });
  return [...mapa.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

export function resumoRodada(celulas) {
  const lista = celulas || [];
  const ok = lista.filter((c) => c.situacao === 'OK').length;
  const resolvidas = lista.filter((c) => resolvida(c.situacao)).length;
  const faltas = lista.filter((c) => c.situacao === 'FALTA').length;
  const vazias = lista.filter((c) => !c.situacao).length;
  return {
    total: lista.length, ok, resolvidas, faltas, vazias,
    pendentes: lista.length - resolvidas,
    completo: lista.length > 0 && resolvidas === lista.length,
    pessoasPendentes: new Set(lista.filter((c) => !resolvida(c.situacao)).map(chavePessoa)).size,
  };
}

// Texto para copiar e mandar (WhatsApp, e-mail) cobrando o que falta
export function textoPendencias(rodada, celulas, nomeHotel) {
  const pessoas = pessoasDaRodada(celulas)
    .map((p) => ({ nome: p.nome, faltam: ordenarDocumentos(Object.keys(p.celulas)).filter((d) => !resolvida(p.celulas[d].situacao)) }))
    .filter((p) => p.faltam.length);
  const titulo = `Documentos pendentes — ${nomeTipo(rodada.tipo)} de ${dataBr(rodada.data_pagamento)}${nomeHotel ? ` (${nomeHotel})` : ''}`;
  if (!pessoas.length) return `${titulo}\nNenhuma pendência. ✅`;
  return [titulo, '', ...pessoas.map((p) => `• ${p.nome}: ${p.faltam.map(nomeDocumento).join(', ')}`)].join('\n');
}

export function dataBr(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return '';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}
