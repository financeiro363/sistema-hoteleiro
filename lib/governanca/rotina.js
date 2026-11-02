// ============================================================================
// GOVERNANÇA — rotina do dia (às 6h e pelo botão do Painel) — regras sem segredo
// ============================================================================
// Com as saídas e chegadas de hoje na Cloudbeds e a ocupação de cada quarto:
//   SAIDA    → hóspede com saída hoje e ainda no quarto: "Previsão de saída"
//   FICOU    → estava em "Previsão de saída" mas não sai hoje e continua
//              ocupado: "Virou arrumação / Apt ocupado" (sujo, entra na lista)
//   SAIU     → estava em "Previsão de saída" e a Cloudbeds diz que está vago:
//              "Saída / Apt Sujo"
//   DIARIA   → quarto com hóspede arrumado antes de hoje volta para a lista:
//              "Arrumação / Apt ocupado" (sujo). "Não deseja arrumação" fica
//   CHEGADA  → chegada hoje num quarto que ainda não está limpo: ⭐ prioridade
//              "Chegada hoje (às HH:MM)"
// Cada marcação vale uma vez por quarto por dia: se a governanta mudar à mão
// depois, a rotina não desfaz (lista "jaFeitas"). FICOU e DIARIA só na
// primeira atualização do dia (a das 6h): apertar o botão à tarde não
// devolve para a lista um quarto que a governanta já resolveu.
// Não mexe em: Interditado, Serviços gerais, quarto em arrumação.
// Decisões do dono (02/11/2026): roda às 6h + botão; "Virou arrumação" para
// quem ficou; o sistema faz a arrumação diária.
// ============================================================================

import { diaNoHotel, ESTADOS_MANUAIS } from './regras';

export const TIPOS_ROTINA = {
  SAIDA: 'Previsão de saída',
  FICOU: 'Virou arrumação',
  SAIU: 'Saída (vago)',
  DIARIA: 'Arrumação do dia',
  CHEGADA: 'Chegada hoje',
};

const normal = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Quartos de uma reserva da Cloudbeds: { roomID, roomName } (lista e detalhe têm formatos diferentes)
export function quartosDaReserva(r) {
  const hospedes = Array.isArray(r?.guestList) ? r.guestList : Object.values(r?.guestList || {});
  const fontes = [
    ...(Array.isArray(r?.rooms) ? r.rooms : []),
    ...(Array.isArray(r?.assigned) ? r.assigned : []),
    ...hospedes.flatMap((h) => (Array.isArray(h?.rooms) ? h.rooms : [])),
  ];
  const vistos = new Set();
  const lista = [];
  for (const q of fontes) {
    const roomID = q?.roomID != null && q.roomID !== '' ? String(q.roomID) : null;
    const roomName = q?.roomName != null && q.roomName !== '' ? String(q.roomName) : null;
    if (!roomID && !roomName) continue;
    const chave = roomID || `n:${normal(roomName)}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    lista.push({ roomID, roomName });
  }
  return lista;
}

// Acha o nosso quarto pelo ID da Cloudbeds ou pelo nome/número
export function acharQuarto(quartos, { roomID, roomName }) {
  if (roomID) {
    const q = quartos.find((x) => x.cloudbeds_room_id && String(x.cloudbeds_room_id) === String(roomID));
    if (q) return q;
  }
  if (roomName) return quartos.find((x) => normal(x.numero) === normal(roomName)) || null;
  return null;
}

// "14:30:00" / "14:30" / "2:30 PM" → "14:30"; o que não entender → null
export function horaDaChegada(valor) {
  const t = String(valor || '').trim();
  let m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/i.exec(t);
  if (!m) return null;
  let h = Number(m[1]); const min = m[2];
  if (m[3]) { const pm = /pm/i.test(m[3]); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
  if (h > 23) return null;
  return `${String(h).padStart(2, '0')}:${min}`;
}

// entrada:
//   quartos     → nossos quartos
//   hoje        → 'AAAA-MM-DD' (Fortaleza)
//   saidas      → Set de ids dos nossos quartos com saída hoje (hóspede ainda no quarto)
//   chegadas    → Map id do quarto → { hora } (chegadas de hoje que ainda não entraram)
//   ocupacao    → Map id do quarto → true/false (Cloudbeds); sem a informação → não está no Map
//   jaFeitas    → Set de `${quartoId}:${tipo}` já feitos hoje
//   primeiraDoDia → true na primeira atualização do dia
// saída: [{ quarto, tipo, campos, cloudbeds }]
export function planoDoDia({ quartos, hoje, saidas = new Set(), chegadas = new Map(), ocupacao = new Map(), jaFeitas = new Set(), primeiraDoDia = true }) {
  const plano = [];
  const feito = (q, tipo) => jaFeitas.has(`${q.id}:${tipo}`);
  for (const q of quartos || []) {
    const estado = q.estado_apartamento || null;
    if (ESTADOS_MANUAIS.includes(estado) || q.status === 'MANUTENCAO' || q.status === 'EM_ARRUMACAO') continue;
    const ocupado = ocupacao.has(q.id) ? ocupacao.get(q.id) : null;
    let atual = { ...q };

    if (saidas.has(q.id)) {
      if (!feito(q, 'SAIDA') && estado !== 'PREVISAO_SAIDA_OCUPADO' && estado !== 'SAIDA_SUJO') {
        const campos = { estado_apartamento: 'PREVISAO_SAIDA_OCUPADO' };
        plano.push({ quarto: q, tipo: 'SAIDA', campos, cloudbeds: null });
        atual = { ...atual, ...campos };
      }
    } else if (estado === 'PREVISAO_SAIDA_OCUPADO' && ocupado === false && !feito(q, 'SAIU')) {
      const campos = { estado_apartamento: 'SAIDA_SUJO', status: 'SUJO' };
      plano.push({ quarto: q, tipo: 'SAIU', campos, cloudbeds: { roomCondition: 'dirty' } });
      atual = { ...atual, ...campos };
    } else if (primeiraDoDia && estado === 'PREVISAO_SAIDA_OCUPADO' && ocupado !== false && !feito(q, 'FICOU')) {
      const campos = { estado_apartamento: 'VIROU_ARRUMACAO_OCUPADO', status: 'SUJO' };
      plano.push({ quarto: q, tipo: 'FICOU', campos, cloudbeds: q.status === 'SUJO' ? null : { roomCondition: 'dirty' } });
      atual = { ...atual, ...campos };
    } else if (primeiraDoDia && (estado === 'ARRUMACAO_OCUPADO' || estado === 'VIROU_ARRUMACAO_OCUPADO') && q.status === 'LIMPO'
      && ocupado !== false && (!q.ultima_limpeza || diaNoHotel(q.ultima_limpeza) < hoje) && !feito(q, 'DIARIA')) {
      const campos = { estado_apartamento: 'ARRUMACAO_OCUPADO', status: 'SUJO' };
      plano.push({ quarto: q, tipo: 'DIARIA', campos, cloudbeds: { roomCondition: 'dirty' } });
      atual = { ...atual, ...campos };
    }

    const chegada = chegadas.get(q.id);
    // Chegada num quarto que ainda vai precisar de arrumação: não está limpo,
    // ou o hóspede anterior sai hoje (troca de hóspede no mesmo dia)
    const precisa = atual.status !== 'LIMPO' || saidas.has(q.id) || atual.estado_apartamento === 'PREVISAO_SAIDA_OCUPADO';
    if (chegada && !feito(q, 'CHEGADA') && precisa && !atual.prioridade) {
      const campos = { prioridade: true, prioridade_obs: `Chegada hoje${chegada.hora ? ` às ${chegada.hora}` : ''}` };
      plano.push({ quarto: q, tipo: 'CHEGADA', campos, cloudbeds: null });
    }
  }
  return plano;
}

// Junta as mudanças do mesmo quarto num update só
export function camposPorQuarto(plano) {
  const porQuarto = new Map();
  for (const p of plano) {
    const atual = porQuarto.get(p.quarto.id) || { quarto: p.quarto, campos: {}, cloudbeds: null, tipos: [] };
    Object.assign(atual.campos, p.campos);
    if (p.cloudbeds) atual.cloudbeds = { ...(atual.cloudbeds || {}), ...p.cloudbeds };
    atual.tipos.push(p.tipo);
    porQuarto.set(p.quarto.id, atual);
  }
  return [...porQuarto.values()];
}

export function resumoDoPlano(plano, extras = {}) {
  const numeros = (tipo) => plano.filter((p) => p.tipo === tipo).map((p) => p.quarto.numero);
  return {
    saidas: extras.saidas || numeros('SAIDA'),
    chegadas: extras.chegadas || [],
    semQuarto: extras.semQuarto || 0,
    marcados: {
      SAIDA: numeros('SAIDA'), FICOU: numeros('FICOU'), SAIU: numeros('SAIU'), DIARIA: numeros('DIARIA'), CHEGADA: numeros('CHEGADA'),
    },
  };
}
