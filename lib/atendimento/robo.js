// ============================================================================
// CAIXA DE ENTRADA — ROBÔ COM IA (Fase 4) — só usado no servidor
// ============================================================================
// O robô responde os clientes 24 horas, até alguém da equipe assumir:
//   - responde dúvidas com o conteúdo publicado do hotel e os dados da Cloudbeds
//   - consulta preço e disponibilidade e envia a cotação com "Reservar agora"
//   - registra solicitações (grupo, pedido especial, problema ao reservar…)
//   - passa a conversa para a equipe quando o cliente pede ou quando não sabe
// A IA é a da Anthropic (Claude), paga por uso com a chave do próprio hotel
// (guardada criptografada). Cada chamada fica registrada com o custo.
//
// Quando o robô responde:
//   - o robô do hotel está ligado e o canal da conversa está marcado;
//   - a conversa não está pausada (pausa = alguém assumiu ou o robô passou para
//     a equipe). A pausa acaba quando a conversa é resolvida/arquivada, quando
//     alguém clica "Devolver ao robô", ou depois de N horas sem a equipe
//     escrever (configurável).
// O webhook do WhatsApp chama o robô assim que a mensagem chega. Se não der
// tempo (limite de 10 s da Netlify), a função agendada tenta de novo.
//
// Modo econômico (ligado por padrão): desde 1º/10/2026 a Meta cobra cada
// mensagem enviada. O robô junta tudo o que tem a dizer — inclusive a
// cotação — numa mensagem só, e não manda "vou verificar…" separado.
//
// Outro hotel do grupo: sem quarto aqui, a consulta já olha os hotéis do
// grupo que o ADMIN liberou (Robô → Configuração) e o robô manda a cotação
// de lá na mesma mensagem. A conversa continua neste hotel.
// ============================================================================

import { lerSegredo } from './servidor';
import { conexaoCloudbeds } from './cloudbeds';
import { chamarCloudbeds } from '../cloudbedsCaixa';
import { buscarDisponibilidade, dataBR, reais } from './cotacao';
import {
  enviarPelaConversa, enviarCotacao, prepararCotacao, concluirCotacao, cancelarCotacao,
  registrarSemDisponibilidade, gravarNota, enviarEmailAvulso,
} from './envio';
import { MODELOS_IA, MODELO_PADRAO, TIPOS_SOLICITACAO, PAUSA_QUE_CONTINUA, custoDaChamada, pausaBloqueiaRobo } from './roboConfig';
import { carregarOutrosHoteis } from './outrosHoteis';
import {
  FERRAMENTA_REVISAO, MAX_CARACTERES_REVISAO, instrucoesRevisao, mensagemRevisao, conferirAchados, assuntosParaRevisar, hojeExtenso,
} from './roboRevisao';
import { numerosDoGrupo } from './gruposConfig';

const API_ANTHROPIC = 'https://api.anthropic.com/v1/messages';
const VERSAO_API = '2023-06-01';
const FUSO = 'America/Fortaleza';
const MAX_RODADAS = 5;               // chamadas à IA por resposta (com ferramentas)
const ESPERA_JUNTAR_MS = 1500;       // espera curta para juntar mensagens seguidas do cliente
const PENDENTE_ATE_MIN = 15;         // depois disso o robô não responde mais (a equipe assume)
const TRAVA_S = 90;
const INFO_VALIDADE_DIAS = 7;
export const CHAVE_SEGREDO = 'anthropic_chave';
const MENSAGEM_RESERVA = 'Recebemos sua mensagem! 😊 Nossa equipe vai te responder assim que possível.';

export class ErroIA extends Error {
  constructor(mensagem, codigo, status) { super(mensagem); this.codigo = codigo; this.status = status; }
}

const ERROS_DE_CONFIGURACAO = ['CHAVE', 'CREDITO', 'PERMISSAO', 'MODELO'];
// Chave: "Authorization: Bearer" (forma atual da API; "x-api-key" ainda funciona).
// A chave precisa ser criada já ligada a um workspace no console da Anthropic.

// ---------------------------------------------------------------------------
// Chamada à API da Anthropic
// ---------------------------------------------------------------------------
function traduzirErroIA(status, erro) {
  const tipo = erro?.type;
  const msg = String(erro?.message || '');
  if (/not scoped to a workspace|anthropic-workspace-id/i.test(msg)) return new ErroIA('Esta chave não está ligada a um workspace. No console da Anthropic, crie a chave de novo escolhendo um workspace (por exemplo, "Default").', 'CHAVE', status);
  if (status === 401 || tipo === 'authentication_error') return new ErroIA('A chave da Anthropic não foi aceita. Confira se copiou a chave inteira ou crie uma nova no console da Anthropic.', 'CHAVE', status);
  if (/credit balance|billing|purchase credits|spend limit|usage limit/i.test(msg)) return new ErroIA('Acabou o crédito (ou o limite de gasto) na conta da Anthropic. Coloque mais crédito no console da Anthropic, em Billing.', 'CREDITO', status);
  if (status === 403 || tipo === 'permission_error') return new ErroIA('A chave da Anthropic não tem permissão para usar este modelo.', 'PERMISSAO', status);
  if (status === 404 || tipo === 'not_found_error') return new ErroIA('O modelo de IA escolhido não foi encontrado. Escolha outro na configuração do robô.', 'MODELO', status);
  if (status === 429 || tipo === 'rate_limit_error') return new ErroIA('Muitas chamadas seguidas para a IA (limite da conta da Anthropic). Tente de novo em instantes.', 'LIMITE', status);
  if (status === 529 || tipo === 'overloaded_error') return new ErroIA('A IA está sobrecarregada agora. Tente de novo em instantes.', 'SOBRECARGA', status);
  return new ErroIA(`A IA recusou o pedido (código ${status})${msg ? `: ${msg.slice(0, 200)}` : ''}.`, 'OUTRO', status);
}

export async function chamarClaude({ chave, modelo, system, tools, toolChoice, messages, maxTokens = 700, tempoMs = 25000 }) {
  let resposta;
  try {
    resposta = await fetch(API_ANTHROPIC, {
      method: 'POST',
      headers: { Authorization: `Bearer ${chave}`, 'anthropic-version': VERSAO_API, 'content-type': 'application/json' },
      body: JSON.stringify({ model: modelo, max_tokens: maxTokens, system, ...(tools?.length ? { tools } : {}), ...(toolChoice ? { tool_choice: toolChoice } : {}), messages }),
      signal: AbortSignal.timeout(Math.max(1000, tempoMs)),
    });
  } catch (e) {
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw new ErroIA('A IA demorou demais para responder.', 'TEMPO');
    throw new ErroIA('Sem conexão com a IA (Anthropic). Tente de novo em instantes.', 'REDE');
  }
  const dados = await resposta.json().catch(() => null);
  if (!resposta.ok || !dados || dados.type === 'error') throw traduzirErroIA(resposta.status, dados?.error);
  return dados;
}

// Teste rápido da chave (custa uma fração de centavo)
export async function testarChave(chave, modelo = MODELO_PADRAO) {
  await chamarClaude({
    chave, modelo, maxTokens: 5, tempoMs: 15000,
    system: 'Responda só "ok".', messages: [{ role: 'user', content: 'teste' }],
  });
  return true;
}

async function registrarUso(supabaseAdmin, { hotelId, conversaId, origem, modelo, uso }) {
  const custo = custoDaChamada(modelo, uso);
  try {
    await supabaseAdmin.from('atendimento_robo_uso').insert({
      hotel_id: hotelId, conversa_id: conversaId || null, origem, modelo,
      tokens_entrada: uso?.input_tokens || 0, tokens_cache_leitura: uso?.cache_read_input_tokens || 0,
      tokens_cache_escrita: uso?.cache_creation_input_tokens || 0, tokens_saida: uso?.output_tokens || 0,
      custo_usd: Math.round(custo * 1e6) / 1e6,
    });
  } catch (e) { /* o registro de uso não pode impedir a resposta */ }
  return custo;
}

// ---------------------------------------------------------------------------
// Horário comercial (igual à função atendimento_fora_do_horario do banco)
// ---------------------------------------------------------------------------
const HORARIO_PADRAO = { 1: ['08:00', '18:00'], 2: ['08:00', '18:00'], 3: ['08:00', '18:00'], 4: ['08:00', '18:00'], 5: ['08:00', '18:00'], 6: ['08:00', '12:00'] };
const DIAS_SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

function partesLocais(data = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  }).formatToParts(data).map((x) => [x.type, x.value]));
  const dow = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday];
  return { iso: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour === '24' ? '00' : p.hour}:${p.minute}`, dow };
}

export function situacaoEquipe(horario, agora = new Date()) {
  const h = horario && typeof horario === 'object' ? horario : HORARIO_PADRAO;
  const { hora, dow } = partesLocais(agora);
  const faixa = h[String(dow)];
  const aberto = Array.isArray(faixa) && faixa.length >= 2 && hora >= faixa[0] && hora < faixa[1];
  if (aberto) return { aberto: true, texto: `a equipe está trabalhando agora (até as ${faixa[1]})` };
  for (let i = 0; i <= 7; i += 1) {
    const d = (dow + i) % 7;
    const f = h[String(d)];
    if (!Array.isArray(f) || f.length < 2) continue;
    if (i === 0 && hora >= f[0]) continue;
    const quando = i === 0 ? 'hoje' : i === 1 ? 'amanhã' : `${DIAS_SEMANA[d]}`;
    return { aberto: false, texto: `a equipe está fora do horário agora e volta ${quando} às ${f[0]}`, volta: `${quando} às ${f[0]}` };
  }
  return { aberto: false, texto: 'a equipe está fora do horário agora' };
}

// ---------------------------------------------------------------------------
// Dados do hotel na Cloudbeds (endereço, horários, quartos), guardados por 7 dias
// ---------------------------------------------------------------------------
const semHtml = (t, max = 600) => String(t || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim().slice(0, max);

export async function lerInfoHotelCloudbeds(cb) {
  const info = { quartos: [] };
  try {
    const r = await chamarCloudbeds(cb, 'getHotelDetails', { verbo: 'GET' });
    const d = r?.data || {};
    const end = d.propertyAddress || {};
    const pol = d.propertyPolicy || {};
    Object.assign(info, {
      nome: d.propertyName || null,
      descricao: semHtml(d.propertyDescription, 1500) || null,
      endereco: [end.propertyAddress1, end.propertyAddress2, end.propertyCity, end.propertyState, end.propertyZip].filter(Boolean).join(', ') || null,
      telefone: d.propertyPhone || null,
      email: d.propertyEmail || null,
      checkin: pol.propertyCheckInTime || null,
      checkout: pol.propertyCheckOutTime || null,
      lateCheckout: pol.propertyLateCheckOutAllowed ? semHtml(`${pol.propertyLateCheckOutType || ''} ${pol.propertyLateCheckOutValue || ''}`, 120) || 'permitido' : null,
      termos: semHtml(pol.propertyTermsAndConditions, 1500) || null,
      comodidades: (Array.isArray(d.propertyAmenities) ? d.propertyAmenities : []).map((a) => semHtml(typeof a === 'string' ? a : a?.name, 60)).filter(Boolean).slice(0, 40),
    });
  } catch (e) { info.erroHotel = e.message; }
  try {
    const r = await chamarCloudbeds(cb, 'getRoomTypes', { verbo: 'GET' });
    const lista = Array.isArray(r?.data) ? r.data : [];
    info.quartos = lista.map((q) => ({
      nome: String(q.roomTypeName || 'Quarto'),
      capacidade: Number(q.maxGuests) || null,
      descricao: semHtml(q.roomTypeDescription, 500) || null,
      comodidades: (Array.isArray(q.roomTypeFeatures) ? q.roomTypeFeatures : Object.values(q.roomTypeFeatures || {}))
        .map((f) => semHtml(typeof f === 'string' ? f : f?.name, 60)).filter(Boolean).slice(0, 25),
    })).slice(0, 20);
  } catch (e) { info.erroQuartos = e.message; }
  return info;
}

export async function atualizarInfoHotel(supabaseAdmin, hotelId) {
  const cb = await conexaoCloudbeds(supabaseAdmin, hotelId);
  const info = await lerInfoHotelCloudbeds(cb);
  await supabaseAdmin.from('atendimento_robo').upsert({ hotel_id: hotelId, hotel_info: info, hotel_info_em: new Date().toISOString() }, { onConflict: 'hotel_id' });
  return info;
}

// ---------------------------------------------------------------------------
// Instruções do robô (a parte fixa vai em cache: fica bem mais barata)
// ---------------------------------------------------------------------------
function textoInfoHotel(info) {
  if (!info) return 'Sem dados da Cloudbeds.';
  const linhas = [];
  if (info.nome) linhas.push(`Nome: ${info.nome}`);
  if (info.endereco) linhas.push(`Endereço: ${info.endereco}`);
  if (info.telefone) linhas.push(`Telefone: ${info.telefone}`);
  if (info.email) linhas.push(`E-mail: ${info.email}`);
  if (info.checkin) linhas.push(`Horário de check-in: a partir das ${info.checkin}`);
  if (info.checkout) linhas.push(`Horário de check-out: até as ${info.checkout}`);
  if (info.lateCheckout) linhas.push(`Late check-out: ${info.lateCheckout}`);
  if (info.descricao) linhas.push(`Descrição: ${info.descricao}`);
  if (info.comodidades?.length) linhas.push(`Comodidades: ${info.comodidades.join(', ')}`);
  if (info.quartos?.length) {
    linhas.push('Tipos de quarto:');
    info.quartos.forEach((q) => linhas.push(`- ${q.nome}${q.capacidade ? ` (até ${q.capacidade} pessoas)` : ''}${q.descricao ? `: ${q.descricao}` : ''}${q.comodidades?.length ? ` [${q.comodidades.join(', ')}]` : ''}`));
  }
  if (info.termos) linhas.push(`Termos e condições: ${info.termos}`);
  return linhas.join('\n') || 'Sem dados da Cloudbeds.';
}

export function textoConteudo(assuntos) {
  return (Array.isArray(assuntos) ? assuntos : [])
    .filter((a) => String(a?.texto || '').trim())
    .map((a) => `### ${String(a.titulo || 'Assunto').trim()}\n${String(a.texto).trim()}`)
    .join('\n\n');
}

export function montarInstrucoes({ nomeHotel, nomeAssistente, conteudo, info, canalNome = 'WhatsApp', economico = false, outrosHoteis = [] }) {
  const assistente = String(nomeAssistente || '').trim() || `o assistente virtual do ${nomeHotel}`;
  const apresentacao = String(nomeAssistente || '').trim() ? `${assistente}, o assistente virtual do ${nomeHotel}` : assistente;
  const regraCotacao = economico
    ? '- Quando houver quarto, use enviar_cotacao: a cotação pronta, com o link "Reservar agora" de cada quarto, vai junto com a sua resposta, numa mensagem só. Não repita os valores e não escreva nada depois dela: o texto da cotação já termina perguntando se pode ajudar em algo mais.'
    : '- Quando houver quarto, use enviar_cotacao: ela manda ao cliente a cotação pronta, com o link "Reservar agora" de cada quarto. Depois dela não repita os valores; escreva no máximo uma frase curta (por exemplo, perguntando se pode ajudar em algo mais), ou nada.';
  const regraEconomia = economico
    ? `\n- Cada mensagem enviada no ${canalNome} tem custo para o hotel. Responda tudo numa mensagem só e não escreva frases de espera como "vou verificar" ou "um momento" antes de usar uma ferramenta: use a ferramenta direto. O cliente recebe só a sua resposta final.`
    : '';
  const grupo = (outrosHoteis || []).filter((o) => o?.id && o?.nome);
  const nomesGrupo = grupo.map((o) => `${o.nome} (hotel_id ${o.id})`).join(', ');
  const regraSemQuarto = grupo.length
    ? `- Se não houver quarto aqui, consultar_disponibilidade já consulta também ${grupo.length > 1 ? 'os hotéis' : 'o hotel'} do mesmo grupo: ${nomesGrupo}. Se vier quarto em "outro_hotel", use enviar_cotacao com o hotel_id dele: a cotação já explica ao cliente que aqui não há quarto e que o outro hotel é do mesmo grupo. Se também não houver lá, diga isso com gentileza e ofereça consultar outras datas. O pedido fica registrado para a equipe.
- Se o cliente pedir o preço de ${grupo.length > 1 ? 'um desses hotéis' : grupo[0].nome}, use consultar_disponibilidade com o hotel_id dele e depois enviar_cotacao com o mesmo hotel_id.`
    : '- Se não houver quarto, diga isso com gentileza e ofereça consultar outras datas. O pedido fica registrado para a equipe.';
  const regraOutrosHoteis = grupo.length
    ? `- Não fale de outros hotéis, a não ser de ${grupo.map((o) => o.nome).join(' e ')}, do mesmo grupo, e só quando não houver quarto aqui ou o cliente perguntar. Sobre ${grupo.length > 1 ? 'eles' : 'ele'} você só sabe o que vem das ferramentas e das informações abaixo; para outras dúvidas, passe o contato que estiver nas informações do hotel. Não prometa nada que não esteja nas informações. Se perguntarem, diga que você é o assistente virtual do hotel.`
    : '- Não fale de outros hotéis. Não prometa nada que não esteja nas informações. Se perguntarem, diga que você é o assistente virtual do hotel.';
  return `Você é ${apresentacao}. Você conversa com hóspedes e interessados pelo ${canalNome} do hotel.

COMO RESPONDER
- Responda no idioma do cliente (normalmente português do Brasil), com tom cordial, simples e direto, como uma boa recepcionista. Mensagens curtas, próprias para ${canalNome}: no máximo uns 3 parágrafos curtos. Pode usar *negrito* com moderação e no máximo um emoji por mensagem. Não use títulos (#) nem tabelas.${regraEconomia}
- Use SOMENTE as informações do hotel abaixo e o resultado das ferramentas. Nunca invente preços, regras, horários, serviços, descontos ou disponibilidade. Se a resposta não estiver aqui, diga que vai confirmar com a equipe e use a ferramenta chamar_atendente com sem_informacao = true e a pergunta do cliente (assim a equipe completa as informações do robô).
- Preço e disponibilidade: sempre pela ferramenta consultar_disponibilidade. Para consultar você precisa das datas de entrada e de saída e do número de adultos e de crianças. Pergunte o que faltar, tudo numa mensagem só. Se o cliente não disser o ano, use a próxima data futura. Se disser "fim de semana" ou "feriado", confirme as datas antes.
${regraCotacao}
${regraSemQuarto}
- A reserva e o pagamento são feitos pelo link "Reservar agora" (motor de reservas oficial do hotel). Nunca peça número de cartão, senha, CPF ou foto de documento na conversa. Se o cliente quiser pagar de outro jeito (Pix, depósito, faturado), pedir desconto ou negociar, use chamar_atendente.
- Use registrar_solicitacao (e depois diga ao cliente que a equipe vai retornar) para: grupos (mais de 3 quartos ou mais de 10 pessoas, ou o que o conteúdo do hotel disser), pedidos especiais (berço, cama extra, decoração, aniversário, chegada ou saída fora do horário, pet, acessibilidade), problema para reservar no site, reserva que já existe (confirmar ou alterar: CONFIRMACAO_RESERVA; cancelar: CANCELAMENTO) e 2ª via de boleto (SEGUNDA_VIA). Antes, colete numa mensagem só os dados principais: nome, datas, quantas pessoas, número da reserva (se tiver), o que precisa e, se o cliente quiser, e-mail. Em grupo, pergunte também quantos quartos; se o cliente não souber, registre assim mesmo.
- Você não tem acesso às reservas: nunca confirme, informe ou invente dados de uma reserva (datas, valores, situação). Registre o pedido para a equipe.
- Use chamar_atendente quando o cliente pedir para falar com uma pessoa, estiver insatisfeito ou reclamando, ou o assunto for sensível (cobrança, reembolso, problema durante a hospedagem, objeto esquecido, emergência). Depois avise o cliente com uma frase curta, dizendo quando a equipe responde (está no contexto "Agora").
- Quando você chamou a equipe só porque não tinha a informação, continue atendendo: responda as outras perguntas do cliente normalmente. Se ele repetir a mesma pergunta, diga que a equipe já foi avisada e vai responder; não chame a equipe de novo para a mesma pergunta.
${regraOutrosHoteis}
- Se o cliente mandar áudio, foto ou arquivo que você não consegue ver, peça com gentileza para escrever em texto o que precisa.

INFORMAÇÕES DO HOTEL (escritas pela equipe — valem mais que os dados da Cloudbeds se houver diferença)
${conteudo || '(nenhum conteúdo publicado)'}

DADOS DO HOTEL NA CLOUDBEDS
${textoInfoHotel(info)}`;
}

function contextoAgora({ horario, contato, simulacao, site }) {
  const agora = new Date();
  const { iso, hora, dow } = partesLocais(agora);
  const equipe = situacaoEquipe(horario, agora);
  const linhas = [
    `AGORA: ${DIAS_SEMANA[dow]}, ${dataBR(iso)}, ${hora} (horário de Brasília/João Pessoa). Hoje é ${iso}.`,
    `Equipe: ${equipe.texto}.`,
  ];
  // Chat do site: o visitante pode fechar a página a qualquer momento
  if (site) {
    linhas.push(site.temContato
      ? 'Canal: chat do site do hotel. O visitante já deixou um contato (WhatsApp ou e-mail) para a equipe retornar.'
      : 'Canal: chat do site do hotel. O visitante ainda não deixou contato: se o assunto precisar da equipe, peça o nome e um WhatsApp ou e-mail para retorno, porque ele pode sair do site.');
    if (site.pagina) linhas.push(`Página do site aberta agora: ${site.pagina}`);
  }
  if (contato?.nome) linhas.push(`Cliente: ${contato.nome}${contato.jaReservou ? ' (já reservou com o hotel antes — trate como cliente da casa)' : ''}.`);
  else if (contato?.jaReservou) linhas.push('Cliente: já reservou com o hotel antes — trate como cliente da casa.');
  if (simulacao) linhas.push('(Esta é uma conversa de TESTE feita pela equipe do hotel.)');
  return linhas.join('\n');
}

// ---------------------------------------------------------------------------
// Ferramentas
// ---------------------------------------------------------------------------
const DATA = { type: 'string', description: 'Data no formato AAAA-MM-DD' };
export const FERRAMENTAS = [
  {
    name: 'consultar_disponibilidade',
    description: 'Consulta na Cloudbeds os quartos disponíveis e o preço total (tarifa padrão do motor de reservas) para as datas e hóspedes. Use sempre antes de falar de preço ou de disponibilidade.',
    input_schema: {
      type: 'object',
      properties: {
        checkin: DATA, checkout: DATA,
        adultos: { type: 'integer', minimum: 1, maximum: 30 },
        criancas: { type: 'integer', minimum: 0, maximum: 20 },
        quartos: { type: 'integer', minimum: 1, maximum: 10, description: 'Quantos quartos (padrão 1)' },
        hotel_id: { type: 'integer', description: 'Só para consultar direto outro hotel do mesmo grupo (quando o cliente pedir). Sem ele, consulta este hotel.' },
      },
      required: ['checkin', 'checkout', 'adultos'],
    },
  },
  {
    name: 'enviar_cotacao',
    description: 'Envia ao cliente a cotação formatada, com o preço e o link "Reservar agora" de cada quarto, e registra no funil do hotel. Use depois de consultar_disponibilidade, quando houver quarto. Sem tipos_ids, envia todos os quartos disponíveis.',
    input_schema: {
      type: 'object',
      properties: {
        checkin: DATA, checkout: DATA,
        adultos: { type: 'integer', minimum: 1, maximum: 30 },
        criancas: { type: 'integer', minimum: 0, maximum: 20 },
        quartos: { type: 'integer', minimum: 1, maximum: 10 },
        tipos_ids: { type: 'array', items: { type: 'string' }, description: 'tipo_id dos quartos que o cliente quer (opcional)' },
        hotel_id: { type: 'integer', description: 'Só para cotar outro hotel do mesmo grupo (o hotel_id que veio em outro_hotel na consulta). Sem ele, a cotação é deste hotel.' },
      },
      required: ['checkin', 'checkout', 'adultos'],
    },
  },
  {
    name: 'registrar_solicitacao',
    description: 'Registra um pedido para a equipe do hotel resolver (grupo, pedido especial, problema ao reservar, reserva existente). A equipe recebe na lista de Solicitações.',
    input_schema: {
      type: 'object',
      properties: {
        tipo: { type: 'string', enum: Object.keys(TIPOS_SOLICITACAO) },
        resumo: { type: 'string', description: 'Uma frase com o que o cliente precisa' },
        nome: { type: 'string' },
        email: { type: 'string' },
        checkin: DATA, checkout: DATA,
        pessoas: { type: 'string', description: 'Ex.: "2 adultos e 1 criança de 4 anos" ou "25 pessoas"' },
        quartos: { type: 'string', description: 'Ex.: "10 quartos" ou "5 duplos e 3 triplos"' },
        numero_pessoas: { type: 'integer', minimum: 1, description: 'Só em GRUPO: total de pessoas, em número' },
        numero_quartos: { type: 'integer', minimum: 1, description: 'Só em GRUPO: total de quartos, em número. Deixe vazio se o cliente não souber' },
        numero_reserva: { type: 'string' },
        detalhes: { type: 'string', description: 'Tudo o mais que o cliente informou' },
      },
      required: ['tipo', 'resumo'],
    },
  },
  {
    name: 'chamar_atendente',
    description: 'Passa a conversa para uma pessoa da equipe e o robô para de responder esta conversa. Use quando o cliente pedir, quando você não souber responder com as informações que tem, ou em assunto sensível.',
    input_schema: {
      type: 'object',
      properties: {
        motivo: { type: 'string', description: 'Uma frase explicando para a equipe o que o cliente precisa' },
        cliente_pediu: { type: 'boolean', description: 'true se o cliente pediu para falar com uma pessoa' },
        sem_informacao: { type: 'boolean', description: 'true se você chamou a equipe porque a resposta não estava nas informações do hotel' },
        pergunta: { type: 'string', description: 'Quando sem_informacao = true: a pergunta do cliente, em poucas palavras (ex.: "Tem tomada 220V no quarto?")' },
      },
      required: ['motivo'],
    },
  },
];

function pedidoDe(entrada) {
  return {
    checkin: String(entrada.checkin || ''), checkout: String(entrada.checkout || ''),
    adultos: Number(entrada.adultos) || 1, criancas: Number(entrada.criancas) || 0, quartos: Number(entrada.quartos) || 1,
  };
}

const opcoesParaIA = (r) => r.itens.slice(0, 8).map((i) => ({
  tipo_id: i.tipoId, nome: i.nome, total: reais(i.total), por_noite: reais(i.porNoite), cabe_ate: i.capacidade, descricao: i.descricao,
}));
const resumoPedido = (r) => `${dataBR(r.checkin)} a ${dataBR(r.checkout)} (${r.adultos} adulto(s)${r.criancas ? `, ${r.criancas} criança(s)` : ''})`;

// Outro hotel do grupo liberado para este hotel (ou null)
function hotelDoGrupo(ctx, id) {
  const n = Math.trunc(Number(id));
  if (!n || n === Number(ctx.hotelId)) return null;
  return (ctx.outrosHoteis || []).find((o) => Number(o.id) === n) || null;
}

// Consulta um hotel do grupo e guarda o resultado para a cotação logo em seguida
async function consultarHotelDoGrupo(ctx, o, pedido) {
  const r = await buscarDisponibilidade(await ctx.cloudbedsDe(o.id), pedido);
  ctx.ultimasOutros[o.id] = { chave: JSON.stringify(pedido), r, quando: Date.now() };
  return r;
}

async function executarFerramenta(nome, entrada, ctx) {
  const e = entrada || {};
  if (nome === 'consultar_disponibilidade') {
    const pedido = pedidoDe(e);
    // Consulta direta de outro hotel do grupo (o cliente pediu)
    if (e.hotel_id !== undefined && e.hotel_id !== null && Number(e.hotel_id) !== Number(ctx.hotelId)) {
      const o = hotelDoGrupo(ctx, e.hotel_id);
      if (!o) return { erro: 'Este hotel não está liberado para consulta. Consulte sem hotel_id (este hotel).' };
      let r;
      try { r = await consultarHotelDoGrupo(ctx, o, pedido); }
      catch (erro) { return { erro: `Não foi possível consultar o ${o.nome} agora: ${erro.message}` }; }
      ctx.eventos.push({ tipo: 'acao', texto: `🏨 Consultou o ${o.nome}, ${resumoPedido(r)}: ${r.itens.length ? `${r.itens.length} opção(ões), a partir de ${reais(r.itens[0].total)}.` : 'sem quarto disponível.'}` });
      if (!r.itens.length) return { disponivel: false, hotel: o.nome, noites: r.noites, observacao: `Nenhum quarto disponível no ${o.nome} para essas datas e hóspedes.` };
      return {
        disponivel: true, hotel: o.nome, hotel_id: o.id, noites: r.noites, adultos: r.adultos, criancas: r.criancas, quartos: r.quartos,
        opcoes: opcoesParaIA(r), como_cotar: `Use enviar_cotacao com hotel_id = ${o.id}.`,
      };
    }

    let r;
    try { r = await buscarDisponibilidade(await ctx.cloudbeds(), pedido); }
    catch (erro) { return { erro: erro.message }; }
    // A cotação logo em seguida usa esta mesma consulta (sem esperar a Cloudbeds de novo)
    ctx.ultimaConsulta = { chave: JSON.stringify(pedido), r, quando: Date.now() };
    if (!r.itens.length) {
      if (!ctx.simulacao) await registrarSemDisponibilidade(ctx.supabaseAdmin, ctx.autor, ctx.conversa, r);
      ctx.eventos.push({ tipo: 'acao', texto: `🔎 Consultou ${resumoPedido(r)}: sem quarto disponível.` });
      const resposta = { disponivel: false, noites: r.noites, observacao: 'Nenhum quarto disponível neste hotel para essas datas e hóspedes.' };
      // Sem quarto aqui: olha os hotéis do grupo (se der tempo)
      const semQuartoLa = [];
      for (const o of ctx.outrosHoteis || []) {
        if (ctx.prazo && ctx.prazo - Date.now() < 4500) break;
        let r2;
        try { r2 = await consultarHotelDoGrupo(ctx, o, pedido); }
        catch (erro) { continue; } // Cloudbeds do outro hotel fora do ar: segue como antes
        if (!r2.itens.length) { semQuartoLa.push(o.nome); continue; }
        ctx.eventos.push({ tipo: 'acao', texto: `🏨 Sem quarto aqui; o ${o.nome} tem ${r2.itens.length} opção(ões), a partir de ${reais(r2.itens[0].total)}.` });
        resposta.outro_hotel = {
          hotel_id: o.id, nome: o.nome, descricao: o.descricao || null, noites: r2.noites, opcoes: opcoesParaIA(r2),
          como_oferecer: `Use enviar_cotacao com hotel_id = ${o.id} (e as mesmas datas e hóspedes). A cotação já explica ao cliente que aqui não há quarto e que o ${o.nome} é do mesmo grupo.`,
        };
        return resposta;
      }
      if (semQuartoLa.length) {
        resposta.outros_hoteis_sem_quarto = semQuartoLa;
        ctx.eventos.push({ tipo: 'acao', texto: `🏨 Também sem quarto: ${semQuartoLa.join(', ')}.` });
      }
      return resposta;
    }
    ctx.eventos.push({ tipo: 'acao', texto: `🔎 Consultou ${resumoPedido(r)}: ${r.itens.length} opção(ões), a partir de ${reais(r.itens[0].total)}.` });
    return {
      disponivel: true, noites: r.noites, adultos: r.adultos, criancas: r.criancas, quartos: r.quartos,
      opcoes: opcoesParaIA(r),
    };
  }

  if (nome === 'enviar_cotacao') {
    if (ctx.cotacoesEnviadas >= 2) return { erro: 'Já foram enviadas cotações nesta resposta. Espere o cliente responder.' };
    const pedido = { ...pedidoDe(e), tipos: Array.isArray(e.tipos_ids) ? e.tipos_ids : [] };
    const juntar = ctx.economico && ctx.canal?.tipo === 'WHATSAPP';
    // Outro hotel do grupo?
    let outro = null;
    if (e.hotel_id !== undefined && e.hotel_id !== null && Number(e.hotel_id) !== Number(ctx.hotelId)) {
      outro = hotelDoGrupo(ctx, e.hotel_id);
      if (!outro) return { erro: 'Este hotel não está liberado para cotação. Cote sem hotel_id (este hotel).' };
    }
    const ultima = outro ? ctx.ultimasOutros[outro.id] : ctx.ultimaConsulta;
    const chave = JSON.stringify(pedidoDe(e));
    const disponibilidade = ultima && ultima.chave === chave && Date.now() - ultima.quando < 5 * 60000 ? ultima.r : null;
    // A cotação do outro hotel explica que aqui não há quarto (só quando a consulta daqui deu vazio)
    if (outro) {
      const daqui = ctx.ultimaConsulta;
      pedido.semQuartoAqui = !!(daqui && daqui.chave === chave && !daqui.r.itens.length);
    }
    let r;
    try {
      const args = {
        conversa: ctx.conversa, canal: ctx.canal, cb: outro ? await ctx.cloudbedsDe(outro.id) : await ctx.cloudbeds(), pedido, origem: ctx.origem, simular: ctx.simulacao,
        nomeCliente: ctx.simulacao ? null : undefined, disponibilidade, hotelCotado: outro,
      };
      // Modo econômico: grava a cotação agora e manda junto com a resposta final
      r = juntar ? await prepararCotacao(ctx.supabaseAdmin, ctx.autor, args) : await enviarCotacao(ctx.supabaseAdmin, ctx.autor, args);
    } catch (erro) { return { erro: erro.message }; }
    if (r.erro) return { erro: r.erro };
    ctx.cotacoesEnviadas += 1;
    const deQual = outro ? ` do ${outro.nome}` : '';
    const quartos = r.itens.map((i) => `${i.nome}: ${reais(i.total)}`);
    if (juntar) {
      ctx.pedacos.push({ tipo: 'cotacao', texto: r.texto, cotacao: r.cotacao || null, valores: r.valores || [], botao: r.botao || null, hotelCotado: outro });
      if (!ctx.simulacao) ctx.eventos.push({ tipo: 'acao', texto: `📤 Preparou a cotação${deQual} (${r.itens.length} quarto(s)); vai junto com a resposta.` });
      return { enviada: true, ...(outro ? { hotel: outro.nome } : {}), observacao: 'A cotação vai junto com a sua resposta, na mesma mensagem.', quartos };
    }
    if (ctx.simulacao) ctx.eventos.push({ tipo: 'cotacao', texto: r.texto });
    else {
      ctx.eventos.push({ tipo: 'acao', texto: `📤 Enviou a cotação${deQual} (${r.itens.length} quarto(s)).` });
      if (outro) await anotarOutroHotel(ctx.supabaseAdmin, ctx.autor, ctx.conversa, outro);
    }
    return { enviada: true, ...(outro ? { hotel: outro.nome } : {}), quartos };
  }

  if (nome === 'registrar_solicitacao') {
    const tipo = TIPOS_SOLICITACAO[e.tipo] ? e.tipo : 'OUTRO';
    const resumo = String(e.resumo || '').trim().slice(0, 300) || TIPOS_SOLICITACAO[tipo];
    const dados = {};
    ['nome', 'email', 'checkin', 'checkout', 'pessoas', 'quartos', 'numero_reserva', 'detalhes'].forEach((k) => {
      const v = String(e[k] ?? '').trim();
      if (v) dados[k] = v.slice(0, k === 'detalhes' ? 2000 : 200);
    });
    // Grupo: os números que o robô mandou (o texto continua como o cliente disse)
    if (tipo === 'GRUPO') {
      if (!dados.pessoas && Number(e.numero_pessoas) > 0) dados.pessoas = `${Math.round(Number(e.numero_pessoas))} pessoas`;
      if (!dados.quartos && Number(e.numero_quartos) > 0) dados.quartos = `${Math.round(Number(e.numero_quartos))} quartos`;
    }
    if (ctx.simulacao) {
      ctx.eventos.push({ tipo: 'acao', texto: `📋 Registraria a solicitação "${TIPOS_SOLICITACAO[tipo]}": ${resumo}${Object.keys(dados).length ? ` (${Object.entries(dados).map(([k, v]) => `${k}: ${v}`).join('; ')})` : ''}` });
      return { registrada: true, numero: 'TESTE' };
    }
    const grupo = tipo === 'GRUPO' ? numerosDoGrupo({ ...dados, numero_pessoas: e.numero_pessoas, numero_quartos: e.numero_quartos }) : null;
    return registrarSolicitacao(ctx, { tipo, resumo, dados, grupo });
  }

  if (nome === 'chamar_atendente') {
    const motivo = String(e.motivo || '').trim().slice(0, 300) || 'O cliente precisa de uma pessoa.';
    const equipe = situacaoEquipe(ctx.horario);
    // Só não sabia a resposta (o cliente não pediu uma pessoa): o robô chama a
    // equipe para esta pergunta e continua respondendo as outras
    const continua = !!e.sem_informacao && !e.cliente_pediu;
    // Pergunta que o robô não soube: fica anotada para o ADMIN completar o conteúdo
    const pergunta = continua ? (String(e.pergunta || '').trim() || motivo).slice(0, 300) : null;
    const resultado = {
      ok: true, equipe_trabalhando_agora: equipe.aberto, equipe_volta: equipe.volta || null,
      ...(continua ? { voce_continua_atendendo: 'A equipe vai responder só esta pergunta. Continue respondendo as outras dúvidas do cliente normalmente.' } : {}),
    };
    if (ctx.simulacao) {
      ctx.eventos.push({ tipo: 'acao', texto: continua ? `🙋 Chamaria a equipe para esta pergunta e continuaria respondendo o resto: ${motivo}` : `🙋 Passaria a conversa para a equipe: ${motivo}` });
      if (pergunta) ctx.eventos.push({ tipo: 'acao', texto: `❓ Anotaria a pergunta sem resposta: “${pergunta}”` });
      if (!continua) ctx.pausou = true;
      return resultado;
    }
    const { supabaseAdmin, conversa } = ctx;
    await pausar(supabaseAdmin, conversa.id, e.cliente_pediu ? 'PEDIU_HUMANO' : continua ? PAUSA_QUE_CONTINUA : 'ROBO_NAO_SABE');
    if (!continua) ctx.pausou = true;
    // O resto em paralelo (cada ida ao banco leva um tempo e o cliente está esperando)
    await Promise.all([
      pergunta ? supabaseAdmin.from('atendimento_robo_lacunas').insert({ hotel_id: conversa.hotel_id, conversa_id: conversa.id, pergunta }).then(() => null, () => null) : null,
      supabaseAdmin.rpc('atendimento_avancar_etapa', { p_conversa: conversa.id, p_nome: 'Solicitado humano' }).then(() => null, () => null),
      supabaseAdmin.rpc('atendimento_adicionar_etiqueta', { p_conversa: conversa.id, p_nome: 'Solicitado atendimento' }).then(() => null, () => null),
      gravarNota(supabaseAdmin, ctx.autor, conversa, continua
        ? `🙋 O robô não sabia responder e chamou a equipe: ${motivo}${/[.!?…]$/.test(motivo) ? '' : '.'} Ele continua respondendo as outras perguntas até alguém da equipe escrever.`
        : `🙋 O robô passou a conversa para a equipe: ${motivo}`, 'robo_passou'),
    ]);
    ctx.eventos.push({ tipo: 'acao', texto: continua ? `🙋 Chamou a equipe (e continua respondendo): ${motivo}` : `🙋 Passou a conversa para a equipe: ${motivo}` });
    return resultado;
  }
  return { erro: `Ferramenta desconhecida: ${nome}` };
}

// Nota para a equipe: a cotação foi de outro hotel do grupo
async function anotarOutroHotel(supabaseAdmin, autor, conversa, outro) {
  try {
    await gravarNota(supabaseAdmin, autor, conversa, `🏨 Sem quarto aqui: o robô mandou a cotação do ${outro.nome} (do mesmo grupo). Se o cliente reservar lá, a conversa vai para “Reservou”.`, 'robo');
  } catch (e) { /* a nota é um extra */ }
}

async function registrarSolicitacao(ctx, { tipo, resumo, dados, grupo }) {
  const { supabaseAdmin, conversa, config } = ctx;
  let registro = { hotel_id: conversa.hotel_id, conversa_id: conversa.id, contato_id: conversa.contato_id || null, tipo, resumo, dados, criado_pelo_robo: true };
  // Grupo: pessoas, quartos e noites já vão junto; o valor estimado (Cloudbeds)
  // é calculado logo depois pela função agendada, sem atrasar a resposta
  if (grupo) {
    registro = {
      ...registro, grupo_pessoas: grupo.pessoas, grupo_quartos: grupo.quartos, grupo_quartos_estimado: grupo.quartosEstimado, grupo_noites: grupo.noites,
    };
  }
  let { data: sol, error } = await supabaseAdmin.from('atendimento_solicitacoes').insert(registro).select().single();
  // Sem o SQL do painel de grupos: grava sem os números
  if (error && grupo && /grupo_/i.test(error.message || '')) {
    const { grupo_pessoas: _p, grupo_quartos: _q, grupo_quartos_estimado: _e, grupo_noites: _n, ...semGrupo } = registro;
    registro = semGrupo;
    ({ data: sol, error } = await supabaseAdmin.from('atendimento_solicitacoes').insert(registro).select().single());
  }
  // Sem o SQL dos ajustes, os tipos novos ainda não existem: grava no tipo mais próximo
  if (error && /tipo_check|check constraint/i.test(error.message || '') && ['CANCELAMENTO', 'SEGUNDA_VIA'].includes(tipo)) {
    ({ data: sol, error } = await supabaseAdmin.from('atendimento_solicitacoes')
      .insert({ ...registro, tipo: tipo === 'CANCELAMENTO' ? 'CONFIRMACAO_RESERVA' : 'OUTRO' }).select().single());
  }
  if (error) return { erro: 'Não foi possível registrar a solicitação agora.' };
  try { await supabaseAdmin.rpc('atendimento_adicionar_etiqueta', { p_conversa: conversa.id, p_nome: 'Solicitação' }); } catch (e) { /* extra */ }
  await gravarNota(supabaseAdmin, ctx.autor, conversa, `📋 Solicitação nº ${sol.id} registrada pelo robô (${TIPOS_SOLICITACAO[tipo]}): ${resumo}`, 'robo');
  ctx.eventos.push({ tipo: 'acao', texto: `📋 Registrou a solicitação nº ${sol.id}: ${resumo}` });

  // Aviso por e-mail (opcional), pela primeira caixa de e-mail ligada do hotel
  const para = String(config?.email_solicitacoes || '').trim();
  if (para) {
    let erroEmail = null;
    try {
      const { data: caixa } = await supabaseAdmin.from('atendimento_canais').select('*')
        .eq('hotel_id', conversa.hotel_id).eq('tipo', 'EMAIL').eq('ativo', true).order('id').limit(1).maybeSingle();
      if (!caixa) throw new Error('nenhuma caixa de e-mail ligada para enviar o aviso');
      const linhas = [
        `Nova solicitação nº ${sol.id} recebida pelo robô (${TIPOS_SOLICITACAO[tipo]}).`, '',
        `Resumo: ${resumo}`,
        ...Object.entries(dados).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`), '',
        `Cliente: ${conversa.contato_nome || ''} ${conversa.contato_endereco || ''}`.trim(),
        `Abrir a conversa: ${ctx.origem}/atendimento?conversa=${conversa.id}`,
      ];
      const nomeCliente = String(conversa.contato_nome || 'cliente').replace(/[\r\n\t]+/g, ' ').slice(0, 80);
      await enviarEmailAvulso(supabaseAdmin, { canal: caixa, para, assunto: `[Solicitação nº ${sol.id}] ${TIPOS_SOLICITACAO[tipo]} — ${nomeCliente}`, texto: linhas.join('\n') });
    } catch (e) { erroEmail = String(e.message || e).slice(0, 300); }
    await supabaseAdmin.from('atendimento_solicitacoes').update(erroEmail ? { email_erro: erroEmail } : { email_enviado_em: new Date().toISOString() }).eq('id', sol.id);
  }
  return { registrada: true, numero: sol.id };
}

// ---------------------------------------------------------------------------
// Modo econômico: tudo numa mensagem só
// ---------------------------------------------------------------------------
const LIMITE_WHATSAPP = 4000;

// Frase de espera ("Vou verificar…", "Um momento…") não diz nada ao cliente:
// no modo econômico ela não vira mensagem.
// Só some quando TODAS as frases são de espera ou de cortesia ("Claro!"),
// para nunca perder uma informação.
const ESPERA_INICIO = /(^|\s)(vou|vamos|deixa eu|deixe-me|deixa-me|j[aá] vou|s[oó] um|um momento|um minuto|um instante|um minutinho|aguarde|aguarda)(\s|[,.!…]|$)/i;
const ESPERA_ACAO = /(verific|consult|busc|olhar|olho|checar|chec|confer|pesquis|momento|instante|minut|aguard|ver (para|pra|aqui|as|os|a |o |se|quais|qual))/i;
const CORTESIA = /^(claro|perfeito|[óo]timo|certo|beleza|ok|oi|ol[áa]|tudo bem|com certeza|que bom|maravilha|entendi|show|combinado)\b/i;

export function ehFraseDeEspera(texto) {
  const t = String(texto || '').trim();
  if (!t || t.length > 200) return false;
  const frases = t.split(/(?<=[.!?…])\s+/).map((f) => f.trim()).filter(Boolean);
  let espera = 0;
  for (const f of frases) {
    if (/\?\s*$/.test(f)) return false; // pergunta ao cliente: fica
    if (ESPERA_INICIO.test(f) && ESPERA_ACAO.test(f)) { espera += 1; continue; }
    if (CORTESIA.test(f) && f.length <= 30) continue;
    return false;
  }
  return espera > 0;
}

// Junta os pedaços (textos e cotações) e o texto final em mensagens de até
// 4.000 caracteres — normalmente uma só.
export function juntarPedacos(pedacos, textoFinal) {
  const partes = [...pedacos.map((p) => String(p.texto || '').trim()), String(textoFinal || '').trim()].filter(Boolean);
  const mensagens = [];
  let atual = '';
  for (const p of partes) {
    const junto = atual ? `${atual}\n\n${p}` : p;
    if (junto.length <= LIMITE_WHATSAPP) { atual = junto; continue; }
    if (atual) mensagens.push(atual);
    atual = p.slice(0, LIMITE_WHATSAPP);
  }
  if (atual) mensagens.push(atual);
  return mensagens;
}

export async function pausar(supabaseAdmin, conversaId, motivo = 'ASSUMIU') {
  try {
    await supabaseAdmin.from('atendimento_conversas')
      .update({ robo_pausado_em: new Date().toISOString(), robo_pausa_motivo: motivo }).eq('id', conversaId);
  } catch (e) { /* sem o SQL da Fase 4: não há robô para pausar */ }
}

// ---------------------------------------------------------------------------
// Conversa → mensagens para a IA
// ---------------------------------------------------------------------------
function textoParaIA(m) {
  const t = String(m.texto || '').trim();
  const anexos = Array.isArray(m.anexos) ? m.anexos : [];
  const entrada = m.direcao === 'ENTRADA';
  const descricao = {
    audio: '[o cliente mandou um áudio — você não consegue ouvir]',
    imagem: '[foto]', video: '[vídeo]', figurinha: '[figurinha]',
    documento: `[arquivo${anexos[0]?.nome ? ` ${anexos[0].nome}` : ''}]`,
    contato: '[contato compartilhado]',
  }[m.tipo];
  if (descricao && entrada) return [descricao, t].filter(Boolean).join(' ');
  if (m.tipo === 'reacao') return '';
  return t || (descricao || '');
}

export function mensagensParaIA(lista) {
  const saida = [];
  for (const m of lista) {
    const texto = textoParaIA(m);
    if (!texto) continue;
    const role = m.direcao === 'ENTRADA' ? 'user' : 'assistant';
    const ultima = saida[saida.length - 1];
    if (ultima && ultima.role === role) ultima.content += `\n${texto}`;
    else saida.push({ role, content: texto });
  }
  while (saida.length && saida[0].role !== 'user') saida.shift();
  // A IA precisa terminar com a vez do cliente
  while (saida.length && saida[saida.length - 1].role !== 'user') saida.pop();
  // Mantém o tamanho sob controle (as mensagens mais recentes)
  let total = 0;
  let corte = saida.length;
  for (let i = saida.length - 1; i >= 0; i -= 1) {
    total += saida[i].content.length;
    if (total > 14000 && i < saida.length - 2) break;
    corte = i;
  }
  const final = saida.slice(corte);
  while (final.length && final[0].role !== 'user') final.shift();
  return final.map((m) => ({ role: m.role, content: m.content.slice(-6000) }));
}

// ---------------------------------------------------------------------------
// O laço de conversa com a IA (usado na conversa de verdade e no teste)
// ---------------------------------------------------------------------------
async function conversarComIA(ctx, { chave, modelo, instrucoes, contexto, mensagens, prazo }) {
  const system = [
    { type: 'text', text: instrucoes, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: contexto },
  ];
  const tools = FERRAMENTAS.map((f, i) => (i === FERRAMENTAS.length - 1 ? { ...f, cache_control: { type: 'ephemeral' } } : f));
  const msgs = mensagens.map((m) => ({ ...m }));
  let textoFinal = '';
  let custo = 0;
  for (let rodada = 0; rodada < MAX_RODADAS; rodada += 1) {
    const resta = prazo - Date.now();
    if (resta < 2500) throw new ErroIA('Acabou o tempo para responder.', 'TEMPO');
    const r = await chamarClaude({ chave, modelo, system, tools, messages: msgs, tempoMs: Math.min(resta - 1000, 25000) });
    custo += await registrarUso(ctx.supabaseAdmin, { hotelId: ctx.hotelId, conversaId: ctx.conversa?.id, origem: ctx.simulacao ? 'TESTE' : 'CONVERSA', modelo, uso: r.usage });
    const blocos = Array.isArray(r.content) ? r.content : [];
    const texto = blocos.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    const usos = blocos.filter((b) => b.type === 'tool_use');
    if (r.stop_reason !== 'tool_use' || !usos.length) { textoFinal = texto; break; }
    // Texto antes da ferramenta ("Vou consultar…") vai para o cliente na hora
    if (texto) await ctx.aoTextoParcial(texto);
    msgs.push({ role: 'assistant', content: blocos });
    const resultados = [];
    for (const u of usos) {
      let resultado;
      try { resultado = await executarFerramenta(u.name, u.input, ctx); }
      catch (e) { resultado = { erro: String(e.message || e) }; }
      resultados.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(resultado), ...(resultado?.erro ? { is_error: true } : {}) });
    }
    msgs.push({ role: 'user', content: resultados });
    if (rodada === MAX_RODADAS - 1) textoFinal = '';
  }
  return { textoFinal, custo };
}

// Conexões da Cloudbeds deste hotel e dos hotéis do grupo (abertas só quando precisa)
function acessoCloudbeds(supabaseAdmin, hotelId) {
  const conexoes = {};
  const de = async (id) => {
    const n = Number(id);
    if (!conexoes[n]) conexoes[n] = conexaoCloudbeds(supabaseAdmin, n);
    try { return await conexoes[n]; } catch (e) { delete conexoes[n]; throw e; }
  };
  return { cloudbeds: () => de(hotelId), cloudbedsDe: de };
}

// ---------------------------------------------------------------------------
// Configuração e conteúdo
// ---------------------------------------------------------------------------
export async function carregarRobo(supabaseAdmin, hotelId) {
  const [{ data: config }, { data: conteudo }, { data: pref }, { data: hotel }] = await Promise.all([
    supabaseAdmin.from('atendimento_robo').select('*').eq('hotel_id', hotelId).maybeSingle(),
    supabaseAdmin.from('atendimento_robo_conteudo').select('*').eq('hotel_id', hotelId).maybeSingle(),
    supabaseAdmin.from('atendimento_preferencias').select('horario_comercial').eq('hotel_id', hotelId).maybeSingle(),
    supabaseAdmin.from('hoteis').select('nome_fantasia').eq('id', hotelId).maybeSingle(),
  ]);
  return { config: config || null, conteudo: conteudo || null, horario: pref?.horario_comercial || null, nomeHotel: hotel?.nome_fantasia || 'hotel' };
}

async function infoAtualizada(supabaseAdmin, hotelId, config) {
  const idade = config?.hotel_info_em ? Date.now() - new Date(config.hotel_info_em).getTime() : Infinity;
  if (config?.hotel_info && idade < INFO_VALIDADE_DIAS * 86400000) return config.hotel_info;
  if (config?.hotel_info) return config.hotel_info; // velha: a função agendada atualiza
  try { return await atualizarInfoHotel(supabaseAdmin, hotelId); } catch (e) { return null; }
}

// ---------------------------------------------------------------------------
// TESTE (aba Robô → Testar): nada é gravado nem enviado ao cliente
// ---------------------------------------------------------------------------
export async function testarRobo(supabaseAdmin, hotelId, { mensagens, usarRascunho, origem }) {
  const robo = await carregarRobo(supabaseAdmin, hotelId);
  const chave = await lerSegredo(supabaseAdmin, hotelId, CHAVE_SEGREDO);
  if (!chave) throw new ErroIA('Falta a chave da Anthropic. Coloque a chave em Robô → Configuração.', 'CHAVE');
  const assuntos = usarRascunho ? robo.conteudo?.rascunho : robo.conteudo?.publicado;
  const modelo = MODELOS_IA[robo.config?.modelo] ? robo.config.modelo : MODELO_PADRAO;
  const info = await infoAtualizada(supabaseAdmin, hotelId, robo.config);

  const lista = (Array.isArray(mensagens) ? mensagens : []).slice(-30)
    .map((m) => ({ direcao: m.papel === 'cliente' ? 'ENTRADA' : 'SAIDA', texto: String(m.texto || '').slice(0, 3000) }));
  const msgs = mensagensParaIA(lista);
  if (!msgs.length) throw new ErroIA('Escreva uma mensagem como se fosse o cliente.', 'OUTRO');

  const economico = robo.config?.modo_economico !== false;
  const outrosHoteis = await carregarOutrosHoteis(supabaseAdmin, hotelId, robo.config);
  const prazo = Date.now() + 9000;
  const ctx = {
    supabaseAdmin, hotelId, simulacao: true, autor: { robo: true }, origem, config: robo.config, horario: robo.horario,
    conversa: { id: null, hotel_id: hotelId, contato_nome: null }, canal: { tipo: 'WHATSAPP' },
    ...acessoCloudbeds(supabaseAdmin, hotelId), outrosHoteis, ultimasOutros: {}, prazo,
    eventos: [], cotacoesEnviadas: 0, pausou: false, economico, pedacos: [],
  };
  ctx.aoTextoParcial = economico
    ? async (t) => { if (!ehFraseDeEspera(t)) ctx.pedacos.push({ tipo: 'texto', texto: t }); }
    : async (t) => { ctx.eventos.push({ tipo: 'texto', texto: t }); };
  const { textoFinal, custo } = await conversarComIA(ctx, {
    chave, modelo,
    instrucoes: montarInstrucoes({ nomeHotel: robo.nomeHotel, nomeAssistente: robo.config?.nome_assistente, conteudo: textoConteudo(assuntos), info, economico, outrosHoteis }),
    contexto: contextoAgora({ horario: robo.horario, simulacao: true }),
    mensagens: msgs, prazo,
  });
  if (economico) {
    // O que o cliente receberia: uma mensagem só (mostra como "cotação" se tiver uma)
    const temCotacao = ctx.pedacos.some((p) => p.tipo === 'cotacao');
    const juntas = juntarPedacos(ctx.pedacos, textoFinal).map((texto) => ({ tipo: temCotacao ? 'cotacao' : 'texto', texto }));
    return { respostas: [...ctx.eventos, ...juntas], custo, modelo, pausou: ctx.pausou, economico, mensagensWhatsApp: juntas.length };
  }
  const respostas = [...ctx.eventos, ...(textoFinal ? [{ tipo: 'texto', texto: textoFinal }] : [])];
  return { respostas, custo, modelo, pausou: ctx.pausou, economico, mensagensWhatsApp: respostas.filter((r) => r.tipo !== 'acao').length };
}

// ---------------------------------------------------------------------------
// REVISÃO DO CONTEÚDO (aba Robô → Conteúdo → "Procurar contradições")
// ---------------------------------------------------------------------------
// Usa sempre a IA econômica: é rápida (a Netlify corta em 10 s) e custa menos
// de 1 centavo de dólar. O custo entra no uso do mês como teste. Os dados da
// Cloudbeds são os já guardados (ler de novo na hora poderia estourar o tempo).
export async function revisarConteudo(supabaseAdmin, hotelId, { assuntos: lista }) {
  const inicio = Date.now();
  const assuntos = assuntosParaRevisar(lista);
  if (!assuntos.length) throw new ErroIA('Não há texto para revisar. Escreva pelo menos um assunto.', 'OUTRO');
  const conteudo = textoConteudo(assuntos);
  if (conteudo.length > MAX_CARACTERES_REVISAO) {
    throw new ErroIA(`O conteúdo está grande demais para revisar de uma vez (${conteudo.length.toLocaleString('pt-BR')} caracteres; o máximo é ${MAX_CARACTERES_REVISAO.toLocaleString('pt-BR')}).`, 'OUTRO');
  }
  const robo = await carregarRobo(supabaseAdmin, hotelId);
  const chave = await lerSegredo(supabaseAdmin, hotelId, CHAVE_SEGREDO);
  if (!chave) throw new ErroIA('Falta a chave da Anthropic. Coloque a chave em Robô → Configuração.', 'CHAVE');
  const info = robo.config?.hotel_info || null;
  const textoCloudbeds = info ? textoInfoHotel(info) : '';
  const modelo = MODELO_PADRAO;
  let r;
  try {
    r = await chamarClaude({
      chave, modelo, maxTokens: 1500, tempoMs: Math.max(3000, 9300 - (Date.now() - inicio)),
      system: instrucoesRevisao({ nomeHotel: robo.nomeHotel, hoje: hojeExtenso() }),
      tools: [FERRAMENTA_REVISAO], toolChoice: { type: 'tool', name: FERRAMENTA_REVISAO.name },
      messages: [{ role: 'user', content: mensagemRevisao({ conteudo, cloudbeds: textoCloudbeds }) }],
    });
  } catch (e) {
    if (e?.codigo === 'TEMPO') throw new ErroIA('A IA demorou demais para revisar tudo. Tente de novo em instantes.', 'TEMPO');
    throw e;
  }
  const custo = await registrarUso(supabaseAdmin, { hotelId, conversaId: null, origem: 'TESTE', modelo, uso: r.usage });
  const uso = (Array.isArray(r.content) ? r.content : []).find((b) => b.type === 'tool_use' && b.name === FERRAMENTA_REVISAO.name);
  if (!uso) throw new ErroIA('A IA não devolveu a revisão. Tente de novo.', 'OUTRO');
  let brutos = uso.input?.problemas;
  if (typeof brutos === 'string') { try { brutos = JSON.parse(brutos); } catch (e) { brutos = null; } }
  const incompleta = r.stop_reason === 'max_tokens';
  if (!Array.isArray(brutos) && incompleta) throw new ErroIA('A IA não terminou a revisão. Tente de novo.', 'OUTRO');
  const { achados, descartados } = conferirAchados(brutos, assuntos, textoCloudbeds);
  return { achados, descartados, custo, modelo, assuntos: assuntos.length, cloudbeds: !!info, incompleta };
}

// ---------------------------------------------------------------------------
// CONVERSA DE VERDADE
// ---------------------------------------------------------------------------
// Tem mensagem do cliente que o robô ainda não respondeu? (compara com a
// última mensagem já respondida, e não com "quem falou por último": o cliente
// pode escrever enquanto o robô ainda está respondendo)
export function temPendente(c) {
  if (!c?.ultima_entrada_em) return false;
  if (!c.robo_respondeu_ate) return true;
  return new Date(c.ultima_entrada_em).getTime() > new Date(c.robo_respondeu_ate).getTime();
}

// Ordem para a IA: o que já foi respondido e, depois, as mensagens novas do cliente
export function ordenarParaIA(lista, respondeuAte) {
  if (!respondeuAte) return lista;
  const marca = new Date(respondeuAte).getTime();
  const nova = (m) => m.direcao === 'ENTRADA' && new Date(m.data_original || m.criado_em).getTime() > marca;
  return [...lista.filter((m) => !nova(m)), ...lista.filter(nova)];
}

// Devolve { respondeu } ou { pulou: motivo }. "prazo" = horário (ms) limite.
// "semEspera": o chat do site já manda as mensagens em fila (não precisa
// esperar 1,5 s para juntar), e cada segundo conta dentro dos 10 s da Netlify.
// O robô vai responder esta conversa? (as mesmas regras de responderConversa;
// usado pela resposta pronta das etiquetas por frase, que só sai sem o robô)
export async function roboVaiResponder(supabaseAdmin, conversa) {
  const robo = await carregarRobo(supabaseAdmin, conversa.hotel_id);
  const config = robo.config;
  if (!config?.ligado || !config.chave_salva_em) return false;
  if (!(config.canais || []).includes(conversa.canal_tipo)) return false;
  if (!Array.isArray(robo.conteudo?.publicado) || !robo.conteudo.publicado.length) return false;
  return !pausaBloqueiaRobo(conversa, config.horas_retomar);
}

export async function responderConversa(supabaseAdmin, conversaId, { origem, prazo, semEspera = false }) {
  const { data: conversa } = await supabaseAdmin.from('atendimento_conversas').select('*').eq('id', conversaId).maybeSingle();
  if (!conversa) return { pulou: 'conversa não encontrada' };
  const robo = await carregarRobo(supabaseAdmin, conversa.hotel_id);
  const config = robo.config;
  if (!config?.ligado) return { pulou: 'robô desligado' };
  if (!(config.canais || []).includes(conversa.canal_tipo)) return { pulou: 'canal sem robô' };
  if (!temPendente(conversa)) return { pulou: 'nada para responder' };
  const ultimaEntrada = conversa.ultima_entrada_em ? new Date(conversa.ultima_entrada_em).getTime() : 0;
  if (Date.now() - ultimaEntrada > PENDENTE_ATE_MIN * 60000) return { pulou: 'mensagem antiga' };

  // Pausada (alguém assumiu): só volta depois de N horas sem a equipe escrever.
  // "Chamou a equipe por não saber" não pausa: o robô continua respondendo.
  if (conversa.robo_pausado_em && conversa.robo_pausa_motivo !== PAUSA_QUE_CONTINUA) {
    if (pausaBloqueiaRobo(conversa, config.horas_retomar)) return { pulou: 'pausada' };
    await supabaseAdmin.from('atendimento_conversas').update({ robo_pausado_em: null, robo_pausa_motivo: null }).eq('id', conversa.id);
  }

  const assuntos = robo.conteudo?.publicado;
  if (!Array.isArray(assuntos) || !assuntos.length) return { pulou: 'sem conteúdo publicado' };
  const { data: canal } = await supabaseAdmin.from('atendimento_canais').select('*').eq('id', conversa.canal_id).maybeSingle();
  if (!canal?.ativo) return { pulou: 'canal desligado' };

  // Trava: só um robô por conversa de cada vez
  const agoraIso = new Date().toISOString();
  const { data: travou } = await supabaseAdmin.from('atendimento_conversas')
    .update({ robo_ocupado_ate: new Date(Date.now() + TRAVA_S * 1000).toISOString() })
    .eq('id', conversa.id).or(`robo_ocupado_ate.is.null,robo_ocupado_ate.lt.${agoraIso}`).select('id');
  if (!travou?.length) return { pulou: 'ocupado' };

  const autor = { id: null, robo: true };
  const economico = config.modo_economico !== false && canal.tipo === 'WHATSAPP';
  let rodadas = 0;
  let despacharPendentes = null; // modo econômico: manda o que ficou guardado se der erro no meio
  try {
    for (;;) {
      rodadas += 1;
      // Espera um pouco para juntar mensagens que o cliente manda em sequência
      const desdeUltima = Date.now() - ultimaEntrada;
      if (!semEspera && rodadas === 1 && desdeUltima < ESPERA_JUNTAR_MS && prazo - Date.now() > 7000) {
        await new Promise((ok) => setTimeout(ok, ESPERA_JUNTAR_MS - desdeUltima));
      }
      const { data: atual } = await supabaseAdmin.from('atendimento_conversas').select('*').eq('id', conversa.id).maybeSingle();
      if (!atual || !temPendente(atual) || pausaBloqueiaRobo(atual, config.horas_retomar)) return { pulou: 'já respondida ou pausada' };
      const fotoEntrada = atual.ultima_entrada_em;

      const chave = await lerSegredo(supabaseAdmin, conversa.hotel_id, CHAVE_SEGREDO);
      if (!chave) return { pulou: 'sem chave' };

      // Limite de gasto do mês
      const { data: gasto } = await supabaseAdmin.rpc('atendimento_robo_gasto_mes', { p_hotel: conversa.hotel_id });
      if (Number(config.limite_mensal_usd) > 0 && Number(gasto || 0) >= Number(config.limite_mensal_usd)) {
        await pausar(supabaseAdmin, conversa.id, 'LIMITE');
        await gravarNota(supabaseAdmin, autor, atual, `🤖 O robô parou: chegou ao limite de gasto do mês (US$ ${Number(config.limite_mensal_usd).toFixed(2)}). A equipe precisa responder. O administrador pode aumentar o limite em Robô → Configuração.`, 'robo');
        await enviarPelaConversa(supabaseAdmin, autor, { canal, conversa: atual, corpo: { semPrevia: true }, texto: MENSAGEM_RESERVA });
        return { pulou: 'limite do mês' };
      }

      const desde = new Date(Date.now() - 30 * 86400000).toISOString();
      const { data: ultimas } = await supabaseAdmin.from('atendimento_mensagens')
        .select('id, direcao, tipo, texto, anexos, status_envio, data_original, criado_em')
        .eq('conversa_id', conversa.id).in('direcao', ['ENTRADA', 'SAIDA']).gte('criado_em', desde)
        .order('data_original', { ascending: false, nullsFirst: false }).order('id', { ascending: false }).limit(40);
      const lista = ordenarParaIA((ultimas || []).filter((m) => m.status_envio !== 'FALHOU').reverse(), atual.robo_respondeu_ate);
      const msgs = mensagensParaIA(lista);
      if (!msgs.length) return { pulou: 'sem mensagem de texto' };

      let contato = null;
      if (atual.contato_id) {
        const { data: ct } = await supabaseAdmin.from('atendimento_contatos').select('nome, ja_reservou').eq('id', atual.contato_id).maybeSingle();
        contato = { nome: ct?.nome || atual.contato_nome, jaReservou: !!ct?.ja_reservou };
      } else {
        contato = { nome: atual.contato_nome };
      }
      const info = await infoAtualizada(supabaseAdmin, conversa.hotel_id, config);
      const modelo = MODELOS_IA[config.modelo] ? config.modelo : MODELO_PADRAO;

      const outrosHoteis = await carregarOutrosHoteis(supabaseAdmin, conversa.hotel_id, config);
      const ctx = {
        supabaseAdmin, hotelId: conversa.hotel_id, simulacao: false, autor, origem, config, horario: robo.horario,
        conversa: atual, canal,
        ...acessoCloudbeds(supabaseAdmin, conversa.hotel_id), outrosHoteis, ultimasOutros: {}, prazo,
        eventos: [], cotacoesEnviadas: 0, pausou: false, economico, pedacos: [],
      };
      let enviadas = 0;
      const enviar = async (texto, corpo = {}, botao = null) => {
        const t = String(texto || '').trim();
        if (!t) return;
        const envio = await enviarPelaConversa(supabaseAdmin, autor, { canal, conversa: atual, corpo, texto: t.slice(0, LIMITE_WHATSAPP), botao });
        if (envio.erro) throw new Error(envio.erro);
        enviadas += 1;
      };
      // Modo econômico: textos e cotações ficam guardados e saem juntos no fim
      const despachar = async (textoFinal) => {
        const pedacos = ctx.pedacos.splice(0);
        const cotacoes = pedacos.filter((p) => p.tipo === 'cotacao' && p.cotacao);
        try {
          const mensagens = juntarPedacos(pedacos, textoFinal);
          // Uma cotação numa mensagem só: vai com o botão "Reservar agora" (se couber)
          const botao = cotacoes.length === 1 && mensagens.length === 1 ? cotacoes[0].botao : null;
          for (const m of mensagens) await enviar(m, cotacoes.length ? { semPrevia: true } : {}, botao);
        } catch (erro) {
          for (const c of cotacoes) await cancelarCotacao(supabaseAdmin, c.cotacao.id);
          throw erro;
        }
        for (const c of cotacoes) {
          await concluirCotacao(supabaseAdmin, autor, { conversa: atual, valores: c.valores });
          if (c.hotelCotado) await anotarOutroHotel(supabaseAdmin, autor, atual, c.hotelCotado);
        }
      };
      if (economico) {
        ctx.aoTextoParcial = async (t) => { if (!ehFraseDeEspera(t)) ctx.pedacos.push({ tipo: 'texto', texto: t }); };
        despacharPendentes = () => despachar('');
      } else {
        ctx.aoTextoParcial = enviar;
      }
      const { textoFinal } = await conversarComIA(ctx, {
        chave, modelo,
        instrucoes: montarInstrucoes({
          nomeHotel: robo.nomeHotel, nomeAssistente: config.nome_assistente, conteudo: textoConteudo(assuntos), info, economico,
          canalNome: canal.tipo === 'SITE' ? 'chat do site' : 'WhatsApp', outrosHoteis,
        }),
        contexto: contextoAgora({
          horario: robo.horario, contato,
          site: canal.tipo === 'SITE' ? { temContato: !!atual.contato_id, pagina: atual.visitante?.pagina || null } : null,
        }),
        mensagens: msgs, prazo,
      });

      if (economico) await despachar(textoFinal);
      else await enviar(textoFinal);
      await supabaseAdmin.from('atendimento_conversas')
        .update({ robo_atendeu: true, robo_ultima_resposta_em: new Date().toISOString(), robo_respondeu_ate: fotoEntrada }).eq('id', conversa.id);

      // O cliente escreveu de novo enquanto o robô pensava? Responde de novo (se der tempo)
      const { data: depois } = await supabaseAdmin.from('atendimento_conversas')
        .select('ultima_entrada_em, ultima_saida_em, robo_respondeu_ate, robo_pausado_em, robo_pausa_motivo').eq('id', conversa.id).maybeSingle();
      const chegouMais = depois && !pausaBloqueiaRobo(depois, config.horas_retomar) && temPendente(depois);
      if (!chegouMais || rodadas >= 2 || prazo - Date.now() < 6000) return { respondeu: true, mensagens: enviadas, pendente: !!chegouMais };
    }
  } catch (e) {
    // Modo econômico: o que já estava pronto (ex.: a cotação) não pode se perder
    if (despacharPendentes) { try { await despacharPendentes(); } catch (x) { /* segue */ } }
    const configuracao = e instanceof ErroIA && ERROS_DE_CONFIGURACAO.includes(e.codigo);
    const velha = Date.now() - ultimaEntrada > 3 * 60000;
    if (configuracao || velha || !(e instanceof ErroIA)) {
      // Problema que não passa sozinho (ou já tentou de novo): a equipe assume
      await pausar(supabaseAdmin, conversa.id, 'ERRO');
      await gravarNota(supabaseAdmin, autor, conversa, `🤖 O robô não conseguiu responder e passou a conversa para a equipe: ${e.message}`, 'robo_passou');
      try { await enviarPelaConversa(supabaseAdmin, autor, { canal, conversa, corpo: { semPrevia: true }, texto: MENSAGEM_RESERVA }); } catch (x) { /* segue */ }
      return { erro: e.message, pausou: true };
    }
    return { erro: e.message, tentarDeNovo: true };
  } finally {
    await supabaseAdmin.from('atendimento_conversas').update({ robo_ocupado_ate: null }).eq('id', conversa.id);
  }
}

// Conversas com mensagem do cliente ainda sem resposta (fila da função agendada)
export async function responderPendentes(supabaseAdmin, { origem, prazo, conversas = null }) {
  const resultados = [];
  let ids = conversas;
  if (!ids) {
    const { data: ligados } = await supabaseAdmin.from('atendimento_robo').select('hotel_id, canais').eq('ligado', true);
    if (!ligados?.length) return { resultados, ligados: 0 };
    const desde = new Date(Date.now() - PENDENTE_ATE_MIN * 60000).toISOString();
    const agoraIso = new Date().toISOString();
    const { data: candidatas } = await supabaseAdmin.from('atendimento_conversas')
      .select('id, hotel_id, canal_tipo, ultima_entrada_em, ultima_saida_em, robo_respondeu_ate, robo_pausado_em, robo_pausa_motivo').in('hotel_id', ligados.map((l) => l.hotel_id))
      .gte('ultima_entrada_em', desde)
      .or(`robo_ocupado_ate.is.null,robo_ocupado_ate.lt.${agoraIso}`)
      .order('ultima_entrada_em', { ascending: true }).limit(40);
    const canaisPorHotel = Object.fromEntries(ligados.map((l) => [l.hotel_id, l.canais || []]));
    // Pausa: a de "chamou a equipe por não saber" não impede (o robô continua);
    // as outras a própria responderConversa confere (e solta depois de N horas)
    ids = (candidatas || []).filter((c) => canaisPorHotel[c.hotel_id]?.includes(c.canal_tipo) && temPendente(c)
      && (!c.robo_pausado_em || c.robo_pausa_motivo === PAUSA_QUE_CONTINUA)).map((c) => c.id).slice(0, 5);
  }
  for (const id of ids) {
    if (prazo - Date.now() < 4000) { resultados.push({ conversaId: id, pulou: 'sem tempo' }); continue; }
    try { resultados.push({ conversaId: id, ...(await responderConversa(supabaseAdmin, id, { origem, prazo })) }); }
    catch (e) { resultados.push({ conversaId: id, erro: e.message }); }
  }
  return { resultados };
}

// Atualiza os dados da Cloudbeds dos robôs ligados (um hotel por vez)
export async function atualizarInfosVelhas(supabaseAdmin) {
  const limite = new Date(Date.now() - INFO_VALIDADE_DIAS * 86400000).toISOString();
  const { data } = await supabaseAdmin.from('atendimento_robo').select('hotel_id, hotel_info_em')
    .eq('ligado', true).or(`hotel_info_em.is.null,hotel_info_em.lt.${limite}`).limit(1);
  if (!data?.length) return null;
  try { await atualizarInfoHotel(supabaseAdmin, data[0].hotel_id); return data[0].hotel_id; } catch (e) { return null; }
}
