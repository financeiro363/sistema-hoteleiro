// ============================================================================
// VALIDAÇÃO DE CPF / CNPJ
// ============================================================================
// - CPF: 11 dígitos, com os dois dígitos verificadores conferidos.
// - CNPJ: 14 caracteres, com os dois dígitos verificadores conferidos. Aceita
//   também o CNPJ NOVO com letras (alfanumérico), que a Receita Federal
//   passou a emitir em 2026 — os 12 primeiros caracteres podem ser letras ou
//   números, e os 2 últimos são sempre números.
// - Reprova sequências repetidas (111.111.111-11, 00.000.000/0000-00...).
//
// Esta é a mesma regra da função documento_valido() do banco de dados, então
// a tela e o banco sempre concordam.
// ============================================================================

// Só letras e números, em maiúsculas, no máximo 14 caracteres.
export function limparDocumento(texto) {
  return String(texto || '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 14);
}

// Formata enquanto a pessoa digita: CPF (000.000.000-00) até 11 dígitos;
// a partir daí, ou se tiver letra, CNPJ (00.000.000/0000-00).
export function formatarDocumento(texto) {
  const d = limparDocumento(texto);
  if (/^[0-9]*$/.test(d) && d.length <= 11) {
    if (d.length <= 3) return d;
    if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
    if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }
  const partes = [d.slice(0, 2), d.slice(2, 5), d.slice(5, 8), d.slice(8, 12), d.slice(12, 14)];
  let saida = partes[0];
  if (partes[1]) saida += `.${partes[1]}`;
  if (partes[2]) saida += `.${partes[2]}`;
  if (partes[3]) saida += `/${partes[3]}`;
  if (partes[4]) saida += `-${partes[4]}`;
  return saida;
}

export function validarCPF(texto) {
  const d = limparDocumento(texto);
  if (!/^[0-9]{11}$/.test(d)) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += Number(d[i]) * (10 - i);
  let dv1 = (soma * 10) % 11;
  if (dv1 === 10) dv1 = 0;
  if (dv1 !== Number(d[9])) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += Number(d[i]) * (11 - i);
  let dv2 = (soma * 10) % 11;
  if (dv2 === 10) dv2 = 0;
  return dv2 === Number(d[10]);
}

const PESOS_CNPJ_1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const PESOS_CNPJ_2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

export function validarCNPJ(texto) {
  const d = limparDocumento(texto);
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(d)) return false;
  if (/^(.)\1{13}$/.test(d)) return false;
  // Valor de cada caractere = código ASCII − 48 (números valem 0 a 9, letras 17 a 42)
  const valor = (c) => c.charCodeAt(0) - 48;
  function digito(base, pesos) {
    let soma = 0;
    for (let i = 0; i < pesos.length; i++) soma += valor(base[i]) * pesos[i];
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  }
  if (digito(d, PESOS_CNPJ_1) !== Number(d[12])) return false;
  return digito(d, PESOS_CNPJ_2) === Number(d[13]);
}

// Devolve:
//   true  = documento completo e válido
//   false = documento completo, mas inválido (dígito verificador errado etc.)
//   null  = ainda incompleto (ou vazio)
export function validarDocumento(texto) {
  const d = limparDocumento(texto);
  if (/^[0-9]{11}$/.test(d)) return validarCPF(d);
  if (d.length === 14) return validarCNPJ(d);
  return null;
}

// Mensagem pronta para mostrar na tela; devolve '' quando está tudo certo.
export function mensagemErroDocumento(texto) {
  if (!limparDocumento(texto)) return 'Informe o CPF ou CNPJ de quem está alugando a sala.';
  const status = validarDocumento(texto);
  if (status === null) return 'O CPF/CNPJ está incompleto — confira os números.';
  if (status === false) return 'O CPF/CNPJ digitado é inválido — confira os números.';
  return '';
}
