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
// Acesso: ADMIN ou COLABORADOR com "Pode usar a Caixa de Entrada".
// ============================================================================

import {
  autenticar, clienteAdmin, respostaErro, erroBanco, chamadaAgendadaValida, lerAnexo, guardarAnexo,
  caminhoAnexo, PASTA_ANEXOS, resumoTexto,
} from '../../../lib/atendimento/servidor';
import {
  tokenDoCanal, enviarTexto, enviarArquivo, enviarModelo, marcarComoLida, listarModelos, normalizarNumero,
  obterConversaWhatsApp, formatarNumero, baixarMidia,
} from '../../../lib/atendimento/whatsapp';
import {
  tokenDaCaixa, sincronizarCaixa, montarEmail, enviarEmail, dadosParaResponder, assuntoDeResposta,
  marcarFioComoLido, baixarAnexoGmail, listaDeEnderecos,
} from '../../../lib/atendimento/gmail';
import { conexaoCloudbeds, procurarReservas, detalheReserva } from '../../../lib/atendimento/cloudbeds';

export const dynamic = 'force-dynamic';

const JANELA_WHATSAPP_MS = 24 * 60 * 60 * 1000;
const LIMITE_ANEXOS_MB = { WHATSAPP: 100, EMAIL: 25 };
const INTERVALO_MINIMO_SINCRONIZACAO_MS = 30 * 1000;

export async function POST(request) {
  let corpo;
  try { corpo = await request.json(); } catch (e) { return respostaErro('Pedido inválido.'); }

  // Chamada da função agendada da Netlify (sem usuário)
  if (corpo?.acao === 'sincronizar' && chamadaAgendadaValida(request)) {
    try { return Response.json(await sincronizarEmails(clienteAdmin(), null, 60 * 1000)); }
    catch (e) { return respostaErro(e.message, 500); }
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
        return Response.json(await sincronizarEmails(supabaseAdmin, chamador.hotel_id, corpo.forcar ? 5000 : INTERVALO_MINIMO_SINCRONIZACAO_MS));
      case 'cloudbeds_buscar': return await acaoCloudbedsBuscar(supabaseAdmin, chamador, corpo);
      case 'cloudbeds_vincular': return await acaoCloudbedsVincular(supabaseAdmin, chamador, corpo);
      default: return respostaErro('Ação desconhecida.');
    }
  } catch (e) {
    return respostaErro(erroBanco(e, 'Não foi possível concluir'));
  }
}

// ---------------------------------------------------------------------------
async function carregarConversa(supabaseAdmin, chamador, conversaId) {
  const { data: conversa, error } = await supabaseAdmin.from('atendimento_conversas')
    .select('*').eq('id', conversaId).eq('hotel_id', chamador.hotel_id).maybeSingle();
  if (error) throw error;
  if (!conversa) throw new Error('Conversa não encontrada.');
  return conversa;
}

async function carregarCanal(supabaseAdmin, chamador, canalId) {
  const { data: canal, error } = await supabaseAdmin.from('atendimento_canais')
    .select('*').eq('id', canalId).eq('hotel_id', chamador.hotel_id).maybeSingle();
  if (error) throw error;
  if (!canal) throw new Error('Canal não encontrado.');
  if (!canal.ativo) throw new Error(`O canal "${canal.nome}" está desligado. O administrador pode ligá-lo em Canais.`);
  return canal;
}

async function lerAnexosEnviados(supabaseAdmin, chamador, anexos, tipoCanal) {
  const lista = Array.isArray(anexos) ? anexos.slice(0, 10) : [];
  const arquivos = [];
  let total = 0;
  for (const a of lista) {
    if (!a?.caminho || !String(a.caminho).startsWith(`${chamador.hotel_id}/`)) throw new Error('Anexo inválido.');
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
    hotel_id: chamador.hotel_id, conversa_id: conversa.id, direcao: 'SAIDA', enviado_por_id: chamador.id,
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
      hotel_id: chamador.hotel_id, conversa_id: conversa.id, direcao: 'NOTA', tipo: 'nota', texto, enviado_por_id: chamador.id,
      data_original: new Date().toISOString(),
    }).select().single();
    if (error) throw error;
    return Response.json({ sucesso: true, mensagens: [data] });
  }

  const arquivos = await lerAnexosEnviados(supabaseAdmin, chamador, corpo.anexos, canal.tipo);
  if (!texto && !arquivos.length && !corpo.modelo) return respostaErro('Escreva a mensagem ou escolha um anexo.');

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
      const r = await enviarTexto({ token, canal, para, texto });
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
  if (!texto) return { lista, conversa, erro: 'Escreva o texto do e-mail.' };

  const { mime, html } = montarEmail({
    de: canal.identificador, nomeRemetente: canal.config?.nomeExibicao || canal.nome, para, cc, assunto, texto,
    assinaturaHtml: canal.config?.usarAssinatura === false ? null : canal.config?.assinatura || null,
    emResposta, referencias, anexos: arquivos,
  });

  let enviado;
  try { enviado = await enviarEmail({ token, threadId, mime }); }
  catch (e) {
    if (conversa) {
      lista.push(await gravarSaida(supabaseAdmin, chamador, conversa, {
        tipo: 'email', texto, para, cc: cc || null, assunto, anexos: arquivos.map(metaAnexo), status_envio: 'FALHOU', erro: e.message,
      }));
    }
    return { lista, conversa, erro: e.message };
  }

  if (!conversa) {
    const { data: nova, error } = await supabaseAdmin.from('atendimento_conversas').insert({
      hotel_id: chamador.hotel_id, canal_id: canal.id, canal_tipo: 'EMAIL', chave_externa: enviado.threadId,
      contato_nome: String(corpo.nome || '').trim() || null, contato_endereco: para, assunto, status: 'ABERTA',
    }).select().single();
    if (error) throw error;
    conversa = nova;
  }
  lista.push(await gravarSaida(supabaseAdmin, chamador, conversa, {
    tipo: 'email', texto, html, de: canal.identificador, para, cc: cc || null, assunto,
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
  const caminho = caminhoAnexo(chamador.hotel_id, corpo.nome);
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
    .select('*').eq('id', corpo.mensagemId).eq('hotel_id', chamador.hotel_id).maybeSingle();
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
    const caminho = await guardarAnexo(supabaseAdmin, chamador.hotel_id, { nome: anexo.nome, mime, dados });
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
async function sincronizarEmails(supabaseAdmin, hotelId, intervaloMinimo) {
  let consulta = supabaseAdmin.from('atendimento_canais').select('*').eq('tipo', 'EMAIL').eq('ativo', true);
  if (hotelId) consulta = consulta.eq('hotel_id', hotelId);
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
  let cb;
  try { cb = await conexaoCloudbeds(supabaseAdmin, chamador.hotel_id); }
  catch (e) { return respostaErro(e.message); }
  const conversa = corpo.conversaId ? await carregarConversa(supabaseAdmin, chamador, corpo.conversaId) : null;

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
    hotel_id: chamador.hotel_id, conversa_id: conversa.id, direcao: 'NOTA', tipo: 'sistema', enviado_por_id: chamador.id,
    data_original: new Date().toISOString(),
    texto: reservationId ? `Reserva ${reservationId} da Cloudbeds ligada a esta conversa.` : 'Reserva da Cloudbeds desligada desta conversa.',
  });
  return Response.json({ sucesso: true });
}
