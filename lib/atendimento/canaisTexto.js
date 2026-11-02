// ============================================================================
// CANAIS NOVOS (Instagram, Facebook Messenger, Telegram) — regras sem segredo
// ============================================================================
// Usado na tela e no servidor: limites de cada canal, janela de resposta e
// como o texto vai (o *negrito* do WhatsApp não existe no Instagram e no
// Messenger; no Telegram vira negrito de verdade).
// ============================================================================

export const LIMITE_TEXTO = { INSTAGRAM: 1000, FACEBOOK: 2000, TELEGRAM: 4000 };

// Instagram e Messenger: a empresa só responde até 24 h depois da última
// mensagem do cliente (e não existe "modelo aprovado" para passar disso).
// Telegram não tem essa regra.
export const JANELA_HORAS = { INSTAGRAM: 24, FACEBOOK: 24 };

export const NOME_CANAL_ROBO = {
  WHATSAPP: 'WhatsApp', SITE: 'chat do site', INSTAGRAM: 'Direct do Instagram', FACEBOOK: 'Messenger do Facebook', TELEGRAM: 'Telegram',
};

export function janelaFechada(tipo, ultimaEntradaEm, agora = Date.now()) {
  const horas = JANELA_HORAS[tipo];
  if (!horas) return false;
  const ultima = ultimaEntradaEm ? new Date(ultimaEntradaEm).getTime() : 0;
  return agora - ultima > horas * 3600000;
}

// *negrito* → negrito (Instagram/Messenger mostram o asterisco)
export function semMarcacao(texto) {
  return String(texto || '').replace(/\*([^*\n]+)\*/g, '$1');
}

const escaparHtml = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Telegram (parse_mode HTML): escapa o texto e troca *negrito* por <b>
export function htmlTelegram(texto) {
  return escaparHtml(texto).replace(/\*([^*\n]+)\*/g, '<b>$1</b>');
}

// Corta um texto longo em pedaços que cabem no canal, de preferência entre
// parágrafos, depois entre linhas, depois entre palavras.
export function partirTexto(texto, limite) {
  const t = String(texto || '').trim();
  if (!t) return [];
  if (t.length <= limite) return [t];
  const partes = [];
  let resto = t;
  while (resto.length > limite) {
    let corte = resto.lastIndexOf('\n\n', limite);
    if (corte < limite * 0.4) corte = resto.lastIndexOf('\n', limite);
    if (corte < limite * 0.4) corte = resto.lastIndexOf(' ', limite);
    if (corte < limite * 0.4) corte = limite;
    partes.push(resto.slice(0, corte).trim());
    resto = resto.slice(corte).trim();
  }
  if (resto) partes.push(resto);
  return partes.filter(Boolean);
}
