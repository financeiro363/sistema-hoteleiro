// ============================================================================
// PEDIDO DE GRUPO REGISTRADO À MÃO (telefone, balcão, e-mail, indicação)
// ============================================================================
// Usado na tela (Solicitações → "+ Registrar grupo") e no servidor
// (/api/atendimento, ação grupo_registrar). O pedido entra igual ao que o
// robô registra: aparece em Solicitações e no painel de grupos, com o valor
// estimado pela Cloudbeds.
// ============================================================================

import { numerosDoGrupo } from './gruposConfig';

export const ORIGENS_GRUPO = {
  TELEFONE: 'Telefone',
  PRESENCIAL: 'No balcão',
  EMAIL: 'E-mail',
  INDICACAO: 'Indicação',
  OUTRO: 'Outro',
};

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const limpo = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const inteiro = (v) => {
  const n = Math.trunc(Number(String(v ?? '').replace(/\D/g, '') || NaN));
  return Number.isFinite(n) ? n : null;
};

function dataValida(iso) {
  if (!DATA_ISO.test(iso || '')) return false;
  const [a, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d));
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const dataBR = (iso) => iso.split('-').reverse().join('/');

// corpo: { nome, telefone, email, checkin, checkout, pessoas, quartos, detalhes, origem }
// Devolve { erros: [] } ou { resumo, dados, numeros, telefone, email }
export function montarGrupoManual(corpo = {}, hoje) {
  const erros = [];
  const nome = limpo(corpo.nome, 120);
  const telefone = String(corpo.telefone || '').replace(/\D/g, '').slice(0, 15);
  const email = limpo(corpo.email, 160).toLowerCase();
  const checkin = limpo(corpo.checkin, 10);
  const checkout = limpo(corpo.checkout, 10);
  const pessoas = corpo.pessoas === '' || corpo.pessoas == null ? null : inteiro(corpo.pessoas);
  const quartos = corpo.quartos === '' || corpo.quartos == null ? null : inteiro(corpo.quartos);
  const origem = ORIGENS_GRUPO[corpo.origem] ? corpo.origem : 'TELEFONE';
  const detalhes = String(corpo.detalhes || '').trim().slice(0, 2000);

  if (!nome) erros.push('Informe o nome do cliente ou da empresa.');
  if (!telefone && !email) erros.push('Informe um telefone ou um e-mail para retornar.');
  if (telefone && (telefone.length < 10 || telefone.length > 13)) erros.push('Telefone: digite com DDD (ex.: 83 98888-7777).');
  if (email && !EMAIL.test(email)) erros.push('E-mail inválido.');
  if ((checkin || checkout) && !(dataValida(checkin) && dataValida(checkout))) erros.push('Informe as duas datas (entrada e saída) ou deixe as duas em branco.');
  else if (checkin && checkout <= checkin) erros.push('A saída precisa ser depois da entrada.');
  else if (checkin && hoje && checkin < hoje) erros.push('A data de entrada já passou.');
  if (pessoas == null && quartos == null) erros.push('Informe quantas pessoas ou quantos quartos.');
  if (pessoas != null && !(pessoas >= 1 && pessoas <= 5000)) erros.push('Pessoas: um número de 1 a 5.000.');
  if (quartos != null && !(quartos >= 1 && quartos <= 1000)) erros.push('Quartos: um número de 1 a 1.000.');
  if (erros.length) return { erros };

  const dados = {
    nome,
    ...(telefone ? { telefone } : {}),
    ...(email ? { email } : {}),
    ...(checkin ? { checkin, checkout } : {}),
    ...(pessoas ? { pessoas: `${pessoas} pessoas` } : {}),
    ...(quartos ? { quartos: `${quartos} quartos` } : {}),
    ...(detalhes ? { detalhes } : {}),
    origem: ORIGENS_GRUPO[origem],
  };
  const numeros = numerosDoGrupo({ ...dados, numero_pessoas: pessoas, numero_quartos: quartos });
  const partes = [
    pessoas ? `${pessoas} pessoas` : null,
    quartos ? `${quartos} quartos` : null,
    checkin ? `${dataBR(checkin)} a ${dataBR(checkout)}` : 'datas a combinar',
  ].filter(Boolean);
  const resumo = `Grupo de ${nome}: ${partes.join(', ')} (${ORIGENS_GRUPO[origem].toLowerCase()})`.slice(0, 300);
  return { erros: [], resumo, dados, numeros, telefone, email };
}
