// ============================================================================
// VENDAS — motivo da perda (M15) e "o que mais perguntam" (M5). Tela e servidor.
// ============================================================================

// Ao arquivar uma conversa sem reserva, o atendente marca o motivo
// (decisão do dono, 05/11/2026). A ordem é a dos botões na tela.
export const MOTIVOS_PERDA_CONVERSA = {
  PRECO: 'Preço',
  SEM_VAGA: 'Sem vaga',
  OTA: 'Reservou em OTA (Booking, Decolar…)',
  DESISTIU: 'Desistiu',
  SEM_RESPOSTA: 'Sem resposta',
  OUTRO: 'Outro',
};

// Assuntos das perguntas dos clientes. Cada mensagem pode cair em mais de um.
// Palavras sem acento e em minúsculas (o texto é normalizado antes).
export const TEMAS_PERGUNTAS = [
  ['PRECO', 'Preço e valores', /\b(preco|precos|valor|valores|quanto (custa|fica|sai|e|seria)|diaria|diarias|tarifa|orcamento|promocao|desconto|mais barato)\b/],
  ['DATAS', 'Datas e vagas', /\b(disponibilidade|disponivel|tem vaga|tem quarto|tem apartamento|vagas?|lotado|reservar|fazer (uma )?reserva|\d{1,2}\/\d{1,2}|dia \d{1,2}|de \d{1,2} a \d{1,2})\b/],
  ['QUARTOS', 'Tipos de quarto e camas', /\b(casal|solteiro|duplo|triplo|quadruplo|camas?|suite|apartamento (simples|luxo)|standard|superior|varanda|vista|banheira|frigobar|ar condicionado)\b/],
  ['CAFE', 'Café da manhã', /\b(cafe|breakfast|desjejum)\b/],
  ['HORARIOS', 'Check-in e check-out', /\b(check ?in|check ?out|checkin|checkout|horario de (entrada|saida)|que horas (posso|pode|da pra|podemos) (entrar|chegar|sair)|early|late|entrar mais cedo|sair mais tarde)\b/],
  ['LOCAL', 'Localização e como chegar', /\b(onde fica|endereco|localizacao|localizado|distancia|perto d[aeo]|longe|praia|aeroporto|rodoviaria|como chegar|mapa|uber)\b/],
  ['ESTACIONAMENTO', 'Estacionamento', /\b(estacionamento|estacionar|garagem|parking|vaga (de|pra|para) (o )?carro)\b/],
  ['PAGAMENTO', 'Formas de pagamento', /\b(pix|cartao|credito|debito|parcela|parcelar|parcelado|\d ?x|pagamento|pagar|boleto|transferencia|sinal|deposito|a vista)\b/],
  ['CANCELAMENTO', 'Cancelamento e reembolso', /\b(cancelar|cancelamento|reembolso|reembolsar|estorno|devolucao do dinheiro)\b/],
  ['MINHA_RESERVA', 'Reserva já feita (confirmar, alterar)', /\b(minha reserva|confirmar (a )?reserva|confirmacao da reserva|numero da reserva|codigo da reserva|localizador|voucher|alterar (a )?reserva|mudar (a )?(data|reserva)|remarcar)\b/],
  ['CRIANCAS', 'Crianças e berço', /\b(crianca|criancas|filho|filha|filhos|bebe|berco|menor de idade|anos de idade)\b/],
  ['PET', 'Animais de estimação', /\b(pet|pets|cachorro|cachorra|cao|gato|gata|animal|animais)\b/],
  ['LAZER', 'Piscina, academia e lazer', /\b(piscina|academia|sala de jogos|lazer|sauna|restaurante|almoco|jantar)\b/],
  ['WIFI', 'Wi-Fi e internet', /\b(wi ?fi|wifi|internet|senha da rede)\b/],
  ['GRUPOS', 'Grupos, eventos e empresas', /\b(grupo|excursao|evento|congresso|empresa|corporativo|cnpj|nota fiscal|faturamento|faturar|\d{2,} pessoas)\b/],
  ['BAGAGEM', 'Guardar bagagem', /\b(bagagem|bagagens|malas?|guarda ?volumes?)\b/],
  ['VISITAS', 'Visitas', /\b(visita|visitas|visitante)\b/],
  ['HUMANO', 'Falar com uma pessoa', /\b(atendente|humano|falar com (alguem|uma pessoa|o gerente|a recepcao)|me liga|pode ligar|telefone do hotel)\b/],
];
export const ROTULO_TEMA = Object.fromEntries(TEMAS_PERGUNTAS.map(([k, r]) => [k, r]));

export function normalizarTexto(texto) {
  return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Lista dos assuntos de uma mensagem (vazia se não achou nenhum)
export function temasDoTexto(texto) {
  const t = normalizarTexto(texto);
  if (!t) return [];
  return TEMAS_PERGUNTAS.filter(([, , re]) => re.test(t)).map(([k]) => k);
}
