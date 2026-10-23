// ============================================================================
// CAIXA DE ENTRADA — texto da cotação (usado no servidor e na prévia da tela)
// ============================================================================

export function dataBR(iso) {
  const [a, m, d] = String(iso || '').slice(0, 10).split('-');
  return a ? `${d}/${m}/${a}` : '';
}

export function reais(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export const ABERTURA_PADRAO = 'Olá, {nome}! Segue a cotação para {checkin} a {checkout} ({noites}), {hospedes}:';
export const FINAL_PADRAO = 'Valores para o período, sujeitos à disponibilidade no momento da reserva. É só clicar em "Reservar agora" para garantir o seu quarto. Qualquer dúvida, estou à disposição!';

function plural(n, um, varios) { return `${n} ${n === 1 ? um : varios}`; }

export function descreverHospedes({ adultos, criancas, quartos }) {
  return [plural(adultos, 'adulto', 'adultos'), criancas ? plural(criancas, 'criança', 'crianças') : null,
    quartos > 1 ? plural(quartos, 'quarto', 'quartos') : null].filter(Boolean).join(', ');
}

export function preencher(texto, cot, nomeCliente, nomeHotel) {
  const primeiro = /\p{L}/u.test(String(nomeCliente || '')) ? String(nomeCliente).trim().split(/\s+/)[0] : '';
  let t = String(texto || '');
  t = primeiro ? t.replace(/\{nome\}/gi, primeiro) : t.replace(/,?\s*\{nome\}/gi, '');
  return t
    .replace(/\{checkin\}/gi, dataBR(cot.checkin))
    .replace(/\{checkout\}/gi, dataBR(cot.checkout))
    .replace(/\{noites\}/gi, plural(cot.noites, 'noite', 'noites'))
    .replace(/\{hospedes\}/gi, descreverHospedes(cot))
    .replace(/\{hotel\}/gi, nomeHotel || '');
}

export function textoCotacao({ cot, itens, links, abertura, final, nomeCliente, nomeHotel }) {
  const partes = [preencher(abertura || ABERTURA_PADRAO, cot, nomeCliente, nomeHotel), ''];
  itens.forEach((i, n) => {
    partes.push(`*${i.nome}* — ${reais(i.total)}${cot.noites > 1 ? ` (${reais(i.porNoite)} por noite)` : ''}`);
    partes.push(`Reservar agora: ${links[n]}`);
    partes.push('');
  });
  partes.push(preencher(final || FINAL_PADRAO, cot, nomeCliente, nomeHotel));
  return partes.join('\n').trim();
}

export function escaparHtml(t) {
  return String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function htmlCotacao({ cot, itens, links, abertura, final, nomeCliente, nomeHotel }) {
  const par = (t) => `<p style="margin:0 0 12px">${escaparHtml(t).replace(/\n/g, '<br>')}</p>`;
  const cartoes = itens.map((i, n) => `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #DDE3DF;border-radius:10px;margin:0 0 12px;border-collapse:separate">
      <tr>
        ${i.foto ? `<td width="130" style="padding:10px"><img src="${escaparHtml(i.foto)}" width="120" alt="" style="display:block;border-radius:8px;width:120px;height:auto"></td>` : ''}
        <td style="padding:12px 14px;font-family:Arial,Helvetica,sans-serif">
          <div style="font-size:16px;font-weight:bold;color:#1F2A26">${escaparHtml(i.nome)}</div>
          ${i.descricao ? `<div style="font-size:12px;color:#5B6762;margin:4px 0">${escaparHtml(i.descricao)}</div>` : ''}
          <div style="font-size:18px;font-weight:bold;color:#14532D;margin:6px 0 2px">${reais(i.total)}</div>
          <div style="font-size:12px;color:#5B6762">${plural(cot.noites, 'noite', 'noites')}${cot.noites > 1 ? ` · ${reais(i.porNoite)} por noite` : ''}</div>
          <div style="margin-top:10px"><a href="${escaparHtml(links[n])}" style="display:inline-block;background:#14532D;color:#ffffff;text-decoration:none;font-weight:bold;padding:9px 16px;border-radius:8px;font-size:14px">Reservar agora</a></div>
        </td>
      </tr>
    </table>`).join('');
  return `${par(preencher(abertura || ABERTURA_PADRAO, cot, nomeCliente, nomeHotel))}${cartoes}${par(preencher(final || FINAL_PADRAO, cot, nomeCliente, nomeHotel))}`;
}

