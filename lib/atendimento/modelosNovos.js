// ============================================================================
// Modelos (templates) do WhatsApp — criar pela tela (Fase 6). Tela e servidor.
// ============================================================================
// Regras da Meta: nome com letras minúsculas, números e _; texto até 1.024
// letras; título até 60 (1 variável); rodapé até 60 (sem variável); até 10
// botões (respostas rápidas com até 25 letras, até 2 de link). Cada variável
// {{1}}, {{2}}… precisa de um exemplo, e o texto não pode começar nem
// terminar com uma variável.
// ============================================================================

export const CATEGORIAS_MODELO = {
  MARKETING: { rotulo: 'Marketing', dica: 'Promoções, follow-up de vendas, lembretes para reservar. Custa mais.' },
  UTILITY: { rotulo: 'Utilidade', dica: 'Confirmação de reserva, aviso de chegada, pesquisa de satisfação. Custa menos. A Meta muda para Marketing se o texto parecer propaganda.' },
};
export const IDIOMAS_MODELO = { pt_BR: 'Português (Brasil)', en_US: 'Inglês (EUA)', en: 'Inglês', es: 'Espanhol' };
export const SITUACAO_MODELO = {
  APPROVED: { rotulo: 'Aprovado', cor: { background: '#E5F4EA', color: '#14532D' } },
  PENDING: { rotulo: 'Em análise', cor: { background: '#FFF4D6', color: '#7A5600' } },
  REJECTED: { rotulo: 'Recusado', cor: { background: '#FDECEA', color: '#B42318' } },
  PAUSED: { rotulo: 'Pausado', cor: { background: '#F1F1EE', color: '#5B6762' } },
  DISABLED: { rotulo: 'Desativado', cor: { background: '#F1F1EE', color: '#5B6762' } },
  IN_APPEAL: { rotulo: 'Em recurso', cor: { background: '#FFF4D6', color: '#7A5600' } },
};

import { textoDoHotel, textoComoModelo } from './textosHospedagem';
import { prontosTraduzidos } from './modelosTraduzidos';

const RODAPE_SAIR = 'Para não receber mais, responda SAIR';

// Modelos prontos: textos do Asksuite adaptados (o hotel entra como variável).
// Boas-vindas e dia da saída: com o conteúdo do robô do hotel escolhido.
export function modelosProntos(origem, hotelId) {
  const link = (texto) => ({ tipo: 'URL', texto, url: `${origem}/r/{{1}}`, exemplo: 'AB12CD34-0' });
  const linkFicha = (texto) => ({ tipo: 'URL', texto, url: `${origem}/f/{{1}}`, exemplo: '4-AbCdEf1234' });
  const boasVindas = textoComoModelo(textoDoHotel('BOAS_VINDAS', hotelId)
    || 'Olá, {nome}! Seja bem-vindo(a). 😊\nO check-out é no dia {checkout}.\nPrecisando de algo, fale com a recepção ou responda esta mensagem.');
  const diaSaida = textoComoModelo(textoDoHotel('DIA_SAIDA', hotelId)
    || 'Bom dia, {nome}! Hoje é o dia da sua saída.\nO check-out é até as 12h: na saída, devolva as chaves na recepção.\nObrigado pela preferência e boa viagem!');
  return [
    {
      chave: 'fup_reservar_agora', titulo: 'Clicou em “Reservar agora” e não reservou', categoria: 'MARKETING',
      corpo: 'Oi, {{1}} 👋\nTudo bem?\n\nVi que você começou a reserva no {{2}}, mas não concluiu.\n📲 Quer garantir sua vaga? É só tocar no botão abaixo e finalizar!',
      exemplos: ['Maria', 'J. R. Hotel'], rodape: RODAPE_SAIR, botoes: [link('Finalizar reserva')],
      usarEm: 'Automação “Clicou em Reservar agora e não reservou” (variáveis: primeiro nome, nome do hotel).',
    },
    {
      chave: 'cotacao_sem_clique', titulo: 'Recebeu a cotação e não reservou', categoria: 'MARKETING',
      corpo: 'Olá, {{1}}! Vimos que você pediu uma cotação no {{2}} para {{3}} a {{4}}, mas ainda não reservou.\nAs vagas para essas datas podem acabar. Quer garantir a sua? É só tocar no botão abaixo.',
      exemplos: ['Maria', 'J. R. Hotel', '10/12/2026', '12/12/2026'], rodape: RODAPE_SAIR, botoes: [link('Reservar agora')],
      usarEm: 'Automação “Recebeu a cotação e não clicou” (primeiro nome, hotel, entrada, saída).',
    },
    {
      chave: 'abriu_vaga', titulo: 'Abriu vaga (lista de espera)', categoria: 'MARKETING',
      corpo: 'Boa notícia, {{1}}! Abriu vaga no {{2}} para {{3}} a {{4}}, as datas que você procurou.\nPara garantir, é só tocar no botão abaixo.',
      exemplos: ['Maria', 'J. R. Hotel', '10/12/2026', '12/12/2026'], rodape: RODAPE_SAIR, botoes: [link('Reservar agora')],
      usarEm: 'Automação “Não tinha quarto: avisar se abrir vaga” (primeiro nome, hotel, entrada, saída).',
    },
    {
      chave: 'retomar_grupo', titulo: 'Cotação de grupo: retomar o contato', categoria: 'MARKETING',
      corpo: 'Olá, {{1}}! Recebemos o seu pedido de cotação para grupo no {{2}}.\nPodemos continuar? É só responder esta mensagem que a nossa equipe te atende.',
      exemplos: ['Maria', 'J. R. Hotel'], rodape: RODAPE_SAIR, botoes: [{ tipo: 'QUICK_REPLY', texto: 'Quero continuar' }],
      usarEm: 'Automação “Cotação de grupo” (primeiro nome, hotel).',
    },
    {
      chave: 'confirmacao_reserva', titulo: 'Confirmação da reserva', categoria: 'UTILITY',
      corpo: 'Olá, {{1}}! Sua reserva nº {{2}} no {{3}} está confirmada: entrada em {{4}} e saída em {{5}}.\nQualquer dúvida, é só responder esta mensagem.',
      exemplos: ['Maria', '1234567890', 'J. R. Hotel', '10/12/2026', '12/12/2026'], rodape: '', botoes: [],
      usarEm: 'Automação “Depois da reserva: confirmação” (primeiro nome, nº da reserva, hotel, entrada, saída).',
    },
    {
      chave: 'vespera_chegada', titulo: 'Véspera da chegada (pré check-in)', categoria: 'UTILITY',
      cabecalho: 'Sua reserva é amanhã',
      corpo: 'Bom dia, {{1}}! Sua reserva no {{2}} é amanhã.\nPara deixarmos tudo pronto na sua chegada, me confirma como prefere as camas no quarto?',
      exemplos: ['Maria', 'J. R. Hotel'], rodape: '', botoes: [],
      usarEm: 'Automação “Véspera da chegada” (primeiro nome, hotel). Igual ao texto do Asksuite.',
    },
    {
      chave: 'confirmacao_reserva_ficha', titulo: 'Confirmação da reserva + link da ficha', categoria: 'UTILITY',
      corpo: 'Olá, {{1}}! Sua reserva nº {{2}} no {{3}} está confirmada: entrada em {{4}} e saída em {{5}}.\n\n📝 Para agilizar a sua chegada, preencha a ficha de hóspede no botão abaixo. Leva uns 3 minutos, e a ficha é obrigatória por lei para todo hóspede.\n\nQualquer dúvida, é só responder esta mensagem.',
      exemplos: ['Maria', '1234567890', 'J. R. Hotel', '10/12/2026', '12/12/2026'], rodape: '', botoes: [linkFicha('Preencher a ficha')],
      usarEm: 'Automação “Depois da reserva: confirmação” (primeiro nome, nº da reserva, hotel, entrada, saída). O botão abre a ficha desta reserva.',
    },
    {
      chave: 'ficha_vespera', titulo: 'Véspera da chegada: lembrete da ficha', categoria: 'UTILITY',
      cabecalho: 'Sua reserva é amanhã',
      corpo: 'Bom dia, {{1}}! Sua reserva no {{2}} é amanhã.\n📝 Para agilizar a sua chegada, preencha a ficha de hóspede no botão abaixo (é obrigatória por lei e leva uns 3 minutos).\nE me confirma: como prefere as camas no quarto?',
      exemplos: ['Maria', 'J. R. Hotel'], rodape: '', botoes: [linkFicha('Preencher a ficha')],
      usarEm: 'Automação “Véspera da chegada: lembrete da ficha” (primeiro nome, hotel). Também pergunta das camas, como a mensagem da véspera.',
    },
    {
      chave: 'boas_vindas_hospede', titulo: 'No check-in: boas-vindas', categoria: 'UTILITY',
      corpo: boasVindas,
      exemplos: ['Maria', '12/12/2026'].slice(0, (boasVindas.match(/\{\{\d\}\}/g) || []).length), rodape: '', botoes: [],
      usarEm: 'Automação “No check-in: boas-vindas” (primeiro nome, data de saída). Texto com as informações do robô deste hotel: confira antes de enviar para a Meta.',
    },
    {
      chave: 'dia_da_saida', titulo: 'Dia da saída: lembrete do check-out', categoria: 'UTILITY',
      corpo: diaSaida,
      exemplos: ['Maria', '12/12/2026'].slice(0, (diaSaida.match(/\{\{\d\}\}/g) || []).length), rodape: '', botoes: [],
      usarEm: 'Automação “Dia da saída” (primeiro nome). Texto com as informações do robô deste hotel: confira antes de enviar para a Meta.',
    },
    {
      chave: 'upgrade_vespera', titulo: 'Véspera: upgrade e late check-out', categoria: 'MARKETING',
      corpo: 'Olá, {{1}}! Sua reserva no {{2}} é amanhã. 😊\nTemos uma opção especial para você: {{3}}.\nQuer? É só tocar num botão abaixo.',
      exemplos: ['Maria', 'J. R. Hotel', 'upgrade para o Apartamento Luxo por R$ 80,00 por noite ou late check-out até as 14h por R$ 60,00'],
      rodape: RODAPE_SAIR, botoes: ['Quero o upgrade', 'Quero o late check-out', 'Não, obrigado'].map((texto) => ({ tipo: 'QUICK_REPLY', texto })),
      usarEm: 'Automação “Véspera: upgrade de quarto e late check-out” (primeiro nome, hotel, o que é oferecido). O botão escolhido avisa a recepção.',
    },
    {
      chave: 'oferta_segunda_tentativa', titulo: 'Segunda tentativa com oferta', categoria: 'MARKETING',
      corpo: 'Olá, {{1}}! As datas que você cotou no {{2}}, de {{3}} a {{4}}, ainda têm vaga.\n🎁 Reservando pelo botão abaixo, você ganha: {{5}}.\nQualquer dúvida, é só responder esta mensagem.',
      exemplos: ['Maria', 'J. R. Hotel', '10/12/2026', '12/12/2026', 'late check-out até as 14h'], rodape: RODAPE_SAIR, botoes: [link('Reservar com a oferta')],
      usarEm: 'Automação “Segunda tentativa com oferta” (primeiro nome, hotel, entrada, saída, benefício da oferta).',
    },
    {
      chave: 'retomar_conversa', titulo: 'Conversa parada sem cotação (opcional)', categoria: 'MARKETING',
      corpo: 'Oi, {{1}}! Ficou alguma dúvida sobre a hospedagem no {{2}}? Se ainda tiver interesse, me diga as datas de entrada e saída e quantas pessoas, que eu já vejo os valores para você.',
      exemplos: ['Maria', 'J. R. Hotel'], rodape: RODAPE_SAIR, botoes: [{ tipo: 'QUICK_REPLY', texto: 'Quero ver os valores' }],
      usarEm: 'Automação “Conversa parada sem cotação” (primeiro nome, hotel). Só é usado se a janela de 24 h já tiver fechado; normalmente vai a mensagem normal, sem custo.',
    },
    {
      chave: 'pesquisa_estadia', titulo: 'Depois da saída: nota da estadia (com botões)', categoria: 'UTILITY',
      corpo: 'Olá, {{1}}! Obrigado por se hospedar no {{2}}.\nDe 1 a 5, que nota você dá para a sua estadia? É só tocar num dos botões abaixo.',
      exemplos: ['Maria', 'J. R. Hotel'], rodape: '',
      botoes: ['5 - Excelente', '4 - Bom', '3 - Regular', '2 - Ruim', '1 - Péssimo'].map((texto) => ({ tipo: 'QUICK_REPLY', texto })),
      usarEm: 'Automação “Depois da saída” (primeiro nome, hotel). A resposta pelo botão vira a nota da estadia; nota 1, 2 ou 3 avisa os administradores.',
    },
    {
      chave: 'aniversario_hospede', titulo: 'Aniversário do hóspede', categoria: 'MARKETING',
      corpo: 'Feliz aniversário, {{1}}! 🎉\nToda a equipe do {{2}} deseja um dia muito especial para você.\nQuando quiser voltar a João Pessoa, vai ser um prazer receber você de novo.',
      exemplos: ['Maria', 'J. R. Hotel'], rodape: RODAPE_SAIR, botoes: [],
      usarEm: 'Automação “Aniversário do hóspede” (primeiro nome, hotel). Só parabéns, sem benefício.',
    },
    {
      chave: 'sentimos_sua_falta', titulo: 'Cliente que não volta há mais de 1 ano', categoria: 'MARKETING',
      corpo: 'Oi, {{1}}! Faz um tempinho que você não se hospeda no {{2}} e sentimos sua falta. 😊\nSe estiver planejando voltar a João Pessoa, é só responder com as datas que a gente vê os valores para você.',
      exemplos: ['Maria', 'J. R. Hotel'], rodape: RODAPE_SAIR, botoes: [{ tipo: 'QUICK_REPLY', texto: 'Quero ver os valores' }],
      usarEm: 'Automação “Cliente que não volta há mais de 1 ano” (primeiro nome, hotel).',
    },
    {
      chave: 'agradecimento_estadia', titulo: 'Depois da saída: agradecimento', categoria: 'UTILITY',
      corpo: 'Olá, {{1}}! Obrigado por se hospedar no {{2}}. Esperamos que tenha gostado.\nSe puder, conte como foi a sua estadia respondendo esta mensagem.',
      exemplos: ['Maria', 'J. R. Hotel'], rodape: '', botoes: [],
      usarEm: 'Automação “Depois da saída” (primeiro nome, hotel).',
    },
    {
      chave: 'pesquisa_satisfacao', titulo: 'Pesquisa de satisfação', categoria: 'UTILITY',
      corpo: 'Olá, como foi sua experiência com o nosso atendimento? Avalie o atendimento prestado por {{1}} através dos botões abaixo:',
      exemplos: ['Ana'], rodape: '',
      botoes: ['5 - Excelente', '4 - Bom', '3 - Regular', '2 - Ruim', '1 - Péssimo'].map((texto) => ({ tipo: 'QUICK_REPLY', texto })),
      usarEm: 'Automação “Pesquisa de satisfação” (nome de quem atendeu). Os botões já viram nota.',
    },
  ].concat(prontosTraduzidos(origem, hotelId));
}

// "FUP de vendas 2!" → "fup_de_vendas_2"
export function normalizarNomeModelo(nome) {
  return String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 512);
}

function numerosDasVariaveis(texto) {
  return [...String(texto || '').matchAll(/\{\{\s*([^}]*)\s*\}\}/g)].map((m) => m[1].trim());
}

// Devolve a lista de problemas (vazia = pode mandar para a Meta)
export function validarModeloNovo(m) {
  const erros = [];
  const nome = normalizarNomeModelo(m?.nome);
  if (!nome) erros.push('Dê um nome ao modelo (ex.: fup_reservar_agora).');
  if (!CATEGORIAS_MODELO[m?.categoria]) erros.push('Escolha a categoria (Marketing ou Utilidade).');
  if (!IDIOMAS_MODELO[m?.idioma]) erros.push('Escolha o idioma.');

  const corpo = String(m?.corpo || '');
  if (!corpo.trim()) erros.push('Escreva o texto da mensagem.');
  if (corpo.length > 1024) erros.push(`O texto tem ${corpo.length} letras; o máximo é 1.024.`);
  const vars = numerosDasVariaveis(corpo);
  if (vars.some((v) => !/^\d+$/.test(v))) erros.push('Use as variáveis só como {{1}}, {{2}}, {{3}}…');
  const numeros = [...new Set(vars.filter((v) => /^\d+$/.test(v)).map(Number))].sort((a, b) => a - b);
  if (numeros.some((n, i) => n !== i + 1)) erros.push('As variáveis precisam ser em ordem, sem pular: {{1}}, {{2}}, {{3}}…');
  if (/^\s*\{\{/.test(corpo) || /\}\}\s*$/.test(corpo)) erros.push('A Meta não aceita o texto começando ou terminando com uma variável. Coloque uma palavra antes ou depois.');
  if (/\}\}\s*\{\{/.test(corpo)) erros.push('Duas variáveis não podem ficar coladas; escreva algo entre elas.');
  const exemplos = Array.isArray(m?.exemplos) ? m.exemplos : [];
  numeros.forEach((n) => { if (!String(exemplos[n - 1] || '').trim()) erros.push(`Escreva um exemplo para a variável {{${n}}} (a Meta pede para aprovar).`); });

  const cab = String(m?.cabecalho || '');
  if (cab.length > 60) erros.push('O título pode ter no máximo 60 letras.');
  if (/\n/.test(cab)) erros.push('O título precisa ser de uma linha só.');
  const varsCab = numerosDasVariaveis(cab);
  if (varsCab.length > 1 || varsCab.some((v) => v !== '1')) erros.push('O título aceita só uma variável, {{1}}.');
  if (varsCab.length === 1 && !String(m?.exemploCabecalho || '').trim()) erros.push('Escreva um exemplo para a variável do título.');

  const rodape = String(m?.rodape || '');
  if (rodape.length > 60) erros.push('O rodapé pode ter no máximo 60 letras.');
  if (numerosDasVariaveis(rodape).length) erros.push('O rodapé não aceita variáveis.');

  const botoes = Array.isArray(m?.botoes) ? m.botoes : [];
  if (botoes.length > 10) erros.push('No máximo 10 botões.');
  const links = botoes.filter((b) => b.tipo === 'URL');
  if (links.length > 2) erros.push('No máximo 2 botões de link.');
  botoes.forEach((b, i) => {
    const t = String(b.texto || '').trim();
    if (!t) erros.push(`Escreva o texto do botão ${i + 1}.`);
    if (t.length > 25) erros.push(`O botão “${t}” tem mais de 25 letras.`);
    if (b.tipo === 'URL') {
      const url = String(b.url || '').trim();
      if (!/^https?:\/\/[^\s]+$/.test(url)) erros.push(`O link do botão “${t || i + 1}” precisa começar com https://`);
      const vu = numerosDasVariaveis(url);
      if (vu.length > 1 || (vu.length === 1 && !/\{\{\s*1\s*\}\}$/.test(url))) erros.push(`No link do botão “${t || i + 1}”, a variável só pode ser {{1}} e no final.`);
      if (vu.length === 1 && !String(b.exemplo || '').trim()) erros.push(`Escreva um exemplo para o final do link do botão “${t || i + 1}”.`);
    }
  });
  const textos = botoes.map((b) => String(b.texto || '').trim().toLowerCase()).filter(Boolean);
  if (new Set(textos).size !== textos.length) erros.push('Dois botões com o mesmo texto.');
  return erros;
}

// Formato que a Meta pede (respostas rápidas juntas, depois os links)
export function montarComponentes(m) {
  const componentes = [];
  const cab = String(m.cabecalho || '').trim();
  if (cab) {
    componentes.push({
      type: 'HEADER', format: 'TEXT', text: cab,
      ...(/\{\{\s*1\s*\}\}/.test(cab) ? { example: { header_text: [String(m.exemploCabecalho).trim()] } } : {}),
    });
  }
  const corpo = String(m.corpo || '').trim();
  const qtd = new Set(numerosDasVariaveis(corpo)).size;
  componentes.push({
    type: 'BODY', text: corpo,
    ...(qtd ? { example: { body_text: [(m.exemplos || []).slice(0, qtd).map((e) => String(e).trim())] } } : {}),
  });
  if (String(m.rodape || '').trim()) componentes.push({ type: 'FOOTER', text: String(m.rodape).trim() });
  const botoes = Array.isArray(m.botoes) ? m.botoes : [];
  const rapidos = botoes.filter((b) => b.tipo === 'QUICK_REPLY').map((b) => ({ type: 'QUICK_REPLY', text: String(b.texto).trim() }));
  const links = botoes.filter((b) => b.tipo === 'URL').map((b) => {
    const url = String(b.url).trim();
    return { type: 'URL', text: String(b.texto).trim(), url, ...(/\{\{\s*1\s*\}\}$/.test(url) ? { example: [String(b.exemplo).trim()] } : {}) };
  });
  if (rapidos.length || links.length) componentes.push({ type: 'BUTTONS', buttons: [...rapidos, ...links] });
  return componentes;
}
