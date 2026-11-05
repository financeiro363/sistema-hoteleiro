// ============================================================================
// TEXTOS DE BOAS-VINDAS E DO DIA DA SAÍDA, POR HOTEL (M2) — tela e servidor
// ============================================================================
// Montados com o conteúdo do robô de cada hotel (horário do café, Wi-Fi,
// recepção, check-out, chaves, bagagem). Servem de texto inicial da mensagem
// normal (aba Automações) e dos modelos prontos para criar na Meta (aba
// WhatsApp → Modelos). Dá para editar nas duas telas antes de usar.
// Se o conteúdo do robô mudar (ex.: horário do café), atualize aqui também.
// Hotéis: 4 = J. R. Hotel · 5 = Guarany Hotel (outros: texto geral).
// ============================================================================

const TEXTOS = {
  4: {
    BOAS_VINDAS: [
      'Olá, {nome}! Seja bem-vindo(a) ao J. R. Hotel. 😊',
      'Algumas informações para a sua estadia:',
      '☕ Café da manhã incluso: segunda a sexta, das 6h às 9h; fins de semana e feriados, das 6h às 10h.',
      '📶 Wi-Fi grátis em todo o hotel (a senha foi entregue no check-in).',
      '🏊 Piscina, academia e sala de jogos à disposição.',
      '🚗 Estacionamento gratuito, por ordem de chegada.',
      '🛎️ Recepção 24 horas: (83) 2106-8700.',
      '🕛 Check-out até as 12h do dia {checkout}.',
      'Precisando de algo, fale com a recepção ou responda esta mensagem.',
    ].join('\n'),
    DIA_SAIDA: [
      'Bom dia, {nome}! Hoje é o dia da sua saída do J. R. Hotel.',
      '🕛 O check-out é até as 12h. Se precisar de mais tempo, fale com a recepção: conforme a ocupação, dá para sair até as 13h, sem custo.',
      '🔑 Na saída, devolva na recepção a chave do quarto e a do cofre.',
      '🧾 Precisa de nota fiscal? É só pedir na recepção na hora da saída.',
      '🧳 O hotel não guarda bagagem depois do check-out.',
      'Obrigado pela preferência e boa viagem!',
    ].join('\n'),
  },
  5: {
    BOAS_VINDAS: [
      'Olá, {nome}! Seja bem-vindo(a) ao Guarany Hotel. 😊',
      'Algumas informações para a sua estadia:',
      '☕ Café da manhã regional incluso: segunda a sexta, das 6h às 9h; sábados, domingos e feriados, das 6h às 10h.',
      '📶 Wi-Fi grátis em todo o hotel (a senha foi entregue no check-in).',
      '🥤 Água e refrigerante: peça na recepção, que leva até o quarto, 24 horas (cobrado à parte).',
      '🚗 Estacionamento incluso, com vagas limitadas.',
      '🛎️ Recepção 24 horas: (83) 2106-8787.',
      '🕛 Check-out até as 12h do dia {checkout}.',
      'Precisando de algo, fale com a recepção ou responda esta mensagem.',
    ].join('\n'),
    DIA_SAIDA: [
      'Bom dia, {nome}! Hoje é o dia da sua saída do Guarany Hotel.',
      '🕛 O check-out é até as 12h. Em alguns dias, conforme o movimento, a recepção pode liberar até as 13h: é só pedir.',
      '🔑 Na saída, devolva na recepção a chave do quarto e a do cofre (com o trancão).',
      '🧳 O hotel não guarda bagagem depois do check-out.',
      'Obrigado pela preferência e boa viagem!',
    ].join('\n'),
  },
};

// Texto inicial da mensagem normal de um tipo, para um hotel (ou null)
export function textoDoHotel(tipo, hotelId) {
  return TEXTOS[Number(hotelId)]?.[tipo] || null;
}

// Mesmo texto no formato de modelo da Meta: {nome} → {{1}}, {checkout} → {{2}}
export function textoComoModelo(texto) {
  return String(texto || '').replace('{nome}', '{{1}}').replace('{checkout}', '{{2}}');
}
