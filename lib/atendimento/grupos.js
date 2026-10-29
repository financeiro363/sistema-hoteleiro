// ============================================================================
// PEDIDOS DE GRUPO — valor estimado pela Cloudbeds (só usado no servidor)
// ============================================================================
// Para cada pedido de grupo, o servidor consulta na Cloudbeds o quarto mais
// barato para 2 pessoas nas datas pedidas e calcula:
//   valor estimado = tarifa por noite × quartos × noites
// Também guarda quantos quartos estavam livres (aviso quando são menos que
// os do grupo). Quem chama:
//   - a função agendada (a cada 2 minutos), para os pedidos novos
//   - o botão "Recalcular pela Cloudbeds" na aba Solicitações
// O valor corrigido pela equipe (origem EQUIPE) só é trocado pelo botão.
// ============================================================================

import { conexaoCloudbeds } from './cloudbeds';
import { buscarDisponibilidade, hojeLocal, MAX_NOITES } from './cotacao';
import { numerosDoGrupo, valorDoGrupo } from './gruposConfig';

const TENTAR_DE_NOVO_H = 6; // erro da Cloudbeds: tenta de novo depois de 6 horas
const MAX_POR_VEZ = 20;

function camposDosNumeros(n) {
  return {
    grupo_pessoas: n.pessoas, grupo_quartos: n.quartos, grupo_quartos_estimado: !!n.quartosEstimado, grupo_noites: n.noites,
  };
}

// Calcula e grava. forcar = botão da equipe (troca também o valor que ela digitou).
export async function estimarGrupo(supabaseAdmin, sol, { forcar = false } = {}) {
  const n = numerosDoGrupo(sol.dados, sol);
  const campos = { ...camposDosNumeros(n), valor_estimado_em: new Date().toISOString(), valor_estimado_erro: false, valor_estimado_obs: null };
  const manterValorDaEquipe = !forcar && sol.valor_estimado_origem === 'EQUIPE' && sol.valor_estimado != null;
  let consultou = false;

  if (manterValorDaEquipe) {
    // só completa os números
  } else if (!n.checkin || !n.checkout || !n.noites) {
    campos.valor_estimado_obs = 'Faltam as datas de entrada e de saída do grupo.';
  } else if (n.checkin < hojeLocal()) {
    campos.valor_estimado_obs = 'As datas do grupo já passaram.';
  } else if (!n.quartos) {
    campos.valor_estimado_obs = 'Falta o número de quartos (ou de pessoas).';
  } else if (n.noites > MAX_NOITES) {
    campos.valor_estimado_obs = `A Cloudbeds só cota até ${MAX_NOITES} noites: digite o valor estimado.`;
  } else {
    consultou = true;
    try {
      const cb = await conexaoCloudbeds(supabaseAdmin, sol.hotel_id);
      const r = await buscarDisponibilidade(cb, { checkin: n.checkin, checkout: n.checkout, adultos: 2, criancas: 0, quartos: 1 });
      const livres = r.itens.reduce((s, i) => s + (Number(i.disponiveis) || 0), 0);
      campos.grupo_quartos_livres = livres;
      if (!r.itens.length) {
        campos.valor_estimado_obs = 'Nenhum quarto livre na Cloudbeds nessas datas: digite o valor estimado.';
      } else {
        const tarifa = Math.round((r.itens[0].total / n.noites) * 100) / 100;
        Object.assign(campos, {
          grupo_tarifa_noite: tarifa,
          valor_estimado: valorDoGrupo(tarifa, n.quartos, n.noites),
          valor_estimado_origem: 'CLOUDBEDS',
          valor_estimado_obs: livres < n.quartos ? `Só ${livres} quarto(s) livre(s) nessas datas na Cloudbeds; o grupo pede ${n.quartos}.` : null,
        });
      }
    } catch (e) {
      Object.assign(campos, { valor_estimado_erro: true, valor_estimado_obs: `Não foi possível consultar a Cloudbeds: ${String(e.message || e).slice(0, 200)}` });
    }
  }
  const { data, error } = await supabaseAdmin.from('atendimento_solicitacoes').update(campos).eq('id', sol.id).select().single();
  if (error) throw error;
  return { solicitacao: data, consultou };
}

// Pedidos de grupo ainda sem cálculo (e os que deram erro há mais de 6 h)
export async function estimarGruposPendentes(supabaseAdmin, { prazo }) {
  const colunas = 'id, hotel_id, tipo, dados, grupo_pessoas, grupo_quartos, grupo_quartos_estimado, grupo_noites, valor_estimado, valor_estimado_origem';
  const novos = await supabaseAdmin.from('atendimento_solicitacoes').select(colunas)
    .eq('tipo', 'GRUPO').is('valor_estimado_em', null).order('criado_em', { ascending: false }).limit(MAX_POR_VEZ);
  if (novos.error) return { erro: novos.error.message }; // sem o SQL dos grupos
  const antes = new Date(Date.now() - TENTAR_DE_NOVO_H * 3600000).toISOString();
  const comErro = await supabaseAdmin.from('atendimento_solicitacoes').select(colunas)
    .eq('tipo', 'GRUPO').eq('valor_estimado_erro', true).lt('valor_estimado_em', antes).limit(5);
  const lista = [...(novos.data || []), ...(comErro.data || [])];
  let feitos = 0;
  let consultas = 0;
  for (const sol of lista) {
    // Cada consulta à Cloudbeds leva 1 a 2 s: para antes do limite da Netlify
    if (prazo - Date.now() < 3000) break;
    try {
      const r = await estimarGrupo(supabaseAdmin, sol);
      feitos += 1;
      if (r.consultou) consultas += 1;
    } catch (e) { /* tenta na próxima vez */ }
  }
  return { pendentes: lista.length, feitos, consultas };
}
