// ============================================================================
// CONTEÚDO DO ROBÔ PELO SITE E POR PDF (M21) — só no SERVIDOR
// ============================================================================
// Lê as fontes (página do site ou PDF guardado), guarda o texto e a "marca"
// (para saber se mudou), pede à IA as sugestões comparando com o conteúdo
// atual e, uma vez por mês, relê as páginas do site e avisa os ADMIN se
// alguma mudou. Regras de segurança da leitura de páginas:
//   - só http/https, por nome (não por número de IP), portas 80/443;
//   - o nome tem de apontar para a internet (nunca para a rede interna),
//     conferido também em cada redirecionamento (até 3);
//   - até 3 MB e 6 s por página; PDF até 10 MB.
// ============================================================================

import dns from 'node:dns';
import {
  htmlParaTexto, linksDoMesmoSite, urlValida, ipInterno, marcaDoTexto, dividirTexto, conferirSugestoes,
  instrucoesSugestoes, mensagemSugestoes, FERRAMENTA_SUGESTOES, MAX_TEXTO_FONTE, MAX_FONTES, RECHECAR_DIAS, MAX_PDF_MB,
} from './roboFontes';
import { assuntosParaRevisar, hojeExtenso, paraBusca } from './roboRevisao';
import { chamarClaude, registrarUso, carregarRobo, textoConteudo, CHAVE_SEGREDO, ErroIA } from './robo';
import { MODELO_PADRAO } from './roboConfig';
import { lerSegredo, lerAnexo } from './servidor';
import { avisarAdmins } from './avisoGestor';

const MAX_PAGINA_MB = 3;
const AGENTE = 'Mozilla/5.0 (compatible; ChokmahSystem/1.0; leitura do conteudo do hotel)';

export class ErroFonte extends Error {}

async function conferirHost(hostname) {
  let enderecos;
  try { enderecos = await dns.promises.lookup(hostname, { all: true }); }
  catch (e) { throw new ErroFonte(`Não achei o site ${hostname}. Confira o endereço.`); }
  if (!enderecos.length || enderecos.some((a) => ipInterno(a.address))) throw new ErroFonte('Este endereço não é de um site público.');
}

// Corpo da resposta até o limite (sem ler arquivos enormes)
async function lerCorpo(resposta, limiteBytes) {
  const tamanho = Number(resposta.headers.get('content-length') || 0);
  if (tamanho > limiteBytes) throw new ErroFonte(`O arquivo é grande demais (máximo ${Math.round(limiteBytes / 1048576)} MB).`);
  const leitor = resposta.body?.getReader?.();
  if (!leitor) return Buffer.from(await resposta.arrayBuffer());
  const pedacos = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.length;
    if (total > limiteBytes) { try { await leitor.cancel(); } catch (e) { /* nada */ } throw new ErroFonte(`O arquivo é grande demais (máximo ${Math.round(limiteBytes / 1048576)} MB).`); }
    pedacos.push(Buffer.from(value));
  }
  return Buffer.concat(pedacos);
}

// Busca uma página pública: { url, tipo: 'html'|'pdf', dados }
export async function buscarPagina(endereco, { tempoMs = 6000 } = {}) {
  let url = urlValida(endereco);
  if (!url) throw new ErroFonte('Endereço inválido. Use o endereço completo da página, começando com https://');
  const fim = Date.now() + tempoMs;
  for (let salto = 0; salto <= 3; salto += 1) {
    const u = new URL(url);
    await conferirHost(u.hostname);
    let resposta;
    try {
      resposta = await fetch(url, {
        redirect: 'manual', headers: { 'User-Agent': AGENTE, Accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.5' },
        signal: AbortSignal.timeout(Math.max(1000, fim - Date.now())),
      });
    } catch (e) {
      throw new ErroFonte(e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'O site demorou demais para responder.' : 'Não foi possível abrir a página (sem conexão com o site).');
    }
    if ([301, 302, 303, 307, 308].includes(resposta.status)) {
      const destino = resposta.headers.get('location');
      const proximo = destino ? urlValida(new URL(destino, url).toString()) : null;
      if (!proximo) throw new ErroFonte('A página manda para um endereço que não dá para ler.');
      url = proximo;
      continue;
    }
    if (resposta.status === 404) throw new ErroFonte('Página não encontrada (erro 404). Confira o endereço.');
    if (!resposta.ok) throw new ErroFonte(`O site respondeu com erro (${resposta.status}).`);
    const tipo = String(resposta.headers.get('content-type') || '').toLowerCase();
    if (tipo.includes('application/pdf') || /\.pdf$/i.test(u.pathname)) return { url, tipo: 'pdf', dados: await lerCorpo(resposta, MAX_PDF_MB * 1048576) };
    if (tipo && !/text\/html|application\/xhtml|text\/plain/.test(tipo)) throw new ErroFonte('Este endereço não é uma página de texto nem um PDF.');
    return { url, tipo: 'html', dados: await lerCorpo(resposta, MAX_PAGINA_MB * 1048576) };
  }
  throw new ErroFonte('A página redireciona vezes demais.');
}

// Texto de um PDF (PDF de foto/escaneado não tem texto)
export async function textoDoPdf(dados) {
  const { extractText, getDocumentProxy } = await import('unpdf');
  let pdf;
  try { pdf = await getDocumentProxy(new Uint8Array(dados)); }
  catch (e) { throw new ErroFonte('Não consegui abrir o PDF (arquivo danificado ou com senha).'); }
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const paginas = (Array.isArray(text) ? text : [text]).map((t, i) => `## Página ${i + 1}\n${String(t || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()}`);
  const texto = paginas.join('\n\n').slice(0, MAX_TEXTO_FONTE);
  if (texto.replace(/## Página \d+/g, '').replace(/\s/g, '').length < 40) {
    throw new ErroFonte('Este PDF não tem texto (parece uma foto ou um escaneado). Envie o PDF original, exportado do programa em que foi feito, ou cole o texto em "📋 Colar texto pronto".');
  }
  return { texto, paginas: totalPages };
}

// ---------------------------------------------------------------- cadastro
export async function listarFontes(supabaseAdmin, hotelId) {
  const [{ data: fontes, error }, { data: sugs }] = await Promise.all([
    supabaseAdmin.from('atendimento_robo_fontes').select('id, tipo, nome, url, situacao, erro, conferida_em, mudou_em, sugerida_em, ativa, criado_em, caracteres')
      .eq('hotel_id', hotelId).order('criado_em', { ascending: true }),
    supabaseAdmin.from('atendimento_robo_sugestoes').select('*').eq('hotel_id', hotelId).eq('situacao', 'PENDENTE').order('id', { ascending: true }).limit(200),
  ]);
  if (error) throw new ErroFonte(/atendimento_robo_fontes/i.test(error.message) ? 'Falta rodar o SQL da Etapa 6 (sql/robo_fontes_etapa6.sql).' : error.message);
  return { fontes: fontes || [], sugestoes: sugs || [] };
}

export async function adicionarFonte(supabaseAdmin, hotelId, autorId, { url, nome, caminho, tipo }) {
  const { count } = await supabaseAdmin.from('atendimento_robo_fontes').select('id', { count: 'exact', head: true }).eq('hotel_id', hotelId);
  if ((count || 0) >= MAX_FONTES) throw new ErroFonte(`Cada hotel pode ter até ${MAX_FONTES} fontes. Apague alguma antes.`);
  let linha;
  if (tipo === 'PDF') {
    if (!caminho || !String(caminho).startsWith(`${hotelId}/`) || !/\.pdf$/i.test(caminho)) throw new ErroFonte('Envie um arquivo PDF.');
    linha = { tipo: 'PDF', caminho, nome: String(nome || 'Arquivo PDF').slice(0, 120) };
  } else {
    const u = urlValida(url);
    if (!u) throw new ErroFonte('Endereço inválido. Use o endereço completo da página, começando com https://');
    const { data: igual } = await supabaseAdmin.from('atendimento_robo_fontes').select('id').eq('hotel_id', hotelId).eq('url', u).limit(1);
    if (igual?.length) throw new ErroFonte('Esta página já está na lista.');
    linha = { tipo: 'SITE', url: u, nome: String(nome || new URL(u).hostname + new URL(u).pathname).slice(0, 120) };
  }
  const { data, error } = await supabaseAdmin.from('atendimento_robo_fontes')
    .insert({ hotel_id: hotelId, ...linha, situacao: 'NOVA', ativa: true, criado_por: autorId || null }).select('*').single();
  if (error) throw new ErroFonte(error.message);
  return data;
}

async function carregarFonte(supabaseAdmin, hotelId, id) {
  const { data } = await supabaseAdmin.from('atendimento_robo_fontes').select('*').eq('hotel_id', hotelId).eq('id', Number(id) || 0).maybeSingle();
  if (!data) throw new ErroFonte('Fonte não encontrada.');
  return data;
}

export async function apagarFonte(supabaseAdmin, hotelId, id) {
  const f = await carregarFonte(supabaseAdmin, hotelId, id);
  await supabaseAdmin.from('atendimento_robo_sugestoes').delete().eq('fonte_id', f.id).eq('situacao', 'PENDENTE');
  await supabaseAdmin.from('atendimento_robo_fontes').delete().eq('id', f.id);
  return { apagada: true };
}

// Páginas do mesmo site, para escolher quais virar fonte
export async function linksDaPagina(endereco) {
  const p = await buscarPagina(endereco);
  if (p.tipo !== 'html') return { url: p.url, titulo: 'PDF', links: [] };
  const html = p.dados.toString('utf8');
  return { url: p.url, titulo: htmlParaTexto(html).titulo, links: linksDoMesmoSite(html, p.url) };
}

// Lê a fonte agora e guarda o texto. { texto, mudou }
export async function lerFonte(supabaseAdmin, fonte, { tempoMs = 6000 } = {}) {
  const agora = new Date().toISOString();
  try {
    let texto; let titulo = null;
    if (fonte.tipo === 'PDF') {
      const dados = await lerAnexo(supabaseAdmin, fonte.caminho);
      if (dados.length > MAX_PDF_MB * 1048576) throw new ErroFonte(`O PDF é grande demais (máximo ${MAX_PDF_MB} MB).`);
      texto = (await textoDoPdf(dados)).texto;
    } else {
      const p = await buscarPagina(fonte.url, { tempoMs });
      if (p.tipo === 'pdf') texto = (await textoDoPdf(p.dados)).texto;
      else ({ titulo, texto } = htmlParaTexto(p.dados.toString('utf8')));
      if (texto.replace(/[\s#|-]/g, '').length < 15) throw new ErroFonte('A página quase não tem texto (pode ser montada por programa no navegador). Use outra página ou cole o texto.');
    }
    const marca = marcaDoTexto(texto);
    const mudou = !!fonte.marca && fonte.marca !== marca;
    const campos = {
      texto, marca, caracteres: texto.length, conferida_em: agora, erro: null,
      situacao: mudou ? 'MUDOU' : (fonte.situacao === 'MUDOU' ? 'MUDOU' : 'OK'),
      ...(mudou ? { mudou_em: agora } : {}),
      // nome automático (o endereço) vira o título da página
      ...(fonte.tipo === 'SITE' && titulo && (!fonte.nome || fonte.url.replace(/^https?:\/\//, '').replace(/\/$/, '') === fonte.nome.replace(/\/$/, '')) ? { nome: titulo.slice(0, 120) } : {}),
    };
    await supabaseAdmin.from('atendimento_robo_fontes').update(campos).eq('id', fonte.id);
    return { texto, mudou, novo: !fonte.marca };
  } catch (e) {
    const msg = e instanceof ErroFonte ? e.message : `Não foi possível ler: ${e.message}`;
    await supabaseAdmin.from('atendimento_robo_fontes').update({ situacao: 'ERRO', erro: msg.slice(0, 300), conferida_em: agora }).eq('id', fonte.id);
    throw new ErroFonte(msg);
  }
}

// ---------------------------------------------------------------- sugestões (IA)
// Uma parte da fonte por chamada (cabe nos 10 s). A tela chama parte 0, 1, 2…
export async function sugerirDaFonte(supabaseAdmin, hotelId, { fonteId, parte = 0, assuntos: lista, ler = false }) {
  const inicio = Date.now();
  let fonte = await carregarFonte(supabaseAdmin, hotelId, fonteId);
  if (ler || !fonte.texto) {
    await lerFonte(supabaseAdmin, fonte, { tempoMs: 4500 });
    fonte = await carregarFonte(supabaseAdmin, hotelId, fonteId);
  }
  const partes = dividirTexto(fonte.texto);
  const n = Math.max(0, Math.min(Number(parte) || 0, partes.length - 1));
  if (!partes.length) return { sugestoes: [], parte: 0, partes: 0 };
  const robo = await carregarRobo(supabaseAdmin, hotelId);
  const chave = await lerSegredo(supabaseAdmin, hotelId, CHAVE_SEGREDO);
  if (!chave) throw new ErroIA('Falta a chave da Anthropic. Coloque a chave em Robô → Configuração.', 'CHAVE');
  const { data: gasto } = await supabaseAdmin.rpc('atendimento_robo_gasto_mes', { p_hotel: hotelId });
  if (Number(robo.config?.limite_mensal_usd) > 0 && Number(gasto || 0) >= Number(robo.config.limite_mensal_usd)) {
    throw new ErroIA('O limite de gasto da IA deste mês já foi atingido (Robô → Configuração).', 'LIMITE');
  }
  // Compara com o que está na tela (rascunho), ou com o publicado
  const assuntos = assuntosParaRevisar(Array.isArray(lista) ? lista : (robo.conteudo?.rascunho || robo.conteudo?.publicado || []));
  const nomeFonte = fonte.tipo === 'PDF' ? `arquivo PDF “${fonte.nome}”` : `página do site ${fonte.url}`;
  // Começo da fonte: as sugestões antigas dela ainda pendentes saem (vêm de novo, atualizadas)
  if (n === 0) await supabaseAdmin.from('atendimento_robo_sugestoes').delete().eq('fonte_id', fonte.id).eq('situacao', 'PENDENTE');
  const modelo = MODELO_PADRAO;
  let r;
  try {
    r = await chamarClaude({
      chave, modelo, maxTokens: 1500, tempoMs: Math.max(3000, 9300 - (Date.now() - inicio)),
      system: instrucoesSugestoes({ nomeHotel: robo.nomeHotel, hoje: hojeExtenso(), fonte: nomeFonte }),
      tools: [FERRAMENTA_SUGESTOES], toolChoice: { type: 'tool', name: FERRAMENTA_SUGESTOES.name },
      messages: [{ role: 'user', content: mensagemSugestoes({ conteudo: textoConteudo(assuntos), textoFonte: partes[n], parte: n, partes: partes.length }) }],
    });
  } catch (e) {
    if (e?.codigo === 'TEMPO') throw new ErroIA('A IA demorou demais para ler esta parte. Tente de novo em instantes.', 'TEMPO');
    throw e;
  }
  const custo = await registrarUso(supabaseAdmin, { hotelId, conversaId: null, origem: 'TESTE', modelo, uso: r.usage });
  const uso = (Array.isArray(r.content) ? r.content : []).find((b) => b.type === 'tool_use' && b.name === FERRAMENTA_SUGESTOES.name);
  if (!uso) throw new ErroIA('A IA não devolveu as sugestões. Tente de novo.', 'OUTRO');
  let brutos = uso.input?.sugestoes;
  if (typeof brutos === 'string') { try { brutos = JSON.parse(brutos); } catch (e) { brutos = null; } }
  const { sugestoes, descartadas } = conferirSugestoes(brutos, assuntos, partes[n]);
  // A mesma sugestão já pendente de outra fonte (ex.: cardápio no site e em PDF) não entra de novo
  const { data: outras } = await supabaseAdmin.from('atendimento_robo_sugestoes').select('tipo, assunto, texto_sugerido').eq('hotel_id', hotelId).eq('situacao', 'PENDENTE').limit(300);
  const chaveSug = (x) => `${x.tipo}|${paraBusca(x.assunto)}|${paraBusca(x.texto_sugerido)}`;
  const jaPendentes = new Set((outras || []).map(chaveSug));
  const novas = sugestoes.filter((x) => !jaPendentes.has(chaveSug(x)));
  let gravadas = [];
  if (novas.length) {
    const { data } = await supabaseAdmin.from('atendimento_robo_sugestoes')
      .insert(novas.map((s) => ({ hotel_id: hotelId, fonte_id: fonte.id, situacao: 'PENDENTE', ...s }))).select('*');
    gravadas = data || [];
  }
  const ultima = n >= partes.length - 1;
  if (ultima) await supabaseAdmin.from('atendimento_robo_fontes').update({ sugerida_em: new Date().toISOString(), situacao: fonte.situacao === 'ERRO' ? 'ERRO' : 'OK' }).eq('id', fonte.id);
  return { sugestoes: gravadas, descartadas, repetidas: sugestoes.length - novas.length, parte: n, partes: partes.length, ultima, custo };
}

export async function decidirSugestao(supabaseAdmin, hotelId, autorId, { id, aceitar }) {
  const { data: s } = await supabaseAdmin.from('atendimento_robo_sugestoes').select('*').eq('hotel_id', hotelId).eq('id', Number(id) || 0).maybeSingle();
  if (!s) throw new ErroFonte('Sugestão não encontrada.');
  if (s.situacao !== 'PENDENTE') return { sugestao: s };
  const { data } = await supabaseAdmin.from('atendimento_robo_sugestoes')
    .update({ situacao: aceitar ? 'ACEITA' : 'RECUSADA', decidido_por: autorId || null, decidido_em: new Date().toISOString() }).eq('id', s.id).select('*').single();
  return { sugestao: data };
}

// ---------------------------------------------------------------- rechecagem mensal
// Relê as páginas do site conferidas há mais de 30 dias. Se o texto mudou,
// avisa os ADMIN (uma vez por fonte) para gerar as sugestões na tela.
export async function rechecarFontes(supabaseAdmin, { prazo, origem }) {
  const limite = new Date(Date.now() - RECHECAR_DIAS * 86400000).toISOString();
  const { data: fontes, error } = await supabaseAdmin.from('atendimento_robo_fontes').select('*')
    .eq('ativa', true).eq('tipo', 'SITE').or(`conferida_em.is.null,conferida_em.lt.${limite}`).order('conferida_em', { ascending: true, nullsFirst: true }).limit(5);
  if (error) return { pulou: /atendimento_robo_fontes/i.test(error.message) ? 'falta o SQL da Etapa 6' : error.message };
  const resultados = [];
  const mudaram = {};
  for (const f of fontes || []) {
    if (prazo - Date.now() < 3000) break;
    try {
      const r = await lerFonte(supabaseAdmin, f, { tempoMs: Math.min(5000, prazo - Date.now() - 1500) });
      resultados.push({ id: f.id, mudou: r.mudou });
      if (r.mudou) (mudaram[f.hotel_id] ||= []).push(f.nome || f.url);
    } catch (e) { resultados.push({ id: f.id, erro: e.message }); }
  }
  for (const [hotelId, nomes] of Object.entries(mudaram)) {
    const lista = nomes.map((n) => `• ${n}`).join('\n');
    const url = `${origem || ''}/atendimento?aba=robo`;
    await avisarAdmins(supabaseAdmin, Number(hotelId), {
      titulo: '📚 O site do hotel mudou', corpo: `${nomes.length} página(s) mudaram. Veja as sugestões para o robô.`, url: '/atendimento?aba=robo', tag: `fontes-${hotelId}`,
      assunto: 'O site do hotel mudou: confira o conteúdo do robô',
      texto: `Na rechecagem mensal, estas páginas mudaram desde a última leitura:\n${lista}\n\nAbra Atendimento → Robô (IA) → Conteúdo → "Fontes do conteúdo" e clique em "Gerar sugestões" para ver o que mudou. Nada é alterado no robô sem você aceitar e publicar.\n${url}`,
    });
  }
  return { conferidas: resultados.length, resultados };
}
