// ============================================================================
// ROBÔ (Fase 4) — valores usados na tela e no servidor (sem nada secreto)
// ============================================================================

// Preço por milhão de tokens (US$), da tabela da Anthropic de out/2026.
// O Haiku 5.5 cobra mais caro acima de 100 mil tokens por pedido; o robô
// fica bem abaixo disso. Se a Anthropic mudar o preço, é só trocar aqui.
export const MODELOS_IA = {
  'claude-haiku-5-5': {
    nome: 'Econômica — Claude Haiku 5.5',
    resumo: 'Rápida e barata. Boa para dúvidas comuns e cotações.',
    entrada: 0.10, saida: 0.50, cacheLeitura: 0.01, cacheEscrita: 0.125,
  },
  'claude-sonnet-5-5': {
    nome: 'Caprichada — Claude Sonnet 5.5',
    resumo: 'Mais cuidadosa nos casos difíceis. Custa cerca de 20 vezes mais.',
    entrada: 2.00, saida: 10.00, cacheLeitura: 0.10, cacheEscrita: 2.50,
  },
};
export const MODELO_PADRAO = 'claude-haiku-5-5';

// Canais em que o robô pode responder (Instagram e Facebook entram depois)
export const CANAIS_ROBO = [
  { tipo: 'WHATSAPP', nome: 'WhatsApp', pronto: true },
  { tipo: 'INSTAGRAM', nome: 'Instagram', pronto: false },
  { tipo: 'FACEBOOK', nome: 'Facebook Messenger', pronto: false },
  { tipo: 'SITE', nome: 'Chat do site', pronto: true },
];

export const TIPOS_SOLICITACAO = {
  PEDIDO_ESPECIAL: 'Pedido especial',
  GRUPO: 'Cotação de grupo',
  PROBLEMA_RESERVA: 'Problema ao reservar',
  CONFIRMACAO_RESERVA: 'Reserva existente (confirmar ou alterar)',
  CANCELAMENTO: 'Cancelamento de reserva',
  SEGUNDA_VIA: '2ª via de boleto',
  OUTRO: 'Outro assunto',
};

export const SITUACOES_SOLICITACAO = {
  NOVA: 'Nova',
  EM_ANDAMENTO: 'Em andamento',
  CONCLUIDA: 'Concluída',
};

export const MOTIVOS_PAUSA = {
  ASSUMIU: 'alguém da equipe assumiu',
  PEDIU_HUMANO: 'o cliente pediu para falar com uma pessoa',
  ROBO_NAO_SABE: 'o assunto precisa de uma pessoa da equipe',
  SEM_INFORMACAO: 'o robô não sabia uma resposta e chamou a equipe (continua respondendo o resto)',
  LIMITE: 'chegou ao limite de gasto do mês',
  ERRO: 'a IA deu erro',
};

// Assuntos sugeridos para o conteúdo do robô (roteiro da tela)
export const ASSUNTOS_SUGERIDOS = [
  ['Apresentação do hotel', 'Onde fica, estilo do hotel, para quem é indicado, distância da praia e dos pontos principais.'],
  ['Check-in e check-out', 'Horários, early check-in e late check-out (tem? quanto custa?), documentos pedidos na chegada.'],
  ['Café da manhã', 'Está incluso? Horário, onde é servido, opções para restrições alimentares.'],
  ['Quartos', 'Tipos de quarto, camas, quantas pessoas cabem, o que tem no quarto, vista.'],
  ['Crianças', 'Até que idade não paga, berço, cama extra e valores.'],
  ['Pets', 'Aceita animais? Regras e taxa.'],
  ['Estacionamento', 'Tem? É gratuito? Coberto? Precisa reservar?'],
  ['Formas de pagamento', 'Cartão, Pix, parcelamento, sinal, quando é cobrado.'],
  ['Política de cancelamento', 'Prazo para cancelar sem custo, multa, no-show, alteração de datas.'],
  ['Comodidades e serviços', 'Wi-Fi, piscina, academia, room service, lavanderia, recepção 24 h, acessibilidade.'],
  ['Como chegar e passeios', 'Distância do aeroporto e da rodoviária, transfer, passeios e restaurantes próximos.'],
  ['Grupos e eventos', 'A partir de quantos quartos é grupo, condições e o que pedir ao cliente.'],
  ['Regras e avisos', 'Horário de silêncio, visitas, fumantes, o que o robô nunca deve prometer.'],
];

export function custoDaChamada(modelo, uso = {}) {
  const p = MODELOS_IA[modelo] || MODELOS_IA[MODELO_PADRAO];
  const e = Number(uso.input_tokens || 0);
  const l = Number(uso.cache_read_input_tokens || 0);
  const w = Number(uso.cache_creation_input_tokens || 0);
  const s = Number(uso.output_tokens || 0);
  return (e * p.entrada + l * p.cacheLeitura + w * p.cacheEscrita + s * p.saida) / 1e6;
}

export function dolares(v, casas = 2) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'USD', minimumFractionDigits: casas, maximumFractionDigits: casas });
}

// Robô "chamou a equipe" porque não sabia uma resposta (decidido em 29/10):
// a conversa fica marcada para a equipe (e o prazo de resposta continua
// contando), mas o robô continua respondendo as outras perguntas. Ele só para
// de vez quando o cliente pede uma pessoa, o assunto é sensível ou alguém da
// equipe escreve (ASSUMIU).
export const PAUSA_QUE_CONTINUA = 'SEM_INFORMACAO';

// A pausa impede o robô de responder? (vale por horas_retomar horas)
export function pausaBloqueiaRobo(conversa, horasRetomar = 12, agora = Date.now()) {
  if (!conversa?.robo_pausado_em || conversa.robo_pausa_motivo === PAUSA_QUE_CONTINUA) return false;
  const ultimaEquipe = Math.max(new Date(conversa.robo_pausado_em).getTime(), conversa.ultima_saida_em ? new Date(conversa.ultima_saida_em).getTime() : 0);
  return agora - ultimaEquipe < (Number(horasRetomar) || 12) * 3600000;
}
