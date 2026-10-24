// ============================================================================
// CAIXA DE ENTRADA — IMPORTAR O HISTÓRICO DO ASKSUITE (só no servidor)
// ============================================================================
// Planilha "Conversas" exportada do Asksuite: uma linha por conversa.
//  - telefone/e-mail → contato (sem duplicar), com as etiquetas que estavam
//    "Sim" e a marca ⭐ "já reservou"
//  - a linha inteira → atendimento_historico_externo (aparece no contato e
//    no Painel). Importar de novo atualiza, não duplica.
//  - limpeza do que a importação comum de contatos deixou (etiquetas "Sim/
//    Não", nome "---------" e e-mails automáticos de sistemas)
// ============================================================================

import crypto from 'crypto';
import { soDigitos } from './servidor';
import { variantesNumero } from './whatsapp';

const VAZIO = /^-{3,}$/;
// E-mails automáticos (avisos de sistemas, propaganda) — não são clientes
export const EMAIL_DE_SISTEMA = /(no-?reply|nao-?responda|naoresponda|do-?not-?reply|mailer-daemon|postmaster|bounce)|^(notifica(c|ç)(a|ã)o|notifications?|informativo|newsletter|news|marketing|alertas?)@|@([a-z0-9-]+\.)*(cloudbeds\.com|asksuite\.com|booking\.com|expedia\.com|airbnb\.com|despegar\.com|decolar\.com|linkedin\.com|facebookmail\.com|bubbleapps\.io|mailchimp\.com|sendgrid\.net)$/i;
const RELAY_DE_HOSPEDE = /@guest\.booking\.com$|@m\.expediapartnercentral\.com$/i; // e-mail do hóspede (vale)
const ETIQUETAS_LIXO = /^(sim|não|nao)(\s*,\s*(sim|não|nao))*$/i;

function limpo(valor, max = 200) {
  const t = String(valor ?? '').replace(/\s+/g, ' ').trim();
  return !t || VAZIO.test(t) ? null : t.slice(0, max);
}

function telefone(valor) {
  const t = limpo(valor, 40);
  if (!t) return null;
  let d = soDigitos(t).replace(/^0+/, '');
  if ((d.length === 10 || d.length === 11) && !t.startsWith('+')) d = `55${d}`;
  return d.length >= 8 && d.length <= 15 ? d : null;
}

function email(valor) {
  const e = String(valor ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e.slice(0, 200) : null;
}

// "23/10/2026 08:58" → ISO (horário de João Pessoa)
function dataHoraBR(valor) {
  const m = String(valor ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const d = new Date(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T${(m[4] || '12').padStart(2, '0')}:${m[5] || '00'}:00-03:00`);
  return Number.isNaN(d.getTime()) || d.getFullYear() < 2000 ? null : d.toISOString();
}

function dataBR(valor) {
  const m = String(valor ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

function valorBR(valor) {
  let t = String(valor ?? '').replace(/R\$|\s| /g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function inteiro(valor) {
  const n = Math.trunc(Number(valor));
  return Number.isFinite(n) && n >= 0 && n < 1000 ? n : null;
}

// Uma linha da planilha → registro do histórico (+ dados do contato)
export function normalizarLinha(l) {
  if (!l || typeof l !== 'object') return null;
  const etiquetas = (Array.isArray(l.etiquetas) ? l.etiquetas : [])
    .map((e) => String(e || '').trim().slice(0, 80)).filter(Boolean).slice(0, 60);
  const codigo = limpo(l.reservaCodigo, 40);
  const reservou = !!codigo || etiquetas.some((e) => /reservou/i.test(e) && !/cancel/i.test(e));
  const link = limpo(l.link, 400);
  const r = {
    criado_origem: dataHoraBR(l.criado),
    atualizado_origem: dataHoraBR(l.atualizado),
    plataforma: limpo(l.plataforma, 40),
    fonte: limpo(l.fonte, 40),
    pediu_cotacao: /^sim$/i.test(String(l.cotou || '').trim()),
    clicou_reservar: /^sim$/i.test(String(l.clicou || '').trim()),
    reservou,
    reserva_codigo: codigo,
    reserva_valor: valorBR(l.reservaValor),
    reserva_em: dataHoraBR(l.reservaEm),
    reserva_agente: limpo(l.reservaAgente, 80),
    chegada: dataBR(l.chegada),
    partida: dataBR(l.partida),
    adultos: inteiro(l.adultos),
    criancas: inteiro(l.criancas),
    agente: limpo(l.agente, 80),
    etiquetas,
    idioma: limpo(l.idioma, 20),
    cidade: limpo(l.cidade, 80),
    pais: limpo(l.pais, 80),
    link: link && /^https:\/\//i.test(link) ? link : null,
  };
  // Chave: o link da conversa; sem link, um resumo da linha
  r.chave = r.link || crypto.createHash('sha256')
    .update(JSON.stringify([l.criado, l.telefone, l.email, l.nome, l.fonte, l.agente])).digest('hex').slice(0, 32);
  r.contato = { telefone: telefone(l.telefone), email: email(l.email), nome: limpo(l.nome, 120) };
  if (r.contato.email && EMAIL_DE_SISTEMA.test(r.contato.email) && !RELAY_DE_HOSPEDE.test(r.contato.email)) r.contato.email = null;
  return r;
}

async function buscarEmLotes(supabaseAdmin, hotelId, coluna, valores) {
  const saida = [];
  for (let i = 0; i < valores.length; i += 150) {
    const { data, error } = await supabaseAdmin.from('atendimento_contatos')
      .select('id, nome, telefone, email, idioma, etiquetas_importadas, ja_reservou, criado_em, origem')
      .eq('hotel_id', hotelId).in(coluna, valores.slice(i, i + 150));
    if (error) throw error;
    saida.push(...(data || []));
  }
  return saida;
}

// Limpeza do que a importação comum deixou (roda no primeiro lote)
export async function limparImportacaoAnterior(supabaseAdmin, hotelId) {
  const resultado = { nomes: 0, etiquetas: 0, sistema: 0, emails: 0 };
  const { data: nomes } = await supabaseAdmin.from('atendimento_contatos').update({ nome: null })
    .eq('hotel_id', hotelId).like('nome', '---%').select('id');
  resultado.nomes = nomes?.length || 0;

  const importados = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabaseAdmin.from('atendimento_contatos')
      .select('id, telefone, email, etiquetas_importadas').eq('hotel_id', hotelId).eq('origem', 'IMPORTADO').order('id').range(de, de + 999);
    if (error) throw error;
    importados.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const comLixo = importados.filter((c) => c.etiquetas_importadas && ETIQUETAS_LIXO.test(c.etiquetas_importadas.trim())).map((c) => c.id);
  for (let i = 0; i < comLixo.length; i += 300) {
    await supabaseAdmin.from('atendimento_contatos').update({ etiquetas_importadas: null }).in('id', comLixo.slice(i, i + 300));
  }
  resultado.etiquetas = comLixo.length;

  // E-mails automáticos: com telefone, só o e-mail sai do contato; sem
  // telefone e sem nenhuma conversa, o contato sai da lista
  const ehSistema = (e) => e && EMAIL_DE_SISTEMA.test(e) && !RELAY_DE_HOSPEDE.test(e);
  const soEmail = importados.filter((c) => c.telefone && ehSistema(c.email)).map((c) => c.id);
  for (let i = 0; i < soEmail.length; i += 300) {
    await supabaseAdmin.from('atendimento_contatos').update({ email: null }).in('id', soEmail.slice(i, i + 300));
  }
  resultado.emails = soEmail.length;
  const candidatos = importados.filter((c) => !c.telefone && ehSistema(c.email)).map((c) => c.id);
  if (candidatos.length) {
    const { data: usados } = await supabaseAdmin.from('atendimento_conversas').select('contato_id').in('contato_id', candidatos);
    const comConversa = new Set((usados || []).map((u) => u.contato_id));
    const apagar = candidatos.filter((id) => !comConversa.has(id));
    for (let i = 0; i < apagar.length; i += 300) {
      await supabaseAdmin.from('atendimento_contatos').delete().in('id', apagar.slice(i, i + 300));
    }
    resultado.sistema = apagar.length;
  }
  return resultado;
}

export async function importarLote(supabaseAdmin, hotelId, linhas) {
  const registros = linhas.map(normalizarLinha).filter(Boolean);

  // Contatos já existentes (pelo telefone, nas duas formas, e pelo e-mail)
  const fones = [...new Set(registros.flatMap((r) => (r.contato.telefone ? variantesNumero(r.contato.telefone) : [])))];
  const emails = [...new Set(registros.map((r) => r.contato.email).filter(Boolean))];
  const existentes = [
    ...(fones.length ? await buscarEmLotes(supabaseAdmin, hotelId, 'telefone', fones) : []),
    ...(emails.length ? await buscarEmLotes(supabaseAdmin, hotelId, 'email', emails) : []),
  ];
  const porTelefone = new Map();
  const porEmail = new Map();
  const registrar = (c) => {
    if (c.telefone) variantesNumero(c.telefone).forEach((v) => porTelefone.set(v, c));
    if (c.email) porEmail.set(String(c.email).toLowerCase(), c);
  };
  existentes.forEach(registrar);

  const novos = [];
  const mudancas = new Map(); // id → campos
  const ligacao = new Map(); // registro → contato (existente ou novo)
  for (const r of registros) {
    const { telefone: tel, email: mail, nome } = r.contato;
    if (!tel && !mail) continue;
    let c = (tel && variantesNumero(tel).map((v) => porTelefone.get(v)).find(Boolean)) || (mail && porEmail.get(mail));
    const etiquetasLinha = r.etiquetas.filter((e) => !/^tag - /i.test(e));
    if (!c) {
      c = {
        hotel_id: hotelId, nome, telefone: tel, email: mail, idioma: r.idioma, origem: 'IMPORTADO',
        etiquetas_importadas: etiquetasLinha.join(', ') || null, ja_reservou: r.reservou,
        criado_em: r.criado_origem || new Date().toISOString(), atualizado_em: r.atualizado_origem || r.criado_origem || new Date().toISOString(),
      };
      novos.push(c);
      registrar(c);
    } else {
      const m = mudancas.get(c.id) || {};
      const atual = { ...c, ...m };
      if ((!atual.nome || VAZIO.test(atual.nome)) && nome) m.nome = nome;
      if (!atual.telefone && tel) m.telefone = tel;
      if (!atual.email && mail) m.email = mail;
      if (!atual.idioma && r.idioma) m.idioma = r.idioma;
      if (r.reservou && !atual.ja_reservou) m.ja_reservou = true;
      const antigas = atual.etiquetas_importadas && !ETIQUETAS_LIXO.test(atual.etiquetas_importadas.trim())
        ? atual.etiquetas_importadas.split(',').map((x) => x.trim()).filter(Boolean) : [];
      const juntas = [...new Set([...antigas, ...etiquetasLinha])];
      if (juntas.join(', ') !== (atual.etiquetas_importadas || '') && (juntas.length || atual.etiquetas_importadas)) {
        m.etiquetas_importadas = juntas.join(', ').slice(0, 1000) || null;
      }
      if (c.origem === 'IMPORTADO' && r.criado_origem && (!atual.criado_em || r.criado_origem < atual.criado_em)) m.criado_em = r.criado_origem;
      if (Object.keys(m).length && c.id) { mudancas.set(c.id, m); Object.assign(c, m); }
      else if (Object.keys(m).length) Object.assign(c, m); // contato novo deste mesmo lote
    }
    ligacao.set(r, c);
  }

  // Grava os contatos novos e descobre os ids
  for (let i = 0; i < novos.length; i += 300) {
    const lote = novos.slice(i, i + 300);
    const { data, error } = await supabaseAdmin.from('atendimento_contatos').insert(lote.map((c) => ({ ...c })))
      .select('id, telefone, email');
    if (error) throw error;
    (data || []).forEach((d) => {
      const alvo = lote.find((c) => !c.id && ((d.telefone && c.telefone === d.telefone) || (d.email && c.email === d.email)));
      if (alvo) alvo.id = d.id;
    });
  }
  for (const [id, m] of mudancas) {
    const { error } = await supabaseAdmin.from('atendimento_contatos').update(m).eq('id', id);
    if (error) throw error;
  }

  // Histórico (importar de novo atualiza a mesma linha)
  const historico = registros.map((r) => {
    const { contato, ...resto } = r;
    return { ...resto, hotel_id: hotelId, sistema: 'ASKSUITE', contato_id: ligacao.get(r)?.id || null, importado_em: new Date().toISOString() };
  });
  const unicos = [...new Map(historico.map((h) => [h.chave, h])).values()];
  for (let i = 0; i < unicos.length; i += 300) {
    const { error } = await supabaseAdmin.from('atendimento_historico_externo')
      .upsert(unicos.slice(i, i + 300), { onConflict: 'hotel_id,sistema,chave' });
    if (error) throw error;
  }

  return {
    linhas: registros.length,
    contatosNovos: novos.length,
    contatosAtualizados: mudancas.size,
    semContato: registros.filter((r) => !ligacao.get(r)).length,
  };
}
