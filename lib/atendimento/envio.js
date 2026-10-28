// ============================================================================
// CAIXA DE ENTRADA — ENVIO de mensagens e cotações (só usado no servidor)
// ============================================================================
// Usado pela tela (pessoa da equipe) e pelo robô (Fase 4). "autor" diz quem
// está enviando:
//   { id: 12 }            → pessoa da equipe (usuarios.id)
//   { id: null, robo: true } → robô (a mensagem fica marcada como do robô)
// ============================================================================

import { resumoTexto } from './servidor';
import {
  tokenDoCanal, enviarTexto, enviarArquivo, enviarModelo, enviarBotaoLink, normalizarNumero, obterConversaWhatsApp, formatarNumero,
  LIMITE_TEXTO_BOTAO,
} from './whatsapp';
import { tokenDaCaixa, montarEmail, enviarEmail, dadosParaResponder, assuntoDeResposta, listaDeEnderecos } from './gmail';
import {
  buscarDisponibilidade, linkDoMotor, novoCodigo, textoCotacao, htmlCotacao, limparHtml, dataBR,
} from './cotacao';
import { ABERTURA_OUTRO_HOTEL, ABERTURA_OUTRO_HOTEL_ROBO } from './cotacaoTexto';

const JANELA_WHATSAPP_MS = 24 * 60 * 60 * 1000;

export const metaAnexo = (a) => ({ nome: a.nome, mime: a.mime, tamanho: a.dados.length, caminho: a.caminho });

function camposAutor(autor) {
  return { enviado_por_id: autor?.id || null, ...(autor?.robo ? { enviado_pelo_robo: true } : {}) };
}

export async function gravarSaida(supabaseAdmin, autor, conversa, campos) {
  const { data, error } = await supabaseAdmin.from('atendimento_mensagens').insert({
    hotel_id: conversa.hotel_id, conversa_id: conversa.id, direcao: 'SAIDA', ...camposAutor(autor),
    data_original: new Date().toISOString(), ...campos,
  }).select().single();
  if (error) throw error;
  return data;
}

export async function gravarNota(supabaseAdmin, autor, conversa, texto, tipo = 'sistema') {
  await supabaseAdmin.from('atendimento_mensagens').insert({
    hotel_id: conversa.hotel_id, conversa_id: conversa.id, direcao: 'NOTA', tipo, texto, ...camposAutor(autor),
    data_original: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------- WHATSAPP
// corpo: { para, nome, modelo, semPrevia } (como vem da tela)
// botao: { texto, url } — só o servidor usa (cotação com "Reservar agora")
export async function enviarWhatsApp(supabaseAdmin, autor, { canal, conversa, corpo = {}, texto, arquivos = [], botao = null }) {
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
      nomesCorpo: Array.isArray(corpo.modelo.nomesCorpo) ? corpo.modelo.nomesCorpo.map(String) : null,
      nomesCabecalho: Array.isArray(corpo.modelo.nomesCabecalho) ? corpo.modelo.nomesCabecalho.map(String) : null,
      variaveisBotao: (Array.isArray(corpo.modelo.variaveisBotao) ? corpo.modelo.variaveisBotao : [])
        .map((b) => ({ indice: Math.trunc(Number(b?.indice)) || 0, texto: String(b?.texto ?? '').trim() })),
    };
    if ([...modelo.variaveisCorpo, ...modelo.variaveisCabecalho, ...modelo.variaveisBotao.map((b) => b.texto)].some((v) => !v)) {
      return { lista, conversa, erro: 'Preencha todas as variáveis do modelo.' };
    }
    let enviado;
    try { enviado = await enviarModelo({ token, canal, para, modelo }); }
    catch (e) {
      if (conversa) lista.push(await gravarSaida(supabaseAdmin, autor, conversa, { tipo: 'modelo', texto: resumoTexto(corpo.modelo.textoFinal || modelo.nome, 2000), status_envio: 'FALHOU', erro: e.message }));
      return { lista, conversa, erro: e.message, codigo: e.codigo || null };
    }
    if (!conversa) {
      conversa = await obterConversaWhatsApp(supabaseAdmin, canal, enviado.waId || para, String(corpo.nome || '').trim() || null);
    }
    lista.push(await gravarSaida(supabaseAdmin, autor, conversa, {
      tipo: 'modelo', texto: String(corpo.modelo.textoFinal || `[Modelo: ${modelo.nome}]`).slice(0, 4000),
      para: formatarNumero(para), id_externo: enviado.idExterno, status_envio: 'ENVIADA',
    }));
    return { lista, conversa };
  }

  // Texto com botão de link (uma mensagem só). Se o WhatsApp recusar, vai como texto.
  if (botao?.url && texto && !arquivos.length && texto.length <= LIMITE_TEXTO_BOTAO) {
    try {
      const r = await enviarBotaoLink({ token, canal, para, texto, botao });
      lista.push(await gravarSaida(supabaseAdmin, autor, conversa, {
        tipo: 'texto', texto: `${texto}\n\n🔘 ${botao.texto || 'Reservar agora'}: ${botao.url}`, id_externo: r.idExterno, status_envio: 'ENVIADA',
      }));
      return { lista, conversa };
    } catch (e) { /* segue como texto simples */ }
  }

  // Texto e/ou arquivos
  const legendaNoArquivo = arquivos.length === 1 && texto && texto.length <= 1000;
  try {
    if (texto && !legendaNoArquivo) {
      const r = await enviarTexto({ token, canal, para, texto, previa: !corpo.semPrevia });
      lista.push(await gravarSaida(supabaseAdmin, autor, conversa, { tipo: 'texto', texto, id_externo: r.idExterno, status_envio: 'ENVIADA' }));
    }
    for (const arquivo of arquivos) {
      const legenda = legendaNoArquivo ? texto : null;
      const r = await enviarArquivo({ token, canal, para, arquivo, legenda });
      const nomeTipo = { image: 'imagem', video: 'video', audio: 'audio', document: 'documento' }[r.tipo];
      lista.push(await gravarSaida(supabaseAdmin, autor, conversa, {
        tipo: nomeTipo, texto: legenda, anexos: [metaAnexo(arquivo)], id_externo: r.idExterno, status_envio: 'ENVIADA',
      }));
    }
  } catch (e) {
    lista.push(await gravarSaida(supabaseAdmin, autor, conversa, {
      tipo: arquivos.length ? 'documento' : 'texto', texto: texto || null, anexos: arquivos.map(metaAnexo), status_envio: 'FALHOU', erro: e.message,
    }));
    return { lista, conversa, erro: e.message };
  }
  return { lista, conversa };
}

// ---------------------------------------------------------------- CHAT DO SITE
// A mensagem fica guardada e a janela do chat no site busca (a cada poucos
// segundos). "ENVIADA" = esperando o visitante; vira "ENTREGUE"/"VISTA" quando
// a janela recebe. Por enquanto só texto.
export async function enviarSite(supabaseAdmin, autor, { conversa, texto, arquivos = [] }) {
  const lista = [];
  if (!conversa) return { lista, erro: 'No chat do site só dá para responder quem escreveu pelo site.' };
  if (arquivos.length) return { lista, conversa, erro: 'No chat do site, por enquanto, só dá para mandar texto. Envie o arquivo por WhatsApp ou e-mail.' };
  const t = String(texto || '').trim();
  if (!t) return { lista, conversa, erro: 'Escreva a mensagem.' };
  lista.push(await gravarSaida(supabaseAdmin, autor, conversa, { tipo: 'texto', texto: t.slice(0, 4000), status_envio: 'ENVIADA' }));
  return { lista, conversa };
}

// Envia pelo canal da conversa (WhatsApp, chat do site ou e-mail)
export async function enviarPelaConversa(supabaseAdmin, autor, { canal, conversa, corpo = {}, texto, arquivos = [], botao = null }) {
  if (canal.tipo === 'WHATSAPP') return enviarWhatsApp(supabaseAdmin, autor, { canal, conversa, corpo, texto, arquivos, botao });
  if (canal.tipo === 'SITE') return enviarSite(supabaseAdmin, autor, { conversa, texto, arquivos });
  return enviarEmailDaConversa(supabaseAdmin, autor, { canal, conversa, corpo, texto, arquivos });
}

// ---------------------------------------------------------------- E-MAIL
// corpo: { para, assunto, cc, nome, html } (como vem da tela)
export async function enviarEmailDaConversa(supabaseAdmin, autor, { canal, conversa, corpo = {}, texto, arquivos = [] }) {
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
      lista.push(await gravarSaida(supabaseAdmin, autor, conversa, {
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
  lista.push(await gravarSaida(supabaseAdmin, autor, conversa, {
    tipo: 'email', texto: texto || null, html, de: canal.identificador, para, cc: cc || null, assunto,
    anexos: arquivos.map(metaAnexo), id_externo: `gmail:${enviado.id}`, status_envio: 'ENVIADA',
  }));
  return { lista, conversa };
}

// E-mail avulso (sem conversa), ex.: aviso de solicitação para reservas@
export async function enviarEmailAvulso(supabaseAdmin, { canal, para, assunto, texto }) {
  const token = await tokenDaCaixa(supabaseAdmin, canal);
  const { mime } = montarEmail({
    de: canal.identificador, nomeRemetente: canal.config?.nomeExibicao || canal.nome, para, assunto, texto,
  });
  return enviarEmail({ token, threadId: null, mime });
}

// ---------------------------------------------------------------- COTAÇÃO
export async function preferenciasCotacao(supabaseAdmin, hotelId) {
  const { data } = await supabaseAdmin.from('atendimento_preferencias')
    .select('cotacao_texto_abertura, cotacao_texto_final').eq('hotel_id', hotelId).maybeSingle();
  return data || {};
}

// Busca de novo o preço (sempre o do motor), grava a cotação com os links
// rastreados e envia pelo canal da conversa. pedido: { checkin, checkout,
// adultos, criancas, quartos, tipos, abertura, final }. "simular": só monta o
// texto (teste do robô), sem gravar nem enviar. "hotelCotado": outro hotel do
// grupo ({ id, nome, descricao }) — "cb" tem que ser a Cloudbeds dele.
export async function enviarCotacao(supabaseAdmin, autor, { conversa, canal, cb, pedido, origem, simular = false, nomeCliente, disponibilidade = null, hotelCotado = null }) {
  const p = await prepararCotacao(supabaseAdmin, autor, { conversa, canal, cb, pedido, origem, simular, nomeCliente, disponibilidade, hotelCotado });
  if (p.erro || simular) return p;

  const envio = canal.tipo === 'EMAIL'
    ? await enviarEmailDaConversa(supabaseAdmin, autor, { canal, conversa, corpo: { html: p.html }, texto: p.texto, arquivos: [] })
    : await enviarPelaConversa(supabaseAdmin, autor, { canal, conversa, corpo: { semPrevia: true }, texto: p.texto, arquivos: [], botao: canal.tipo === 'WHATSAPP' ? p.botao : null });
  if (envio.erro) {
    await cancelarCotacao(supabaseAdmin, p.cotacao.id);
    return { erro: envio.erro, mensagens: envio.lista };
  }
  await concluirCotacao(supabaseAdmin, autor, { conversa, valores: p.valores });
  return { cotacao: p.cotacao, mensagens: envio.lista, texto: p.texto, itens: p.itens, resultado: p.resultado, hotelCotado: p.hotelCotado };
}

// A cotação não chegou ao cliente: os links deixam de contar
export async function cancelarCotacao(supabaseAdmin, cotacaoId) {
  await supabaseAdmin.from('atendimento_cotacoes').update({ status: 'CANCELADA' }).eq('id', cotacaoId);
}

// Depois que a cotação chegou: valor no cartão do Quadro e etapa "Cotação"
export async function concluirCotacao(supabaseAdmin, autor, { conversa, valores }) {
  await supabaseAdmin.from('atendimento_conversas').update({
    valor_cotacao: Math.min(...valores), ...(conversa.responsavel_id || !autor?.id ? {} : { responsavel_id: autor.id }),
  }).eq('id', conversa.id);
  await supabaseAdmin.rpc('atendimento_avancar_etapa', { p_conversa: conversa.id, p_nome: 'Cotação' });
}

// Monta o texto e grava a cotação (com os links rastreados), sem enviar.
// O robô no modo econômico usa isto para mandar a cotação junto com o resto
// da resposta, numa mensagem só. "disponibilidade": a consulta que o robô
// acabou de fazer para as mesmas datas (evita consultar a Cloudbeds de novo).
// "hotelCotado": outro hotel do grupo (link, motor e textos são os dele; a
// conversa e a cotação continuam no hotel da conversa).
export async function prepararCotacao(supabaseAdmin, autor, { conversa, canal, cb, pedido, origem, simular = false, nomeCliente, disponibilidade = null, hotelCotado = null }) {
  const resultado = disponibilidade || await buscarDisponibilidade(cb, pedido);
  const escolhidos = Array.isArray(pedido.tipos) ? pedido.tipos.map(String) : [];
  const itens = resultado.itens.filter((i) => !escolhidos.length || escolhidos.includes(i.tipoId)).slice(0, 8);
  if (!itens.length) return { erro: 'Os quartos escolhidos não estão mais disponíveis para essas datas. Busque de novo.', semQuartos: true, resultado };

  const outro = hotelCotado?.id && Number(hotelCotado.id) !== Number(conversa.hotel_id) ? hotelCotado : null;
  const hotelDoMotor = outro ? Number(outro.id) : conversa.hotel_id;
  const motor = await linkDoMotor(supabaseAdmin, cb, hotelDoMotor);
  if (!motor) {
    return {
      erro: outro
        ? `Falta o link do motor de reservas do ${outro.nome}. O administrador de lá coloca em Caixa de Entrada → Funil e etiquetas → Motor de reservas e cotação.`
        : 'Falta o link do motor de reservas. O administrador coloca em Caixa de Entrada → Funil e etiquetas → Motor de reservas e cotação.',
    };
  }

  // O final da cotação é o do hotel cotado; a abertura de outro hotel explica de onde ele vem
  const pref = await preferenciasCotacao(supabaseAdmin, hotelDoMotor);
  const { data: hotel } = await supabaseAdmin.from('hoteis').select('nome_fantasia').eq('id', conversa.hotel_id).maybeSingle();
  const codigo = simular ? 'EXEMPLO' : novoCodigo();
  const links = itens.map((_, n) => `${origem}/r/${codigo}-${n + 1}`);
  // Outro hotel: abertura neutra; o robô manda a de "não temos mais quarto aqui" quando é o caso
  const aberturaPadrao = outro ? (pedido.semQuartoAqui ? ABERTURA_OUTRO_HOTEL_ROBO : ABERTURA_OUTRO_HOTEL) : pref.cotacao_texto_abertura;
  const dados = {
    cot: resultado, itens, links,
    abertura: String(pedido.abertura || '').trim() || aberturaPadrao,
    final: String(pedido.final || '').trim() || pref.cotacao_texto_final,
    nomeCliente: nomeCliente ?? conversa.contato_nome, nomeHotel: outro ? outro.nome : hotel?.nome_fantasia,
    extra: { origem: hotel?.nome_fantasia, descricao: outro?.descricao || '' },
  };
  const texto = textoCotacao(dados);
  const valores = itens.map((i) => i.total);
  if (simular) return { texto, itens, resultado, hotelCotado: outro };

  // A cotação é gravada antes do envio: o link já tem que funcionar quando chegar
  const { data: cotacao, error } = await supabaseAdmin.from('atendimento_cotacoes').insert({
    hotel_id: conversa.hotel_id, conversa_id: conversa.id, contato_id: conversa.contato_id, codigo,
    checkin: resultado.checkin, checkout: resultado.checkout, adultos: resultado.adultos, criancas: resultado.criancas, quartos: resultado.quartos,
    itens: itens.map(({ tipoId, nome, abreviacao, total, porNoite, disponiveis, foto }) => ({ tipoId, nome, abreviacao, total, porNoite, disponiveis, foto })),
    valor_minimo: Math.min(...valores), valor_maximo: Math.max(...valores), mensagem: texto, canal_tipo: canal.tipo,
    enviado_por_id: autor?.id || null, ...(autor?.robo ? { enviado_pelo_robo: true } : {}),
    ...(outro ? { hotel_cotado_id: Number(outro.id) } : {}),
  }).select().single();
  if (error) {
    if (outro && /hotel_cotado_id/i.test(error.message || '')) {
      return { erro: 'Para cotar outro hotel do grupo, primeiro rode no Supabase o SQL sql/robo_outro_hotel.sql.' };
    }
    throw error;
  }
  // Botão "Reservar agora" (WhatsApp): abre o motor com as datas, sem quarto escolhido
  const botao = { texto: 'Reservar agora', url: `${origem}/r/${codigo}-0` };
  return { cotacao, texto, html: canal.tipo === 'EMAIL' ? htmlCotacao(dados) : null, itens, resultado, valores, botao, hotelCotado: outro };
}

// Pedido de cotação sem quarto disponível: fica registrado (demanda perdida)
export async function registrarSemDisponibilidade(supabaseAdmin, autor, conversa, r) {
  try {
    const { data: repetido } = await supabaseAdmin.from('atendimento_cotacoes').select('id')
      .eq('conversa_id', conversa.id).eq('status', 'SEM_DISPONIBILIDADE').eq('checkin', r.checkin).eq('checkout', r.checkout)
      .eq('adultos', r.adultos).gte('criado_em', new Date(Date.now() - 86400000).toISOString()).limit(1);
    if (repetido?.length) return;
    const { error } = await supabaseAdmin.from('atendimento_cotacoes').insert({
      hotel_id: conversa.hotel_id, conversa_id: conversa.id, contato_id: conversa.contato_id, codigo: novoCodigo(),
      checkin: r.checkin, checkout: r.checkout, adultos: r.adultos, criancas: r.criancas, quartos: r.quartos,
      itens: [], status: 'SEM_DISPONIBILIDADE', enviado_por_id: autor?.id || null, ...(autor?.robo ? { enviado_pelo_robo: true } : {}),
    });
    if (error) return;
    await supabaseAdmin.rpc('atendimento_adicionar_etiqueta', { p_conversa: conversa.id, p_nome: 'Indisponibilidade na cotação' });
    await gravarNota(supabaseAdmin, autor, conversa,
      `🔎 Sem quarto disponível para ${dataBR(r.checkin)} a ${dataBR(r.checkout)} (${r.adultos} adulto(s)${r.criancas ? `, ${r.criancas} criança(s)` : ''}). Ficou registrado como demanda perdida.`);
  } catch (e) { /* o registro é um extra; a busca continua */ }
}
