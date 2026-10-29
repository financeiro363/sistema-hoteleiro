// ============================================================================
// ETIQUETAS AUTOMÁTICAS POR FRASE — só usado no servidor
// ============================================================================
// Chamado quando chega mensagem do cliente (webhook do WhatsApp e chat do site).
// Se a 1ª mensagem (o cliente começa a conversa ou volta depois de 24 horas)
// tem uma frase de uma regra ligada:
//   - coloca a etiqueta da regra (cria a etiqueta se ainda não existe)
//   - conta a vez na regra
//   - se a regra tem resposta pronta e o robô não vai responder esta conversa,
//     manda a resposta (mensagem automática: não conta como resposta da equipe
//     no prazo de resposta)
//   - deixa uma nota na conversa
// Sem o SQL (sql/etiquetas_por_frase.sql) ou sem regras: não faz nada.
// ============================================================================

import { enviarPelaConversa, gravarNota } from './envio';
import { roboVaiResponder } from './robo';
import { CANAIS_FRASE, HORAS_RECOMECO, acharRegra } from './frasesConfig';

const AUTOR = { id: null }; // mensagem automática

export async function aplicarFrases(supabaseAdmin, { conversaId, canal, texto, data }) {
  if (!conversaId || !CANAIS_FRASE.includes(canal?.tipo) || !String(texto || '').trim()) return null;
  const { data: regras, error } = await supabaseAdmin.from('atendimento_frases_etiqueta')
    .select('*').eq('hotel_id', canal.hotel_id).eq('ativo', true).order('id');
  if (error || !regras?.length) return null;
  const achou = acharRegra(regras, texto);
  if (!achou) return null;

  // Só a 1ª mensagem: nenhuma outra do cliente nas 24 horas antes desta
  const quando = data ? new Date(data) : new Date();
  const desde = new Date(quando.getTime() - HORAS_RECOMECO * 3600000).toISOString();
  const { count } = await supabaseAdmin.from('atendimento_mensagens').select('id', { count: 'exact', head: true })
    .eq('conversa_id', conversaId).eq('direcao', 'ENTRADA').gte('data_original', desde).lt('data_original', quando.toISOString());
  if ((count || 0) > 0) return { pulou: 'não é a 1ª mensagem' };

  const { data: conversa } = await supabaseAdmin.from('atendimento_conversas').select('*').eq('id', conversaId).maybeSingle();
  if (!conversa) return null;
  const { regra, frase } = achou;
  await supabaseAdmin.rpc('atendimento_adicionar_etiqueta', { p_conversa: conversa.id, p_nome: regra.etiqueta });
  await supabaseAdmin.from('atendimento_frases_etiqueta')
    .update({ vezes: (Number(regra.vezes) || 0) + 1, ultima_vez: new Date().toISOString() }).eq('id', regra.id);

  let respondeu = false;
  let erroResposta = null;
  const resposta = String(regra.resposta || '').trim();
  if (resposta && !(await roboVaiResponder(supabaseAdmin, conversa))) {
    try {
      const envio = await enviarPelaConversa(supabaseAdmin, AUTOR, { canal, conversa, corpo: { semPrevia: true }, texto: resposta });
      erroResposta = envio?.erro || null;
      respondeu = !erroResposta;
    } catch (e) { erroResposta = String(e.message || e); }
  }
  try {
    await gravarNota(supabaseAdmin, AUTOR, conversa,
      `🏷️ A 1ª mensagem tem a frase “${frase}”: etiqueta “${regra.etiqueta}”${respondeu ? ' e resposta pronta enviada (o robô não está respondendo esta conversa)' : ''}.`
      + `${erroResposta ? ` A resposta pronta não foi enviada: ${erroResposta}` : ''}`);
  } catch (e) { /* a nota é um extra */ }
  return { etiqueta: regra.etiqueta, frase, respondeu, erroResposta };
}
