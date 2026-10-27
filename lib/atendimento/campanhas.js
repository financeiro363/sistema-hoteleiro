// ============================================================================
// CAIXA DE ENTRADA — CAMPANHAS DO WHATSAPP (Fase 6, servidor)
// ============================================================================
// Mensagem com modelo aprovado para um grupo de clientes (contatos do sistema
// ou planilha). Quem respondeu "SAIR" fica de fora. O envio é feito aos
// poucos pela função agendada (a cada 2 minutos), respeitando a data limite.
// ============================================================================

import { enviarWhatsApp, gravarNota } from './envio';
import { listarModelos, tokenDoCanal, normalizarNumero } from './whatsapp';
import { montarTextoModelo } from './modelosTexto';
import { LIMITE_CAMPANHA, ENVIOS_POR_RODADA, FONTES_VARIAVEL, valoresDaPessoa } from './campanhasConfig';

const ERROS_DE_ESPERA = [131056, 130429, 80007];       // muitas mensagens seguidas: tenta depois
const ERROS_DE_CONTA = [190, 10, 200, 368, 131048, 133010]; // token, permissão, bloqueio: pausa a campanha

const limparBusca = (t) => String(t || '').replace(/[,()%*\\]/g, ' ').trim();

async function nomeDoHotel(supabaseAdmin, hotelId) {
  const { data } = await supabaseAdmin.from('hoteis').select('nome_fantasia').eq('id', hotelId).maybeSingle();
  return data?.nome_fantasia || '';
}

// ---------------------------------------------------------------- público
async function contatosDoFiltro(supabaseAdmin, hotelId, filtros = {}) {
  const lista = [];
  for (let de = 0; de < LIMITE_CAMPANHA + 1000; de += 1000) {
    let q = supabaseAdmin.from('atendimento_contatos').select('id, nome, telefone, sem_automacoes, origem, ja_reservou, idioma, etiquetas_importadas')
      .eq('hotel_id', hotelId).not('telefone', 'is', null);
    if (filtros.mostrar === 'importados') q = q.eq('origem', 'IMPORTADO');
    if (filtros.mostrar === 'conversaram') q = q.neq('origem', 'IMPORTADO');
    if (filtros.mostrar === 'reservaram') q = q.eq('ja_reservou', true);
    if (filtros.mostrar === 'nao_reservaram') q = q.eq('ja_reservou', false);
    if (Number(filtros.periodo) > 0) q = q.gte('atualizado_em', new Date(Date.now() - Number(filtros.periodo) * 86400000).toISOString());
    const idioma = limparBusca(filtros.idioma);
    if (idioma) q = q.ilike('idioma', `%${idioma}%`);
    const etiqueta = limparBusca(filtros.etiqueta);
    if (etiqueta) q = q.ilike('etiquetas_importadas', `%${etiqueta}%`);
    const busca = limparBusca(filtros.busca);
    if (busca) q = q.or(`nome.ilike.%${busca}%,observacoes.ilike.%${busca}%`);
    const { data, error } = await q.order('id').range(de, de + 999);
    if (error) throw error;
    lista.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return lista;
}

// Lista final de quem recebe (sem repetidos, sem quem saiu, com número válido)
export async function montarPublico(supabaseAdmin, hotelId, publico) {
  const excluidos = { sem_numero: 0, repetidos: 0, sairam: 0, acima_do_limite: 0 };
  let brutos = [];
  if (publico?.tipo === 'PLANILHA') {
    brutos = (Array.isArray(publico.linhas) ? publico.linhas : []).slice(0, LIMITE_CAMPANHA * 2).map((l) => ({
      telefone: l?.telefone, nome: String(l?.nome || '').trim().slice(0, 120) || null, contato_id: null,
      colunas: Object.fromEntries(Object.entries(l?.colunas || {}).slice(0, 30).map(([k, v]) => [String(k).slice(0, 60), String(v ?? '').slice(0, 300)])),
    }));
  } else {
    const contatos = await contatosDoFiltro(supabaseAdmin, hotelId, publico?.filtros || {});
    brutos = contatos.map((c) => ({ telefone: c.telefone, nome: c.nome, contato_id: c.id, colunas: {}, saiu: !!c.sem_automacoes }));
  }

  const vistos = new Set();
  const lista = [];
  for (const p of brutos) {
    const tel = normalizarNumero(p.telefone || '');
    if (tel.length < 12 || tel.length > 15) { excluidos.sem_numero += 1; continue; }
    if (vistos.has(tel)) { excluidos.repetidos += 1; continue; }
    vistos.add(tel);
    if (p.saiu) { excluidos.sairam += 1; continue; }
    lista.push({ ...p, telefone: tel });
  }

  // Planilha: confere quem já pediu para sair (pelo telefone)
  if (publico?.tipo === 'PLANILHA' && lista.length) {
    const sairam = new Set();
    for (let i = 0; i < lista.length; i += 200) {
      const { data } = await supabaseAdmin.from('atendimento_contatos').select('telefone')
        .eq('hotel_id', hotelId).eq('sem_automacoes', true).in('telefone', lista.slice(i, i + 200).map((p) => p.telefone));
      (data || []).forEach((c) => sairam.add(c.telefone));
    }
    if (sairam.size) {
      const antes = lista.length;
      const restantes = lista.filter((p) => !sairam.has(p.telefone));
      excluidos.sairam += antes - restantes.length;
      lista.length = 0;
      lista.push(...restantes);
    }
  }
  if (lista.length > LIMITE_CAMPANHA) {
    excluidos.acima_do_limite = lista.length - LIMITE_CAMPANHA;
    lista.length = LIMITE_CAMPANHA;
  }
  return { lista, excluidos };
}

// ---------------------------------------------------------------- validar
const DATA_HORA = /^\d{4}-\d\d-\d\dT\d\d:\d\d/;

async function conferirEntrada(supabaseAdmin, hotelId, e) {
  const nome = String(e?.nome || '').trim();
  if (!nome) return { erro: 'Dê um nome à campanha (ex.: Promoção de Natal).' };
  if (nome.length > 120) return { erro: 'O nome da campanha pode ter até 120 letras.' };
  const { data: canal } = await supabaseAdmin.from('atendimento_canais').select('*').eq('id', Number(e.canal_id)).maybeSingle();
  if (!canal || Number(canal.hotel_id) !== Number(hotelId) || canal.tipo !== 'WHATSAPP') return { erro: 'Escolha um número de WhatsApp deste hotel.' };
  if (!canal.ativo) return { erro: 'Este número de WhatsApp está desligado.' };
  if (!canal.config?.wabaId) return { erro: 'Falta o "ID da conta do WhatsApp Business" na configuração do número (aba Canais).' };
  let modelos;
  try { modelos = await listarModelos({ token: await tokenDoCanal(supabaseAdmin, canal), wabaId: canal.config.wabaId }); }
  catch (err) { return { erro: `Não foi possível ler os modelos na Meta: ${err.message}` }; }
  const m = modelos.find((x) => x.nome === e.modelo_nome && (!e.modelo_idioma || x.idioma === e.modelo_idioma));
  if (!m) return { erro: `O modelo “${e.modelo_nome || ''}” não está aprovado neste número.` };
  if (m.cabecalhoMidia) return { erro: 'Este modelo tem foto, vídeo ou documento no título; escolha um modelo só de texto.' };

  const limparVar = (v) => {
    const fonte = FONTES_VARIAVEL[v?.fonte] ? v.fonte : null;
    return fonte ? { fonte, valor: ['fixo', 'coluna'].includes(fonte) ? String(v.valor || '').slice(0, 300) : null } : null;
  };
  const variaveis = (Array.isArray(e.variaveis) ? e.variaveis : []).map(limparVar);
  const variaveisCab = (Array.isArray(e.variaveis_cabecalho) ? e.variaveis_cabecalho : []).map(limparVar);
  const botoes = (Array.isArray(e.botoes) ? e.botoes : []).map(limparVar);
  if (variaveis.length !== m.variaveisCorpo || variaveis.some((v) => !v || (['fixo', 'coluna'].includes(v.fonte) && !v.valor))) {
    return { erro: `Escolha o que vai em cada uma das ${m.variaveisCorpo} variável(is) do modelo.` };
  }
  if (variaveisCab.length !== m.variaveisCabecalho || variaveisCab.some((v) => !v || (['fixo', 'coluna'].includes(v.fonte) && !v.valor))) {
    return { erro: 'Escolha o que vai na variável do título do modelo.' };
  }
  if (botoes.length !== (m.botoesLink || []).length || botoes.some((v) => !v || !['fixo', 'coluna'].includes(v.fonte) || !v.valor)) {
    return { erro: 'Escreva o final do link de cada botão do modelo.' };
  }
  const tipo = e.publico?.tipo === 'PLANILHA' ? 'PLANILHA' : 'CONTATOS';
  if (tipo === 'CONTATOS' && [...variaveis, ...variaveisCab, ...botoes].some((v) => v.fonte === 'coluna')) {
    return { erro: '“Coluna da planilha” só serve quando o público vem de uma planilha.' };
  }
  const agora = Date.now();
  const agendada = e.agendada_para && DATA_HORA.test(e.agendada_para) ? new Date(e.agendada_para) : new Date(agora);
  if (Number.isNaN(agendada.getTime())) return { erro: 'Confira a data e hora do envio.' };
  if (agendada.getTime() > agora + 60 * 86400000) return { erro: 'Agende para no máximo 60 dias à frente.' };
  const expira = e.expira_em && DATA_HORA.test(e.expira_em) ? new Date(e.expira_em) : null;
  if (expira && (Number.isNaN(expira.getTime()) || expira.getTime() <= Math.max(agora, agendada.getTime()))) {
    return { erro: 'A data limite tem que ser depois do início do envio.' };
  }
  const etiqueta = String(e.etiqueta || '').trim().slice(0, 40) || null;
  return {
    canal, modelo: m, variaveis, variaveisCab, botoes, tipo, agendada, expira, etiqueta, nome,
    robo_responde: e.robo_responde !== false,
  };
}

function campanhaDeRascunho(hotelId, c, publico) {
  return {
    hotel_id: hotelId, nome: c.nome, canal_id: c.canal.id, modelo_nome: c.modelo.nome, modelo_idioma: c.modelo.idioma,
    modelo_info: {
      corpo: c.modelo.corpo, cabecalho: c.modelo.cabecalho, rodape: c.modelo.rodape, categoria: c.modelo.categoria,
      nomesCorpo: c.modelo.nomesCorpo || null, nomesCabecalho: c.modelo.nomesCabecalho || null, botoesLink: c.modelo.botoesLink || [],
      botoes: c.modelo.botoes || [],
    },
    variaveis: c.variaveis, variaveis_cabecalho: c.variaveisCab, botoes: c.botoes,
    publico, etiqueta: c.etiqueta, robo_responde: c.robo_responde,
  };
}

async function precoDoModelo(supabaseAdmin, hotelId, categoria) {
  const { data } = await supabaseAdmin.from('atendimento_preferencias').select('*').eq('hotel_id', hotelId).maybeSingle();
  if (String(categoria).toUpperCase() === 'UTILITY') return Number(data?.whatsapp_preco_utilidade ?? 0.04);
  return Number(data?.whatsapp_preco_marketing ?? 0.35);
}

function textoPara(campanha, valores) {
  return montarTextoModelo({ ...(campanha.modelo_info || {}), nome: campanha.modelo_nome }, valores);
}

// Resumo do público: quantos, quem ficou de fora, custo e exemplos
export async function previaCampanha(supabaseAdmin, hotelId, entrada) {
  const c = await conferirEntrada(supabaseAdmin, hotelId, entrada);
  if (c.erro) return c;
  const publicoGuardado = c.tipo === 'PLANILHA' ? { tipo: 'PLANILHA', linhas: (entrada.publico?.linhas || []).length } : { tipo: 'CONTATOS', filtros: entrada.publico?.filtros || {} };
  const { lista, excluidos } = await montarPublico(supabaseAdmin, hotelId, entrada.publico);
  const hotelNome = await nomeDoHotel(supabaseAdmin, hotelId);
  const camp = campanhaDeRascunho(hotelId, c, publicoGuardado);
  const preco = await precoDoModelo(supabaseAdmin, hotelId, c.modelo.categoria);
  return {
    total: lista.length, excluidos, preco, categoria: c.modelo.categoria, custo: Math.round(lista.length * preco * 100) / 100,
    exemplos: lista.slice(0, 3).map((p) => ({ nome: p.nome || '', telefone: p.telefone, texto: textoPara(camp, valoresDaPessoa(camp, p, hotelNome)) })),
    _interno: { c, camp, lista, hotelNome, preco },
  };
}

export async function criarCampanha(supabaseAdmin, chamador, hotelId, entrada) {
  const p = await previaCampanha(supabaseAdmin, hotelId, entrada);
  if (p.erro) return p;
  const { c, camp, lista, hotelNome, preco } = p._interno;
  if (!lista.length) return { erro: 'Ninguém para receber com esse público (confira os filtros ou a planilha).' };
  if (Number(entrada.confirmar_total) !== lista.length) return { erro: 'O público mudou desde a prévia. Veja a prévia de novo antes de enviar.' };
  const registro = {
    ...camp, situacao: 'AGENDADA', agendada_para: c.agendada.toISOString(), expira_em: c.expira ? c.expira.toISOString() : null,
    total: lista.length, preco_unitario: preco, custo_estimado: Math.round(lista.length * preco * 100) / 100,
    criado_por_id: chamador.id,
  };
  const { data: campanha, error } = await supabaseAdmin.from('atendimento_campanhas').insert(registro).select().single();
  if (error) return { erro: /atendimento_campanhas/i.test(error.message) ? 'Falta rodar no Supabase o SQL da Fase 6 (sql/caixa_de_entrada_fase6.sql).' : error.message };
  for (let i = 0; i < lista.length; i += 500) {
    const linhas = lista.slice(i, i + 500).map((pessoa) => ({
      campanha_id: campanha.id, hotel_id: hotelId, telefone: pessoa.telefone, nome: pessoa.nome || null, contato_id: pessoa.contato_id || null,
      valores: valoresDaPessoa(campanha, pessoa, hotelNome),
    }));
    const { error: e2 } = await supabaseAdmin.from('atendimento_campanha_envios').insert(linhas);
    if (e2) {
      await supabaseAdmin.from('atendimento_campanhas').delete().eq('id', campanha.id);
      return { erro: `Não foi possível montar a lista de envio: ${e2.message}` };
    }
  }
  return { campanha };
}

// ---------------------------------------------------------------- pausar, retomar, cancelar
export async function mudarCampanha(supabaseAdmin, campanha, acao) {
  const agora = new Date().toISOString();
  if (acao === 'pausar') {
    if (!['AGENDADA', 'ENVIANDO'].includes(campanha.situacao)) return { erro: 'Só dá para pausar uma campanha agendada ou enviando.' };
    await supabaseAdmin.from('atendimento_campanhas').update({ situacao: 'PAUSADA', atualizado_em: agora }).eq('id', campanha.id);
  } else if (acao === 'retomar') {
    if (campanha.situacao !== 'PAUSADA') return { erro: 'Só dá para retomar uma campanha pausada.' };
    if (campanha.expira_em && new Date(campanha.expira_em).getTime() <= Date.now()) return { erro: 'A data limite desta campanha já passou.' };
    await supabaseAdmin.from('atendimento_campanhas').update({ situacao: campanha.iniciada_em ? 'ENVIANDO' : 'AGENDADA', aviso: null, atualizado_em: agora }).eq('id', campanha.id);
  } else if (acao === 'cancelar') {
    if (['CONCLUIDA', 'CANCELADA'].includes(campanha.situacao)) return { erro: 'Esta campanha já terminou.' };
    await supabaseAdmin.from('atendimento_campanha_envios').update({ situacao: 'CANCELADO', motivo: 'campanha cancelada' })
      .eq('campanha_id', campanha.id).eq('situacao', 'PENDENTE');
    await supabaseAdmin.from('atendimento_campanhas').update({ situacao: 'CANCELADA', concluida_em: agora, atualizado_em: agora }).eq('id', campanha.id);
  } else return { erro: 'Ação desconhecida.' };
  return { sucesso: true };
}

// ============================================================================
// ENVIO (função agendada, a cada 2 minutos)
// ============================================================================
async function concluirSeAcabou(supabaseAdmin, campanha) {
  const { count } = await supabaseAdmin.from('atendimento_campanha_envios').select('id', { count: 'exact', head: true })
    .eq('campanha_id', campanha.id).eq('situacao', 'PENDENTE');
  if ((count || 0) === 0) {
    await supabaseAdmin.from('atendimento_campanhas').update({ situacao: 'CONCLUIDA', concluida_em: new Date().toISOString(), atualizado_em: new Date().toISOString() })
      .eq('id', campanha.id).eq('situacao', 'ENVIANDO');
    return true;
  }
  return false;
}

async function enviarUm(supabaseAdmin, campanha, canal, envio) {
  // Pediu para sair depois que a campanha foi criada?
  const { data: saiu } = await supabaseAdmin.from('atendimento_contatos').select('id')
    .eq('hotel_id', campanha.hotel_id).eq('telefone', envio.telefone).eq('sem_automacoes', true).limit(1);
  if (saiu?.length) {
    await supabaseAdmin.from('atendimento_campanha_envios').update({ situacao: 'PULADO', motivo: 'o cliente pediu para não receber mensagens' }).eq('id', envio.id);
    return 'pulado';
  }
  const v = envio.valores || {};
  const info = campanha.modelo_info || {};
  const modelo = {
    nome: campanha.modelo_nome, idioma: campanha.modelo_idioma || 'pt_BR',
    variaveisCorpo: v.corpo || [], variaveisCabecalho: v.cabecalho || [], variaveisBotao: v.botoes || [],
    nomesCorpo: info.nomesCorpo || null, nomesCabecalho: info.nomesCabecalho || null,
  };
  if ([...modelo.variaveisCorpo, ...modelo.variaveisCabecalho, ...modelo.variaveisBotao.map((b) => b.texto)].some((x) => !String(x || '').trim())) {
    await supabaseAdmin.from('atendimento_campanha_envios').update({ situacao: 'PULADO', motivo: 'falta o valor de alguma variável (planilha)' }).eq('id', envio.id);
    return 'pulado';
  }
  modelo.textoFinal = textoPara(campanha, { corpo: modelo.variaveisCorpo, cabecalho: modelo.variaveisCabecalho, botoes: modelo.variaveisBotao.map((b) => b.texto) });
  const r = await enviarWhatsApp(supabaseAdmin, { id: null }, { canal, conversa: null, corpo: { modelo, para: envio.telefone, nome: envio.nome || '' } });
  if (r.erro) {
    if (ERROS_DE_ESPERA.includes(Number(r.codigo))) return 'esperar';
    if (ERROS_DE_CONTA.includes(Number(r.codigo))) return { pausar: r.erro };
    await supabaseAdmin.from('atendimento_campanha_envios').update({ situacao: 'FALHOU', motivo: String(r.erro).slice(0, 300), conversa_id: r.conversa?.id || null }).eq('id', envio.id);
    return 'falhou';
  }
  const msg = (r.lista || [])[0];
  const conv = r.conversa;
  await supabaseAdmin.from('atendimento_campanha_envios').update({
    situacao: 'ENVIADO', enviado_em: new Date().toISOString(), conversa_id: conv?.id || null, mensagem_id: msg?.id || null, motivo: null,
  }).eq('id', envio.id);
  if (conv) {
    await gravarNota(supabaseAdmin, { id: null }, conv, `📣 Campanha “${campanha.nome}” enviada para este cliente.`);
    if (campanha.etiqueta) {
      try { await supabaseAdmin.rpc('atendimento_adicionar_etiqueta', { p_conversa: conv.id, p_nome: campanha.etiqueta }); } catch (e) { /* extra */ }
    }
    if (!campanha.robo_responde) {
      await supabaseAdmin.from('atendimento_conversas')
        .update({ robo_pausado_em: new Date().toISOString(), robo_pausa_motivo: `Campanha “${campanha.nome}”: a equipe responde` }).eq('id', conv.id);
    }
  }
  return 'enviado';
}

export async function rodarCampanhas(supabaseAdmin, { prazo }) {
  const resultado = { iniciadas: 0, enviados: 0, falhas: 0, pulados: 0, concluidas: 0, expiradas: 0, pausadas: 0 };
  const agora = new Date().toISOString();

  // Passou da data limite: o que não saiu é cancelado
  const { data: vencidas, error } = await supabaseAdmin.from('atendimento_campanhas').select('id')
    .in('situacao', ['AGENDADA', 'ENVIANDO']).lt('expira_em', agora);
  if (error) return { pulou: 'falta o SQL da Fase 6' };
  for (const c of vencidas || []) {
    await supabaseAdmin.from('atendimento_campanha_envios').update({ situacao: 'CANCELADO', motivo: 'passou da data limite da campanha' })
      .eq('campanha_id', c.id).eq('situacao', 'PENDENTE');
    await supabaseAdmin.from('atendimento_campanhas').update({ situacao: 'CONCLUIDA', concluida_em: agora, atualizado_em: agora }).eq('id', c.id);
    resultado.expiradas += 1;
  }

  // Chegou a hora: começa a enviar
  const { data: prontas } = await supabaseAdmin.from('atendimento_campanhas').select('id')
    .eq('situacao', 'AGENDADA').lte('agendada_para', agora);
  for (const c of prontas || []) {
    await supabaseAdmin.from('atendimento_campanhas').update({ situacao: 'ENVIANDO', iniciada_em: agora, atualizado_em: agora }).eq('id', c.id).eq('situacao', 'AGENDADA');
    resultado.iniciadas += 1;
  }

  const { data: enviando } = await supabaseAdmin.from('atendimento_campanhas').select('*')
    .eq('situacao', 'ENVIANDO').order('agendada_para').limit(5);
  let restam = ENVIOS_POR_RODADA;
  for (const campanha of enviando || []) {
    if (restam <= 0 || prazo - Date.now() < 2000) break;
    const { data: canal } = await supabaseAdmin.from('atendimento_canais').select('*').eq('id', campanha.canal_id).maybeSingle();
    if (!canal?.ativo) {
      await supabaseAdmin.from('atendimento_campanhas').update({ situacao: 'PAUSADA', aviso: 'O número de WhatsApp da campanha está desligado.', atualizado_em: agora }).eq('id', campanha.id);
      resultado.pausadas += 1;
      continue;
    }
    const { data: fila } = await supabaseAdmin.from('atendimento_campanha_envios').select('*')
      .eq('campanha_id', campanha.id).eq('situacao', 'PENDENTE').order('id').limit(restam);
    let parar = false;
    for (const [i, envio] of (fila || []).entries()) {
      if (prazo - Date.now() < 1500) { parar = true; break; }
      // Alguém pausou ou cancelou no meio da rodada?
      if (i > 0 && i % 10 === 0) {
        const { data: atual } = await supabaseAdmin.from('atendimento_campanhas').select('situacao').eq('id', campanha.id).maybeSingle();
        if (atual?.situacao !== 'ENVIANDO') break;
      }
      const r = await enviarUm(supabaseAdmin, campanha, canal, envio);
      restam -= 1;
      if (r === 'enviado') resultado.enviados += 1;
      else if (r === 'pulado') resultado.pulados += 1;
      else if (r === 'falhou') resultado.falhas += 1;
      else if (r === 'esperar') { parar = true; break; }
      else if (r?.pausar) {
        await supabaseAdmin.from('atendimento_campanhas').update({ situacao: 'PAUSADA', aviso: String(r.pausar).slice(0, 300), atualizado_em: new Date().toISOString() }).eq('id', campanha.id);
        resultado.pausadas += 1;
        break;
      }
    }
    if (await concluirSeAcabou(supabaseAdmin, campanha)) resultado.concluidas += 1;
    if (parar) break;
  }
  return resultado;
}

// Quem recebeu campanha e respondeu "SAIR"
export async function marcarSaidaCampanha(supabaseAdmin, conversaId) {
  const { data } = await supabaseAdmin.from('atendimento_campanha_envios').select('id')
    .eq('conversa_id', conversaId).eq('situacao', 'ENVIADO').is('saiu_em', null);
  if (!data?.length) return false;
  await supabaseAdmin.from('atendimento_campanha_envios').update({ saiu_em: new Date().toISOString() }).in('id', data.map((x) => x.id));
  return true;
}
