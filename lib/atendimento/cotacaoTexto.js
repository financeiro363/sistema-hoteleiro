// ============================================================================
// CAIXA DE ENTRADA — texto da cotação (usado no servidor e na prévia da tela)
// ============================================================================
// Em inglês ou espanhol (M7) usa os textos de lib/atendimento/idiomas.js; o
// nome dos quartos continua o da Cloudbeds.

import { TEXTOS_COTACAO } from './idiomas';

export function dataBR(iso) {
  const [a, m, d] = String(iso || '').slice(0, 10).split('-');
  return a ? `${d}/${m}/${a}` : '';
}

export function reais(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export const ABERTURA_PADRAO = 'Olá, {nome}! Segue a cotação para {checkin} a {checkout} ({noites}), {hospedes}:';
export const FINAL_PADRAO = 'Valores para o período, sujeitos à disponibilidade no momento da reserva. É só clicar em "Reservar agora" para garantir o seu quarto. Qualquer dúvida, estou à disposição!';

// Cotação de outro hotel do grupo ({origem} = hotel da conversa; {descricao} = o
// texto curto que o ADMIN escreveu, entre parênteses)
export const ABERTURA_OUTRO_HOTEL_ROBO = 'Olá, {nome}! Para {checkin} a {checkout} ({noites}), {hospedes}, não temos mais quarto no {origem}, mas o *{hotel}*, do mesmo grupo{descricao}, tem estas opções:';
export const ABERTURA_OUTRO_HOTEL = 'Olá, {nome}! Segue a cotação do *{hotel}*, do mesmo grupo{descricao}, para {checkin} a {checkout} ({noites}), {hospedes}:';

function plural(n, um, varios) { return `${n} ${n === 1 ? um : varios}`; }
const T = (idioma) => TEXTOS_COTACAO[idioma] || null;
const palavras = (idioma, chave, pt) => T(idioma)?.[chave] || pt;

export function descreverHospedes({ adultos, criancas, quartos }, idioma = 'pt') {
  return [plural(adultos, ...palavras(idioma, 'adulto', ['adulto', 'adultos'])), criancas ? plural(criancas, ...palavras(idioma, 'crianca', ['criança', 'crianças'])) : null,
    quartos > 1 ? plural(quartos, ...palavras(idioma, 'quarto', ['quarto', 'quartos'])) : null].filter(Boolean).join(', ');
}

// Abertura e final no idioma: em inglês/espanhol, os textos traduzidos
// (os do hotel, em português, valem só para o português)
export function textosDoIdioma(idioma, { abertura, final, outroHotel = false, semQuartoAqui = false } = {}) {
  const t = T(idioma);
  if (!t) return { abertura, final };
  return { abertura: outroHotel ? (semQuartoAqui ? t.aberturaOutroRobo : t.aberturaOutro) : t.abertura, final: t.final };
}

export function preencher(texto, cot, nomeCliente, nomeHotel, extra = {}, idioma = 'pt') {
  const primeiro = /\p{L}/u.test(String(nomeCliente || '')) ? String(nomeCliente).trim().split(/\s+/)[0] : '';
  let t = String(texto || '');
  t = primeiro ? t.replace(/\{nome\}/gi, primeiro) : t.replace(/,?\s*\{nome\}/gi, '');
  return t
    .replace(/\{checkin\}/gi, dataBR(cot.checkin))
    .replace(/\{checkout\}/gi, dataBR(cot.checkout))
    .replace(/\{noites\}/gi, plural(cot.noites, ...palavras(idioma, 'noite', ['noite', 'noites'])))
    .replace(/\{hospedes\}/gi, descreverHospedes(cot, idioma))
    .replace(/\{hotel\}/gi, nomeHotel || '')
    .replace(/\{origem\}/gi, extra?.origem || palavras(idioma, 'nossoHotel', 'nosso hotel'))
    .replace(/\{descricao\}/gi, extra?.descricao ? ` (${extra.descricao})` : '');
}

export function textoCotacao({ cot, itens, links, abertura, final, nomeCliente, nomeHotel, extra, idioma = 'pt' }) {
  const partes = [preencher(abertura || ABERTURA_PADRAO, cot, nomeCliente, nomeHotel, extra, idioma), ''];
  itens.forEach((i, n) => {
    partes.push(`*${i.nome}* — ${reais(i.total)}${cot.noites > 1 ? ` (${reais(i.porNoite)} ${palavras(idioma, 'porNoite', 'por noite')})` : ''}`);
    partes.push(`${palavras(idioma, 'reservar', 'Reservar agora')}: ${links[n]}`);
    partes.push('');
  });
  partes.push(preencher(final || FINAL_PADRAO, cot, nomeCliente, nomeHotel, extra, idioma));
  return partes.join('\n').trim();
}

export function escaparHtml(t) {
  return String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function htmlCotacao({ cot, itens, links, abertura, final, nomeCliente, nomeHotel, extra, idioma = 'pt' }) {
  const noitesTxt = (n) => plural(n, ...palavras(idioma, 'noite', ['noite', 'noites']));
  const par = (t) => `<p style="margin:0 0 12px">${escaparHtml(t).replace(/\n/g, '<br>')}</p>`;
  const cartoes = itens.map((i, n) => `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #DDE3DF;border-radius:10px;margin:0 0 12px;border-collapse:separate">
      <tr>
        ${i.foto ? `<td width="130" style="padding:10px"><img src="${escaparHtml(i.foto)}" width="120" alt="" style="display:block;border-radius:8px;width:120px;height:auto"></td>` : ''}
        <td style="padding:12px 14px;font-family:Arial,Helvetica,sans-serif">
          <div style="font-size:16px;font-weight:bold;color:#1F2A26">${escaparHtml(i.nome)}</div>
          ${i.descricao ? `<div style="font-size:12px;color:#5B6762;margin:4px 0">${escaparHtml(i.descricao)}</div>` : ''}
          <div style="font-size:18px;font-weight:bold;color:#14532D;margin:6px 0 2px">${reais(i.total)}</div>
          <div style="font-size:12px;color:#5B6762">${noitesTxt(cot.noites)}${cot.noites > 1 ? ` · ${reais(i.porNoite)} ${palavras(idioma, 'porNoite', 'por noite')}` : ''}</div>
          <div style="margin-top:10px"><a href="${escaparHtml(links[n])}" style="display:inline-block;background:#14532D;color:#ffffff;text-decoration:none;font-weight:bold;padding:9px 16px;border-radius:8px;font-size:14px">${palavras(idioma, 'reservar', 'Reservar agora')}</a></div>
        </td>
      </tr>
    </table>`).join('');
  // *negrito* do WhatsApp vira <strong> no e-mail
  const parNegrito = (t) => par(t).replace(/\*([^*\n<]{1,80})\*/g, '<strong>$1</strong>');
  return `${parNegrito(preencher(abertura || ABERTURA_PADRAO, cot, nomeCliente, nomeHotel, extra, idioma))}${cartoes}${par(preencher(final || FINAL_PADRAO, cot, nomeCliente, nomeHotel, extra, idioma))}`;
}

