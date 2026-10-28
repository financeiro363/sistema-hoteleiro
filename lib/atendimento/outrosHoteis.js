// ============================================================================
// CAIXA DE ENTRADA — OUTRO HOTEL DO GRUPO (só usado no servidor)
// ============================================================================
// Quando o hotel da conversa não tem quarto, o robô (e a equipe, na tela de
// cotação) pode cotar outro hotel do mesmo grupo. Quais hotéis entram é o
// ADMIN quem escolhe em Robô → Configuração (coluna atendimento_robo.outros_hoteis):
//   [{ "hotel_id": 2, "descricao": "também no Centro, a 1 km daqui" }]
// A conversa continua no hotel que atendeu; a cotação guarda o hotel cotado
// (atendimento_cotacoes.hotel_cotado_id).
// ============================================================================

export const MAX_OUTROS_HOTEIS = 3;
export const MAX_DESCRICAO = 120;

// Frase curta do ADMIN: sem HTML, sem quebra de linha e sem os sinais de
// formatação do WhatsApp (*negrito*, _itálico_, ~riscado~)
export function limparDescricao(t) {
  return String(t || '').replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f<>*_~`]/g, ' ')
    .replace(/\s+/g, ' ').trim().replace(/^[,;.\s]+|[,;\s]+$/g, '').slice(0, MAX_DESCRICAO);
}

// Lista limpa da configuração (sem o próprio hotel, sem repetidos)
export function listaOutrosHoteis(config, hotelId) {
  const vistos = new Set();
  return (Array.isArray(config?.outros_hoteis) ? config.outros_hoteis : [])
    .map((o) => ({ hotel_id: Math.trunc(Number(o?.hotel_id)), descricao: limparDescricao(o?.descricao) }))
    .filter((o) => o.hotel_id > 0 && o.hotel_id !== Number(hotelId) && !vistos.has(o.hotel_id) && vistos.add(o.hotel_id))
    .slice(0, MAX_OUTROS_HOTEIS);
}

// Hotéis do grupo que o hotel pode cotar, com o nome: [{ id, nome, descricao }]
export async function carregarOutrosHoteis(supabaseAdmin, hotelId, config = undefined) {
  let cfg = config;
  if (cfg === undefined) {
    const { data } = await supabaseAdmin.from('atendimento_robo').select('outros_hoteis').eq('hotel_id', hotelId).maybeSingle();
    cfg = data;
  }
  const lista = listaOutrosHoteis(cfg, hotelId);
  if (!lista.length) return [];
  const { data: hoteis } = await supabaseAdmin.from('hoteis').select('id, nome_fantasia').in('id', lista.map((o) => o.hotel_id));
  const nomes = Object.fromEntries((hoteis || []).map((h) => [Number(h.id), h.nome_fantasia]));
  return lista.filter((o) => nomes[o.hotel_id] !== undefined)
    .map((o) => ({ id: o.hotel_id, nome: nomes[o.hotel_id] || `Hotel #${o.hotel_id}`, descricao: o.descricao }));
}

// Um hotel da lista (ou null se não estiver liberado para este hotel)
export async function outroHotelLiberado(supabaseAdmin, hotelId, outroId, config = undefined) {
  const id = Math.trunc(Number(outroId));
  if (!id || id === Number(hotelId)) return null;
  const lista = await carregarOutrosHoteis(supabaseAdmin, hotelId, config);
  return lista.find((o) => o.id === id) || null;
}
