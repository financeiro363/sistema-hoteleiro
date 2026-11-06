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
    tipo: 'OFERTA',
    titulo: 'Segunda tentativa com oferta',
    descricao: 'Alguns dias depois da cotação, se o cliente não reservou e não voltou a conversar, manda uma segunda mensagem com um benefício (o texto que você escrever). Só para datas com bastante vaga: antes de mandar, o sistema consulta a ocupação das datas na Cloudbeds. Se o cliente reservar, a recepção vê o benefício na tela de chegadas.',
    asksuite: 'Novo: o Asksuite não tem. Use depois do “Recebeu a cotação e não clicou”.',
    espera: 3 * 24 * 60,
    configPadrao: { ocupacao_max: 60, beneficio: '' },
    campos: ['nome', 'nome_completo', 'hotel', 'checkin', 'checkout', 'noites', 'pessoas', 'valor', 'link_reservar', 'beneficio'],
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
    tipo: 'UPGRADE',
    titulo: 'Véspera: upgrade de quarto e late check-out',
    descricao: 'Um dia antes da chegada, oferece upgrade para um quarto melhor (só se a Cloudbeds mostrar vaga nele nas datas da reserva) e/ou late check-out, com os preços que você define. Quando o hóspede aceita pelo botão, a conversa vai para “Pendente” e a recepção lança o valor na reserva.',
    asksuite: 'Novo: o Asksuite não tem.',
    espera: 0,
    configPadrao: { hora: '11:00', dias: 1, late_hora: '14:00' },
    campos: ['nome', 'nome_completo', 'hotel', 'checkin', 'checkout', 'noites', 'numero_reserva', 'oferta_upgrade'],
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
    titulo: 'Depois da saída: agradecimento e nota da estadia',
    descricao: 'No dia seguinte ao check-out, agradece a estadia e pede uma nota de 1 a 5 (use o modelo pronto “Pesquisa da estadia”, com botões). A nota entra no Painel; nota 1, 2 ou 3 avisa os administradores no celular e por e-mail, e a conversa vai para “Pendente” para alguém falar com o hóspede.',
    asksuite: 'No Asksuite: parte do agente de check-in e check-out da Cloudbeds.',
    espera: 0,
    configPadrao: { hora: '10:00', dias: 1 },
    campos: ['nome', 'nome_completo', 'hotel', 'checkin', 'checkout', 'numero_reserva'],
  },
  {
    tipo: 'ANIVERSARIO',
    titulo: 'Aniversário do hóspede',
    descricao: 'No dia do aniversário (data de nascimento da ficha de hóspede), manda os parabéns para quem se hospedou nos últimos 3 anos. Só parabéns, sem benefício. Uma vez por ano por telefone.',
    asksuite: 'Novo: o Asksuite não tem.',
    espera: 0,
    configPadrao: { hora: '10:00' },
    campos: ['nome', 'nome_completo', 'hotel'],
  },
  {
    tipo: 'REATIVACAO',
    titulo: 'Cliente que não volta há mais de 1 ano',
    descricao: 'Para quem teve a última estadia há 1 ano (pela ficha de hóspede) e não voltou: manda um “sentimos sua falta” convidando a responder com as datas. Uma vez por ano por telefone; não vai para quem conversou com o hotel nos últimos 30 dias.',
    asksuite: 'Novo: o Asksuite não tem.',
    espera: 0,
    configPadrao: { hora: '10:30' },
    campos: ['nome', 'nome_completo', 'hotel'],
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
  beneficio: 'Benefício da oferta',
  oferta_upgrade: 'O que é oferecido (upgrade / late check-out e preços)',
  atendente: 'Nome de quem atendeu',
};

// Automações que consultam a Cloudbeds numa hora do dia
// (dias: + antes da entrada, − depois da saída, 0 = no dia)
export const AUTOMACOES_POR_HORA = ['PRE_CHECKIN', 'FICHA_VESPERA', 'UPGRADE', 'POS_CHECKOUT', 'DIA_SAIDA'];
// Também uma vez por dia, na hora marcada, mas pela ficha de hóspede
export const AUTOMACOES_DA_FICHA = ['ANIVERSARIO', 'REATIVACAO'];
// Resposta à oferta de upgrade (botões do modelo, em pt/en/es)
export function respostaUpgrade(texto) {
  const t = String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  if (!t) return null;
  if (/^(nao|no)\b|nao,? obrigad|no,? (thanks|gracias)|dispenso/.test(t)) return 'NAO';
  if (/upgrade|quarto melhor|better room|mejor habitacion/.test(t)) return 'UPGRADE';
  if (/late|sair mais tarde|salida tardia/.test(t)) return 'LATE';
  return null;
}

// Nota da pesquisa da estadia que avisa os administradores
export const NOTA_BAIXA_ATE = 3;

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
// Palavras dos botões em português, inglês e espanhol (modelos traduzidos, M7)
const NOTA_POR_PALAVRA = { excelente: 5, otimo: 5, bom: 4, regular: 3, ruim: 2, pessimo: 1, excellent: 5, good: 4, fair: 3, poor: 2, 'very poor': 1, buena: 4, bueno: 4, mala: 2, malo: 2, pesima: 1, pesimo: 1 };
const PALAVRAS_NOTA = 'excelente|otimo|bom|regular|ruim|pessimo|excellent|good|fair|very poor|poor|buena|bueno|mala|malo|pesima|pesimo';
export function lerNota(texto) {
  const t = String(texto || '').trim();
  const estrelas = (t.match(/⭐|★/g) || []).length;
  if (estrelas >= 1 && estrelas <= 5 && t.replace(/⭐|★|\s|️/g, '') === '') return estrelas;
  const m = t.match(/^(?:nota\s*)?([1-5])(?:\s*(?:estrelas?|⭐|de\s*5|\/\s*5))?\s*[.!]*$/i);
  if (m) return Number(m[1]);
  const semAcento = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const b = semAcento.match(new RegExp(`^([1-5])\\s*[-–—:.)]\\s*(${PALAVRAS_NOTA})\\s*[.!]*$`));
  if (b && NOTA_POR_PALAVRA[b[2]] === Number(b[1])) return Number(b[1]);
  const p = semAcento.match(new RegExp(`^(${PALAVRAS_NOTA})\\s*[.!]*$`));
  return p ? NOTA_POR_PALAVRA[p[1]] : null;
}

export function esperaTexto(minutos) {
  const m = Number(minutos) || 0;
  if (m === 0) return 'na hora';
  if (m % 1440 === 0) return `${m / 1440} dia(s)`;
  if (m % 60 === 0) return `${m / 60} hora(s)`;
  return `${m} minuto(s)`;
}
