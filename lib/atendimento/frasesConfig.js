// ============================================================================
// ETIQUETAS AUTOMÁTICAS POR FRASE — usado na tela e no servidor
// ============================================================================
// Decidido pelo Eduardo em 29/10:
//   - a frase é procurada só na 1ª mensagem do cliente: quando ele começa a
//     conversa ou volta depois de HORAS_RECOMECO horas sem escrever
//   - a resposta pronta só sai quando o robô não vai responder
//   - canais de conversa (o e-mail fica de fora)
// A comparação não liga para maiúsculas, acentos, pontuação e espaços:
// “Quero reservar!” acha “olá, quero  reservar”.
// ============================================================================

export const HORAS_RECOMECO = 24;
export const CANAIS_FRASE = ['WHATSAPP', 'SITE', 'INSTAGRAM', 'FACEBOOK'];
export const ETIQUETA_PADRAO = 'AD';
export const MAX_FRASES = 50;
export const MIN_LETRAS_FRASE = 3;

export function normalizarFrase(texto) {
  return String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Uma frase por linha (ou separadas por ;), sem repetidas e sem as curtas demais
export function frasesDoTexto(texto) {
  const vistas = new Set();
  const lista = [];
  for (const bruta of String(texto || '').split(/[\n;]+/)) {
    const f = bruta.replace(/\s+/g, ' ').trim().slice(0, 200);
    const n = normalizarFrase(f);
    if (n.length < MIN_LETRAS_FRASE || vistas.has(n)) continue;
    vistas.add(n);
    lista.push(f);
  }
  return lista.slice(0, MAX_FRASES);
}

// A mensagem tem a frase? (palavras inteiras: "reservar" não acha "reservaram")
export function temFrase(mensagem, frase) {
  const m = ` ${normalizarFrase(mensagem)} `;
  const f = normalizarFrase(frase);
  return f.length >= MIN_LETRAS_FRASE && m.includes(` ${f} `);
}

// Primeira regra ligada que tem uma frase na mensagem → { regra, frase } ou null
export function acharRegra(regras, mensagem) {
  for (const r of Array.isArray(regras) ? regras : []) {
    if (!r || r.ativo === false) continue;
    const frase = (r.frases || []).find((f) => temFrase(mensagem, f));
    if (frase) return { regra: r, frase };
  }
  return null;
}
