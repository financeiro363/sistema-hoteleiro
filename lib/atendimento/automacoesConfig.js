// ============================================================================
// CAIXA DE ENTRADA — AUTOMAÇÕES (Fase 5): nomes e padrões (tela e servidor)
// ============================================================================
// Cada automação manda um modelo aprovado do WhatsApp (mensagem fora da
// conversa só pode sair com modelo aprovado pela Meta). Todas começam
// DESLIGADAS: antes de ligar, desligue a equivalente no Asksuite para o
// cliente não receber duas mensagens.
// ============================================================================

export const AUTOMACOES = [
  {
    tipo: 'FUP_RESERVAR',
    titulo: 'Clicou em “Reservar agora” e não reservou',
    descricao: 'Algum tempo depois do clique no link da cotação, se a reserva não entrou na Cloudbeds, manda uma mensagem para retomar a venda.',
    asksuite: 'No Asksuite (J.R. e Guarany): espera 1 hora, não envia se houver conversa em andamento, modelo “FUP DE VENDAS 2”. O botão desse modelo abre um link do Asksuite (ak.gd): aqui é preciso um modelo com o botão abrindo o link do sistema.',
    espera: 60,
    campos: ['nome', 'nome_completo', 'hotel', 'checkin', 'checkout', 'noites', 'pessoas', 'valor', 'link_reservar'],
  },
  {
    tipo: 'FUP_COTACAO',
    titulo: 'Recebeu a cotação e não clicou',
    descricao: 'Se o cliente recebeu a cotação, não clicou em “Reservar agora” e não voltou a conversar, manda um lembrete.',
    asksuite: 'No Asksuite: agente “Follow up de chat não vendido após envio da cotação” (disponível, desligado).',
    espera: 24 * 60,
    campos: ['nome', 'nome_completo', 'hotel', 'checkin', 'checkout', 'noites', 'pessoas', 'valor', 'link_reservar'],
  },
  {
    tipo: 'SEM_DISPONIBILIDADE',
    titulo: 'Não tinha quarto: avisar se abrir vaga',
    descricao: 'Quando a cotação não tinha quarto, o sistema consulta a Cloudbeds de novo de tempos em tempos e avisa o cliente se abrir vaga para as mesmas datas (lista de espera).',
    asksuite: 'No Asksuite: “Follow-up de cotações com indisponibilidade” (desligado).',
    espera: 0,
    configPadrao: { reverificar_horas: 6 },
    campos: ['nome', 'nome_completo', 'hotel', 'checkin', 'checkout', 'noites', 'pessoas', 'valor', 'link_reservar'],
  },
  {
    tipo: 'GRUPO',
    titulo: 'Cotação de grupo: retomar o contato',
    descricao: 'Depois de uma solicitação de grupo, se o cliente não voltou a escrever, manda uma mensagem para retomar a conversa.',
    asksuite: 'No Asksuite: “Follow-up de cotação de grupos” (disponível, desligado).',
    espera: 48 * 60,
    campos: ['nome', 'nome_completo', 'hotel', 'checkin', 'checkout', 'pessoas'],
  },
  {
    tipo: 'RETOMADA',
    titulo: 'Conversa parada sem cotação: retomar',
    descricao: 'O cliente perguntou, o hotel respondeu e ele sumiu antes de pedir a cotação (não deu as datas). Manda uma mensagem curta perguntando se ainda tem interesse. Vai antes de fechar a janela de 24 h do WhatsApp, como mensagem normal (sem custo de modelo). Não vai para quem já reservou, já recebeu cotação, pediu grupo, é hóspede, nem para conversa resolvida ou arquivada; no máximo uma vez por semana por conversa.',
    asksuite: 'No Asksuite: agente “Recuperação de chat parado” — se estiver ligado, desligue antes de ligar aqui.',
    espera: 23 * 60,
    textoLivre: true,
    textoPadrao: 'Oi, {nome}! Ficou alguma dúvida? 😊 Se ainda tiver interesse, me diga as datas de entrada e saída e quantas pessoas, que eu já vejo os valores para você.',
    campos: ['nome', 'nome_completo', 'hotel'],
  },
  {
    tipo: 'CONFIRMACAO_RESERVA',
    titulo: 'Depois da reserva: confirmação',
    descricao: 'Quando a reserva de quem conversou com o hotel entra na Cloudbeds, manda a mensagem de confirmação (pode levar o link da ficha de hóspede). Depois do envio o robô fica em silêncio nessa conversa: quem responde é a equipe.',
    asksuite: 'No Asksuite: agente “Confirmação de reserva”; o J.R. tem o modelo “confirmacao_da_reserva_1dia”.',
    espera: 10,
    pararRobo: true,
    campos: ['nome', 'nome_completo', 'hotel', 'checkin', 'checkout', 'noites', 'numero_reserva', 'valor', 'link_ficha'],
  },
  {
    tipo: 'PRE_CHECKIN',
    titulo: 'Véspera da chegada (pré check-in)',
    descricao: 'Um dia antes do check-in, manda uma mensagem para quem tem reserva confirmada na Cloudbeds com telefone. Se o “lembrete da ficha” (abaixo) estiver ligado, quem ainda não preencheu a ficha recebe só o lembrete, no lugar desta. Depois do envio o robô fica em silêncio nessa conversa: quem responde é a equipe.',
    asksuite: 'No Asksuite: “Pré check-in, check-in e check-out — Cloudbeds” (ligado nos dois hotéis): 1 dia antes, às 8h, modelos “confirmacao_da_reserva_1dia” (J.R.) e “confirmao_da_reserva_1d” (Guarany), {{1}} = nome. Cerca de 40 envios por mês.',
    espera: 0,
    pararRobo: true,
    configPadrao: { hora: '08:00', dias: 1 },
    campos: ['nome', 'nome_completo', 'hotel', 'checkin', 'checkout', 'noites', 'numero_reserva', 'link_ficha'],
  },
  {
    tipo: 'FICHA_VESPERA',
    titulo: 'Véspera da chegada: lembrete da ficha',
    descricao: 'Um dia antes do check-in, só para quem ainda não preencheu a ficha de hóspede: manda o link da ficha. Ligado, ele substitui a mensagem da véspera para quem falta a ficha (use um modelo que também pergunte o que a véspera pergunta); quem já preencheu recebe a mensagem normal da véspera. Uma mensagem só por hóspede.',
    asksuite: 'Novo: o Asksuite não tem. Hoje a recepção manda o link da ficha à mão.',
    espera: 0,
    pararRobo: true,
    configPadrao: { hora: '08:00', dias: 1 },
    campos: ['nome', 'nome_completo', 'hotel', 'checkin', 'checkout', 'noites', 'numero_reserva', 'link_ficha'],
  },
  {
    tipo: 'BOAS_VINDAS',
    titulo: 'No check-in: boas-vindas',
    descricao: 'Quando a recepção faz o check-in na Cloudbeds, manda as boas-vindas (Wi-Fi, café da manhã, recepção, horário de saída). O sistema olha a Cloudbeds a cada 20 minutos. Se o hóspede conversou nas últimas 24 h, vai como mensagem normal; senão, vai o modelo.',
    asksuite: 'No Asksuite: parte do agente “Pré check-in, check-in e check-out — Cloudbeds”.',
    espera: 15,
    textoLivre: true,
    textoPadrao: 'Olá, {nome}! Seja bem-vindo(a) ao {hotel}. 😊 Precisando de algo durante a estadia, é só escrever aqui. A saída é no dia {checkout}.',
    campos: ['nome', 'nome_completo', 'hotel', 'checkin', 'checkout', 'noites', 'numero_reserva'],
  },
  {
    tipo: 'DIA_SAIDA',
    titulo: 'Dia da saída: lembrete do check-out',
    descricao: 'Na manhã do check-out, para quem ainda está hospedado: lembra o horário de saída e a devolução das chaves, e agradece. Se o hóspede conversou nas últimas 24 h, vai como mensagem normal; senão, vai o modelo.',
    asksuite: 'No Asksuite: parte do agente “Pré check-in, check-in e check-out — Cloudbeds”.',
    espera: 0,
    textoLivre: true,
    configPadrao: { hora: '07:30', dias: 0 },
    textoPadrao: 'Bom dia, {nome}! Hoje é o dia da sua saída do {hotel}. Obrigado pela preferência! Qualquer coisa, é só escrever aqui.',
    campos: ['nome', 'nome_completo', 'hotel', 'checkin', 'checkout', 'numero_reserva'],
  },
  {
    tipo: 'POS_CHECKOUT',
    titulo: 'Depois da saída: agradecimento',
    descricao: 'No dia seguinte ao check-out, agradece a estadia (pode pedir uma avaliação).',
    asksuite: 'No Asksuite: parte do agente de check-in e check-out da Cloudbeds.',
    espera: 0,
    configPadrao: { hora: '10:00', dias: 1 },
    campos: ['nome', 'nome_completo', 'hotel', 'checkin', 'checkout', 'numero_reserva'],
  },
  {
    tipo: 'PESQUISA',
    titulo: 'Pesquisa de satisfação',
    descricao: 'Quando o atendimento é marcado como resolvido, pergunta a nota de 1 a 5. Com a conversa aberta (até 24 h), vai como mensagem normal, sem modelo; depois disso, só com modelo.',
    asksuite: 'No Asksuite: agente “Feedback de atendimento” (disponível, desligado). Modelo “AskFlow - Feedback Atendimento” com 5 botões (5 - Excelente … 1 - Péssimo): a resposta pelo botão já vira nota aqui.',
    espera: 10,
    textoLivre: true,
    textoPadrao: 'Olá, como foi sua experiência com o nosso atendimento? Avalie o atendimento prestado por {atendente} respondendo com um número:\n5 - Excelente\n4 - Bom\n3 - Regular\n2 - Ruim\n1 - Péssimo',
    campos: ['nome', 'nome_completo', 'hotel', 'atendente'],
  },
];

export const AUTOMACAO_POR_TIPO = Object.fromEntries(AUTOMACOES.map((a) => [a.tipo, a]));

// Campos que podem preencher as variáveis {{1}}, {{2}}… do modelo
export const CAMPOS_VARIAVEL = {
  nome: 'Primeiro nome do cliente',
  nome_completo: 'Nome completo do cliente',
  hotel: 'Nome do hotel',
  checkin: 'Data de entrada',
  checkout: 'Data de saída',
  noites: 'Número de noites',
  pessoas: 'Hóspedes (ex.: 2 adultos)',
  valor: 'Valor (a partir de)',
  link_reservar: 'Link “Reservar agora”',
  numero_reserva: 'Número da reserva',
  link_ficha: 'Link da ficha de hóspede',
  atendente: 'Nome de quem atendeu',
};

// Automações que consultam a Cloudbeds numa hora do dia
// (dias: + antes da entrada, − depois da saída, 0 = no dia)
export const AUTOMACOES_POR_HORA = ['PRE_CHECKIN', 'FICHA_VESPERA', 'POS_CHECKOUT', 'DIA_SAIDA'];

// Variáveis que dá para usar no texto da mensagem normal (sem modelo)
export const VARIAVEIS_TEXTO = {
  PESQUISA: ['nome', 'atendente'],
  RETOMADA: ['nome', 'hotel'],
  BOAS_VINDAS: ['nome', 'hotel', 'checkout'],
  DIA_SAIDA: ['nome', 'hotel', 'checkout'],
};

// Retomada: a janela de 24 h do WhatsApp fecha 24 h depois da última
// mensagem do cliente; com espera maior que isto, só com modelo
export const RETOMADA_MAX_SEM_MODELO_MIN = 23 * 60 + 30;

export const SITUACOES_DISPARO = {
  AGENDADO: 'Agendado',
  ENVIADO: 'Enviado',
  PULADO: 'Não enviado',
  FALHOU: 'Falhou',
  CANCELADO: 'Cancelado',
};

// "SAIR" e parecidos: o cliente não quer mais mensagens automáticas
export const REGEX_SAIR = /^\s*(sair|parar|pare|stop|descadastrar|cancelar inscri[cç][aã]o|n[aã]o quero (mais )?receber( mensagens?)?)\s*[.!]*\s*$/i;

// Nota da pesquisa: "5", "nota 4", "5 estrelas", "⭐⭐⭐⭐", e os botões do
// modelo do Asksuite: "5 - Excelente", "4 - Bom", "3 - Regular", "2 - Ruim", "1 - Péssimo"
const NOTA_POR_PALAVRA = { excelente: 5, otimo: 5, bom: 4, regular: 3, ruim: 2, pessimo: 1 };
export function lerNota(texto) {
  const t = String(texto || '').trim();
  const estrelas = (t.match(/⭐|★/g) || []).length;
  if (estrelas >= 1 && estrelas <= 5 && t.replace(/⭐|★|\s|️/g, '') === '') return estrelas;
  const m = t.match(/^(?:nota\s*)?([1-5])(?:\s*(?:estrelas?|⭐|de\s*5|\/\s*5))?\s*[.!]*$/i);
  if (m) return Number(m[1]);
  const semAcento = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const b = semAcento.match(/^([1-5])\s*[-–—:.)]\s*(excelente|otimo|bom|regular|ruim|pessimo)\s*[.!]*$/);
  if (b && NOTA_POR_PALAVRA[b[2]] === Number(b[1])) return Number(b[1]);
  const p = semAcento.match(/^(excelente|otimo|bom|regular|ruim|pessimo)\s*[.!]*$/);
  return p ? NOTA_POR_PALAVRA[p[1]] : null;
}

export function esperaTexto(minutos) {
  const m = Number(minutos) || 0;
  if (m === 0) return 'na hora';
  if (m % 1440 === 0) return `${m / 1440} dia(s)`;
  if (m % 60 === 0) return `${m / 60} hora(s)`;
  return `${m} minuto(s)`;
}
