// ============================================================================
// GOVERNANÇA — pedidos especiais da recepção (regras sem segredo)
// ============================================================================
// Para quem vai o aviso (decisão do dono, 02/11/2026):
//   1) a(s) camareira(s) do andar na escala de hoje
//   2) se ninguém tem o andar: quem está na escala "em qualquer andar"
//   3) senão, a camareira do quarto (se não estiver de folga hoje)
//   4) senão, todas as que vieram hoje
//   5) sem escala hoje: todas as camareiras do hotel
// ============================================================================

import { andarDoQuarto } from './distribuicao';

export const TIPOS_PEDIDO = {
  TOALHA_BANHO: { rotulo: 'Toalha de banho', icone: '🛁' },
  TOALHA_ROSTO: { rotulo: 'Toalha de rosto', icone: '🧴' },
  ENXOVAL: { rotulo: 'Lençol / fronha', icone: '🛏️' },
  TRAVESSEIRO: { rotulo: 'Travesseiro', icone: '💤' },
  COBERTOR: { rotulo: 'Cobertor / manta', icone: '🧣' },
  AMENITIES: { rotulo: 'Sabonete / shampoo / papel', icone: '🧼' },
  ARRUMACAO: { rotulo: 'Arrumação extra', icone: '🧹' },
  OUTRO: { rotulo: 'Outro', icone: '📝' },
};

export const SITUACAO_PEDIDO = {
  NOVO: { rotulo: 'Novo', fundo: '#FDF3D7', texto: '#8A6100' },
  A_CAMINHO: { rotulo: 'A caminho', fundo: '#E3EDFA', texto: '#1D4E89' },
  ENTREGUE: { rotulo: 'Entregue', fundo: '#DDF2E4', texto: '#1E6B3C' },
  CANCELADO: { rotulo: 'Cancelado', fundo: '#EFEFEF', texto: '#666666' },
};

export const MOTIVO_AVISO = {
  ANDAR: 'camareira do andar',
  VOLANTE: 'camareira em qualquer andar',
  DONA: 'camareira do quarto',
  PRESENTES: 'todas que vieram hoje',
  TODAS: 'todas as camareiras',
};

export function destinatariosDoPedido(quarto, escalaHoje, camareiras) {
  const ids = (lista) => [...new Set(lista.map((x) => Number(x)))];
  const presentes = (escalaHoje || []).filter((e) => e.presente);
  const andar = andarDoQuarto(quarto);
  const doAndar = presentes.filter((e) => (e.andares || []).map(Number).includes(andar));
  if (doAndar.length) return { ids: ids(doAndar.map((e) => e.camareira_id)), motivo: 'ANDAR' };
  const volantes = presentes.filter((e) => !(e.andares || []).length);
  if (volantes.length) return { ids: ids(volantes.map((e) => e.camareira_id)), motivo: 'VOLANTE' };
  const dona = quarto?.camareira_id ? Number(quarto.camareira_id) : null;
  const folga = (escalaHoje || []).some((e) => Number(e.camareira_id) === dona && !e.presente);
  if (dona && !folga && (camareiras || []).some((c) => Number(c.id) === dona)) return { ids: [dona], motivo: 'DONA' };
  if (presentes.length) return { ids: ids(presentes.map((e) => e.camareira_id)), motivo: 'PRESENTES' };
  return { ids: ids((camareiras || []).map((c) => c.id)), motivo: 'TODAS' };
}

export function textoDoPedido(p) {
  const t = TIPOS_PEDIDO[p?.tipo] || TIPOS_PEDIDO.OUTRO;
  const qtd = Number(p?.quantidade || 1);
  const item = p?.tipo === 'OUTRO' ? (String(p?.descricao || '').trim() || 'Outro') : t.rotulo;
  return `${qtd > 1 ? `${qtd}× ` : ''}${item}`;
}

// O pedido aparece para a camareira se ela foi avisada ou se é ela que está levando
export function pedidoEhMeu(p, usuarioId) {
  const eu = Number(usuarioId);
  return (p?.avisadas || []).map(Number).includes(eu) || Number(p?.atendido_por_id) === eu;
}

export function pedidoValido({ quartoId, tipo, quantidade, descricao }) {
  if (!quartoId) return 'Escolha o apartamento.';
  if (!TIPOS_PEDIDO[tipo]) return 'Escolha o que o hóspede pediu.';
  const q = Number(quantidade || 1);
  if (!Number.isInteger(q) || q < 1 || q > 20) return 'Quantidade entre 1 e 20.';
  if (tipo === 'OUTRO' && !String(descricao || '').trim()) return 'Escreva o que o hóspede pediu.';
  if (String(descricao || '').length > 300) return 'Observação muito longa (até 300 letras).';
  return null;
}

export function haQuantoTempo(valor, agora = Date.now()) {
  if (!valor) return '';
  const min = Math.max(0, Math.round((agora - new Date(valor).getTime()) / 60000));
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  return `há ${h} h${min % 60 ? ` ${min % 60} min` : ''}`;
}
