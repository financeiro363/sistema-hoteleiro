// ============================================================================
// "PRONTO PARA DESLIGAR O ASKSUITE?" — conferência (só servidor)
// ============================================================================
// Olha o que precisa estar funcionando no sistema antes de tirar o Asksuite:
// os canais que ele atendia (WhatsApp, Instagram, Facebook, chat do site)
// ligados e RECEBENDO mensagens, o robô pronto, a equipe com acesso, a
// Cloudbeds e o motor de reservas. Cada item volta com a situação:
//   OK       → pronto
//   FALTA    → impede desligar
//   ATENCAO  → não impede, mas vale resolver
// ============================================================================

import { lerSegredo } from './servidor';
import { tokenDoCanal, listarModelos } from './whatsapp';

const DIA = 86400000;
const RECEBENDO_DIAS = 7;

async function seguro(promessa) {
  try { const r = await promessa; return r?.error ? { erro: r.error } : r; } catch (e) { return { erro: e }; }
}

async function ultimaEntrada(supabaseAdmin, canalId) {
  const r = await seguro(supabaseAdmin.from('atendimento_conversas').select('ultima_entrada_em')
    .eq('canal_id', canalId).not('ultima_entrada_em', 'is', null).order('ultima_entrada_em', { ascending: false }).limit(1));
  return r?.data?.[0]?.ultima_entrada_em || null;
}

const diasDesde = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / DIA) : null);
const quando = (iso) => {
  const d = diasDesde(iso);
  if (d === null) return 'nunca';
  if (d === 0) return 'hoje';
  return d === 1 ? 'ontem' : `há ${d} dias`;
};

// Canal ligado e recebendo: FALTA se não existe ou está desligado; ATENCAO
// se nunca recebeu ou faz tempo; OK se recebeu nos últimos dias.
async function itemCanal(supabaseAdmin, canais, tipo, titulo, onde) {
  const doTipo = canais.filter((c) => c.tipo === tipo);
  const ligado = doTipo.find((c) => c.ativo);
  if (!doTipo.length) return { chave: tipo, titulo, situacao: 'FALTA', detalhe: 'Ainda não está conectado no sistema.', onde };
  if (!ligado) return { chave: tipo, titulo, situacao: 'FALTA', detalhe: 'Está conectado, mas desligado.', onde };
  if (ligado.status === 'ERRO') return { chave: tipo, titulo, situacao: 'FALTA', detalhe: `Com problema: ${ligado.erro || 'veja em Canais'}.`, onde };
  const ultima = await ultimaEntrada(supabaseAdmin, ligado.id);
  const d = diasDesde(ultima);
  if (d === null) return { chave: tipo, titulo, situacao: 'ATENCAO', detalhe: `Conectado (${ligado.endereco_exibicao || ligado.nome}), mas ainda não chegou nenhuma mensagem. Mande uma de teste de outro celular.`, onde };
  if (d > RECEBENDO_DIAS) return { chave: tipo, titulo, situacao: 'ATENCAO', detalhe: `Conectado, mas a última mensagem de cliente chegou ${quando(ultima)}. Confira se está recebendo.`, onde };
  return { chave: tipo, titulo, situacao: 'OK', detalhe: `Recebendo: última mensagem de cliente ${quando(ultima)} (${ligado.endereco_exibicao || ligado.nome}).`, onde };
}

export async function conferirSaidaAsksuite(supabaseAdmin, hotelId) {
  const itens = [];
  const [canaisR, roboR, conteudoR, lacunasR, histR, equipeR, prefR, cbR, autoR, configR] = await Promise.all([
    seguro(supabaseAdmin.from('atendimento_canais').select('*').eq('hotel_id', hotelId)),
    seguro(supabaseAdmin.from('atendimento_robo').select('*').eq('hotel_id', hotelId).maybeSingle()),
    seguro(supabaseAdmin.from('atendimento_robo_conteudo').select('publicado').eq('hotel_id', hotelId).maybeSingle()),
    seguro(supabaseAdmin.from('atendimento_robo_lacunas').select('id', { count: 'exact', head: true }).eq('hotel_id', hotelId).eq('situacao', 'NOVA')),
    seguro(supabaseAdmin.from('atendimento_historico_externo').select('id', { count: 'exact', head: true }).eq('hotel_id', hotelId)),
    seguro(supabaseAdmin.from('usuarios').select('id, papel, ativo, pode_acessar_atendimento').eq('hotel_id', hotelId)),
    seguro(supabaseAdmin.from('atendimento_preferencias').select('*').eq('hotel_id', hotelId).maybeSingle()),
    seguro(supabaseAdmin.from('cloudbeds_credenciais').select('hotel_id, cloudbeds_property_id').eq('hotel_id', hotelId).maybeSingle()),
    seguro(supabaseAdmin.from('atendimento_automacoes').select('tipo, ativo').eq('hotel_id', hotelId)),
    seguro(supabaseAdmin.from('atendimento_config').select('meta_verify_token, meta_app_id').eq('hotel_id', hotelId).maybeSingle()),
  ]);
  const canais = canaisR?.data || [];

  // ---- 1. Canais que o Asksuite atendia ---------------------------------------
  itens.push({ grupo: 'Canais', ...await itemCanal(supabaseAdmin, canais, 'WHATSAPP', 'WhatsApp oficial no sistema', 'Canais → WhatsApp') });
  itens.push({ grupo: 'Canais', ...await itemCanal(supabaseAdmin, canais, 'INSTAGRAM', 'Direct do Instagram no sistema', 'Canais → Instagram e Facebook') });
  itens.push({ grupo: 'Canais', ...await itemCanal(supabaseAdmin, canais, 'FACEBOOK', 'Messenger do Facebook no sistema', 'Canais → Instagram e Facebook') });
  const site = canais.find((c) => c.tipo === 'SITE');
  if (!site || !site.ativo) {
    itens.push({ grupo: 'Canais', chave: 'SITE', titulo: 'Chat do site do sistema', situacao: 'FALTA', detalhe: site ? 'O chat do site está desligado.' : 'O chat do site ainda não foi ativado.', onde: 'Canais → Chat do site' });
  } else if (!(site.config?.dominios || []).length) {
    itens.push({ grupo: 'Canais', chave: 'SITE', titulo: 'Chat do site do sistema', situacao: 'FALTA', detalhe: 'Falta informar o endereço do site (sem ele, o chat só funciona na página de teste).', onde: 'Canais → Chat do site → Editar' });
  } else {
    const r = await seguro(supabaseAdmin.from('atendimento_conversas').select('visitante, criado_em')
      .eq('canal_id', site.id).order('criado_em', { ascending: false }).limit(30));
    const doSite = (r?.data || []).find((c) => {
      const pagina = String(c.visitante?.pagina || '');
      return pagina && !/\/chat-site\/teste/.test(pagina) && (site.config.dominios || []).some((d) => pagina.includes(d));
    });
    itens.push(doSite
      ? { grupo: 'Canais', chave: 'SITE', titulo: 'Chat do site do sistema', situacao: 'OK', detalhe: `No site: última conversa vinda do site ${quando(doSite.criado_em)}.`, onde: 'Canais → Chat do site' }
      : { grupo: 'Canais', chave: 'SITE', titulo: 'Chat do site do sistema', situacao: 'ATENCAO', detalhe: 'Ativado, mas ainda não chegou conversa vinda do site de verdade. O código do chat precisa estar publicado no site (no lugar do Asksuite).', onde: 'Canais → Chat do site' });
  }
  const tg = canais.find((c) => c.tipo === 'TELEGRAM');
  itens.push(tg
    ? { grupo: 'Canais', ...await itemCanal(supabaseAdmin, canais, 'TELEGRAM', 'Telegram (novo, opcional)', 'Canais → Telegram') }
    : { grupo: 'Canais', chave: 'TELEGRAM', titulo: 'Telegram (novo, opcional)', situacao: 'OPCIONAL', detalhe: 'Não conectado. Não impede desligar o Asksuite.', onde: 'Canais → Telegram' });
  if (!configR?.data?.meta_verify_token) {
    itens.push({ grupo: 'Canais', chave: 'META_APP', titulo: 'App da Meta', situacao: 'FALTA', detalhe: 'Falta salvar o app da Meta (chave secreta e token de verificação).', onde: 'Canais → WhatsApp → 1. App da Meta' });
  }

  // ---- 2. Robô ----------------------------------------------------------------
  const robo = roboR?.data;
  const publicado = conteudoR?.data?.publicado;
  const chave = await lerSegredo(supabaseAdmin, hotelId, 'anthropic_chave').catch(() => null);
  const canaisRobo = robo?.canais || [];
  const faltamNoRobo = ['WHATSAPP', 'INSTAGRAM', 'FACEBOOK', 'SITE'].filter((t) => !canaisRobo.includes(t));
  const nomeCanal = { WHATSAPP: 'WhatsApp', INSTAGRAM: 'Instagram', FACEBOOK: 'Facebook', SITE: 'chat do site' };
  if (!chave) itens.push({ grupo: 'Robô', chave: 'ROBO_CHAVE', titulo: 'Chave da IA (Anthropic)', situacao: 'FALTA', detalhe: 'Sem a chave, o robô não responde.', onde: '🤖 Robô (IA) → Configuração' });
  else itens.push({ grupo: 'Robô', chave: 'ROBO_CHAVE', titulo: 'Chave da IA (Anthropic)', situacao: 'OK', detalhe: 'Guardada.', onde: '🤖 Robô (IA) → Configuração' });
  if (!Array.isArray(publicado) || !publicado.length) itens.push({ grupo: 'Robô', chave: 'ROBO_CONTEUDO', titulo: 'Conteúdo do robô publicado', situacao: 'FALTA', detalhe: 'Nada publicado: o robô não tem o que responder.', onde: '🤖 Robô (IA) → Conteúdo' });
  else itens.push({ grupo: 'Robô', chave: 'ROBO_CONTEUDO', titulo: 'Conteúdo do robô publicado', situacao: 'OK', detalhe: `${publicado.length} assunto(s) publicado(s).`, onde: '🤖 Robô (IA) → Conteúdo' });
  if (!robo?.ligado) itens.push({ grupo: 'Robô', chave: 'ROBO_LIGADO', titulo: 'Robô ligado', situacao: 'ATENCAO', detalhe: 'Desligado. Tudo bem enquanto o Asksuite responde; na hora da troca (passo 7 do passo a passo), ligue o robô nos canais, senão ninguém responde na hora fora do horário.', onde: '🤖 Robô (IA) → Configuração' });
  else if (faltamNoRobo.length) itens.push({ grupo: 'Robô', chave: 'ROBO_LIGADO', titulo: 'Robô ligado', situacao: 'ATENCAO', detalhe: `Ligado, mas não responde em: ${faltamNoRobo.map((t) => nomeCanal[t]).join(', ')}. Na hora da troca, ligue esses canais na configuração do robô.`, onde: '🤖 Robô (IA) → Configuração' });
  else itens.push({ grupo: 'Robô', chave: 'ROBO_LIGADO', titulo: 'Robô ligado', situacao: 'OK', detalhe: 'Ligado no WhatsApp, Instagram, Facebook e chat do site.', onde: '🤖 Robô (IA) → Configuração' });
  const lacunas = lacunasR?.count || 0;
  itens.push(lacunas
    ? { grupo: 'Robô', chave: 'ROBO_LACUNAS', titulo: 'Perguntas que o robô não soube', situacao: 'ATENCAO', detalhe: `${lacunas} pergunta(s) esperando resposta no conteúdo.`, onde: '🤖 Robô (IA) → Perguntas que o robô não soube' }
    : { grupo: 'Robô', chave: 'ROBO_LACUNAS', titulo: 'Perguntas que o robô não soube', situacao: 'OK', detalhe: 'Nenhuma pendente.', onde: '🤖 Robô (IA) → Perguntas que o robô não soube' });

  // ---- 3. Equipe, horário e reservas -------------------------------------------
  const equipe = (equipeR?.data || []).filter((u) => u.ativo !== false && (u.papel === 'ADMIN' || (u.papel === 'COLABORADOR' && u.pode_acessar_atendimento)));
  itens.push(equipe.length > 1
    ? { grupo: 'Equipe e reservas', chave: 'EQUIPE', titulo: 'Equipe com acesso à Caixa de Entrada', situacao: 'OK', detalhe: `${equipe.length} pessoa(s) podem atender.`, onde: 'Administração → Usuários' }
    : { grupo: 'Equipe e reservas', chave: 'EQUIPE', titulo: 'Equipe com acesso à Caixa de Entrada', situacao: 'ATENCAO', detalhe: 'Só o administrador pode atender. Marque "Pode usar a Caixa de Entrada" para quem atende.', onde: 'Administração → Usuários' });
  const pref = prefR?.data || {};
  itens.push(pref.horario_comercial && Object.keys(pref.horario_comercial).length
    ? { grupo: 'Equipe e reservas', chave: 'HORARIO', titulo: 'Horário de atendimento', situacao: 'OK', detalhe: 'Configurado (o robô avisa quando a equipe volta).', onde: 'Funil e etiquetas → Horário comercial' }
    : { grupo: 'Equipe e reservas', chave: 'HORARIO', titulo: 'Horário de atendimento', situacao: 'ATENCAO', detalhe: 'Não configurado.', onde: 'Funil e etiquetas → Horário comercial' });
  itens.push(cbR?.data
    ? { grupo: 'Equipe e reservas', chave: 'CLOUDBEDS', titulo: 'Cloudbeds conectada', situacao: 'OK', detalhe: 'O robô consegue consultar preço e disponibilidade.', onde: 'Atendimento → Fichas de Hóspedes → Configurar Cloudbeds' }
    : { grupo: 'Equipe e reservas', chave: 'CLOUDBEDS', titulo: 'Cloudbeds conectada', situacao: 'FALTA', detalhe: 'Sem a Cloudbeds, não há cotação automática.', onde: 'Atendimento → Fichas de Hóspedes → Configurar Cloudbeds' });
  itens.push(pref.motor_url
    ? { grupo: 'Equipe e reservas', chave: 'MOTOR', titulo: 'Link do motor de reservas', situacao: 'OK', detalhe: pref.motor_url, onde: 'Funil e etiquetas → Motor de reservas e cotação' }
    : { grupo: 'Equipe e reservas', chave: 'MOTOR', titulo: 'Link do motor de reservas', situacao: 'FALTA', detalhe: 'Sem o link, o botão "Reservar agora" da cotação não funciona.', onde: 'Funil e etiquetas → Motor de reservas e cotação' });

  // ---- 4. O que vinha do Asksuite ---------------------------------------------
  const hist = histR?.count || 0;
  itens.push(hist
    ? { grupo: 'Do Asksuite', chave: 'HISTORICO', titulo: 'Histórico de conversas do Asksuite', situacao: 'OK', detalhe: `${hist.toLocaleString('pt-BR')} conversa(s) importada(s) para o Painel.`, onde: 'Contatos → Importar planilha (histórico do Asksuite)' }
    : { grupo: 'Do Asksuite', chave: 'HISTORICO', titulo: 'Histórico de conversas do Asksuite', situacao: 'ATENCAO', detalhe: 'Ainda não importado. Exporte a planilha do Asksuite ANTES de cancelar (depois não dá mais).', onde: 'Contatos → Importar planilha (histórico do Asksuite)' });
  const whats = canais.find((c) => c.tipo === 'WHATSAPP' && c.ativo);
  if (whats?.config?.wabaId) {
    let modelos = null;
    try { modelos = (await listarModelos({ token: await tokenDoCanal(supabaseAdmin, whats), wabaId: whats.config.wabaId })).length; } catch (e) { modelos = null; }
    itens.push(modelos === null
      ? { grupo: 'Do Asksuite', chave: 'MODELOS', titulo: 'Modelos aprovados do WhatsApp', situacao: 'ATENCAO', detalhe: 'Não deu para ler os modelos agora.', onde: '📣 WhatsApp → 📋 Modelos' }
      : modelos
        ? { grupo: 'Do Asksuite', chave: 'MODELOS', titulo: 'Modelos aprovados do WhatsApp', situacao: 'OK', detalhe: `${modelos} modelo(s) aprovado(s) na conta do WhatsApp (os do Asksuite continuam, porque a conta é de vocês).`, onde: '📣 WhatsApp → 📋 Modelos' }
        : { grupo: 'Do Asksuite', chave: 'MODELOS', titulo: 'Modelos aprovados do WhatsApp', situacao: 'ATENCAO', detalhe: 'Nenhum modelo aprovado: sem modelo, não dá para escrever para quem não falou nas últimas 24 h.', onde: '📣 WhatsApp → 📋 Modelos' });
  }
  const autos = (autoR?.data || []).filter((a) => a.ativo);
  itens.push(autos.length
    ? { grupo: 'Do Asksuite', chave: 'AUTOMACOES', titulo: 'Automações (follow-up, pré-check-in…)', situacao: 'OK', detalhe: `${autos.length} ligada(s).`, onde: '🔁 Automações' }
    : { grupo: 'Do Asksuite', chave: 'AUTOMACOES', titulo: 'Automações (follow-up, pré-check-in…)', situacao: 'ATENCAO', detalhe: 'Nenhuma ligada. Se o Asksuite mandava follow-up ou mensagens de pré-check-in, ligue as equivalentes.', onde: '🔁 Automações' });

  const faltas = itens.filter((i) => i.situacao === 'FALTA').length;
  const atencoes = itens.filter((i) => i.situacao === 'ATENCAO').length;
  return { itens, faltas, atencoes, pronto: faltas === 0, conferidoEm: new Date().toISOString() };
}
