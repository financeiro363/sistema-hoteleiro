// ============================================================================
// Modelos (templates) do WhatsApp — leitura das variáveis (tela e servidor)
// ============================================================================
// A Meta aceita dois jeitos de marcar as variáveis no texto do modelo:
//   posicional  →  "Olá, {{1}}!"
//   com nome    →  "Olá, {{nome_do_viajante}}!"
// E o botão de link pode ter o final variável: "https://site.com/r/{{1}}".
// ============================================================================

const VARIAVEL = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

// Quantas variáveis o texto tem e, se forem com nome, quais (na ordem)
export function lerVariaveis(texto) {
  const achadas = [...String(texto || '').matchAll(VARIAVEL)].map((m) => m[1]);
  if (!achadas.length) return { quantidade: 0, nomes: null };
  if (achadas.every((v) => /^\d+$/.test(v))) return { quantidade: Math.max(...achadas.map(Number)), nomes: null };
  const nomes = [...new Set(achadas)];
  return { quantidade: nomes.length, nomes };
}

// Troca {{1}} ou {{nome}} pelos valores (na ordem)
export function trocarVariaveis(texto, valores, nomes) {
  return String(texto || '').replace(VARIAVEL, (tudo, chave) => {
    const i = /^\d+$/.test(chave) ? Number(chave) - 1 : (nomes || []).indexOf(chave);
    const v = i >= 0 ? valores?.[i] : undefined;
    return v === undefined || v === null || v === '' ? tudo : String(v);
  });
}

// Rótulo da variável para a tela: {{1}} ou {{nome_do_viajante}}
export function rotuloVariavel(i, nomes) {
  return `{{${nomes?.[i] || i + 1}}}`;
}

// Parte fixa do link do botão (antes do {{1}})
export function baseDoLink(url) {
  return String(url || '').split(/\{\{\s*\w+\s*\}\}/)[0];
}

// Texto do modelo como aparece na conversa (cabeçalho, corpo, rodapé e links)
export function montarTextoModelo(info, valores) {
  const partes = [];
  if (info?.cabecalho) partes.push(`*${trocarVariaveis(info.cabecalho, valores?.cabecalho, info.nomesCabecalho)}*`);
  partes.push(trocarVariaveis(info?.corpo || `[Modelo: ${info?.nome || ''}]`, valores?.corpo, info?.nomesCorpo));
  if (info?.rodape) partes.push(`_${info.rodape}_`);
  (info?.botoesLink || []).forEach((b, i) => {
    const final = valores?.botoes?.[i];
    if (final) partes.push(`🔘 ${b.texto}: ${baseDoLink(b.url)}${final}`);
  });
  return partes.join('\n');
}
