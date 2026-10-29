// ============================================================================
// PEDIDOS DE GRUPO — valores usados na tela e no servidor (sem nada secreto)
// ============================================================================
// Decidido pelo Eduardo em 28/10:
//   - valor estimado = tarifa do quarto mais barato na Cloudbeds nas datas
//     × quartos × noites (a equipe pode corrigir)
//   - a equipe marca "Fechou" (com o valor fechado) ou "Não fechou" (com o motivo)
//   - o robô pergunta quantos quartos; se o cliente não souber, conta
//     PESSOAS_POR_QUARTO pessoas por quarto e marca "estimado"
// ============================================================================

export const PESSOAS_POR_QUARTO = 2;

export const MOTIVOS_PERDA = {
  PRECO: 'Achou caro',
  SEM_QUARTO: 'Sem quarto nas datas',
  SEM_RESPOSTA: 'Cliente não respondeu',
  OUTRO_HOTEL: 'Fechou com outro hotel',
  DESISTIU: 'Desistiu da viagem',
  OUTRO: 'Outro motivo',
};

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const PALAVRAS_QUARTO = /(\d+)\s*(?:quartos?|apartamentos?|aptos?\.?|su[ií]tes?|duplos?|triplos?|qu[aá]druplos?|singles?|individuais?|casais?|uhs?)\b/gi;

const inteiro = (v, min, max) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

// "10 quartos" → 10; "5 duplos e 3 triplos" → 8; "uns 12" → 12
export function quartosDe(texto) {
  if (typeof texto === 'number') return inteiro(texto, 1, 1000);
  const t = String(texto || '');
  const comPalavra = [...t.matchAll(PALAVRAS_QUARTO)].reduce((s, m) => s + Number(m[1]), 0);
  if (comPalavra) return inteiro(comPalavra, 1, 1000);
  const m = t.match(/\d+/);
  return m ? inteiro(m[0], 1, 1000) : null;
}

// "20 adultos e 5 crianças de 4 a 8 anos" → 25 (a idade não conta)
export function pessoasDe(texto) {
  if (typeof texto === 'number') return inteiro(texto, 1, 5000);
  const t = String(texto || '')
    .replace(/\(?\s*(?:de|com)\s+\d+\s*(?:(?:a|e|-|até)\s*\d+\s*)?anos?\s*\)?/gi, ' ')
    .replace(/\(?\b\d+\s*(?:(?:a|e|-)\s*\d+\s*)?anos?\b\)?/gi, ' ')
    .replace(/\d+\s*(?:quartos?|apartamentos?|aptos?|su[ií]tes?|noites?|di[aá]rias?|dias?)\b/gi, ' ');
  const total = (t.match(/\d+/g) || []).reduce((s, n) => s + Number(n), 0);
  return total ? inteiro(total, 1, 5000) : null;
}

export function noitesEntreDatas(checkin, checkout) {
  if (!DATA_ISO.test(checkin || '') || !DATA_ISO.test(checkout || '')) return null;
  const n = Math.round((Date.parse(`${checkout}T12:00:00Z`) - Date.parse(`${checkin}T12:00:00Z`)) / 86400000);
  return inteiro(n, 1, 365);
}

// Números do grupo a partir dos dados do pedido. O que a equipe já corrigiu
// (colunas grupo_*) vale mais que o texto do pedido.
export function numerosDoGrupo(dados = {}, atual = {}) {
  const d = dados || {};
  const pessoas = atual?.grupo_pessoas ?? pessoasDe(d.numero_pessoas) ?? pessoasDe(d.pessoas);
  let quartos = atual?.grupo_quartos ?? quartosDe(d.numero_quartos) ?? quartosDe(d.quartos);
  let quartosEstimado = atual?.grupo_quartos != null ? !!atual.grupo_quartos_estimado : false;
  if (!quartos && pessoas) {
    quartos = Math.max(1, Math.ceil(pessoas / PESSOAS_POR_QUARTO));
    quartosEstimado = true;
  }
  const checkin = DATA_ISO.test(d.checkin || '') ? d.checkin : null;
  const checkout = DATA_ISO.test(d.checkout || '') ? d.checkout : null;
  const noites = atual?.grupo_noites ?? noitesEntreDatas(checkin, checkout);
  return { pessoas: pessoas ?? null, quartos: quartos ?? null, quartosEstimado, noites: noites ?? null, checkin, checkout };
}

// Valor = tarifa por noite × quartos × noites (centavos certos)
export function valorDoGrupo(tarifaNoite, quartos, noites) {
  const t = Number(tarifaNoite);
  if (!(t > 0) || !quartos || !noites) return null;
  return Math.round(t * quartos * noites * 100) / 100;
}

export const ehGrupo = (s) => s?.tipo === 'GRUPO';

// "R$ 11.500,00", "11500", "11.500", "11500,5" → número (ou null)
export function lerReais(texto) {
  let t = String(texto ?? '').replace(/[R$\s]/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && n < 100000000 ? Math.round(n * 100) / 100 : null;
}
