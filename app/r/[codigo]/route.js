// ============================================================================
// LINK "RESERVAR AGORA" DA COTAÇÃO:  /r/<código>-<opção>
// (/r/<código>-0 = botão "Reservar agora" do WhatsApp: motor sem quarto escolhido)
// ============================================================================
// O cliente clica no link da cotação → o sistema conta o clique, move o
// cartão para "Reservar agora" e manda o cliente para o motor de reservas da
// Cloudbeds com as datas, os hóspedes e o quarto já escolhidos (o motor do
// hotel cotado, que pode ser outro hotel do grupo).
// Robôs (prévia de link do WhatsApp, antivírus de e-mail, buscadores) também
// abrem links: esses vão para o motor, mas não contam como clique.
// Não precisa de login (quem abre é o cliente).
// ============================================================================

import { clienteAdmin } from '../../../lib/atendimento/servidor';
import { montarLinkMotor } from '../../../lib/atendimento/cotacao';

export const dynamic = 'force-dynamic';

const ROBOS = /bot|crawl|spider|slurp|preview|facebookexternalhit|facebot|whatsapp|telegram|slack|discord|skype|linkedin|google-|googleimageproxy|bingpreview|outlook|microsoft office|ms-office|office365|proofpoint|mimecast|barracuda|symantec|trendmicro|safelinks|python|curl|wget|httpclient|okhttp|go-http|java\/|headless|lighthouse|pingdom|uptime/i;

function paginaSimples(titulo, texto, status = 404) {
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titulo}</title><style>body{font-family:Arial,Helvetica,sans-serif;background:#F4F5F2;color:#1F2A26;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:16px}
div{background:#fff;border:1px solid #DDE3DF;border-radius:14px;padding:24px;max-width:420px;text-align:center}h1{font-size:20px;margin:0 0 8px}p{color:#5B6762;margin:0}</style></head>
<body><div><h1>${titulo}</h1><p>${texto}</p></div></body></html>`;
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

async function tratar(request, { params }) {
  const m = /^([A-Za-z0-9]{6,20})(?:-(\d{1,2}))?$/.exec(String(params?.codigo || ''));
  if (!m) return paginaSimples('Link inválido', 'Confira o link recebido ou fale com o hotel.');
  const codigo = m[1];
  const geral = m[2] === '0';
  const item = m[2] ? Math.max(0, Number(m[2]) - 1) : 0;
  const agente = request.headers.get('user-agent') || '';
  const robo = request.method === 'HEAD' || !agente || ROBOS.test(agente);

  let supabaseAdmin;
  try { supabaseAdmin = clienteAdmin(); } catch (e) { return paginaSimples('Indisponível', 'Tente de novo em instantes.', 503); }

  let dados = null;
  if (robo) {
    const { data: cot } = await supabaseAdmin.from('atendimento_cotacoes')
      .select('*').eq('codigo', codigo).maybeSingle();
    if (cot) {
      // Cotação de outro hotel do grupo: o motor é o do hotel cotado
      const hotelDoMotor = cot.hotel_cotado_id || cot.hotel_id;
      const { data: pref } = await supabaseAdmin.from('atendimento_preferencias').select('motor_url').eq('hotel_id', hotelDoMotor).maybeSingle();
      const it = (cot.itens || [])[item] || (cot.itens || [])[0] || {};
      dados = { ...cot, motor_url: pref?.motor_url, abreviacao: it.abreviacao };
    }
  } else {
    const { data } = await supabaseAdmin.rpc('atendimento_registrar_clique', { p_codigo: codigo, p_item: item });
    dados = data;
  }
  if (!dados) return paginaSimples('Cotação não encontrada', 'Este link de cotação não existe mais. Fale com o hotel para receber uma nova cotação.');

  const destino = montarLinkMotor(dados.motor_url, {
    checkin: dados.checkin, checkout: dados.checkout, adultos: dados.adultos, criancas: dados.criancas, abreviacao: geral ? undefined : dados.abreviacao,
  });
  if (!destino) return paginaSimples('Quase lá!', 'Fale com o hotel para concluir a sua reserva.', 200);
  return new Response(null, { status: 302, headers: { location: destino, 'cache-control': 'no-store' } });
}

export async function GET(request, contexto) { return tratar(request, contexto); }
export async function HEAD(request, contexto) { return tratar(request, contexto); }
