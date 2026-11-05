// ============================================================================
// RESUMO SEMANAL POR E-MAIL PARA O GESTOR (M17)
// ============================================================================
// Toda segunda às 8h (função agendada da Netlify) e pelo botão "Enviar agora"
// (Funil e etiquetas). Um e-mail por hotel, com a semana de segunda a
// domingo: atendimentos, tempo de resposta, cotações, vendas em R$, meta do
// mês, oportunidades abertas, motivos da perda, robô e custo da IA,
// chamados de manutenção abertos.
// Vai para os ADMIN do hotel e os e-mails extras da tela. Sai pela caixa de
// e-mail (Gmail) ligada na Caixa de Entrada do hotel; sem ela, pelo Resend
// (se configurado). Decisão do dono (05/11/2026): e-mail, segunda às 8h.
// ============================================================================

import { funilEmReais } from './metas';
import { MOTIVOS_PERDA_CONVERSA } from './vendasConfig';
import { tokenDaCaixa, montarEmail, enviarEmail } from './gmail';

const FUSO = 'America/Fortaleza';
const DIA = 86400000;
const diaLocal = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: FUSO });
const brData = (iso) => iso.split('-').reverse().join('/');
const reais = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const inteiro = (n) => Number(n || 0).toLocaleString('pt-BR');
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Semana anterior completa (segunda a domingo), olhando de "agora"
export function semanaAnterior(agora = new Date()) {
  const hoje = diaLocal(agora);
  const [a, m, d] = hoje.split('-').map(Number);
  const diaSemana = new Date(Date.UTC(a, m - 1, d)).getUTCDay(); // 0 = domingo
  const desdeSegunda = (diaSemana + 6) % 7;
  const segundaAtual = new Date(Date.UTC(a, m - 1, d) - desdeSegunda * DIA);
  const inicio = new Date(segundaAtual.getTime() - 7 * DIA).toISOString().slice(0, 10);
  const fim = new Date(segundaAtual.getTime() - DIA).toISOString().slice(0, 10);
  return { inicio, fim };
}

export function minutosTexto(m) {
  if (m == null) return '—';
  const n = Math.round(Number(m));
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  return `${h} h${n % 60 ? ` ${n % 60} min` : ''}`;
}

export function listaDeEmails(texto) {
  return [...new Set(String(texto || '').split(/[\s,;]+/).map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))].slice(0, 10);
}

// dados → { assunto, html, texto } (sem acesso ao banco: testável)
export function montarResumo(d) {
  const t = d.totais || {};
  const s = d.semana_funil?.totais || {};
  const mes = d.mes_funil?.mes_atual || null;
  const linhas = [];
  const html = [];
  const secao = (titulo, itens) => {
    const validos = itens.filter(Boolean);
    if (!validos.length) return;
    linhas.push('', titulo.toUpperCase(), ...validos.map(([r, v]) => `• ${r}: ${v}`));
    html.push(`<h3 style="margin:18px 0 6px;font-size:15px;color:#14532D">${esc(titulo)}</h3>`,
      '<table style="border-collapse:collapse;font-size:14px">',
      ...validos.map(([r, v]) => `<tr><td style="padding:3px 16px 3px 0;color:#5B6762">${esc(r)}</td><td style="padding:3px 0"><strong>${esc(v)}</strong></td></tr>`),
      '</table>');
  };
  const periodo = `${brData(d.inicio)} a ${brData(d.fim)}`;

  secao('Atendimento', [
    ['Atendimentos', inteiro(t.atendimentos)],
    ['Contatos novos', inteiro(t.contatos_novos)],
    ['Fora do horário comercial', `${inteiro(t.fora_horario)} (${pct(t.fora_horario, t.atendimentos)})`],
    ['Tempo médio da 1ª resposta', minutosTexto(t.primeira_resposta_min)],
  ]);
  secao('Vendas da semana', [
    ['Cotações enviadas', `${inteiro(s.cotacoes)} · ${reais(s.cotado)} cotados`],
    ['Clicaram em Reservar agora', `${inteiro(s.clicaram)} (${pct(s.clicaram, s.cotacoes)})`],
    ['Reservas pelas cotações', `${inteiro(s.reservas)} · ${reais(s.vendido)}`],
    d.abertas ? ['Oportunidades abertas (cotação sem reserva, chegada futura)', `${inteiro(d.abertas.quantidade)} · ${reais(d.abertas.valor)}`] : null,
  ]);
  if (mes) {
    secao(`Meta do mês (até ${brData(d.hoje)})`, [
      ['Vendido no mês', reais(mes.vendido)],
      mes.meta != null ? ['Meta', `${reais(mes.meta)} · ${pct(mes.vendido, mes.meta)} atingido`] : ['Meta', 'não definida (Caixa de Entrada → Painel)'],
      mes.projecao != null ? ['No ritmo atual, o mês fecha em', `${reais(mes.projecao)}${mes.meta ? ` (${pct(mes.projecao, mes.meta)} da meta)` : ''}`] : null,
    ]);
  }
  const perdas = Object.entries(d.perdas || {}).sort((a, b) => b[1] - a[1]);
  if (perdas.length) secao('Por que não fecharam (conversas arquivadas)', perdas.map(([k, n]) => [MOTIVOS_PERDA_CONVERSA[k] || k, inteiro(n)]));
  if (d.robo) {
    secao('Robô (IA)', [
      ['Conversas atendidas pelo robô', inteiro(d.robo.conversas)],
      ['Resolveu sem a equipe', `${inteiro(d.robo.resolveu_sozinho)} (${pct(d.robo.resolveu_sozinho, d.robo.conversas)})`],
      d.robo.lacunas != null ? ['Perguntas que o robô não soube', inteiro(d.robo.lacunas)] : null,
      d.robo.custo_usd != null ? ['Custo da IA na semana', Number(d.robo.custo_usd).toLocaleString('pt-BR', { style: 'currency', currency: 'USD' })] : null,
    ]);
  }
  if (d.manutencao) {
    secao('Manutenção', [
      ['Chamados abertos agora', inteiro(d.manutencao.abertos)],
      ['Urgentes (prioridade alta) abertos', inteiro(d.manutencao.urgentes)],
      ['Concluídos na semana', inteiro(d.manutencao.concluidos)],
    ]);
  }
  const assunto = `Resumo da semana — ${d.hotel} (${periodo})`;
  const topo = `Resumo da semana de ${periodo} — ${d.hotel}`;
  const texto = [topo, ...linhas, '', 'Detalhes no sistema: Caixa de Entrada → Painel.'].join('\n');
  const corpo = [
    `<h2 style="margin:0 0 4px;font-size:18px">${esc(topo)}</h2>`,
    ...html,
    `<p style="margin-top:18px;color:#5B6762;font-size:13px">Detalhes no sistema: Caixa de Entrada → Painel${d.origem ? ` (<a href="${esc(d.origem)}/atendimento?aba=painel">abrir</a>)` : ''}.</p>`,
  ].join('\n');
  return { assunto, html: corpo, texto };
}

// ---------------------------------------------------------------- banco (servidor)
export async function destinatariosDoResumo(supabaseAdmin, hotelId, extras) {
  const emails = new Set(listaDeEmails(extras));
  const { data: diretos } = await supabaseAdmin.from('usuarios').select('email, ativo').eq('hotel_id', hotelId).eq('papel', 'ADMIN');
  (diretos || []).filter((u) => u.ativo !== false).forEach((u) => listaDeEmails(u.email).forEach((e) => emails.add(e)));
  const { data: vinculos } = await supabaseAdmin.from('vinculos_usuario_hotel').select('auth_id').eq('hotel_id', hotelId).eq('papel', 'ADMIN').eq('ativo', true);
  const auths = (vinculos || []).map((v) => v.auth_id).filter(Boolean);
  if (auths.length) {
    const { data: us } = await supabaseAdmin.from('usuarios').select('email, ativo').in('auth_id', auths);
    (us || []).filter((u) => u.ativo !== false).forEach((u) => listaDeEmails(u.email).forEach((e) => emails.add(e)));
  }
  return [...emails];
}

async function dadosDoHotel(supabaseAdmin, hotelId, { inicio, fim, origem }) {
  const { data: hotel } = await supabaseAdmin.from('hoteis').select('nome_fantasia').eq('id', hotelId).maybeSingle();
  const hoje = diaLocal(new Date());
  const { data: painel } = await supabaseAdmin.rpc('atendimento_painel', { p_hoteis: [hotelId], p_inicio: inicio, p_fim: fim });
  const { data: robo } = await supabaseAdmin.rpc('atendimento_painel_robo', { p_hoteis: [hotelId], p_inicio: inicio, p_fim: fim });
  const semana_funil = await funilEmReais(supabaseAdmin, [hotelId], inicio, fim);
  const mes_funil = await funilEmReais(supabaseAdmin, [hotelId], `${hoje.slice(0, 7)}-01`, hoje);
  const de = new Date(`${inicio}T03:00:00Z`).toISOString();
  const ate = new Date(new Date(`${fim}T03:00:00Z`).getTime() + DIA).toISOString();

  // Oportunidades abertas: cotação dos últimos 14 dias, sem reserva, chegada futura
  const { data: abertas } = await supabaseAdmin.from('atendimento_cotacoes').select('valor_minimo')
    .eq('hotel_id', hotelId).in('status', ['ENVIADA', 'CLICOU']).gte('checkin', hoje)
    .gte('criado_em', new Date(Date.now() - 14 * DIA).toISOString()).limit(2000);
  const { data: perdasLinhas, error: erroPerdas } = await supabaseAdmin.from('atendimento_conversas').select('motivo_perda')
    .eq('hotel_id', hotelId).gte('motivo_perda_em', de).lt('motivo_perda_em', ate).not('motivo_perda', 'is', null).limit(2000);
  const perdas = {};
  if (!erroPerdas) (perdasLinhas || []).forEach((c) => { perdas[c.motivo_perda] = (perdas[c.motivo_perda] || 0) + 1; });
  let roboFinal = robo || null;
  if (roboFinal) {
    const { count } = await supabaseAdmin.from('atendimento_robo_lacunas').select('id', { count: 'exact', head: true })
      .eq('hotel_id', hotelId).gte('criado_em', de).lt('criado_em', ate);
    roboFinal = { ...roboFinal, lacunas: count ?? null };
  }
  let manutencao = null;
  const { data: chamados, error: erroMan } = await supabaseAdmin.from('manutencoes').select('status, prioridade, concluido_em').eq('hotel_id', hotelId)
    .or(`status.neq.CONCLUIDO,concluido_em.gte.${de}`).limit(2000);
  if (!erroMan) {
    const abertos = (chamados || []).filter((c) => c.status !== 'CONCLUIDO');
    manutencao = {
      abertos: abertos.length, urgentes: abertos.filter((c) => c.prioridade === 'ALTA').length,
      concluidos: (chamados || []).filter((c) => c.status === 'CONCLUIDO' && c.concluido_em && c.concluido_em >= de && c.concluido_em < ate).length,
    };
  }
  return {
    hotel: hotel?.nome_fantasia || `Hotel ${hotelId}`, inicio, fim, hoje, origem,
    totais: painel?.totais || {}, semana_funil, mes_funil, robo: roboFinal, perdas, manutencao,
    abertas: { quantidade: (abertas || []).length, valor: (abertas || []).reduce((s, c) => s + Number(c.valor_minimo || 0), 0) },
  };
}

async function enviarPeloSistema(supabaseAdmin, hotelId, { para, assunto, html, texto }) {
  const { data: caixas } = await supabaseAdmin.from('atendimento_canais').select('*').eq('hotel_id', hotelId).eq('tipo', 'EMAIL').eq('ativo', true).order('id').limit(1);
  const canal = caixas?.[0];
  if (canal) {
    const token = await tokenDaCaixa(supabaseAdmin, canal);
    const { mime } = montarEmail({ de: canal.identificador, nomeRemetente: canal.config?.nomeExibicao || canal.nome, para: para.join(', '), assunto, texto, html });
    await enviarEmail({ token, threadId: null, mime });
    return `caixa ${canal.identificador}`;
  }
  const chave = process.env.RESEND_API_KEY;
  if (!chave) throw new Error('o hotel não tem caixa de e-mail ligada na Caixa de Entrada (⚙️ Canais) para enviar o resumo');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.RESEND_FROM_EMAIL || 'Chokmah System <onboarding@resend.dev>', to: para, subject: assunto, html, text: texto }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.message || 'o Resend recusou o envio');
  return 'Resend';
}

// origemEnvio: 'AGENDADO' (segunda 8h, uma vez por semana) ou 'MANUAL' (botão)
export async function enviarResumo(supabaseAdmin, hotelId, { origemEnvio = 'MANUAL', origem = '', agora = new Date() } = {}) {
  const { inicio, fim } = semanaAnterior(agora);
  const { data: pref } = await supabaseAdmin.from('atendimento_preferencias').select('*').eq('hotel_id', hotelId).maybeSingle();
  if (origemEnvio === 'AGENDADO') {
    if (pref && pref.resumo_semanal === false) return { ignorado: 'resumo desligado' };
    const { data: ja } = await supabaseAdmin.from('atendimento_resumos').select('id').eq('hotel_id', hotelId).eq('semana', inicio).eq('origem', 'AGENDADO').not('enviado_em', 'is', null).limit(1);
    if (ja?.length) return { ignorado: 'já enviado nesta semana' };
  }
  const para = await destinatariosDoResumo(supabaseAdmin, hotelId, pref?.resumo_emails_extras);
  const registro = { hotel_id: hotelId, semana: inicio, origem: origemEnvio, para: para.join(', ') || null };
  if (!para.length) {
    await supabaseAdmin.from('atendimento_resumos').insert({ ...registro, erro: 'nenhum e-mail para enviar' });
    return { erro: 'Nenhum e-mail para enviar: os administradores não têm e-mail cadastrado e não há e-mail extra.' };
  }
  try {
    const dados = await dadosDoHotel(supabaseAdmin, hotelId, { inicio, fim, origem });
    const email = montarResumo(dados);
    const via = await enviarPeloSistema(supabaseAdmin, hotelId, { para, ...email });
    await supabaseAdmin.from('atendimento_resumos').insert({ ...registro, enviado_em: new Date().toISOString() });
    return { sucesso: true, para, via, assunto: email.assunto };
  } catch (e) {
    const msg = String(e.message || e).slice(0, 300);
    await supabaseAdmin.from('atendimento_resumos').insert({ ...registro, erro: msg });
    return { erro: `Não foi possível enviar o resumo: ${msg}.` };
  }
}
