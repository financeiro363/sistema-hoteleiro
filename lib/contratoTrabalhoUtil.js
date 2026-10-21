// ============================================================================
// FUNÇÕES DE APOIO — CONTRATOS DE TRABALHO
// ============================================================================
// - Valor por extenso (R$ 1.665,00 → "mil seiscentos e sessenta e cinco reais")
// - Número por extenso (45 → "quarenta e cinco")
// - Conferência do PIS/NIS
// - Máscaras de CPF, CNPJ, PIS, CEP e telefone
// - Datas: 2026-10-20 → "20/10/2026" ou "20 de outubro de 2026"
// ============================================================================

const UNIDADES = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove',
  'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CENTENAS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos',
  'setecentos', 'oitocentos', 'novecentos'];

// 0 a 999
function ate999(n) {
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100);
  const resto = n % 100;
  const partes = [];
  if (c) partes.push(CENTENAS[c]);
  if (resto) {
    if (resto < 20) partes.push(UNIDADES[resto]);
    else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      partes.push(u ? `${DEZENAS[d]} e ${UNIDADES[u]}` : DEZENAS[d]);
    }
  }
  return partes.join(' e ');
}

// Número inteiro por extenso (até 999.999.999.999)
export function numeroPorExtenso(valor) {
  let n = Math.floor(Math.abs(Number(valor) || 0));
  if (n === 0) return 'zero';
  const grupos = []; // [unidades, milhares, milhões, bilhões]
  while (n > 0) { grupos.push(n % 1000); n = Math.floor(n / 1000); }
  const nomes = [
    () => '',
    (g) => (g === 1 ? 'mil' : `${ate999(g)} mil`),
    (g) => (g === 1 ? 'um milhão' : `${ate999(g)} milhões`),
    (g) => (g === 1 ? 'um bilhão' : `${ate999(g)} bilhões`),
  ];
  const pedacos = [];
  for (let i = grupos.length - 1; i >= 0; i -= 1) {
    const g = grupos[i];
    if (!g) continue;
    pedacos.push({ g, texto: i === 0 ? ate999(g) : nomes[i](g) });
  }
  // Regra do "e": entra antes do último pedaço quando ele é menor que 100
  // ou é uma centena redonda (ex.: "mil e cem", "dois mil e quinze").
  let saida = '';
  pedacos.forEach((p, idx) => {
    if (idx === 0) { saida = p.texto; return; }
    const ultimo = idx === pedacos.length - 1;
    const usaE = ultimo && (p.g < 100 || p.g % 100 === 0);
    saida += usaE ? ` e ${p.texto}` : ` ${p.texto}`;
  });
  return saida;
}

// Valor em reais por extenso
export function reaisPorExtenso(valor) {
  const numero = Math.round((Number(valor) || 0) * 100);
  const reais = Math.floor(numero / 100);
  const centavos = numero % 100;
  const partes = [];
  if (reais > 0) {
    const redondoMilhao = reais >= 1000000 && reais % 1000000 === 0;
    partes.push(`${numeroPorExtenso(reais)}${redondoMilhao ? ' de' : ''} ${reais === 1 ? 'real' : 'reais'}`);
  }
  if (centavos > 0) partes.push(`${numeroPorExtenso(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}`);
  if (!partes.length) return 'zero real';
  return partes.join(' e ');
}

// "1665,5" / "1.665,50" / "1665.50" → 1665.5
export function lerValorDinheiro(texto) {
  let s = String(texto || '').trim().replace(/[R$\s]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function formatarDinheiro(valor) {
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(valor) || 0);
}

// ---- Documentos ------------------------------------------------------------
export function soDigitos(texto, limite) {
  const d = String(texto || '').replace(/\D/g, '');
  return limite ? d.slice(0, limite) : d;
}

export function formatarCPF(texto) {
  const d = soDigitos(texto, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

// PIS/PASEP/NIS: 000.00000.00-0
export function formatarPIS(texto) {
  const d = soDigitos(texto, 11);
  if (d.length <= 3) return d;
  if (d.length <= 8) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 10) return `${d.slice(0, 3)}.${d.slice(3, 8)}.${d.slice(8)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 8)}.${d.slice(8, 10)}-${d.slice(10)}`;
}

export function validarPIS(texto) {
  const d = soDigitos(texto);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const pesos = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const soma = pesos.reduce((total, peso, i) => total + peso * Number(d[i]), 0);
  const resto = soma % 11;
  const digito = resto < 2 ? 0 : 11 - resto;
  return digito === Number(d[10]);
}

export function formatarCEP(texto) {
  const d = soDigitos(texto, 8);
  return d.length <= 5 ? d : `${d.slice(0, 5)}-${d.slice(5)}`;
}

export function formatarTelefone(texto) {
  const d = soDigitos(texto, 11);
  if (d.length <= 2) return d ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

// ---- Datas -----------------------------------------------------------------
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto',
  'setembro', 'outubro', 'novembro', 'dezembro'];

export function hojeFortaleza() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Fortaleza' });
}

export function dataCurta(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return '';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

export function dataPorExtenso(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return '';
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} de ${MESES[m - 1]} de ${a}`;
}

// Soma dias a uma data "AAAA-MM-DD" (sem problema de fuso: conta em UTC)
export function somarDias(iso, dias) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return '';
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
  const data = new Date(Date.UTC(a, m - 1, d));
  data.setUTCDate(data.getUTCDate() + Number(dias || 0));
  return data.toISOString().slice(0, 10);
}

// Quantos dias do início ao fim, contando os dois (01/11 a 15/11 = 15 dias)
export function diasEntre(inicioIso, fimIso) {
  if (!inicioIso || !fimIso) return null;
  const a = Date.parse(`${inicioIso.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${fimIso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000) + 1;
}
