// ============================================================================
// ROTA PÚBLICA: /api/chat-site   (chamada pela janela do chat no site do hotel)
// ============================================================================
// Não tem login: quem chama é o visitante do site. Cada pedido diz o hotel e,
// depois da primeira mensagem, o "passe" do visitante. Ações (campo "acao"):
//   config   { hotel }                                  → título, saudação, cor, equipe
//   enviar   { hotel, passe?, id, texto, visitante }    → grava a mensagem (o robô responde aqui mesmo)
//   novas    { hotel, passe, depois, aberta }           → mensagens novas (equipe e robô)
//   contato  { hotel, passe, nome, telefone, email }    → contato para a equipe retornar
// Só responde para os endereços de site cadastrados no canal (aba Canais) e
// para o próprio sistema (página de teste). Pedidos com corpo em texto simples
// não precisam da consulta prévia do navegador (CORS), mas ela também funciona.
// ============================================================================

import { clienteAdmin, origemDoSite } from '../../../lib/atendimento/servidor';
import { responderConversa } from '../../../lib/atendimento/robo';
import { pausaBloqueiaRobo } from '../../../lib/atendimento/roboConfig';
import { aplicarFrases } from '../../../lib/atendimento/frases';
import {
  TIPO_SITE, LIMITE_TEXTO, LIMITE_MENSAGENS_10MIN, LIMITE_CONVERSAS_HORA,
  canalDoSite, origemPermitida, configPublica, novoPasse, resumoPasse, passeValido, resumoIp, dadosDoVisitante,
  mensagensDaConversa, mensagemParaVisitante, nomesDaEquipe, marcarEntregues, telefoneDoVisitante, emailValido,
} from '../../../lib/atendimento/chatSite';
import { gravarNota } from '../../../lib/atendimento/envio';

export const dynamic = 'force-dynamic';

const TEMPO_TOTAL_MS = 8500; // a Netlify encerra a função em 10 s

function cabecalhos(origem) {
  return {
    ...(origem ? { 'Access-Control-Allow-Origin': origem } : {}),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
    'Cache-Control': 'no-store',
  };
}

function json(dados, status, origem) {
  return Response.json(dados, { status, headers: cabecalhos(origem) });
}

export async function OPTIONS(request) {
  return new Response(null, { status: 204, headers: cabecalhos(request.headers.get('origin')) });
}

export async function POST(request) {
  const inicio = Date.now();
  const origem = request.headers.get('origin') || '';
  let corpo;
  try { corpo = JSON.parse(await request.text()); } catch (e) { return json({ erro: 'Pedido inválido.' }, 400, null); }

  let supabaseAdmin;
  try { supabaseAdmin = clienteAdmin(); } catch (e) { return json({ erro: 'Chat indisponível no momento.' }, 503, null); }

  let canal;
  try { canal = await canalDoSite(supabaseAdmin, corpo?.hotel); } catch (e) { canal = null; }
  // Endereço não cadastrado: o navegador nem entrega a resposta ao site
  if (!canal || !origemPermitida(origem, canal, origemDoSite(request))) {
    return json({ erro: 'Este site não está liberado para o chat.' }, 403, null);
  }
  const ok = (dados, status = 200) => json(dados, status, origem);
  const falha = (erro, status = 400, extra = {}) => json({ erro, ...extra }, status, origem);

  try {
    if (corpo.acao === 'config') {
      return ok(await configPublica(supabaseAdmin, canal));
    }
    if (!canal.ativo) return falha('O chat está desligado no momento.', 409, { desligado: true });

    // ------------------------------------------------------------ conversa do passe
    const acharConversa = async (passe) => {
      if (!passeValido(passe)) return null;
      const { data } = await supabaseAdmin.from('atendimento_conversas').select('*')
        .eq('canal_id', canal.id).eq('chave_externa', resumoPasse(passe)).maybeSingle();
      return data || null;
    };
    const resposta = async (conversa, lista, aberta, extra = {}) => {
      await marcarEntregues(supabaseAdmin, conversa, lista, aberta);
      const nomes = await nomesDaEquipe(supabaseAdmin, lista);
      const agora = Date.now();
      const { data: atual } = await supabaseAdmin.from('atendimento_conversas')
        .select('robo_ocupado_ate, contato_id, robo_pausado_em, robo_pausa_motivo, ultima_saida_em').eq('id', conversa.id).maybeSingle();
      return ok({
        mensagens: lista.map((m) => mensagemParaVisitante(m, nomes)),
        digitando: !!(atual?.robo_ocupado_ate && new Date(atual.robo_ocupado_ate).getTime() > agora),
        temContato: !!atual?.contato_id,
        // A equipe assumiu esta conversa: o balão deixa de dizer "responde na hora"
        equipe: pausaBloqueiaRobo(atual),
        ...extra,
      });
    };

    // ------------------------------------------------------------ ENVIAR
    if (corpo.acao === 'enviar') {
      const texto = String(corpo.texto || '').replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
      if (!texto) return falha('Escreva a mensagem.');
      if (texto.length > LIMITE_TEXTO) return falha(`A mensagem passou de ${LIMITE_TEXTO} letras. Divida em partes.`);
      const idCliente = /^[A-Za-z0-9-]{8,64}$/.test(String(corpo.id || '')) ? String(corpo.id) : null;

      let conversa = await acharConversa(corpo.passe);
      let passeNovo = null;
      const visitante = dadosDoVisitante(corpo.visitante, request);
      if (!conversa) {
        // Limite de conversas novas por IP (robôs e abusos)
        const ip = resumoIp(request);
        if (ip) {
          const { count } = await supabaseAdmin.from('atendimento_conversas').select('id', { count: 'exact', head: true })
            .eq('canal_id', canal.id).eq('visitante->>ip', ip).gte('criado_em', new Date(Date.now() - 3600000).toISOString());
          if ((count || 0) >= LIMITE_CONVERSAS_HORA) return falha('Muitas conversas novas a partir desta conexão. Tente de novo mais tarde.', 429);
        }
        passeNovo = novoPasse();
        const { data, error } = await supabaseAdmin.from('atendimento_conversas').insert({
          hotel_id: canal.hotel_id, canal_id: canal.id, canal_tipo: TIPO_SITE, chave_externa: resumoPasse(passeNovo),
          contato_nome: null, contato_endereco: null, status: 'ABERTA', visitante: { ...visitante, ip },
          site_visto_em: new Date().toISOString(),
        }).select().single();
        if (error) throw error;
        conversa = data;
      } else {
        // Limite de mensagens seguidas na mesma conversa
        const { count } = await supabaseAdmin.from('atendimento_mensagens').select('id', { count: 'exact', head: true })
          .eq('conversa_id', conversa.id).eq('direcao', 'ENTRADA').gte('criado_em', new Date(Date.now() - 600000).toISOString());
        if ((count || 0) >= LIMITE_MENSAGENS_10MIN) return falha('Muitas mensagens seguidas. Espere um pouco antes de escrever de novo.', 429);
        // Página em que a pessoa está agora (ajuda a equipe e o robô)
        if (visitante.pagina && visitante.pagina !== conversa.visitante?.pagina) {
          const novo = { ...(conversa.visitante || {}), pagina: visitante.pagina, titulo: visitante.titulo };
          await supabaseAdmin.from('atendimento_conversas').update({ visitante: novo }).eq('id', conversa.id);
          conversa.visitante = novo;
        }
      }

      const dataMsg = new Date().toISOString();
      const { error: erroMsg } = await supabaseAdmin.from('atendimento_mensagens').upsert({
        hotel_id: canal.hotel_id, conversa_id: conversa.id, direcao: 'ENTRADA', tipo: 'texto', texto,
        id_externo: idCliente ? `site:${conversa.id}:${idCliente}` : null, status_envio: 'NAO_LIDA',
        data_original: dataMsg,
      }, { onConflict: 'hotel_id,id_externo', ignoreDuplicates: true });
      if (erroMsg) throw erroMsg;

      // Etiquetas por frase (1ª mensagem do visitante)
      try { await aplicarFrases(supabaseAdmin, { conversaId: conversa.id, canal, texto, data: dataMsg }); } catch (e) { /* a etiqueta é um extra */ }

      // Robô (se estiver ligado para o chat do site): responde aqui mesmo
      try {
        await responderConversa(supabaseAdmin, conversa.id, { origem: origemDoSite(request), prazo: inicio + TEMPO_TOTAL_MS, semEspera: true });
      } catch (e) { /* a função agendada tenta de novo */ }

      const lista = await mensagensDaConversa(supabaseAdmin, conversa, { depois: Number(corpo.depois) || 0 });
      return resposta(conversa, lista, true, passeNovo ? { passe: passeNovo } : {});
    }

    // ------------------------------------------------------------ NOVAS
    if (corpo.acao === 'novas') {
      const conversa = await acharConversa(corpo.passe);
      if (!conversa) return ok({ mensagens: [], encerrada: true });
      const depois = Number(corpo.depois) || 0;
      const lista = await mensagensDaConversa(supabaseAdmin, conversa, { depois, limite: depois ? 60 : 50 });
      return resposta(conversa, lista, corpo.aberta === true);
    }

    // ------------------------------------------------------------ CONTATO
    if (corpo.acao === 'contato') {
      const conversa = await acharConversa(corpo.passe);
      if (!conversa) return falha('Escreva uma mensagem antes de deixar o contato.');
      const nome = String(corpo.nome || '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').trim().slice(0, 80);
      const telefone = telefoneDoVisitante(corpo.telefone);
      const email = String(corpo.email || '').trim().toLowerCase();
      if (telefone === null) return falha('Confira o WhatsApp: use o DDD e o número (ex.: 83 98888-7777).');
      if (email && !emailValido(email)) return falha('Confira o e-mail.');
      if (!telefone && !email) return falha('Deixe o WhatsApp ou o e-mail.');
      // Limite: até 5 trocas de contato por hora na mesma conversa
      const { count: trocas } = await supabaseAdmin.from('atendimento_mensagens').select('id', { count: 'exact', head: true })
        .eq('conversa_id', conversa.id).eq('direcao', 'NOTA').like('texto', '📇%').gte('criado_em', new Date(Date.now() - 3600000).toISOString());
      if ((trocas || 0) >= 5) return falha('Muitas tentativas. Tente de novo mais tarde.', 429);
      const { error } = await supabaseAdmin.rpc('atendimento_site_contato', {
        p_conversa: conversa.id, p_nome: nome || null, p_telefone: telefone || null, p_email: email || null,
      });
      if (error) throw error;
      const partes = [nome, telefone ? `WhatsApp +${telefone}` : null, email || null].filter(Boolean);
      await gravarNota(supabaseAdmin, null, conversa, `📇 O visitante deixou o contato: ${partes.join(' · ')}`);
      return ok({ sucesso: true });
    }

    return falha('Ação desconhecida.');
  } catch (e) {
    const m = String(e?.message || e || '');
    if (/visitante|site_visto_em|site_email_msg_id|atendimento_site_contato|canais_tipo_check/i.test(m)) {
      return falha('O chat do site ainda não foi ativado no banco de dados.', 503);
    }
    return falha('Não foi possível concluir agora. Tente de novo em instantes.', 500);
  }
}
