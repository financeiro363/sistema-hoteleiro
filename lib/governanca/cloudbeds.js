// ============================================================================
// GOVERNANÇA — chamadas à Cloudbeds (só no SERVIDOR, a chave nunca vai à tela)
// ============================================================================
// Endpoints oficiais da API v1.3 (developers.cloudbeds.com):
//   getHousekeepingStatus   → limpeza, ocupado e bloqueio de um quarto
//   postHousekeepingStatus  → roomCondition (dirty/clean/inspected),
//                             doNotDisturb e refusedService
//   postRoomBlock           → bloqueio "out_of_service" (fora de serviço)
//   deleteRoomBlock         → tira o bloqueio (roomBlockID)
// Housekeeping pede a permissão "Housekeeping" na chave; os bloqueios pedem a
// permissão de bloqueio de quartos (escopo write:roomblock).
// ============================================================================

import crypto from 'crypto';
import { carregarCloudbeds, ErroCloudbeds } from '../cloudbedsCaixa';

export { carregarCloudbeds, ErroCloudbeds };

export const CLOUDBEDS_V13 = 'https://api.cloudbeds.com/api/v1.3';

export const DICA_HOUSEKEEPING = ' — confira se a chave de API da Cloudbeds tem a permissão "Housekeeping" (Ler e Escrever).';
export const DICA_BLOQUEIO = ' — confira se a chave de API da Cloudbeds tem a permissão de bloqueio de quartos ("Room Blocks", Ler e Escrever).';

function textoBool(v) { return v ? 'true' : 'false'; }

export async function chamarV13(cb, metodo, { verbo = 'POST', campos = [], dica = '' } = {}) {
  const corpo = new URLSearchParams();
  corpo.set('propertyID', cb.propertyId);
  for (const [chave, valor] of campos) {
    if (valor === undefined || valor === null || valor === '') continue;
    corpo.append(chave, typeof valor === 'boolean' ? textoBool(valor) : String(valor));
  }
  const cabecalhos = { Authorization: `Bearer ${cb.apiKey}`, 'x-property-id': cb.propertyId, Accept: 'application/json' };
  let resposta;
  try {
    resposta = verbo === 'GET'
      ? await fetch(`${CLOUDBEDS_V13}/${metodo}?${corpo.toString()}`, { headers: cabecalhos })
      : await fetch(`${CLOUDBEDS_V13}/${metodo}`, {
        method: 'POST',
        headers: { ...cabecalhos, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: corpo.toString(),
      });
  } catch (e) {
    throw new ErroCloudbeds('Sem conexão com a Cloudbeds. Tente de novo em instantes.');
  }
  const dados = await resposta.json().catch(() => null);
  if (!resposta.ok || !dados || dados.success === false) {
    const msg = String(dados?.message || dados?.error || `a Cloudbeds respondeu com erro (status ${resposta.status})`);
    const semPermissao = /scope|permiss|unauthori|forbidden|access denied/i.test(msg) || resposta.status === 401 || resposta.status === 403;
    throw new ErroCloudbeds(msg + (semPermissao ? dica : ''));
  }
  return dados;
}

// Situação do quarto lá: { ocupado, condicao, bloqueado } ou null
export async function situacaoNaCloudbeds(cb, roomId) {
  const dados = await chamarV13(cb, 'getHousekeepingStatus', { verbo: 'GET', campos: [['roomIDs', roomId]], dica: DICA_HOUSEKEEPING });
  const r = (dados.data || []).find((x) => String(x.roomID) === String(roomId));
  if (!r) return null;
  return { ocupado: !!r.roomOccupied, condicao: r.roomCondition || null, bloqueado: !!r.roomBlocked };
}

// { roomCondition?, doNotDisturb?, refusedService? }
export async function enviarSituacao(cb, roomId, { roomCondition, doNotDisturb, refusedService } = {}) {
  if (roomCondition && !['dirty', 'clean', 'inspected'].includes(roomCondition)) throw new ErroCloudbeds('Status inválido.');
  const campos = [['roomID', roomId], ['roomCondition', roomCondition]];
  if (typeof doNotDisturb === 'boolean') campos.push(['doNotDisturb', doNotDisturb]);
  if (typeof refusedService === 'boolean') campos.push(['refusedService', refusedService]);
  if (campos.length === 2 && !roomCondition) return null; // nada a mandar
  return chamarV13(cb, 'postHousekeepingStatus', { campos, dica: DICA_HOUSEKEEPING });
}

// Bloqueio "fora de serviço" de inicio até fim (datas AAAA-MM-DD). Devolve o roomBlockID.
export async function bloquearNaCloudbeds(cb, roomId, { inicio, fim, motivo }) {
  const dados = await chamarV13(cb, 'postRoomBlock', {
    campos: [
      ['roomBlockType', 'out_of_service'],
      ['roomBlockReason', motivo],
      ['startDate', inicio],
      ['endDate', fim],
      ['rooms[0][roomID]', roomId],
    ],
    dica: DICA_BLOQUEIO,
  });
  const id = dados.roomBlockID ?? dados.data?.roomBlockID ?? null;
  if (!id) throw new ErroCloudbeds('A Cloudbeds aceitou, mas não devolveu o número do bloqueio.');
  return String(id);
}

export async function liberarNaCloudbeds(cb, roomBlockID) {
  return chamarV13(cb, 'deleteRoomBlock', { campos: [['roomBlockID', roomBlockID]], dica: DICA_BLOQUEIO });
}

// ---- Senha do endereço que recebe os avisos ---------------------------------
export function novaSenhaWebhook() {
  return crypto.randomBytes(24).toString('base64url');
}

export function senhaWebhookConfere(recebida, guardada) {
  if (!recebida || !guardada) return false;
  const a = crypto.createHash('sha256').update(String(recebida)).digest();
  const b = crypto.createHash('sha256').update(String(guardada)).digest();
  return crypto.timingSafeEqual(a, b);
}
