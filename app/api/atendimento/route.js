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
// Acesso: ADMIN ou COLABORADOR com "Pode usar a Caixa de Entrada" — nos dois
// hotéis, quando a pessoa tem vínculo com os dois.
// ============================================================================

import {
  autenticar, clienteAdmin, respostaErro, erroBanco, chamadaAgendadaValida, lerAnexo, guardarAnexo,
  caminhoAnexo, PASTA_ANEXOS, resumoTexto, hotelPermitido, soDigitos,
} from '../../../lib/atendimento/servidor';
import {
  tokenDoCanal, enviarTexto, enviarArquivo, enviarModelo, marcarComoLida, listarModelos, normalizarNumero,
  obterConversaWhatsApp, formatarNumero, baixarMidia, variantesNumero,
} from '../../../lib/atendimento/whatsapp';
import {
  tokenDaCaixa, sincronizarCaixa, montarEmail, enviarEmail, dadosParaResponder, assuntoDeResposta,
  marcarFioComoLido, baixarAnexoGmail, listaDeEnderecos,
} from '../../../lib/atendimento/gmail';
import { conexaoCloudbeds, procurarReservas, detalheReserva } from '../../../lib/atendimento/cloudbeds';
import {
  buscarDisponibilidade, linkDoMotor, detectarMotor, novoCodigo, textoCotacao, htmlCotacao, limparHtml,
  verificarReservasHotel, reais, dataBR,
} from '../../../lib/atendimento/cotacao';
import { origemDoSite } from '../../../lib/atendimento/servidor';
import { importarLote, limparImportacaoAnterior } from '../../../lib/atendimento/asksuite';

export const dynamic = 'force-dynamic';

const JANELA_WHATSAPP_MS = 24 * 60 * 60 * 1000;
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
      return Response.json({ ...emails, reservas });
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

const metaAnexo = (a) => ({ nome: a.nome, mime: a.mime, tamanho: a.dados.length, caminho: a.caminho });

async function gravarSaida(supabaseAdmin, chamador, conversa, campos) {
  const { data, error } = await supabaseAdmin.from('atendimento_mensagens').insert({
    hotel_id: conversa.hotel_id, conversa_id: conversa.id, direcao: 'SAIDA', enviado_por_id: chamador.id,
    data_original: new Date().toISOString(), ...campos,
  }).select().single();
  if (error) throw error;
  return data;
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

  const mensagens = canal.tipo === 'WHATSAPP'
    ? await enviarWhatsApp(supabaseAdmin, chamador, { canal, conversa, corpo, texto, arquivos })
    : await enviarEmailDaConversa(supabaseAdmin, chamador, { canal, conversa, corpo, texto, arquivos });

  // Quem responde vira o responsável, se a conversa estava sem ninguém
  const conversaFinal = mensagens.conversa;
  if (conversaFinal && !conversaFinal.responsavel_id) {
    await supabaseAdmin.from('atendimento_conversas').update({ responsavel_id: chamador.id }).eq('id', conversaFinal.id);
  }
  if (mensagens.erro) return respostaErro(mensagens.erro, 400, { mensagens: mensagens.lista, conversaId: conversaFinal?.id });
  return Response.json({ sucesso: true, mensagens: mensagens.lista, conversaId: conversaFinal?.id });
}

async function enviarWhatsApp(supabaseAdmin, chamador, { canal, conversa, corpo, texto, arquivos }) {
  const token = await tokenDoCanal(supabaseAdmin, canal);
  const lista = [];
  let para = conversa?.chave_externa;

  // Conversa nova: o WhatsApp só deixa a empresa começar com um modelo aprovado
  if (!conversa) {
    para = normalizarNumero(corpo.para);
    if (para.length < 12) return { lista, erro: 'Informe o número com DDD (ex.: 83 98888-7777).' };
    if (!corpo.modelo?.nome) return { lista, erro: 'Para começar uma conversa no WhatsApp é preciso usar um modelo aprovado.' };
  } else if (!corpo.modelo) {
    const ultimaEntrada = conversa.ultima_entrada_em ? new Date(conversa.ultima_entrada_em).getTime() : 0;
    if (Date.now() - ultimaEntrada > JANELA_WHATSAPP_MS) {
      return { lista, conversa, erro: 'Já passaram mais de 24 horas desde a última mensagem do cliente. Pela regra do WhatsApp, agora só dá para enviar um modelo aprovado (botão "Modelo").' };
    }
  }

  // Modelo (template)
  if (corpo.modelo?.nome) {
    const modelo = {
      nome: String(corpo.modelo.nome), idioma: String(corpo.modelo.idioma || 'pt_BR'),
      variaveisCorpo: (corpo.modelo.variaveisCorpo || []).map((v) => String(v ?? '').trim()),
      variaveisCabecalho: (corpo.modelo.variaveisCabecalho || []).map((v) => String(v ?? '').trim()),
    };
    if ([...modelo.variaveisCorpo, ...modelo.variaveisCabecalho].some((v) => !v)) {
      return { lista, conversa, erro: 'Preencha todas as variáveis do modelo.' };
    }
    let enviado;
    try { enviado = await enviarModelo({ token, canal, para, modelo }); }
    catch (e) {
      if (conversa) lista.push(await gravarSaida(supabaseAdmin, chamador, conversa, { tipo: 'modelo', texto: resumoTexto(corpo.modelo.textoFinal || modelo.nome, 2000), status_envio: 'FALHOU', erro: e.message }));
      return { lista, conversa, erro: e.message };
    }
    if (!conversa) {
      conversa = await obterConversaWhatsApp(supabaseAdmin, canal, enviado.waId || para, String(corpo.nome || '').trim() || null);
    }
    lista.push(await gravarSaida(supabaseAdmin, chamador, conversa, {
      tipo: 'modelo', texto: String(corpo.modelo.textoFinal || `[Modelo: ${modelo.nome}]`).slice(0, 4000),
      para: formatarNumero(para), id_externo: enviado.idExterno, status_envio: 'ENVIADA',
    }));
    return { lista, conversa };
  }

  // Texto e/ou arquivos
  const legendaNoArquivo = arquivos.length === 1 && texto && texto.length <= 1000;
  try {
    if (texto && !legendaNoArquivo) {
      const r = await enviarTexto({ token, canal, para, texto, previa: !corpo.semPrevia });
      lista.push(await gravarSaida(supabaseAdmin, chamador, conversa, { tipo: 'texto', texto, id_externo: r.idExterno, status_envio: 'ENVIADA' }));
    }
    for (const arquivo of arquivos) {
      const legenda = legendaNoArquivo ? texto : null;
      const r = await enviarArquivo({ token, canal, para, arquivo, legenda });
      const nomeTipo = { image: 'imagem', video: 'video', audio: 'audio', document: 'documento' }[r.tipo];
      lista.push(await gravarSaida(supabaseAdmin, chamador, conversa, {
        tipo: nomeTipo, texto: legenda, anexos: [metaAnexo(arquivo)], id_externo: r.idExterno, status_envio: 'ENVIADA',
      }));
    }
  } catch (e) {
    lista.push(await gravarSaida(supabaseAdmin, chamador, conversa, {
      tipo: arquivos.length ? 'documento' : 'texto', texto: texto || null, anexos: arquivos.map(metaAnexo), status_envio: 'FALHOU', erro: e.message,
    }));
    return { lista, conversa, erro: e.message };
  }
  return { lista, conversa };
}

async function enviarEmailDaConversa(supabaseAdmin, chamador, { canal, conversa, corpo, texto, arquivos }) {
  const token = await tokenDaCaixa(supabaseAdmin, canal);
  const lista = [];
  const cc = listaDeEnderecos(corpo.cc).join(', ');

  let para;
  let assunto;
  let threadId = null;
  let emResposta = null;
  let referencias = null;
  if (conversa) {
    para = conversa.contato_endereco;
    threadId = conversa.chave_externa;
    const dados = await dadosParaResponder(token, threadId).catch(() => ({}));
    emResposta = dados.emResposta || null;
    referencias = dados.referencias || null;
    assunto = assuntoDeResposta(dados.assunto || conversa.assunto);
  } else {
    para = listaDeEnderecos(corpo.para)[0];
    assunto = String(corpo.assunto || '').trim();
    if (!para) return { lista, erro: 'Informe um e-mail válido para o destinatário.' };
    if (!assunto) return { lista, erro: 'Informe o assunto do e-mail.' };
  }
  const htmlCorpo = corpo.html ? limparHtml(corpo.html) : null;
  if (!texto && !htmlCorpo) return { lista, conversa, erro: 'Escreva o texto do e-mail.' };

  const { mime, html } = montarEmail({
    de: canal.identificador, nomeRemetente: canal.config?.nomeExibicao || canal.nome, para, cc, assunto, texto, html: htmlCorpo,
    assinaturaHtml: canal.config?.usarAssinatura === false ? null : canal.config?.assinatura || null,
    emResposta, referencias, anexos: arquivos,
  });

  let enviado;
  try { enviado = await enviarEmail({ token, threadId, mime }); }
  catch (e) {
    if (conversa) {
      lista.push(await gravarSaida(supabaseAdmin, chamador, conversa, {
        tipo: 'email', texto: texto || null, html: htmlCorpo, para, cc: cc || null, assunto, anexos: arquivos.map(metaAnexo), status_envio: 'FALHOU', erro: e.message,
      }));
    }
    return { lista, conversa, erro: e.message };
  }

  if (!conversa) {
    const { data: nova, error } = await supabaseAdmin.from('atendimento_conversas').insert({
      hotel_id: canal.hotel_id, canal_id: canal.id, canal_tipo: 'EMAIL', chave_externa: enviado.threadId,
      contato_nome: String(corpo.nome || '').trim() || null, contato_endereco: para, assunto, status: 'ABERTA',
    }).select().single();
    if (error) throw error;
    conversa = nova;
  }
  lista.push(await gravarSaida(supabaseAdmin, chamador, conversa, {
    tipo: 'email', texto: texto || null, html, de: canal.identificador, para, cc: cc || null, assunto,
    anexos: arquivos.map(metaAnexo), id_externo: `gmail:${enviado.id}`, status_envio: 'ENVIADA',
  }));
  return { lista, conversa };
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
  return Response.json({ painel: { ...data, cotacoes: cotacoes || null, historico: historico || null }, inicio, fim });
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
async function preferenciasCotacao(supabaseAdmin, hotelId) {
  const { data } = await supabaseAdmin.from('atendimento_preferencias')
    .select('cotacao_texto_abertura, cotacao_texto_final').eq('hotel_id', hotelId).maybeSingle();
  return data || {};
}

async function acaoCotacaoBuscar(supabaseAdmin, chamador, corpo) {
  const conversa = await carregarConversa(supabaseAdmin, chamador, corpo.conversaId);
  let cb;
  try { cb = await conexaoCloudbeds(supabaseAdmin, conversa.hotel_id); } catch (e) { return respostaErro(e.message); }
  const resultado = await buscarDisponibilidade(cb, corpo);
  if (!resultado.itens.length) await registrarSemDisponibilidade(supabaseAdmin, chamador, conversa, resultado);
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

  // Preço buscado de novo aqui (é sempre o preço do motor, sem alteração)
  const resultado = await buscarDisponibilidade(cb, corpo);
  const escolhidos = Array.isArray(corpo.tipos) ? corpo.tipos.map(String) : [];
  const itens = resultado.itens.filter((i) => !escolhidos.length || escolhidos.includes(i.tipoId)).slice(0, 8);
  if (!itens.length) return respostaErro('Os quartos escolhidos não estão mais disponíveis para essas datas. Busque de novo.');

  const motor = await linkDoMotor(supabaseAdmin, cb, conversa.hotel_id);
  if (!motor) {
    return respostaErro('Falta o link do motor de reservas. O administrador coloca em Caixa de Entrada → Funil e etiquetas → Motor de reservas e cotação.');
  }

  const pref = await preferenciasCotacao(supabaseAdmin, conversa.hotel_id);
  const { data: hotel } = await supabaseAdmin.from('hoteis').select('nome_fantasia').eq('id', conversa.hotel_id).maybeSingle();
  const codigo = novoCodigo();
  const origem = origemDoSite(request);
  const links = itens.map((_, n) => `${origem}/r/${codigo}-${n + 1}`);
  const dados = {
    cot: resultado, itens, links,
    abertura: String(corpo.abertura || '').trim() || pref.cotacao_texto_abertura,
    final: String(corpo.final || '').trim() || pref.cotacao_texto_final,
    nomeCliente: conversa.contato_nome, nomeHotel: hotel?.nome_fantasia,
  };
  const texto = textoCotacao(dados);
  const valores = itens.map((i) => i.total);

  // A cotação é gravada antes do envio: o link já tem que funcionar quando chegar
  const { data: cotacao, error } = await supabaseAdmin.from('atendimento_cotacoes').insert({
    hotel_id: conversa.hotel_id, conversa_id: conversa.id, contato_id: conversa.contato_id, codigo,
    checkin: resultado.checkin, checkout: resultado.checkout, adultos: resultado.adultos, criancas: resultado.criancas, quartos: resultado.quartos,
    itens: itens.map(({ tipoId, nome, abreviacao, total, porNoite, disponiveis, foto }) => ({ tipoId, nome, abreviacao, total, porNoite, disponiveis, foto })),
    valor_minimo: Math.min(...valores), valor_maximo: Math.max(...valores), mensagem: texto, canal_tipo: canal.tipo, enviado_por_id: chamador.id,
  }).select().single();
  if (error) throw error;

  const envio = canal.tipo === 'WHATSAPP'
    ? await enviarWhatsApp(supabaseAdmin, chamador, { canal, conversa, corpo: { semPrevia: true }, texto, arquivos: [] })
    : await enviarEmailDaConversa(supabaseAdmin, chamador, { canal, conversa, corpo: { html: htmlCotacao(dados) }, texto, arquivos: [] });
  if (envio.erro) {
    await supabaseAdmin.from('atendimento_cotacoes').update({ status: 'CANCELADA' }).eq('id', cotacao.id);
    return respostaErro(envio.erro, 400, { mensagens: envio.lista });
  }

  await supabaseAdmin.from('atendimento_conversas').update({
    valor_cotacao: Math.min(...valores), ...(conversa.responsavel_id ? {} : { responsavel_id: chamador.id }),
  }).eq('id', conversa.id);
  await supabaseAdmin.rpc('atendimento_avancar_etapa', { p_conversa: conversa.id, p_nome: 'Cotação' });
  return Response.json({ sucesso: true, cotacao, mensagens: envio.lista });
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

// Pedido de cotação sem quarto disponível: fica registrado (demanda perdida)
async function registrarSemDisponibilidade(supabaseAdmin, chamador, conversa, r) {
  try {
    const { data: repetido } = await supabaseAdmin.from('atendimento_cotacoes').select('id')
      .eq('conversa_id', conversa.id).eq('status', 'SEM_DISPONIBILIDADE').eq('checkin', r.checkin).eq('checkout', r.checkout)
      .eq('adultos', r.adultos).gte('criado_em', new Date(Date.now() - 86400000).toISOString()).limit(1);
    if (repetido?.length) return;
    const { error } = await supabaseAdmin.from('atendimento_cotacoes').insert({
      hotel_id: conversa.hotel_id, conversa_id: conversa.id, contato_id: conversa.contato_id, codigo: novoCodigo(),
      checkin: r.checkin, checkout: r.checkout, adultos: r.adultos, criancas: r.criancas, quartos: r.quartos,
      itens: [], status: 'SEM_DISPONIBILIDADE', enviado_por_id: chamador.id,
    });
    if (error) return;
    await supabaseAdmin.rpc('atendimento_adicionar_etiqueta', { p_conversa: conversa.id, p_nome: 'Indisponibilidade na cotação' });
    await supabaseAdmin.from('atendimento_mensagens').insert({
      hotel_id: conversa.hotel_id, conversa_id: conversa.id, direcao: 'NOTA', tipo: 'sistema', enviado_por_id: chamador.id,
      data_original: new Date().toISOString(),
      texto: `🔎 Sem quarto disponível para ${dataBR(r.checkin)} a ${dataBR(r.checkout)} (${r.adultos} adulto(s)${r.criancas ? `, ${r.criancas} criança(s)` : ''}). Ficou registrado como demanda perdida.`,
    });
  } catch (e) { /* o registro é um extra; a busca continua */ }
}

// ---------------------------------------------------------------- HISTÓRICO DO ASKSUITE
async function acaoImportarAsksuite(supabaseAdmin, chamador, corpo) {
  const hotelId = hotelPermitido(chamador, corpo.hotelId);
  const linhas = Array.isArray(corpo.linhas) ? corpo.linhas.slice(0, 400) : [];
  if (!linhas.length) return respostaErro('A planilha não tem conversas.');
  const limpeza = corpo.limpar ? await limparImportacaoAnterior(supabaseAdmin, hotelId) : null;
  const resultado = await importarLote(supabaseAdmin, hotelId, linhas);
  return Response.json({ sucesso: true, ...resultado, limpeza });
}
