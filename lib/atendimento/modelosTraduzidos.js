// ============================================================================
// MODELOS PRONTOS EM INGLÊS E ESPANHOL (M7) — tela
// ============================================================================
// Mesmo nome do modelo em português, outro idioma (a Meta aceita o mesmo nome
// em idiomas diferentes). Variáveis na MESMA ordem e os MESMOS botões do
// modelo em português, para a automação poder trocar um pelo outro.
// Boas-vindas e dia da saída: com as informações de cada hotel.
// ============================================================================

const SAIR = { en: 'Reply STOP to unsubscribe', es: 'Responda SALIR para no recibir más' };

// Boas-vindas e saída por hotel ({{1}} = nome; boas-vindas {{2}} = data de saída)
const HOTEIS = {
  4: {
    nome: 'J. R. Hotel', recepcao: '+55 83 2106-8700',
    en: {
      bv: ['☕ Breakfast included: Monday to Friday, 6am to 9am; weekends and holidays, 6am to 10am.', '📶 Free Wi-Fi throughout the hotel (the password was given at check-in).', '🏊 Pool, gym and game room available.', '🚗 Free parking, first come, first served.'],
      ds: ['🕛 Check-out is until 12pm. If you need more time, ask the front desk: depending on occupancy, you can leave until 1pm at no cost.', '🔑 When leaving, return the room key and the safe key to the front desk.', '🧾 Need an invoice? Just ask at the front desk when checking out.', '🧳 The hotel does not store luggage after check-out.'],
    },
    es: {
      bv: ['☕ Desayuno incluido: de lunes a viernes, de 6h a 9h; fines de semana y feriados, de 6h a 10h.', '📶 Wi-Fi gratis en todo el hotel (la contraseña se entregó en el check-in).', '🏊 Piscina, gimnasio y sala de juegos a su disposición.', '🚗 Estacionamiento gratis, por orden de llegada.'],
      ds: ['🕛 El check-out es hasta las 12h. Si necesita más tiempo, hable con la recepción: según la ocupación, puede salir hasta las 13h sin costo.', '🔑 Al salir, devuelva en la recepción la llave de la habitación y la de la caja fuerte.', '🧾 ¿Necesita factura? Pídala en la recepción al salir.', '🧳 El hotel no guarda equipaje después del check-out.'],
    },
  },
  5: {
    nome: 'Guarany Hotel', recepcao: '+55 83 2106-8787',
    en: {
      bv: ['☕ Regional breakfast included: Monday to Friday, 6am to 9am; Saturdays, Sundays and holidays, 6am to 10am.', '📶 Free Wi-Fi throughout the hotel (the password was given at check-in).', '🥤 Water and soft drinks: ask the front desk and they bring them to your room, 24 hours (charged separately).', '🚗 Parking included, limited spaces.'],
      ds: ['🕛 Check-out is until 12pm. On some days, depending on demand, the front desk can extend it to 1pm: just ask.', '🔑 When leaving, return the room key and the safe key (with the lock) to the front desk.', '🧳 The hotel does not store luggage after check-out.'],
    },
    es: {
      bv: ['☕ Desayuno regional incluido: de lunes a viernes, de 6h a 9h; sábados, domingos y feriados, de 6h a 10h.', '📶 Wi-Fi gratis en todo el hotel (la contraseña se entregó en el check-in).', '🥤 Agua y refrescos: pídalos en la recepción y se los llevan a la habitación, las 24 horas (se cobran aparte).', '🚗 Estacionamiento incluido, con plazas limitadas.'],
      ds: ['🕛 El check-out es hasta las 12h. Algunos días, según la demanda, la recepción puede extenderlo hasta las 13h: solo pídalo.', '🔑 Al salir, devuelva en la recepción la llave de la habitación y la de la caja fuerte (con el candado).', '🧳 El hotel no guarda equipaje después del check-out.'],
    },
  },
};

export function prontosTraduzidos(origem, hotelId) {
  const linkFicha = (texto) => ({ tipo: 'URL', texto, url: `${origem}/f/{{1}}`, exemplo: '4-AbCdEf1234' });
  const h = HOTEIS[Number(hotelId)] || null;
  const lista = [];
  for (const [k, cod, nomeIdioma] of [['en', 'en_US', 'inglês'], ['es', 'es', 'espanhol']]) {
    const en = k === 'en';
    const add = (base, titulo, categoria, campos) => lista.push({ chave: `${base}__${k}`, nome: base, idioma: cod, titulo: `${titulo} — em ${nomeIdioma}`, categoria, ...campos });
    add('confirmacao_reserva_ficha', 'Confirmação da reserva + link da ficha', 'UTILITY', {
      corpo: en
        ? 'Hello, {{1}}! Your booking no. {{2}} at {{3}} is confirmed: check-in on {{4}} and check-out on {{5}}.\n\n📝 To speed up your arrival, please fill in the guest registration form using the button below. It takes about 3 minutes and is required by Brazilian law for every guest.\n\nAny questions, just reply to this message.'
        : '¡Hola, {{1}}! Su reserva n.º {{2}} en {{3}} está confirmada: entrada el {{4}} y salida el {{5}}.\n\n📝 Para agilizar su llegada, complete la ficha de huésped con el botón de abajo. Toma unos 3 minutos y es obligatoria por ley en Brasil para todos los huéspedes.\n\nCualquier duda, solo responda este mensaje.',
      exemplos: ['Maria', '1234567890', 'J. R. Hotel', '10/12/2026', '12/12/2026'], rodape: '', botoes: [linkFicha(en ? 'Fill in the form' : 'Completar la ficha')],
      usarEm: 'Versão traduzida da “Confirmação da reserva + link da ficha” (mesmas variáveis e botão).',
    });
    add('ficha_vespera', 'Véspera da chegada: lembrete da ficha', 'UTILITY', {
      cabecalho: en ? 'Your stay starts tomorrow' : 'Su reserva es mañana',
      corpo: en
        ? 'Good morning, {{1}}! Your stay at {{2}} starts tomorrow.\n📝 To speed up your arrival, please fill in the guest registration form using the button below (required by law, about 3 minutes).\nAlso, how would you like the beds in your room?'
        : '¡Buenos días, {{1}}! Su reserva en {{2}} es mañana.\n📝 Para agilizar su llegada, complete la ficha de huésped con el botón de abajo (es obligatoria por ley y toma unos 3 minutos).\nY dígame: ¿cómo prefiere las camas en la habitación?',
      exemplos: ['Maria', 'J. R. Hotel'], rodape: '', botoes: [linkFicha(en ? 'Fill in the form' : 'Completar la ficha')],
      usarEm: 'Versão traduzida do “Lembrete da ficha” (mesmas variáveis e botão).',
    });
    add('pesquisa_estadia', 'Depois da saída: nota da estadia', 'UTILITY', {
      corpo: en
        ? 'Hello, {{1}}! Thank you for staying at {{2}}.\nFrom 1 to 5, how would you rate your stay? Just tap one of the buttons below.'
        : '¡Hola, {{1}}! Gracias por hospedarse en {{2}}.\nDel 1 al 5, ¿qué nota le da a su estadía? Solo toque uno de los botones de abajo.',
      exemplos: ['Maria', 'J. R. Hotel'], rodape: '',
      botoes: (en ? ['5 - Excellent', '4 - Good', '3 - Fair', '2 - Poor', '1 - Very poor'] : ['5 - Excelente', '4 - Buena', '3 - Regular', '2 - Mala', '1 - Pésima']).map((texto) => ({ tipo: 'QUICK_REPLY', texto })),
      usarEm: 'Versão traduzida da “Nota da estadia” (a nota é lida pelo número do botão).',
    });
    add('upgrade_vespera', 'Véspera: upgrade e late check-out', 'MARKETING', {
      corpo: en
        ? 'Hello, {{1}}! Your stay at {{2}} starts tomorrow. 😊\nWe have a special option for you: {{3}}.\nWould you like it? Just tap a button below.'
        : '¡Hola, {{1}}! Su reserva en {{2}} es mañana. 😊\nTenemos una opción especial para usted: {{3}}.\n¿Le interesa? Solo toque un botón abajo.',
      exemplos: ['Maria', 'J. R. Hotel', en ? 'upgrade to the Deluxe Room for R$ 80 per night' : 'upgrade a la habitación Lujo por R$ 80 por noche'],
      rodape: SAIR[k],
      botoes: (en ? ['I want the upgrade', 'I want late check-out', 'No, thanks'] : ['Quiero el upgrade', 'Quiero el late check-out', 'No, gracias']).map((texto) => ({ tipo: 'QUICK_REPLY', texto })),
      usarEm: 'Versão traduzida da oferta da véspera (o sistema escreve a oferta, {{3}}, no mesmo idioma).',
    });
    if (h) {
      const t = h[k];
      add('boas_vindas_hospede', `No check-in: boas-vindas (${h.nome})`, 'UTILITY', {
        corpo: [en ? `Hello, {{1}}! Welcome to ${h.nome}. 😊` : `¡Hola, {{1}}! Bienvenido(a) a ${h.nome}. 😊`, en ? 'Some information for your stay:' : 'Algunas informaciones para su estadía:',
          ...t.bv, en ? `🛎️ 24-hour front desk: ${h.recepcao}.` : `🛎️ Recepción 24 horas: ${h.recepcao}.`,
          en ? '🕛 Check-out until 12pm on {{2}}.' : '🕛 Check-out hasta las 12h del día {{2}}.',
          en ? 'If you need anything, talk to the front desk or reply to this message.' : 'Si necesita algo, hable con la recepción o responda este mensaje.'].join('\n'),
        exemplos: ['Maria', '12/12/2026'], rodape: '', botoes: [],
        usarEm: 'Versão traduzida das boas-vindas deste hotel (nome, data de saída).',
      });
      add('dia_da_saida', `Dia da saída (${h.nome})`, 'UTILITY', {
        corpo: [en ? `Good morning, {{1}}! Today is your check-out day at ${h.nome}.` : `¡Buenos días, {{1}}! Hoy es el día de su salida de ${h.nome}.`, ...t.ds,
          en ? 'Thank you for staying with us and have a safe trip!' : '¡Gracias por su preferencia y buen viaje!'].join('\n'),
        exemplos: ['Maria'], rodape: '', botoes: [],
        usarEm: 'Versão traduzida do dia da saída deste hotel (nome).',
      });
    }
  }
  return lista;
}
