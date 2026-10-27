// ============================================================================
// ROTA DE SERVIDOR: /api/atendimento   (Caixa de Entrada)
// ============================================================================
// Uma rota só, com várias ações (campo "acao" no corpo):
//   enviar            → responde a conversa (texto, anexos, modelo do WhatsApp)
//                       ou abre conversa nova; "nota" grava nota interna
//   ler               → zera as não lidas e avisa o WhatsApp/Gmail que foi lido
//   upload            → link para a tela enviar um anexo direto ao Storage
//   anexo             → link temporário para ver/baixar um anexo
//   modelos           → modelos (templates) aprovados do WhatsApp
//   sincronizar       → busca e-mails novos (também chamada pela função agendada)
//   cloudbeds_buscar  → reservas do cliente na Cloudbeds
//   cloudbeds_vincular→ liga/desliga uma reserva à conversa
//   equipe            → hotéis e pessoas que atendem (filtros e "responsável")
//   painel            → indicadores do mês (aba Painel)
//   importar_contatos → importa a lista de contatos (ex.: exportada do Asksuite)
//   cotacao_buscar    → preço e disponibilidade na Cloudbeds (tarifa padrão)
//   cotacao_enviar    → envia a cotação com o link "Reservar agora" de cada quarto
//   motor_detectar    → descobre o link do motor de reservas na Cloudbeds (ADMIN)
//   reservas_verificar→ procura reservas novas na Cloudbeds e marca "Reservou"
//   importar_asksuite → importa a planilha de conversas do Asksuite (histórico)
//   robo_config       → liga/desliga e configura o robô com IA (ADMIN)
//   robo_chave        → guarda (criptografada) e testa a chave da Anthropic (ADMIN)
//   robo_info_hotel   → lê de novo os dados do hotel na Cloudbeds para o robô (ADMIN)
//   robo_testar       → conversa de teste com o robô, sem enviar nada (ADMIN)
//   robo_pendentes    → robô responde mensagens que ficaram sem resposta (agendada)
//   automacoes_rodar  → automações da Fase 5: agenda e envia os disparos (agendada)
//   automacoes        → lista as automações, os disparos e os números (ADMIN)
//   automacao_salvar  → liga/desliga e configura uma automação (ADMIN)
//   automacao_testar  → manda o modelo de uma automação para um número de teste (ADMIN)
//   disparo_cancelar  → cancela um disparo agendado (ADMIN)
// Acesso: ADMIN ou COLABORADOR com "Pode usar a Caixa de Entrada" — nos dois
// hotéis, quando a pessoa tem vínculo com os dois.
// ============================================================================

import {
  autenticar, clienteAdmin, respostaErro, erroBanco, chamadaAgendadaValida, lerAnexo, guardarAnexo,
  caminhoAnexo, PASTA_ANEXOS, hotelPermitido, soDigitos,
} from '../../../lib/atendimento/servidor';
import {
  tokenDoCanal, marcarComoLida, listarModelos, baixarMidia, variantesNumero, criarModelo, excluirModelo,
} from '../../../lib/atendimento/whatsapp';
import { validarModeloNovo, normalizarNomeModelo, montarComponentes } from '../../../lib/atendimento/modelosNovos';
import { previaCampanha, criarCampanha, mudarCampanha, rodarCampanhas } from '../../../lib/atendimento/campanhas';
import {
  tokenDaCaixa, sincronizarCaixa, marcarFioComoLido, baixarAnexoGmail,
} from '../../../lib/atendimento/gmail';
import { conexaoCloudbeds, procurarReservas, detalheReserva } from '../../../lib/atendimento/cloudbeds';
import {
  buscarDisponibilidade, linkDoMotor, detectarMotor, verificarReservasHotel, reais, dataBR,
} from '../../../lib/atendimento/cotacao';
import {
  enviarPelaConversa, enviarCotacao, registrarSemDisponibilidade, preferenciasCotacao,
} from '../../../lib/atendimento/envio';
import { origemDoSite } from '../../../lib/atendimento/servidor';
import { importarLote, limparImportacaoAnterior } from '../../../lib/atendimento/asksuite';
import {
  pausar as pausarRobo, responderPendentes, atualizarInfosVelhas, atualizarInfoHotel, testarRobo, testarChave, CHAVE_SEGREDO,
} from '../../../lib/atendimento/robo';
import { MODELOS_IA, CANAIS_ROBO } from '../../../lib/atendimento/roboConfig';
import { avisarVisitantesPorEmail } from '../../../lib/atendimento/chatSite';
import { rodarAutomacoes, salvarAutomacao, testarAutomacao } from '../../../lib/atendimento/automacoes';
import { gravarSegredo, lerSegredo } from '../../../lib/atendimento/servidor';

export const dynamic = 'force-dynamic';

const LIMITE_ANEXOS_MB = { WHATSAPP: 100, EMAIL: 25 };
const INTERVALO_MINIMO_SINCRONIZACAO_MS = 30 * 1000;

export async function POST(request) {
  let corpo;
  try { corpo = await request.json(); } catch (e) { return respostaErro('Pedido inválido.'); }

  // Chamada da função agendada da Netlify (sem usuário): e-mails novos e,
  // a cada 5 minutos por hotel, reservas novas na Cloudbeds
  if (corpo?.acao === 'sincronizar' && chamadaAgendadaValida(request)) {
    try {
      const supabaseAdmin = clienteAdmin();
      const emails = await sincronizarEmails(supabaseAdmin, null, 60 * 1000);
      const reservas = await verificarReservasTodos(supabaseAdmin, null, false);
      // Arquivar sozinho os atendimentos parados (só nos hotéis que escolheram os dias)
      const { data: arquivadas } = await supabaseAdmin.rpc('atendimento_arquivar_antigos');
      // Chat do site: respostas que o visitante não leu em 10 minutos vão por e-mail
      let chatSite = null;
      try { chatSite = await avisarVisitantesPorEmail(supabaseAdmin, { prazo: Date.now() + 5000 }); } catch (e) { chatSite = { erro: e.message }; }
      return Response.json({ ...emails, reservas, arquivadas: arquivadas ?? null, chatSite });
    } catch (e) { return respostaErro(e.message, 500); }
  }
  // Automações (Fase 5): agenda e envia os disparos que chegaram a hora
  if (corpo?.acao === 'automacoes_rodar' && chamadaAgendadaValida(request)) {
    try {
      const supabaseAdmin = clienteAdmin();
      return Response.json(await rodarAutomacoes(supabaseAdmin, { origem: origemDoSite(request), prazo: Date.now() + 8500 }));
    } catch (e) { return respostaErro(e.message, 500); }
  }
  // Campanhas (Fase 6): envia aos poucos o que está na fila
  if (corpo?.acao === 'campanhas_rodar' && chamadaAgendadaValida(request)) {
    try {
      const supabaseAdmin = clienteAdmin();
      return Response.json(await rodarCampanhas(supabaseAdmin, { prazo: Date.now() + 8500 }));
    } catch (e) { return respostaErro(e.message, 500); }
  }
  // Robô: mensagens que ficaram sem resposta (o webhook não teve tempo)
  if (corpo?.acao === 'robo_pendentes' && chamadaAgendadaValida(request)) {
    try {
      const supabaseAdmin = clienteAdmin();
      const inicio = Date.now();
      const r = await responderPendentes(supabaseAdmin, { origem: origemDoSite(request), prazo: inicio + 8500 });
      const info = Date.now() - inicio < 4000 ? await atualizarInfosVelhas(supabaseAdmin) : null;
      return Response.json({ ...r, infoAtualizada: info });
    } catch (e) { return respostaErro(e.message, 500); }
  }

  const auth = await autenticar(request);
  if (auth.resposta) return auth.resposta;
  const { chamador, supabaseAdmin } = auth;

  try {
    switch (corpo?.acao) {
      case 'enviar': return await acaoEnviar(supabaseAdmin, chamador, corpo);
      case 'ler': return await acaoLer(supabaseAdmin, chamador, corpo);
      case 'upload': return await acaoUpload(supabaseAdmin, chamador, corpo);
      case 'anexo': return await acaoAnexo(supabaseAdmin, chamador, corpo);
      case 'modelos': return await acaoModelos(supabaseAdmin, chamador, corpo);
      case 'sincronizar':
        return Response.json(await sincronizarEmails(supabaseAdmin, chamador.hoteis, corpo.forcar ? 5000 : INTERVALO_MINIMO_SINCRONIZACAO_MS));
      case 'cloudbeds_buscar': return await acaoCloudbedsBuscar(supabaseAdmin, chamador, corpo);
      case 'cloudbeds_vincular': return await acaoCloudbedsVincular(supabaseAdmin, chamador, corpo);
      case 'equipe': return await acaoEquipe(supabaseAdmin, chamador);
      case 'painel': return await acaoPainel(supabaseAdmin, chamador, corpo);
      case 'importar_contatos': return await acaoImportarContatos(supabaseAdmin, chamador, corpo);
      case 'cotacao_buscar': return await acaoCotacaoBuscar(supabaseAdmin, chamador, corpo);
      case 'cotacao_enviar': return await acaoCotacaoEnviar(supabaseAdmin, chamador, corpo, request);
      case 'motor_detectar': return await acaoMotorDetectar(supabaseAdmin, chamador, corpo);
      case 'importar_asksuite': return await acaoImportarAsksuite(supabaseAdmin, chamador, corpo);
      case 'robo_config': return await acaoRoboConfig(supabaseAdmin, chamador, corpo);
      case 'robo_chave': return await acaoRoboChave(supabaseAdmin, chamador, corpo);
      case 'robo_info_hotel': return await acaoRoboInfoHotel(supabaseAdmin, chamador, corpo);
      case 'robo_testar': return await acaoRoboTestar(supabaseAdmin, chamador, corpo, request);
      case 'automacoes': return await acaoAutomacoes(supabaseAdmin, chamador, corpo);
      case 'automacao_salvar': {
        const hotelId = hotelDoAdmin(chamador, corpo.hotelId);
        const r = await salvarAutomacao(supabaseAdmin, chamador, hotelId, corpo.automacao || {}, origemDoSite(request));
        return r.erro ? respostaErro(r.erro) : Response.json({ sucesso: true, automacao: r.automacao });
      }
      case 'automacao_testar': {
        const hotelId = hotelDoAdmin(chamador, corpo.hotelId);
        const r = await testarAutomacao(supabaseAdmin, hotelId, { tipo: corpo.tipo, telefone: corpo.telefone, origem: origemDoSite(request) });
        return r.erro ? respostaErro(r.erro) : Response.json(r);
      }
      case 'disparo_cancelar': return await acaoDisparoCancelar(supabaseAdmin, chamador, corpo);
      case 'whatsapp_modelos': return await acaoWhatsappModelos(supabaseAdmin, chamador, corpo);
      case 'modelo_criar': return await acaoModeloCriar(supabaseAdmin, chamador, corpo);
      case 'modelo_excluir': return await acaoModeloExcluir(supabaseAdmin, chamador, corpo);
      case 'campanhas': return await acaoCampanhas(supabaseAdmin, chamador, corpo);
      case 'campanha_previa': {
        const hotelId = hotelDoAdmin(chamador, corpo.hotelId);
        const r = await previaCampanha(supabaseAdmin, hotelId, corpo.campanha || {});
        if (r.erro) return respostaErro(r.erro);
        const { _interno, ...previa } = r;
        return Response.json(previa);
      }
      case 'campanha_criar': {
        const hotelId = hotelDoAdmin(chamador, corpo.hotelId);
        const r = await criarCampanha(supabaseAdmin, chamador, hotelId, corpo.campanha || {});
        return r.erro ? respostaErro(r.erro) : Response.json({ sucesso: true, campanha: r.campanha });
      }
      case 'campanha_mudar': {
        const { data: c } = await supabaseAdmin.from('atendimento_campanhas').select('*').eq('id', Number(corpo.campanhaId)).maybeSingle();
        if (!c) return respostaErro('Campanha não encontrada.');
        hotelDoAdmin(chamador, c.hotel_id);
        const r = await mudarCampanha(supabaseAdmin, c, String(corpo.mudanca || ''));
        return r.erro ? respostaErro(r.erro) : Response.json({ sucesso: true });
      }
      case 'campanha_envios': return await acaoCampanhaEnvios(supabaseAdmin, chamador, corpo);
      case 'reservas_verificar':
        return Response.json({ resultados: await verificarReservasTodos(supabaseAdmin, chamador.hoteis, true) });
      default: return respostaErro('Ação desconhecida.');
    }
  } catch (e) {
    return respostaErro(erroBanco(e, 'Não foi possível concluir'));
  }
}

// ---------------------------------------------------------------------------
async function carregarConversa(supabaseAdmin, chamador, conversaId) {
  const { data: conversa, error } = await supabaseAdmin.from('atendimento_conversas')
    .select('*').eq('id', conversaId).in('hotel_id', chamador.hoteis).maybeSingle();
  if (error) throw error;
  if (!conversa) throw new Error('Conversa não encontrada.');
  return conversa;
}

async function carregarCanal(supabaseAdmin, chamador, canalId) {
  const { data: canal, error } = await supabaseAdmin.from('atendimento_canais')
    .select('*').eq('id', canalId).in('hotel_id', chamador.hoteis).maybeSingle();
  if (error) throw error;
  if (!canal) throw new Error('Canal não encontrado.');
  if (!canal.ativo) throw new Error(`O canal "${canal.nome}" está desligado. O administrador pode ligá-lo em Canais.`);
  return canal;
}

async function lerAnexosEnviados(supabaseAdmin, hotelId, anexos, tipoCanal) {
  const lista = Array.isArray(anexos) ? anexos.slice(0, 10) : [];
  const arquivos = [];
  let total = 0;
  for (const a of lista) {
    if (!a?.caminho || !String(a.caminho).startsWith(`${hotelId}/`) || String(a.caminho).includes('..')) throw new Error('Anexo inválido.');
    const dados = await lerAnexo(supabaseAdmin, a.caminho);
    total += dados.length;
    arquivos.push({ nome: String(a.nome || 'arquivo').slice(0, 120), mime: a.mime || 'application/octet-stream', dados, caminho: a.caminho });
  }
  const limite = LIMITE_ANEXOS_MB[tipoCanal] || 25;
  if (total > limite * 1024 * 1024) throw new Error(`Os anexos passam de ${limite} MB, que é o limite deste canal.`);
  return arquivos;
}

// ---------------------------------------------------------------- ENVIAR
async function acaoEnviar(supabaseAdmin, chamador, corpo) {
  const texto = String(corpo.texto || '').replace(/\r\n/g, '\n').trim();
  const novaConversa = !corpo.conversaId;

  let conversa = null;
  let canal;
  if (novaConversa) {
    canal = await carregarCanal(supabaseAdmin, chamador, corpo.canalId);
  } else {
    conversa = await carregarConversa(supabaseAdmin, chamador, corpo.conversaId);
    canal = await carregarCanal(supabaseAdmin, chamador, conversa.canal_id);
  }

  // Nota interna: o cliente não vê
  if (corpo.nota) {
    if (!conversa) return respostaErro('Abra uma conversa para escrever a nota.');
    if (!texto) return respostaErro('Escreva a nota.');
    const { data, error } = await supabaseAdmin.from('atendimento_mensagens').insert({
      hotel_id: conversa.hotel_id, conversa_id: conversa.id, direcao: 'NOTA', tipo: 'nota', texto, enviado_por_id: chamador.id,
      data_original: new Date().toISOString(),
    }).select().single();
    if (error) throw error;
    return Response.json({ sucesso: true, mensagens: [data] });
  }

  const arquivos = await lerAnexosEnviados(supabaseAdmin, canal.hotel_id, corpo.anexos, canal.tipo);
  if (!texto && !arquivos.length && !corpo.modelo && !corpo.html) return respostaErro('Escreva a mensagem ou escolha um anexo.');

  const autor = { id: chamador.id };
  const mensagens = await enviarPelaConversa(supabaseAdmin, autor, { canal, conversa, corpo, texto, arquivos });

  // Quem responde vira o responsável, se a conversa estava sem ninguém
  const conversaFinal = mensagens.conversa;
  if (conversaFinal && !conversaFinal.responsavel_id) {
    await supabaseAdmin.from('atendimento_conversas').update({ responsavel_id: chamador.id }).eq('id', conversaFinal.id);
  }
  // Alguém da equipe respondeu: o robô para de responder esta conversa
  if (conversaFinal && mensagens.lista.some((m) => m.status_envio !== 'FALHOU')) await pausarRobo(supabaseAdmin, conversaFinal.id);
  if (mensagens.erro) return respostaErro(mensagens.erro, 400, { mensagens: mensagens.lista, conversaId: conversaFinal?.id });
  return Response.json({ sucesso: true, mensagens: mensagens.lista, conversaId: conversaFinal?.id });
}

// ---------------------------------------------------------------- LER
async function acaoLer(supabaseAdmin, chamador, corpo) {
  const conversa = await carregarConversa(supabaseAdmin, chamador, corpo.conversaId);
  const { data: naoLidas } = await supabaseAdmin.from('atendimento_mensagens')
    .select('id, id_externo').eq('conversa_id', conversa.id).eq('direcao', 'ENTRADA').eq('status_envio', 'NAO_LIDA')
    .order('id', { ascending: false });
  await supabaseAdmin.from('atendimento_conversas').update({ nao_lidas: 0 }).eq('id', conversa.id);
  if (!naoLidas?.length) return Response.json({ sucesso: true });
  await supabaseAdmin.from('atendimento_mensagens').update({ status_envio: 'LIDA' }).in('id', naoLidas.map((m) => m.id));

  // Avisa o canal (melhor esforço: se falhar, não atrapalha)
  try {
    const { data: canal } = await supabaseAdmin.from('atendimento_canais').select('*').eq('id', conversa.canal_id).maybeSingle();
    if (canal?.ativo && canal.tipo === 'WHATSAPP' && naoLidas[0].id_externo) {
      const token = await tokenDoCanal(supabaseAdmin, canal);
      await marcarComoLida({ token, canal, idExterno: naoLidas[0].id_externo });
    }
    if (canal?.ativo && canal.tipo === 'EMAIL') {
      const token = await tokenDaCaixa(supabaseAdmin, canal);
      await marcarFioComoLido(token, conversa.chave_externa);
    }
  } catch (e) { /* segue */ }
  return Response.json({ sucesso: true });
}

// ---------------------------------------------------------------- UPLOAD
async function acaoUpload(supabaseAdmin, chamador, corpo) {
  const tamanho = Number(corpo.tamanho) || 0;
  if (tamanho <= 0) return respostaErro('Arquivo vazio.');
  if (tamanho > 100 * 1024 * 1024) return respostaErro('Arquivo grande demais (máximo 100 MB).');
  const caminho = caminhoAnexo(hotelPermitido(chamador, corpo.hotelId), corpo.nome);
  const { data, error } = await supabaseAdmin.storage.from(PASTA_ANEXOS).createSignedUploadUrl(caminho);
  if (error) {
    return respostaErro(/not found|bucket/i.test(error.message)
      ? 'A pasta de anexos ainda não existe no Supabase (falta rodar o SQL da Caixa de Entrada).'
      : 'Não foi possível preparar o envio do arquivo: ' + error.message);
  }
  return Response.json({ caminho, token: data.token, pasta: PASTA_ANEXOS });
}

// ---------------------------------------------------------------- ANEXO
async function acaoAnexo(supabaseAdmin, chamador, corpo) {
  const { data: mensagem } = await supabaseAdmin.from('atendimento_mensagens')
    .select('*').eq('id', corpo.mensagemId).in('hotel_id', chamador.hoteis).maybeSingle();
  if (!mensagem) return respostaErro('Mensagem não encontrada.', 404);
  const anexos = Array.isArray(mensagem.anexos) ? [...mensagem.anexos] : [];
  const indice = Number(corpo.indice) || 0;
  const anexo = anexos[indice];
  if (!anexo) return respostaErro('Anexo não encontrado.', 404);

  // Ainda não está guardado: busca no Gmail ou no WhatsApp e guarda
  if (!anexo.caminho) {
    const { data: conversa } = await supabaseAdmin.from('atendimento_conversas').select('canal_id').eq('id', mensagem.conversa_id).maybeSingle();
    const { data: canal } = await supabaseAdmin.from('atendimento_canais').select('*').eq('id', conversa?.canal_id).maybeSingle();
    if (!canal) return respostaErro('O canal desta conversa não existe mais.');
    let dados;
    let mime = anexo.mime;
    if (anexo.gmail?.attachmentId) {
      const token = await tokenDaCaixa(supabaseAdmin, canal);
      dados = await baixarAnexoGmail(token, anexo.gmail);
    } else if (anexo.mediaId) {
      const token = await tokenDoCanal(supabaseAdmin, canal);
      const baixado = await baixarMidia(token, anexo.mediaId);
      dados = baixado.dados;
      mime = baixado.mime || mime;
    } else {
      return respostaErro(anexo.erro || 'Este anexo não está disponível.');
    }
    const caminho = await guardarAnexo(supabaseAdmin, mensagem.hotel_id, { nome: anexo.nome, mime, dados });
    anexos[indice] = { ...anexo, caminho, mime, tamanho: dados.length, erro: undefined };
    await supabaseAdmin.from('atendimento_mensagens').update({ anexos }).eq('id', mensagem.id);
    anexo.caminho = caminho;
    anexo.mime = mime;
  }

  const { data, error } = await supabaseAdmin.storage.from(PASTA_ANEXOS)
    .createSignedUrl(anexo.caminho, 600, corpo.baixar ? { download: anexo.nome || true } : undefined);
  if (error) return respostaErro('Não foi possível abrir o anexo: ' + error.message);
  return Response.json({ url: data.signedUrl, nome: anexo.nome, mime: anexo.mime });
}

// ---------------------------------------------------------------- MODELOS
async function acaoModelos(supabaseAdmin, chamador, corpo) {
  const canal = await carregarCanal(supabaseAdmin, chamador, corpo.canalId);
  if (canal.tipo !== 'WHATSAPP') return respostaErro('Modelos só existem no WhatsApp.');
  if (!canal.config?.wabaId) return respostaErro('Falta o "ID da conta do WhatsApp Business" na configuração do canal.');
  const token = await tokenDoCanal(supabaseAdmin, canal);
  return Response.json({ modelos: await listarModelos({ token, wabaId: canal.config.wabaId }) });
}

// Tela de modelos (ADMIN): todos, inclusive em análise e recusados
async function canalDoAdmin(supabaseAdmin, chamador, canalId) {
  const canal = await carregarCanal(supabaseAdmin, chamador, canalId);
  hotelDoAdmin(chamador, canal.hotel_id);
  if (canal.tipo !== 'WHATSAPP') throw Object.assign(new Error('Modelos só existem no WhatsApp.'), { codigo: 'DADO' });
  if (!canal.config?.wabaId) throw Object.assign(new Error('Falta o "ID da conta do WhatsApp Business" na configuração do número (aba Canais).'), { codigo: 'DADO' });
  return canal;
}

async function acaoWhatsappModelos(supabaseAdmin, chamador, corpo) {
  const canal = await canalDoAdmin(supabaseAdmin, chamador, corpo.canalId);
  const token = await tokenDoCanal(supabaseAdmin, canal);
  const modelos = await listarModelos({ token, wabaId: canal.config.wabaId, todos: true });
  // Onde cada modelo está sendo usado (automações ligadas e campanhas que ainda vão sair)
  const { data: aut } = await supabaseAdmin.from('atendimento_automacoes').select('tipo, modelo_nome, ativo').eq('hotel_id', canal.hotel_id).eq('ativo', true);
  const { data: camp } = await supabaseAdmin.from('atendimento_campanhas').select('nome, modelo_nome, situacao').eq('canal_id', canal.id).in('situacao', ['AGENDADA', 'ENVIANDO', 'PAUSADA']);
  return Response.json({
    modelos: modelos.map((m) => ({
      ...m,
      usoAutomacoes: (aut || []).filter((a) => a.modelo_nome === m.nome).map((a) => a.tipo),
      usoCampanhas: (camp || []).filter((c) => c.modelo_nome === m.nome).map((c) => c.nome),
    })),
  });
}

async function acaoModeloCriar(supabaseAdmin, chamador, corpo) {
  const canal = await canalDoAdmin(supabaseAdmin, chamador, corpo.canalId);
  const m = corpo.modelo || {};
  const erros = validarModeloNovo(m);
  if (erros.length) return respostaErro(erros[0]);
  const token = await tokenDoCanal(supabaseAdmin, canal);
  let r;
  try {
    r = await criarModelo({
      token, wabaId: canal.config.wabaId, nome: normalizarNomeModelo(m.nome), idioma: m.idioma, categoria: m.categoria, componentes: montarComponentes(m),
    });
  } catch (e) {
    // "Dado inválido enviado ao WhatsApp: …" fica mais claro como recusa do modelo
    return respostaErro(String(e.message || e).replace(/^Dado inválido enviado ao WhatsApp:\s*/, 'A Meta recusou o modelo: '));
  }
  return Response.json({ sucesso: true, ...r, nome: normalizarNomeModelo(m.nome) });
}

async function acaoModeloExcluir(supabaseAdmin, chamador, corpo) {
  const canal = await canalDoAdmin(supabaseAdmin, chamador, corpo.canalId);
  const nome = String(corpo.nome || '');
  if (!/^[a-z0-9_]{1,512}$/.test(nome)) return respostaErro('Modelo inválido.');
  const { data: aut } = await supabaseAdmin.from('atendimento_automacoes').select('tipo').eq('hotel_id', canal.hotel_id).eq('ativo', true).eq('modelo_nome', nome);
  if (aut?.length) return respostaErro('Este modelo está sendo usado por uma automação ligada. Desligue a automação ou troque o modelo dela antes de excluir.');
  const { data: camp } = await supabaseAdmin.from('atendimento_campanhas').select('nome').eq('canal_id', canal.id).eq('modelo_nome', nome).in('situacao', ['AGENDADA', 'ENVIANDO', 'PAUSADA']);
  if (camp?.length) return respostaErro(`Este modelo está na campanha “${camp[0].nome}”, que ainda não terminou. Cancele a campanha antes de excluir.`);
  const token = await tokenDoCanal(supabaseAdmin, canal);
  await excluirModelo({ token, wabaId: canal.config.wabaId, nome, id: corpo.id || null });
  return Response.json({ sucesso: true });
}

// ---------------------------------------------------------------- CAMPANHAS
async function acaoCampanhas(supabaseAdmin, chamador, corpo) {
  const hotelId = hotelDoAdmin(chamador, corpo.hotelId);
  const { data: campanhas, error } = await supabaseAdmin.from('atendimento_campanhas')
    .select('id, nome, canal_id, modelo_nome, modelo_idioma, modelo_info, situacao, agendada_para, expira_em, iniciada_em, concluida_em, total, custo_estimado, preco_unitario, etiqueta, robo_responde, aviso, criado_por_id, criado_em, publico')
    .eq('hotel_id', hotelId).order('criado_em', { ascending: false }).limit(60);
  if (error) return respostaErro(/atendimento_campanhas|does not exist|schema cache/i.test(error.message) ? 'Falta rodar no Supabase o SQL da Fase 6 (sql/caixa_de_entrada_fase6.sql).' : error.message);
  const ids = (campanhas || []).map((c) => c.id);
  const { data: resumo } = ids.length ? await supabaseAdmin.rpc('atendimento_campanhas_resumo', { p_ids: ids }) : { data: {} };
  const { data: canais } = await supabaseAdmin.from('atendimento_canais').select('id, nome, endereco_exibicao, ativo, config')
    .eq('hotel_id', hotelId).eq('tipo', 'WHATSAPP').order('id');
  const { data: pref } = await supabaseAdmin.from('atendimento_preferencias').select('*').eq('hotel_id', hotelId).maybeSingle();
  return Response.json({
    campanhas: (campanhas || []).map((c) => ({ ...c, resumo: resumo?.[c.id] || null })),
    canais: (canais || []).map((c) => ({ id: c.id, nome: c.nome, numero: c.endereco_exibicao, ativo: c.ativo, temWaba: !!c.config?.wabaId })),
    precos: { marketing: Number(pref?.whatsapp_preco_marketing ?? 0.35), utilidade: Number(pref?.whatsapp_preco_utilidade ?? 0.04) },
  });
}

async function acaoCampanhaEnvios(supabaseAdmin, chamador, corpo) {
  const { data: c } = await supabaseAdmin.from('atendimento_campanhas').select('id, hotel_id').eq('id', Number(corpo.campanhaId)).maybeSingle();
  if (!c) return respostaErro('Campanha não encontrada.');
  hotelDoAdmin(chamador, c.hotel_id);
  let q = supabaseAdmin.from('atendimento_campanha_envios').select('id, telefone, nome, situacao, motivo, enviado_em, saiu_em, conversa_id, mensagem_id')
    .eq('campanha_id', c.id).order('id').limit(1000);
  if (corpo.situacao) q = q.eq('situacao', String(corpo.situacao));
  const { data: envios } = await q;
  const idsMsg = (envios || []).map((e) => e.mensagem_id).filter(Boolean);
  const status = {};
  for (let i = 0; i < idsMsg.length; i += 200) {
    const { data } = await supabaseAdmin.from('atendimento_mensagens').select('id, status_envio, erro').in('id', idsMsg.slice(i, i + 200));
    (data || []).forEach((m) => { status[m.id] = m; });
  }
  return Response.json({
    envios: (envios || []).map((e) => ({ ...e, entrega: status[e.mensagem_id]?.status_envio || null, erroEntrega: status[e.mensagem_id]?.erro || null })),
  });
}

// ---------------------------------------------------------------- SINCRONIZAR
async function sincronizarEmails(supabaseAdmin, hoteis, intervaloMinimo) {
  let consulta = supabaseAdmin.from('atendimento_canais').select('*').eq('tipo', 'EMAIL').eq('ativo', true);
  if (hoteis) consulta = consulta.in('hotel_id', hoteis);
  const { data: canais, error } = await consulta;
  if (error) throw error;
  const agora = Date.now();
  const alvo = (canais || []).filter((c) => !c.ultima_sincronizacao || agora - new Date(c.ultima_sincronizacao).getTime() >= intervaloMinimo);

  // Marca antes de começar, para duas telas abertas não sincronizarem juntas
  if (alvo.length) {
    await supabaseAdmin.from('atendimento_canais').update({ ultima_sincronizacao: new Date().toISOString() }).in('id', alvo.map((c) => c.id));
  }
  const resultados = await Promise.allSettled(alvo.map((c) => sincronizarCaixa(supabaseAdmin, c)));
  let novas = 0;
  const erros = [];
  for (let i = 0; i < resultados.length; i += 1) {
    const r = resultados[i];
    if (r.status === 'fulfilled') { novas += r.value.novas; erros.push(...r.value.erros.map((e) => `${alvo[i].nome}: ${e}`)); }
    else {
      erros.push(`${alvo[i].nome}: ${r.reason?.message}`);
      await supabaseAdmin.from('atendimento_canais').update({ status: 'ERRO', erro: String(r.reason?.message).slice(0, 500) }).eq('id', alvo[i].id);
    }
  }
  return { sucesso: true, caixas: alvo.length, novas, erros };
}

// ---------------------------------------------------------------- CLOUDBEDS
async function acaoCloudbedsBuscar(supabaseAdmin, chamador, corpo) {
  const conversa = corpo.conversaId ? await carregarConversa(supabaseAdmin, chamador, corpo.conversaId) : null;
  let cb;
  try { cb = await conexaoCloudbeds(supabaseAdmin, conversa?.hotel_id || hotelPermitido(chamador, corpo.hotelId)); }
  catch (e) { return respostaErro(e.message); }

  let vinculada = null;
  if (conversa?.cloudbeds_reservation_id && !corpo.busca) {
    try { vinculada = await detalheReserva(cb, conversa.cloudbeds_reservation_id); }
    catch (e) { vinculada = { reservationId: conversa.cloudbeds_reservation_id, erro: e.message }; }
  }
  const ehEmail = conversa?.canal_tipo === 'EMAIL';
  const reservas = vinculada && !corpo.busca ? [] : await procurarReservas(cb, {
    telefone: ehEmail ? null : conversa?.chave_externa,
    email: ehEmail ? conversa?.contato_endereco : null,
    nome: conversa?.contato_nome,
    busca: corpo.busca,
  });
  return Response.json({ vinculada, reservas });
}

async function acaoCloudbedsVincular(supabaseAdmin, chamador, corpo) {
  const conversa = await carregarConversa(supabaseAdmin, chamador, corpo.conversaId);
  const reservationId = corpo.reservationId ? String(corpo.reservationId).slice(0, 40) : null;
  const { error } = await supabaseAdmin.from('atendimento_conversas')
    .update({ cloudbeds_reservation_id: reservationId }).eq('id', conversa.id);
  if (error) throw error;
  await supabaseAdmin.from('atendimento_mensagens').insert({
    hotel_id: conversa.hotel_id, conversa_id: conversa.id, direcao: 'NOTA', tipo: 'sistema', enviado_por_id: chamador.id,
    data_original: new Date().toISOString(),
    texto: reservationId ? `Reserva ${reservationId} da Cloudbeds ligada a esta conversa.` : 'Reserva da Cloudbeds desligada desta conversa.',
  });

  // Reserva atual ou futura ligada à mão também conta como "Reservou"
  if (reservationId) {
    try {
      const cb = await conexaoCloudbeds(supabaseAdmin, conversa.hotel_id);
      const r = await detalheReserva(cb, reservationId);
      const ontem = new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Fortaleza' });
      if (r.status !== 'canceled' && r.status !== 'no_show' && String(r.checkout || '') >= ontem) {
        await supabaseAdmin.rpc('atendimento_marcar_reserva', {
          p_conversa: conversa.id, p_reserva: reservationId, p_valor: r.total,
          p_texto: `🎉 Reservou! Reserva ${reservationId}: ${dataBR(r.checkin)} a ${dataBR(r.checkout)}${r.total ? `, total ${reais(r.total)}` : ''}.`,
        });
      }
    } catch (e) { /* a ligação já foi feita; o "Reservou" é um extra */ }
  }
  return Response.json({ sucesso: true });
}

// ---------------------------------------------------------------- EQUIPE
// Hotéis da pessoa, quem pode atender em cada um (para "Responsável" e o
// filtro "Atendente") e o nome de todos (para mostrar quem enviou cada mensagem).
async function acaoEquipe(supabaseAdmin, chamador) {
  const campos = 'id, nome, papel, hotel_id, auth_id, ativo, pode_acessar_atendimento';
  const [{ data: hoteis }, { data: vinculos }, { data: daqui }] = await Promise.all([
    supabaseAdmin.from('hoteis').select('id, nome_fantasia').in('id', chamador.hoteis),
    supabaseAdmin.from('vinculos_usuario_hotel').select('auth_id, hotel_id, papel').in('hotel_id', chamador.hoteis).eq('ativo', true),
    supabaseAdmin.from('usuarios').select(campos).in('hotel_id', chamador.hoteis),
  ]);
  const porAuth = new Map((daqui || []).map((u) => [u.auth_id, u]));
  const faltam = [...new Set((vinculos || []).map((v) => v.auth_id))].filter((a) => a && !porAuth.has(a));
  if (faltam.length) {
    const { data: outros } = await supabaseAdmin.from('usuarios').select(campos).in('auth_id', faltam);
    (outros || []).forEach((u) => porAuth.set(u.auth_id, u));
  }

  const nomes = {};
  const pessoas = new Map();
  const incluir = (u, hotelId, papel) => {
    if (!u) return;
    nomes[u.id] = u.nome;
    if (u.ativo === false) return;
    if (!(papel === 'ADMIN' || (papel === 'COLABORADOR' && u.pode_acessar_atendimento === true))) return;
    const p = pessoas.get(u.id) || { id: u.id, nome: u.nome || `Usuário #${u.id}`, hoteis: [] };
    if (!p.hoteis.includes(hotelId)) p.hoteis.push(hotelId);
    pessoas.set(u.id, p);
  };
  for (const u of porAuth.values()) if (chamador.hoteis.includes(Number(u.hotel_id))) incluir(u, Number(u.hotel_id), u.papel);
  for (const v of vinculos || []) incluir(porAuth.get(v.auth_id), Number(v.hotel_id), v.papel);

  return Response.json({
    eu: chamador.id,
    hotelAtual: Number(chamador.hotel_id),
    hoteis: (hoteis || []).map((h) => ({ id: Number(h.id), nome: h.nome_fantasia || `Hotel #${h.id}`, souAdmin: chamador.hoteisAdmin.includes(Number(h.id)) }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    pessoas: [...pessoas.values()].sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR')),
    nomes,
  });
}

// ---------------------------------------------------------------- PAINEL
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

async function acaoPainel(supabaseAdmin, chamador, corpo) {
  const pedidos = (Array.isArray(corpo.hoteis) && corpo.hoteis.length ? corpo.hoteis : chamador.hoteis)
    .map(Number).filter((h) => chamador.hoteis.includes(h));
  if (!pedidos.length) return respostaErro('Escolha um hotel.');
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Fortaleza' });
  const fim = DATA_ISO.test(corpo.fim || '') ? corpo.fim : hoje;
  const inicio = DATA_ISO.test(corpo.inicio || '') ? corpo.inicio : `${fim.slice(0, 7)}-01`;
  if (inicio > fim) return respostaErro('A data inicial é depois da final.');
  const meses = (Number(fim.slice(0, 4)) - Number(inicio.slice(0, 4))) * 12 + Number(fim.slice(5, 7)) - Number(inicio.slice(5, 7));
  if (meses > 24) return respostaErro('Escolha um período de até 2 anos.');

  const { data, error } = await supabaseAdmin.rpc('atendimento_painel', { p_hoteis: pedidos, p_inicio: inicio, p_fim: fim });
  if (error) throw error;
  const { data: cotacoes } = await supabaseAdmin.rpc('atendimento_painel_cotacoes', { p_hoteis: pedidos, p_inicio: inicio, p_fim: fim });
  const { data: historico } = await supabaseAdmin.rpc('atendimento_painel_historico', { p_hoteis: pedidos, p_inicio: inicio, p_fim: fim });
  const { data: robo } = await supabaseAdmin.rpc('atendimento_painel_robo', { p_hoteis: pedidos, p_inicio: inicio, p_fim: fim });
  // Custo da IA só para quem é ADMIN de todos os hotéis escolhidos
  const roboFinal = robo && !pedidos.every((h) => chamador.hoteisAdmin.includes(h)) ? { ...robo, custo_usd: null } : (robo ? { ...robo } : null);
  if (roboFinal) {
    // Perguntas que o robô não soube responder no período
    const de = new Date(`${inicio}T03:00:00Z`).toISOString();
    const ate = new Date(new Date(`${fim}T03:00:00Z`).getTime() + 86400000).toISOString();
    const { count, error: erroLacunas } = await supabaseAdmin.from('atendimento_robo_lacunas').select('id', { count: 'exact', head: true })
      .in('hotel_id', pedidos).gte('criado_em', de).lt('criado_em', ate);
    roboFinal.lacunas = erroLacunas ? null : (count ?? 0);
  }
  // Vendas: por atendente, robô, canal, horário e antecedência
  const { data: vendas } = await supabaseAdmin.rpc('atendimento_painel_vendas', { p_hoteis: pedidos, p_inicio: inicio, p_fim: fim });
  // Mensagens e custo do WhatsApp: só dos hotéis em que a pessoa é ADMIN
  const hoteisAdmin = pedidos.filter((h) => chamador.hoteisAdmin.includes(h));
  let whatsapp = null;
  let automacoes = null;
  if (hoteisAdmin.length) {
    const { data: uso } = await supabaseAdmin.rpc('atendimento_whatsapp_uso', { p_hoteis: hoteisAdmin, p_inicio: inicio, p_fim: fim });
    whatsapp = uso || null; // sem o SQL da economia: a seção não aparece
    const { data: aut } = await supabaseAdmin.rpc('atendimento_painel_automacoes', { p_hoteis: hoteisAdmin, p_inicio: inicio, p_fim: fim });
    automacoes = aut || null; // sem o SQL da Fase 5: não aparece
  }
  return Response.json({ painel: { ...data, cotacoes: cotacoes || null, historico: historico || null, robo: roboFinal || null, whatsapp, vendas: vendas || null, automacoes }, inicio, fim });
}

// ---------------------------------------------------------------- IMPORTAR CONTATOS
function textoLimpo(valor, max) {
  const t = String(valor ?? '').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
}

function telefoneImportado(valor) {
  let d = soDigitos(valor).replace(/^0+/, '');
  if (!d) return null;
  if ((d.length === 10 || d.length === 11) && !String(valor).trim().startsWith('+')) d = `55${d}`;
  return d.length >= 8 && d.length <= 15 ? d : null;
}

function emailImportado(valor) {
  const e = String(valor ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e.slice(0, 200) : null;
}

// Aceita "2026-10-23", "2026-10-23T10:15:00Z" e "23/10/2026 10:15"
function dataImportada(valor) {
  const t = String(valor ?? '').trim();
  if (!t) return null;
  const br = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  let d;
  if (br) {
    const ano = br[3].length === 2 ? `20${br[3]}` : br[3];
    d = new Date(`${ano}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}T${(br[4] || '12').padStart(2, '0')}:${br[5] || '00'}:${br[6] || '00'}-03:00`);
  } else {
    d = new Date(t);
  }
  if (Number.isNaN(d.getTime()) || d.getFullYear() < 2000 || d.getTime() > Date.now() + 86400000) return null;
  return d.toISOString();
}

async function acaoImportarContatos(supabaseAdmin, chamador, corpo) {
  const hotelId = hotelPermitido(chamador, corpo.hotelId);
  const linhas = Array.isArray(corpo.linhas) ? corpo.linhas.slice(0, 1000) : [];
  if (!linhas.length) return respostaErro('A planilha não tem contatos.');

  const existentes = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabaseAdmin.from('atendimento_contatos')
      .select('id, nome, telefone, email, idioma, etiquetas_importadas').eq('hotel_id', hotelId).order('id').range(de, de + 999);
    if (error) throw error;
    existentes.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const porTelefone = new Map();
  const porEmail = new Map();
  const registrar = (c) => {
    if (c.telefone) variantesNumero(c.telefone).forEach((v) => porTelefone.set(v, c));
    if (c.email) porEmail.set(String(c.email).toLowerCase(), c);
  };
  existentes.forEach(registrar);

  const novos = [];
  const alterados = new Map();
  let ignorados = 0;
  for (const l of linhas) {
    const telefone = telefoneImportado(l?.telefone);
    const email = emailImportado(l?.email);
    if (!telefone && !email) { ignorados += 1; continue; }
    const nome = textoLimpo(l.nome, 120);
    const idioma = textoLimpo(l.idioma, 20);
    const etiquetas = textoLimpo(l.etiquetas, 500);
    const achado = (telefone && variantesNumero(telefone).map((v) => porTelefone.get(v)).find(Boolean)) || (email && porEmail.get(email));

    if (achado) {
      const mudancas = {};
      if (!achado.nome && nome) mudancas.nome = nome;
      if (!achado.telefone && telefone) mudancas.telefone = telefone;
      if (!achado.email && email) mudancas.email = email;
      if (!achado.idioma && idioma) mudancas.idioma = idioma;
      if (etiquetas && !String(achado.etiquetas_importadas || '').includes(etiquetas)) {
        mudancas.etiquetas_importadas = [achado.etiquetas_importadas, etiquetas].filter(Boolean).join(', ').slice(0, 1000);
      }
      if (Object.keys(mudancas).length) {
        Object.assign(achado, mudancas);
        registrar(achado);
        if (achado.id) alterados.set(achado.id, { ...(alterados.get(achado.id) || {}), ...mudancas });
      }
      continue;
    }

    const criado = dataImportada(l.criado_em) || new Date().toISOString();
    const novo = {
      hotel_id: hotelId, nome, telefone, email, idioma, etiquetas_importadas: etiquetas, origem: 'IMPORTADO',
      observacoes: textoLimpo(l.observacoes, 1000), criado_em: criado, atualizado_em: dataImportada(l.atualizado_em) || criado,
    };
    novos.push(novo);
    registrar(novo);
  }

  for (let i = 0; i < novos.length; i += 500) {
    const { error } = await supabaseAdmin.from('atendimento_contatos').insert(novos.slice(i, i + 500));
    if (error) throw error;
  }
  for (const [id, mudancas] of alterados) {
    const { error } = await supabaseAdmin.from('atendimento_contatos').update(mudancas).eq('id', id);
    if (error) throw error;
  }
  return Response.json({ sucesso: true, novos: novos.length, atualizados: alterados.size, ignorados });
}

// ---------------------------------------------------------------- COTAÇÃO
async function acaoCotacaoBuscar(supabaseAdmin, chamador, corpo) {
  const conversa = await carregarConversa(supabaseAdmin, chamador, corpo.conversaId);
  let cb;
  try { cb = await conexaoCloudbeds(supabaseAdmin, conversa.hotel_id); } catch (e) { return respostaErro(e.message); }
  const resultado = await buscarDisponibilidade(cb, corpo);
  if (!resultado.itens.length) await registrarSemDisponibilidade(supabaseAdmin, { id: chamador.id }, conversa, resultado);
  const motor = await linkDoMotor(supabaseAdmin, cb, conversa.hotel_id);
  const pref = await preferenciasCotacao(supabaseAdmin, conversa.hotel_id);
  const { data: hotel } = await supabaseAdmin.from('hoteis').select('nome_fantasia').eq('id', conversa.hotel_id).maybeSingle();
  return Response.json({
    ...resultado, motor: !!motor, abertura: pref.cotacao_texto_abertura || null, final: pref.cotacao_texto_final || null,
    nomeHotel: hotel?.nome_fantasia || null,
  });
}

async function acaoCotacaoEnviar(supabaseAdmin, chamador, corpo, request) {
  const conversa = await carregarConversa(supabaseAdmin, chamador, corpo.conversaId);
  const canal = await carregarCanal(supabaseAdmin, chamador, conversa.canal_id);
  let cb;
  try { cb = await conexaoCloudbeds(supabaseAdmin, conversa.hotel_id); } catch (e) { return respostaErro(e.message); }
  const r = await enviarCotacao(supabaseAdmin, { id: chamador.id }, { conversa, canal, cb, pedido: corpo, origem: origemDoSite(request) });
  if (r.erro) return respostaErro(r.erro, 400, r.mensagens ? { mensagens: r.mensagens } : {});
  await pausarRobo(supabaseAdmin, conversa.id);
  return Response.json({ sucesso: true, cotacao: r.cotacao, mensagens: r.mensagens });
}

async function acaoMotorDetectar(supabaseAdmin, chamador, corpo) {
  const hotelId = hotelPermitido(chamador, corpo.hotelId);
  if (!chamador.hoteisAdmin.includes(hotelId)) return respostaErro('Só o administrador do hotel pode fazer isso.', 403);
  let cb;
  try { cb = await conexaoCloudbeds(supabaseAdmin, hotelId); } catch (e) { return respostaErro(e.message); }
  const url = await detectarMotor(cb);
  if (!url) {
    return respostaErro('A Cloudbeds não informou o link do motor. Copie o link na Cloudbeds (Configurações → Motor de reservas → link de reserva) e cole no campo.');
  }
  await supabaseAdmin.from('atendimento_preferencias').upsert({ hotel_id: hotelId, motor_url: url }, { onConflict: 'hotel_id' });
  return Response.json({ sucesso: true, url });
}

// ---------------------------------------------------------------- RESERVAS NOVAS
async function verificarReservasTodos(supabaseAdmin, hoteis, forcar) {
  let consulta = supabaseAdmin.from('cloudbeds_credenciais').select('hotel_id');
  if (hoteis) consulta = consulta.in('hotel_id', hoteis);
  const { data: credenciais } = await consulta;
  const resultados = [];
  for (const c of credenciais || []) {
    try {
      resultados.push(await verificarReservasHotel(supabaseAdmin, Number(c.hotel_id), { segredoCripto: process.env.CLOUDBEDS_CRYPTO_SECRET, forcar }));
    } catch (e) {
      resultados.push({ hotelId: c.hotel_id, erro: e.message });
    }
  }
  return resultados;
}

// ---------------------------------------------------------------- HISTÓRICO DO ASKSUITE
async function acaoImportarAsksuite(supabaseAdmin, chamador, corpo) {
  // Importar o histórico apaga a importação anterior: só o administrador
  const hotelId = hotelDoAdmin(chamador, corpo.hotelId);
  const linhas = Array.isArray(corpo.linhas) ? corpo.linhas.slice(0, 400) : [];
  if (!linhas.length) return respostaErro('A planilha não tem conversas.');
  const limpeza = corpo.limpar ? await limparImportacaoAnterior(supabaseAdmin, hotelId) : null;
  const resultado = await importarLote(supabaseAdmin, hotelId, linhas);
  return Response.json({ sucesso: true, ...resultado, limpeza });
}

// ---------------------------------------------------------------- ROBÔ (FASE 4)
// ---------------------------------------------------------------- AUTOMAÇÕES (Fase 5)
async function acaoAutomacoes(supabaseAdmin, chamador, corpo) {
  const hotelId = hotelDoAdmin(chamador, corpo.hotelId);
  const { data: automacoes, error } = await supabaseAdmin.from('atendimento_automacoes').select('*').eq('hotel_id', hotelId);
  if (error) return respostaErro(/atendimento_automacoes|does not exist|schema cache/i.test(error.message) ? 'Falta rodar no Supabase o SQL da Fase 5 (sql/caixa_de_entrada_fase5.sql).' : error.message);
  const { data: canais } = await supabaseAdmin.from('atendimento_canais').select('id, nome, endereco_exibicao, ativo, config')
    .eq('hotel_id', hotelId).eq('tipo', 'WHATSAPP').order('id');
  let consulta = supabaseAdmin.from('atendimento_disparos')
    .select('id, tipo, situacao, motivo, agendado_para, enviado_em, criado_em, conversa_id, telefone, nome, nota, atendimento_conversas(contato_nome, contato_endereco)')
    .eq('hotel_id', hotelId).order('criado_em', { ascending: false }).limit(150);
  if (corpo.tipo) consulta = consulta.eq('tipo', String(corpo.tipo));
  if (corpo.situacao) consulta = consulta.eq('situacao', String(corpo.situacao));
  const { data: disparos } = await consulta;
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Fortaleza' });
  const inicio = new Date(Date.now() - 30 * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Fortaleza' });
  const { data: painel } = await supabaseAdmin.rpc('atendimento_painel_automacoes', { p_hoteis: [hotelId], p_inicio: inicio, p_fim: hoje });
  return Response.json({
    automacoes: automacoes || [],
    canais: (canais || []).map((c) => ({ id: c.id, nome: c.nome, numero: c.endereco_exibicao, ativo: c.ativo, temWaba: !!c.config?.wabaId })),
    disparos: (disparos || []).map((d) => ({
      ...d, cliente: d.nome || d.atendimento_conversas?.contato_nome || null, contato: d.telefone || d.atendimento_conversas?.contato_endereco || null, atendimento_conversas: undefined,
    })),
    painel: painel || null,
  });
}

async function acaoDisparoCancelar(supabaseAdmin, chamador, corpo) {
  const { data: d } = await supabaseAdmin.from('atendimento_disparos').select('id, hotel_id, situacao').eq('id', Number(corpo.disparoId)).maybeSingle();
  if (!d) return respostaErro('Disparo não encontrado.');
  hotelDoAdmin(chamador, d.hotel_id);
  if (d.situacao !== 'AGENDADO') return respostaErro('Só dá para cancelar o que ainda está agendado.');
  await supabaseAdmin.from('atendimento_disparos').update({ situacao: 'CANCELADO', motivo: 'cancelado pela equipe', atualizado_em: new Date().toISOString() }).eq('id', d.id);
  return Response.json({ sucesso: true });
}

function hotelDoAdmin(chamador, hotelId) {
  const h = hotelPermitido(chamador, hotelId);
  if (!chamador.hoteisAdmin.includes(h)) throw Object.assign(new Error('Só o administrador do hotel pode mudar esta configuração.'), { codigo: 'SEM_ACESSO' });
  return h;
}

async function acaoRoboConfig(supabaseAdmin, chamador, corpo) {
  const hotelId = hotelDoAdmin(chamador, corpo.hotelId);
  const c = corpo.config || {};
  const modelo = MODELOS_IA[c.modelo] ? c.modelo : 'claude-haiku-5-5';
  const canais = (Array.isArray(c.canais) ? c.canais : []).filter((t) => CANAIS_ROBO.some((x) => x.tipo === t && x.pronto));
  const horas = Math.trunc(Number(c.horas_retomar));
  const limite = Number(c.limite_mensal_usd);
  const email = String(c.email_solicitacoes || '').trim().toLowerCase();
  if (!(horas >= 1 && horas <= 168)) return respostaErro('“Voltar a responder depois de” tem que ser entre 1 e 168 horas.');
  if (!(limite >= 0 && limite <= 5000)) return respostaErro('O limite de gasto tem que ser entre US$ 0 e US$ 5.000 por mês.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return respostaErro('Confira o e-mail que recebe as solicitações.');

  if (c.ligado) {
    if (!await lerSegredo(supabaseAdmin, hotelId, CHAVE_SEGREDO)) return respostaErro('Para ligar o robô, primeiro guarde a chave da Anthropic.');
    const { data: conteudo } = await supabaseAdmin.from('atendimento_robo_conteudo').select('publicado').eq('hotel_id', hotelId).maybeSingle();
    if (!Array.isArray(conteudo?.publicado) || !conteudo.publicado.length) return respostaErro('Para ligar o robô, primeiro publique o conteúdo do hotel (aba Conteúdo).');
    if (!canais.length) return respostaErro('Marque pelo menos um canal em que o robô vai responder.');
  }
  const registro = {
    hotel_id: hotelId, ligado: !!c.ligado, canais, modelo, horas_retomar: horas, limite_mensal_usd: limite,
    nome_assistente: String(c.nome_assistente || '').trim().slice(0, 40) || null, email_solicitacoes: email || null,
    atualizado_por_id: chamador.id, atualizado_em: new Date().toISOString(),
    ...(typeof c.modo_economico === 'boolean' ? { modo_economico: c.modo_economico } : {}),
  };
  let { data, error } = await supabaseAdmin.from('atendimento_robo').upsert(registro, { onConflict: 'hotel_id' }).select().single();
  if (error && 'modo_economico' in registro && /modo_economico/i.test(error.message || '')) {
    if (registro.modo_economico === false) return respostaErro('Para desligar o modo econômico, primeiro rode no Supabase o SQL da economia (sql/caixa_de_entrada_economia.sql).');
    delete registro.modo_economico; // sem o SQL novo: salva o resto (o robô já fica econômico)
    ({ data, error } = await supabaseAdmin.from('atendimento_robo').upsert(registro, { onConflict: 'hotel_id' }).select().single());
  }
  if (error) throw error;
  return Response.json({ sucesso: true, config: data });
}

async function acaoRoboChave(supabaseAdmin, chamador, corpo) {
  const hotelId = hotelDoAdmin(chamador, corpo.hotelId);
  if (corpo.apagar) {
    await supabaseAdmin.from('atendimento_segredos').delete().eq('hotel_id', hotelId).eq('canal_id', 0).eq('chave', CHAVE_SEGREDO);
    await supabaseAdmin.from('atendimento_robo').upsert({ hotel_id: hotelId, ligado: false, chave_salva_em: null }, { onConflict: 'hotel_id' });
    return Response.json({ sucesso: true });
  }
  const chave = String(corpo.chave || '').trim();
  let usar = chave;
  if (!chave) {
    usar = await lerSegredo(supabaseAdmin, hotelId, CHAVE_SEGREDO);
    if (!usar) return respostaErro('Cole a chave da Anthropic (começa com sk-ant-).');
  } else if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(chave)) {
    return respostaErro('Essa não parece uma chave da Anthropic. Ela começa com “sk-ant-” e é bem comprida. Copie de novo no console da Anthropic.');
  }
  const { data: config } = await supabaseAdmin.from('atendimento_robo').select('modelo').eq('hotel_id', hotelId).maybeSingle();
  try { await testarChave(usar, MODELOS_IA[config?.modelo] ? config.modelo : 'claude-haiku-5-5'); }
  catch (e) { return respostaErro(`A chave não funcionou: ${e.message}`); }
  if (chave) {
    await gravarSegredo(supabaseAdmin, hotelId, CHAVE_SEGREDO, chave);
    await supabaseAdmin.from('atendimento_robo').upsert({ hotel_id: hotelId, chave_salva_em: new Date().toISOString() }, { onConflict: 'hotel_id' });
  }
  return Response.json({ sucesso: true, testada: true });
}

async function acaoRoboInfoHotel(supabaseAdmin, chamador, corpo) {
  const hotelId = hotelDoAdmin(chamador, corpo.hotelId);
  try { return Response.json({ sucesso: true, info: await atualizarInfoHotel(supabaseAdmin, hotelId) }); }
  catch (e) { return respostaErro(e.message); }
}

async function acaoRoboTestar(supabaseAdmin, chamador, corpo, request) {
  const hotelId = hotelDoAdmin(chamador, corpo.hotelId);
  try {
    const r = await testarRobo(supabaseAdmin, hotelId, { mensagens: corpo.mensagens, usarRascunho: !!corpo.usarRascunho, origem: origemDoSite(request) });
    return Response.json({ sucesso: true, ...r });
  } catch (e) { return respostaErro(e.message); }
}
