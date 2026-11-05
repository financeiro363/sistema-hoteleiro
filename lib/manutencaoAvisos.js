// ============================================================================
// MANUTENÇÃO — aviso no celular quando abrem um chamado (M22)
// ============================================================================
// Decisão do dono (05/11/2026): todo chamado novo avisa; o urgente (prioridade
// Alta) avisa de novo a cada 30 minutos enquanto ninguém pegar (continua
// "Pendente"), até 3 vezes. Usa os mesmos avisos (Web Push) das camareiras.
// Para quem: o técnico atribuído ao chamado; sem atribuição, todos os da
// Manutenção. Quem abriu o chamado não recebe (a não ser que seja o único).
// O aviso sai na hora (a tela chama /api/manutencao-avisos) e a função
// agendada, a cada 2 minutos, pega o que faltou e as repetições.
// ============================================================================

import { enviarPush } from './push';

export const REPETIR_MIN = 30;
export const MAX_RODADAS = 4; // o aviso + 3 repetições
const NOVO_ATE_HORAS = 24;    // chamado mais velho que isto sem aviso: não avisa mais

// 'NOVO' | 'REPETIR' | null
export function planoDeAviso(c, agora = new Date()) {
  if (!c || c.status !== 'PENDENTE') return null;
  const t = agora.getTime();
  if (!c.avisado_em) {
    return c.criado_em && t - new Date(c.criado_em).getTime() <= NOVO_ATE_HORAS * 3600000 ? 'NOVO' : null;
  }
  if (c.prioridade !== 'ALTA') return null;
  if (Number(c.avisos_rodadas || 0) >= MAX_RODADAS) return null;
  const ultimo = new Date(c.ultimo_aviso_em || c.avisado_em).getTime();
  return t - ultimo >= REPETIR_MIN * 60000 ? 'REPETIR' : null;
}

// tecnicos: [{ id, ativo }] com papel MANUTENCAO do hotel
export function destinatariosDaManutencao(c, tecnicos) {
  const ativos = (tecnicos || []).filter((u) => u.ativo !== false).map((u) => Number(u.id));
  const resp = c?.responsavel_id ? Number(c.responsavel_id) : null;
  let ids = resp ? [resp] : ativos;
  const autor = c?.criado_por_id ? Number(c.criado_por_id) : null;
  if (autor && ids.length > 1) ids = ids.filter((id) => id !== autor);
  return [...new Set(ids)];
}

export function mensagemDoChamado(c, tipo) {
  const urgente = c.prioridade === 'ALTA';
  const rodada = Number(c.avisos_rodadas || 0);
  const titulo = tipo === 'REPETIR'
    ? `⏰ Ainda sem ninguém — ${c.local}`
    : `🔧 ${urgente ? 'URGENTE — ' : ''}Chamado: ${c.local}`;
  return {
    titulo,
    corpo: `${String(c.descricao || '').slice(0, 150)}${tipo === 'REPETIR' ? ` (aviso ${rodada + 1} de ${MAX_RODADAS})` : ''}`,
    url: '/manutencao', tag: `manut-${c.id}`,
  };
}

// Manda o aviso de um chamado, se for a hora. Trava pelo banco: se duas
// chamadas chegarem juntas, só uma envia.
export async function avisarChamado(supabaseAdmin, chamado, agora = new Date()) {
  const tipo = planoDeAviso(chamado, agora);
  if (!tipo) return { enviado: false };
  const rodadas = Number(chamado.avisos_rodadas || 0);
  const quando = agora.toISOString();
  let trava = supabaseAdmin.from('manutencoes')
    .update({ avisado_em: chamado.avisado_em || quando, ultimo_aviso_em: quando, avisos_rodadas: rodadas + 1 })
    .eq('id', chamado.id).eq('avisos_rodadas', rodadas);
  trava = tipo === 'NOVO' ? trava.is('avisado_em', null) : trava;
  const { data: pegou, error } = await trava.select('id');
  if (error || !pegou?.length) return { enviado: false };

  const { data: tecnicos } = await supabaseAdmin.from('usuarios').select('id, ativo').eq('hotel_id', chamado.hotel_id).eq('papel', 'MANUTENCAO');
  const ids = destinatariosDaManutencao(chamado, tecnicos || []);
  if (!ids.length) return { enviado: false, tipo, semTecnico: true };
  const r = await enviarPush(supabaseAdmin, chamado.hotel_id, ids, mensagemDoChamado(chamado, tipo));
  return { enviado: r.enviados > 0, tipo, enviados: r.enviados, semCelular: r.semCelular };
}

// Função agendada: chamados novos sem aviso e urgentes para repetir (todos os hotéis)
export async function varrerChamados(supabaseAdmin, agora = new Date()) {
  const desde = new Date(agora.getTime() - NOVO_ATE_HORAS * 3600000).toISOString();
  const { data, error } = await supabaseAdmin.from('manutencoes').select('*').eq('status', 'PENDENTE')
    .or(`avisado_em.is.null,prioridade.eq.ALTA`).gte('criado_em', new Date(agora.getTime() - 7 * 86400000).toISOString()).limit(200);
  if (error) return { erro: error.message };
  let enviados = 0;
  for (const c of data || []) {
    if (!c.avisado_em && c.criado_em < desde) continue;
    try { const r = await avisarChamado(supabaseAdmin, c, agora); if (r.enviado) enviados += 1; } catch (e) { /* um chamado com problema não atrapalha os outros */ }
  }
  return { verificados: (data || []).length, enviados };
}
