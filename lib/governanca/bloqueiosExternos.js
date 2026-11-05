// ============================================================================
// GOVERNANÇA — bloqueio feito direto na Cloudbeds refletido aqui (M23)
// ============================================================================
// A Cloudbeds avisa (webhook "roomblock/created", "roomblock/details_changed"
// e "roomblock/removed") quando alguém bloqueia ou desbloqueia um quarto por
// lá. Decisão do dono (05/11/2026): o quarto vira "Interditado" com a data de
// volta (= fim do bloqueio) e sai da lista das camareiras; ao desbloquear na
// Cloudbeds, volta sozinho como "Saída / Apt Sujo" (precisa de arrumação),
// igual a quando a equipe libera por aqui.
// Bloqueio que começa num dia futuro fica guardado e a rotina das 6h aplica
// no dia. Os bloqueios que o próprio sistema cria (motivo "… (Chokmah)") a
// rota de bloqueio já cuida.
// Funções puras no topo (testes); a parte do banco, no fim.
// ============================================================================

import { mudancaDeEstado } from './regras';

export const MARCA_DO_SISTEMA = '(Chokmah)';

const dia = (v) => (v ? String(v).slice(0, 10) : null);

// Corpo do webhook → { acao: 'CRIOU'|'MUDOU'|'REMOVEU', blockId, propertyId, tipo, motivo, inicio, fim, quartos: [roomID] } | null
export function lerEventoBloqueio(corpo) {
  const evento = String(corpo?.event || '');
  const acao = { 'roomblock/created': 'CRIOU', 'roomblock/details_changed': 'MUDOU', 'roomblock/removed': 'REMOVEU' }[evento];
  if (!acao) return null;
  const blockId = corpo.roomBlockID ?? corpo.roomBlockId ?? null;
  const propertyId = corpo.propertyID ?? corpo.propertyId ?? corpo.propertyID_str ?? null;
  const quartos = (Array.isArray(corpo.rooms) ? corpo.rooms : []).map((r) => r?.roomID ?? r?.roomId).filter((x) => x != null && x !== '').map(String);
  if (!blockId || !propertyId) return null;
  return {
    acao, blockId: String(blockId), propertyId: String(propertyId), tipo: corpo.roomBlockType ? String(corpo.roomBlockType) : null,
    motivo: corpo.roomBlockReason ? String(corpo.roomBlockReason).slice(0, 200) : null,
    inicio: dia(corpo.startDate), fim: dia(corpo.endDate), quartos: [...new Set(quartos)],
  };
}

export const doSistema = (b) => String(b?.motivo || '').includes(MARCA_DO_SISTEMA);
// O bloqueio vale hoje? (o quarto volta no dia "fim")
export const valeHoje = (b, hoje) => !!b?.inicio && !!b?.fim && b.inicio <= hoje && b.fim > hoje;

// O que fazer no quarto: { tipo: 'INTERDITAR'|'ATUALIZAR'|'LIBERAR', campos } | null
export function acaoNoQuarto(quarto, b, hoje) {
  if (!quarto || !b) return null;
  const deste = quarto.cloudbeds_bloqueio_id && String(quarto.cloudbeds_bloqueio_id) === b.blockId;
  const interditado = quarto.estado_apartamento === 'INTERDITADO';
  const liberar = () => ({ tipo: 'LIBERAR', campos: { ...mudancaDeEstado(quarto, 'SAIDA_SUJO').campos, interditado_ate: null, cloudbeds_bloqueio_id: null } });

  if (b.acao === 'REMOVEU') return deste && interditado ? liberar() : deste ? { tipo: 'ATUALIZAR', campos: { cloudbeds_bloqueio_id: null, interditado_ate: null } } : null;
  if (!valeHoje(b, hoje)) return deste && interditado && b.acao === 'MUDOU' ? liberar() : null; // ainda não começou (ou já acabou)
  if (deste) return quarto.interditado_ate === b.fim ? null : { tipo: 'ATUALIZAR', campos: { interditado_ate: b.fim } };
  if (interditado) {
    // Já interditado aqui: guarda o nº do bloqueio da Cloudbeds se o quarto ainda não tinha
    return quarto.cloudbeds_bloqueio_id ? null : { tipo: 'ATUALIZAR', campos: { cloudbeds_bloqueio_id: b.blockId, interditado_ate: quarto.interditado_ate || b.fim } };
  }
  return { tipo: 'INTERDITAR', campos: { ...mudancaDeEstado(quarto, 'INTERDITADO').campos, interditado_ate: b.fim, cloudbeds_bloqueio_id: b.blockId } };
}

// ---------------------------------------------------------------- banco (servidor)
async function aplicar(supabaseAdmin, hotelId, b, hoje) {
  const resultado = [];
  for (const roomId of b.quartos) {
    const { data: quartos } = await supabaseAdmin.from('quartos').select('*').eq('hotel_id', hotelId).eq('cloudbeds_room_id', roomId);
    for (const q of quartos || []) {
      const a = acaoNoQuarto(q, b, hoje);
      if (!a) continue;
      await supabaseAdmin.from('quartos').update(a.campos).eq('id', q.id);
      resultado.push({ quarto: q.numero, tipo: a.tipo });
    }
    if (b.acao !== 'REMOVEU' && valeHoje(b, hoje)) {
      await supabaseAdmin.from('governanca_bloqueios_externos').update({ aplicado_em: new Date().toISOString() })
        .eq('hotel_id', hotelId).eq('cloudbeds_block_id', b.blockId).eq('cloudbeds_room_id', roomId).is('aplicado_em', null);
    }
  }
  return resultado;
}

// Aviso da Cloudbeds (já com a senha conferida)
export async function processarBloqueio(supabaseAdmin, hotelId, b, hoje) {
  if (b.acao !== 'REMOVEU' && doSistema(b)) return { ignorado: 'bloqueio feito pelo próprio sistema' };
  const agora = new Date().toISOString();
  if (b.acao === 'REMOVEU') {
    await supabaseAdmin.from('governanca_bloqueios_externos').update({ removido_em: agora, atualizado_em: agora })
      .eq('hotel_id', hotelId).eq('cloudbeds_block_id', b.blockId);
  } else if (b.inicio && b.fim) {
    if (b.acao === 'MUDOU') {
      // quartos que saíram do bloqueio
      await supabaseAdmin.from('governanca_bloqueios_externos').update({ removido_em: agora, atualizado_em: agora })
        .eq('hotel_id', hotelId).eq('cloudbeds_block_id', b.blockId).not('cloudbeds_room_id', 'in', `(${b.quartos.map((q) => `"${q}"`).join(',') || '""'})`);
    }
    const linhas = b.quartos.map((roomId) => ({
      hotel_id: hotelId, cloudbeds_block_id: b.blockId, cloudbeds_room_id: roomId, tipo: b.tipo, motivo: b.motivo,
      inicio: b.inicio, fim: b.fim, removido_em: null, atualizado_em: agora,
    }));
    if (linhas.length) await supabaseAdmin.from('governanca_bloqueios_externos').upsert(linhas, { onConflict: 'hotel_id,cloudbeds_block_id,cloudbeds_room_id' });
  }
  return { mudancas: await aplicar(supabaseAdmin, hotelId, b, hoje) };
}

// Rotina das 6h: bloqueios guardados que começam hoje (ou já começaram e não foram aplicados)
export async function aplicarBloqueiosDoDia(supabaseAdmin, hotelId, hoje) {
  const { data, error } = await supabaseAdmin.from('governanca_bloqueios_externos').select('*')
    .eq('hotel_id', hotelId).is('removido_em', null).is('aplicado_em', null).lte('inicio', hoje).gt('fim', hoje).limit(200);
  if (error) return [];
  const feitos = [];
  for (const r of data || []) {
    const b = { acao: 'CRIOU', blockId: r.cloudbeds_block_id, tipo: r.tipo, motivo: r.motivo, inicio: r.inicio, fim: r.fim, quartos: [r.cloudbeds_room_id] };
    feitos.push(...await aplicar(supabaseAdmin, hotelId, b, hoje));
  }
  return feitos;
}
