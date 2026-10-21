// ============================================================================
// MODELO DO MANUAL DE PROCEDIMENTOS INTERNOS (versão 1.1 · outubro de 2026)
// ============================================================================
// Texto copiado do PDF "Manual de Procedimentos Internos versão 1.1 - data
// 20-10-2026", separado nas MESMAS 9 páginas do original. Isso importa porque o
// Termo de Ciência (página 9) e a Cláusula 47ª do contrato dizem que o manual
// tem 9 páginas — então cada página aqui vira exatamente uma folha A4.
//
// Tipos de item em cada página:
//   ['h2', 'texto']             → título de seção (ex.: "1. Integração ...")
//   ['h3', 'texto']             → subtítulo (ex.: "1.1. Quem entrega ...")
//   ['h4', 'texto']             → título em negrito menor
//   ['p',  'texto']             → parágrafo
//   ['ul', ['item', ...]]       → lista com marcadores
//   ['ol', ['item', ...]]       → lista numerada
//   ['alerta', 'TÍTULO.', 'texto'] → caixa de destaque
//
// Quando o manual mudar de versão, atualize este arquivo e as constantes abaixo.
// ============================================================================

export const MANUAL_VERSAO_PADRAO = '1.1';
export const MANUAL_DATA_VERSAO = 'Outubro de 2026';
export const MANUAL_EMPRESAS = 'JR Hotel Ltda · Guarany Hotel Ltda';
export const MANUAL_TOTAL_PAGINAS = 9;

export const MANUAL_PAGINAS = [
  // ---------------------------------------------------------------- página 1
  { capa: true },

  // ---------------------------------------------------------------- página 2
  [
    ['h2', 'Como ler este manual'],
    ['p', 'Este manual reúne as regras de comportamento e os procedimentos do dia a dia do hotel. Ler e seguir tudo o que está aqui é obrigatório para todos os colaboradores, sem exceção.'],
    ['p', 'Descumprir as regras pode gerar advertência verbal, advertência escrita, suspensão ou demissão por justa causa, observada a progressividade das medidas ou ainda a gravidade da conduta.'],
    ['p', 'Em caso de dúvida sobre qualquer item, fale com o seu superior imediato antes de agir. É melhor perguntar do que errar.'],
    ['h2', '1. Integração e aceite do manual'],
    ['h3', '1.1. Quem entrega o manual?'],
    ['p', 'O manual é entregue a todo colaborador em virtude do contrato de trabalho celebrado com o hotel.'],
    ['h3', '1.2. Como funciona a integração?'],
    ['p', 'A entrega segue estes passos:'],
    ['ol', [
      'O hotel entrega uma cópia impressa ou digital deste manual ao colaborador.',
      'Uma cópia do termo assinado fica no arquivo de RH; uma cópia digital é guardada no sistema.',
    ]],
    ['h3', '1.3. Atualizações do manual'],
    ['p', 'Sempre que o manual for atualizado, o colaborador receberá a nova versão e assinará um novo termo. A versão mais recente substitui as versões anteriores.'],
    ['h2', '2. Jornada de trabalho e registro de ponto'],
    ['h3', '2.1. Pontualidade'],
    ['ul', [
      'A tolerância máxima de atraso para entrar no trabalho é de 10 minutos.',
      'Atrasos repetidos serão tratados como falta de comprometimento e podem ensejar a aplicação de medidas disciplinares.',
    ]],
    ['h3', '2.2. Registro de ponto'],
    ['ul', [
      'Registre o ponto na hora exata em que começa e em que termina sua jornada. Além disso, os horários de início e término do intervalo intrajornada devem ser registrados corretamente.',
      'É proibido bater o ponto no lugar de outro colega.',
    ]],
    ['h3', '2.3. Situações que não integram a jornada de trabalho'],
    ['p', 'O tempo em que o colaborador escolhe ficar nas dependências do hotel para fazer atividades particulares — práticas religiosas, descanso, lazer, estudo, alimentação, higiene pessoal, atividades de relacionamento social, e troca de roupa quando não for obrigatória — não conta como tempo de trabalho e não gera hora extra. Isso está previsto na Convenção Coletiva da categoria e na CLT.'],
    ['h3', '2.4. Mensagens e ligações fora do expediente'],
    ['p', 'Nenhum empregado é obrigado a atender ligações ou a responder mensagens relacionadas ao trabalho (WhatsApp, e-mail, telefone ou qualquer outro meio) fora da sua jornada de trabalho, inclusive nas folgas, férias e afastamentos.'],
    ['p', 'As mensagens recebidas fora do horário podem ser lidas e respondidas no início da jornada seguinte, e a falta de resposta fora do horário não gera nenhuma penalidade. Qualquer trabalho fora do horário só será realizado mediante convocação expressa do superior e com registro no ponto.'],
    ['h3', '2.5. Saída do posto de trabalho'],
    ['p', 'É proibido sair do seu posto sem autorização do superior imediato. Se precisar se ausentar, peça autorização e garanta que o posto fique coberto.'],
  ],

  // ---------------------------------------------------------------- página 3
  [
    ['h3', '2.6. Troca de turno'],
    ['p', 'Toda troca de turno exige o repasse de informações para o colega que assume o próximo turno. O repasse de informações é obrigatório e deve ser realizado antes do encerramento da jornada.'],
    ['h4', 'Informações obrigatórias na passagem de turno'],
    ['ul', [
      'Hóspedes que chegaram, que saíram e que estão previstos para chegar ou sair.',
      'Quartos com situação especial (manutenção, bloqueados, em limpeza, com VIP).',
      'Reclamações e ocorrências em aberto, com nome do hóspede e quarto, com os seus devidos registros no sistema Starter.',
      'Pedidos pendentes (lavanderia, despertar).',
      'Pagamentos pendentes ou cobranças em discussão.',
      'Problemas no sistema (Cloudbeds, Ask Suite, Starter) ou em equipamentos.',
      'Avisos da gerência ou da direção que precisam circular.',
      'Caixa: valor de abertura e fechamento, com conferência feita pelos dois colaboradores.',
    ]],
    ['p', 'A passagem deve ser registrada em formato digital no sistema Starter. Quem assume é responsável a partir do momento da troca de turno.'],
    ['h2', '3. Apresentação pessoal e uniforme'],
    ['h3', '3.1. Uso do uniforme'],
    ['ul', [
      'Use o uniforme completo e limpo durante toda a jornada.',
      'O uso de calçado fechado é obrigatório, por motivo de segurança.',
      'É proibido trabalhar de sandália ou chinelo.',
    ]],
    ['h3', '3.2. Devolução e perda do fardamento'],
    ['ul', [
      'Ao sair do hotel (demissão, pedido de saída, fim de contrato), devolva o uniforme.',
      'Se o uniforme for perdido ou danificado por culpa do colaborador, o custo do novo será do empregado.',
    ]],
    ['h3', '3.3. Uniforme fora do hotel'],
    ['p', 'É proibido frequentar bares ou locais de lazer usando o uniforme do hotel. Isso protege a imagem da empresa.'],
    ['h2', '4. Conduta e relacionamento entre colegas'],
    ['h3', '4.1. Respeito'],
    ['p', 'O tratamento entre colegas e com superiores deve ser sempre cordial, sem distinção de hierarquia, raça, sexo, religião, orientação sexual ou qualquer outra característica pessoal.'],
    ['h3', '4.2. Linguagem'],
    ['p', 'Mantenha linguagem profissional. Evite gírias, palavrões e apelidos. Isso vale tanto presencialmente quanto em mensagens, redes sociais e grupos de trabalho.'],
    ['h3', '4.3. Assédio moral e sexual'],
    ['alerta', 'TOLERÂNCIA ZERO.', 'O hotel não tolera nenhum tipo de assédio moral ou sexual. Quem sofrer ou presenciar deve comunicar à gerência imediatamente. A denúncia será apurada em sigilo.'],
    ['ul', [
      'É proibido fazer fofocas, dar apelidos pejorativos, comentar sobre religião ou vida pessoal de colegas.',
      'É proibida qualquer forma de assédio sexual: cantadas, comentários sobre o corpo, toques com ou sem consentimento, mensagens de cunho sexual.',
      'Qualquer forma de discriminação pode gerar demissão por justa causa.',
    ]],
  ],

  // ---------------------------------------------------------------- página 4
  [
    ['h3', '4.4. Cooperação entre setores'],
    ['p', 'Quando um problema chega até você, é seu dever resolver, desde que compatível com as suas atribuições, ou encaminhar para quem é responsável pela resolução do caso.'],
    ['h3', '4.5. Grupos de WhatsApp do trabalho'],
    ['p', 'Os grupos de WhatsApp do trabalho são exclusivos para assuntos profissionais. É proibido enviar correntes, conteúdo religioso, político, humorístico, comercial, pessoal, dentre outros, nos grupos da empresa.'],
    ['h2', '5. Relacionamento com os hóspedes'],
    ['h3', '5.1. Postura profissional'],
    ['ul', [
      'Mantenha postura profissional. Evite intimidades.',
      'É proibido pedir empréstimos a hóspedes ou induzir gorjetas.',
      'É proibido discutir com hóspedes em qualquer hipótese. Se o hóspede estiver agressivo, chame a gerência.',
    ]],
    ['h3', '5.2. Discrição com hóspedes (incluindo VIPs e celebridades)'],
    ['p', 'Nunca confirme a presença de um hóspede para terceiros sem autorização dele. Se alguém procurar um hóspede:'],
    ['ol', [
      'Peça para a pessoa aguardar.',
      'Ligue para o quarto e pergunte se o hóspede deseja ser anunciado.',
      'Só passe a chamada se o hóspede confirmar.',
    ]],
    ['p', 'Com celebridades e VIPs, é proibido:'],
    ['ul', [
      'Pedir foto ou autógrafo.',
      'Comentar interna ou externamente que a celebridade está hospedada.',
      'Abordar o hóspede em momentos de lazer.',
      'Postar nas redes sociais qualquer coisa que possa identificar o hóspede.',
    ]],
    ['h3', '5.3. Defesa do colaborador'],
    ['p', 'Se um hóspede te tratar mal, te assediar ou for agressivo, afaste-se imediatamente e chame a gerência. O hotel não admite que o hóspede desrespeite o funcionário.'],
    ['h3', '5.4. Como tratar reclamações de hóspedes'],
    ['p', 'Toda reclamação deve ser tratada com seriedade. Use o passo a passo abaixo:'],
    ['ol', [
      'Ouça o hóspede até o fim, sem interromper.',
      'Demonstre que entendeu o problema, repetindo-o com suas palavras: "Então, o senhor está dizendo que..."',
      'Peça desculpas pelo transtorno, mesmo que a culpa não seja sua.',
      'Se o problema é simples e você pode resolver na hora, resolva.',
      'Se o problema foge da sua alçada ou envolve dinheiro (desconto, cortesia, devolução), chame imediatamente a gerência.',
      'Registre a reclamação no sistema (Cloudbeds, no campo de observações da reserva), com data, hora e o que foi feito, como também no programa Starter, na parte de comunicações internas.',
      'No final do dia, comunique a reclamação na passagem de turno.',
      'Se a reclamação envolver dano material ou ameaça de processo, comunique a gerência imediatamente, ainda que fora do horário de expediente da gerência. Essa comunicação é feita durante o seu turno de trabalho.',
    ]],
  ],

  // ---------------------------------------------------------------- página 5
  [
    ['h3', '5.5. Tempo máximo de resposta ao hóspede'],
    ['ul', [
      'Atendimento presencial na recepção: imediato. Se você estiver atendendo outra pessoa, faça contato visual e diga: "Em um instante estou com o senhor."',
      'Telefone interno (do quarto): atender até o terceiro toque.',
      'Telefone externo: atender até o quarto toque.',
      'WhatsApp do hotel durante o expediente: responder em até 5 minutos. Se a resposta exigir mais tempo (consulta, conferência), enviar primeiro uma mensagem informando: "Recebi sua mensagem, vou verificar e retorno em X minutos."',
    ]],
    ['h2', '6. Uso de equipamentos e recursos do hotel'],
    ['h3', '6.1. Celular pessoal'],
    ['p', 'O uso do celular pessoal para assuntos particulares é proibido durante o expediente, principalmente em áreas de contato com o hóspede. Em caso de emergência familiar, avise a gerência.'],
    ['h3', '6.2. Computador e celular do hotel'],
    ['p', 'Computadores e celulares do hotel são ferramentas de trabalho. É proibido usar para jogar, acessar redes sociais pessoais, pesquisar preço de produto pessoal ou qualquer atividade que não seja do seu cargo.'],
    ['h3', '6.3. Chaves e acessos'],
    ['ul', [
      'A chave mestra é de responsabilidade pessoal de quem a recebe.',
      'Nunca empreste a chave para outra pessoa.',
      'Nunca deixe a chave em local desprotegido (balcão, armário aberto, mesa).',
    ]],
    ['h2', '7. Patrimônio, consumo e áreas restritas'],
    ['h3', '7.1. Consumo de itens do hotel'],
    ['ul', [
      'Tudo o que é vendido no hotel e for consumido pelo colaborador deve ser pago.',
      'É proibido consumir itens do frigobar dos quartos, amenidades destinadas aos hóspedes ou sobras de eventos sem autorização da gerência.',
    ]],
    ['h3', '7.2. Áreas de lazer'],
    ['p', 'Os funcionários não podem usar piscina, academia, sala de jogos ou outras áreas destinadas exclusivamente aos hóspedes.'],
    ['h3', '7.3. Acesso às áreas internas'],
    ['ul', [
      'Só colaboradores autorizados podem circular nas áreas internas e operacionais.',
      'É proibida a permanência de familiares e amigos do colaborador nas áreas internas do hotel, em qualquer horário.',
    ]],
    ['h3', '7.4. Comunicação de danos'],
    ['p', 'Qualquer dano ou avaria nas dependências do hotel — inclusive os causados por hóspedes — deve ser comunicado imediatamente à gerência e registrado conforme o procedimento.'],
    ['h3', '7.5. Revistas'],
    ['p', 'O hotel pode fazer revistas visuais e impessoais em bolsas e armários, sempre com o colaborador presente. A revista nunca envolve toque no corpo do colaborador nem em pertences íntimos.'],
  ],

  // ---------------------------------------------------------------- página 6
  [
    ['h2', '8. Operação da recepção'],
    ['h3', '8.1. Check-in'],
    ['p', 'No check-in, é obrigatório:'],
    ['ol', [
      'Conferir o documento de identificação com foto do hóspede.',
      'Preencher a ficha completa no Cloudbeds, sem deixar campos vazios e sem erros de digitação.',
      'Imprimir a ficha de hospedagem para assinatura do hóspede.',
      'Arquivar a ficha assinada conforme orientação.',
    ]],
    ['h3', '8.2. Encomendas e entregas externas'],
    ['p', 'Não é permitida a entrega de encomendas, alimentação ou similares direto no apartamento. O hóspede deve vir até a recepção para retirar.'],
    ['h3', '8.3. Achados e perdidos'],
    ['h4', 'O que fazer ao encontrar um item esquecido'],
    ['ol', [
      'Entregue o item imediatamente à recepção ou à governança — nunca leve para casa, nunca deixe no local em que foi visto.',
      'Registre no programa Starter os seguintes dados: data e hora em que foi encontrado, local exato (quarto, área comum, restaurante), descrição do item, nome de quem encontrou.',
      'Guarde o item no local físico padronizado, com a etiqueta de identificação.',
    ]],
    ['h4', 'Como devolver um item ao hóspede'],
    ['ol', [
      'Confirme a identidade da pessoa: peça documento e confira com o cadastro da reserva.',
      'Confira se a descrição que a pessoa dá do item bate com o que está registrado.',
      'Registre a entrega no Starter, com data, hora e quem entregou.',
      'Peça uma assinatura no documento de entrega.',
      'Se a devolução for por correio, o hóspede paga o frete e assume o risco do envio.',
    ]],
    ['h4', 'Tempo de armazenamento'],
    ['ul', [
      'Itens de baixo valor (roupas, toalhas, cosméticos, carregadores): 90 dias.',
      'Itens de valor médio (óculos, livros, eletrônicos pequenos): 180 dias.',
      'Itens de alto valor (joias, dinheiro, documentos, eletrônicos caros): 1 ano.',
      'Documentos pessoais (RG, passaporte, CNH): devolver imediatamente, com tentativa ativa de contato pelo telefone do cadastro. Se não houver retorno em 30 dias, comunicar a gerência para definir destinação.',
      'Após o prazo: itens não reclamados podem ser doados (preferencialmente para instituições parceiras) ou descartados, sempre com registro escrito da destinação no Starter.',
    ]],
    ['h2', '9. Procedimentos operacionais gerais'],
    ['h3', '9.1. Barulho e perturbação'],
    ['p', 'Hóspede tem direito ao descanso. Quando uma reclamação de barulho chega à recepção, siga este passo a passo:'],
    ['ol', [
      'Ligue para o quarto que está gerando o barulho. Identifique-se com cordialidade: "Aqui é o(a) [nome] da recepção. Recebemos uma reclamação sobre barulho. O senhor pode, por gentileza, diminuir o som?"',
      'Registre no Cloudbeds: hora da ligação, motivo, quarto que reclamou, quarto que recebeu o aviso.',
      'Se o barulho continuar após 15 minutos, suba ao apartamento. Vá em dupla, nunca sozinho. Bata na porta, identifique-se e repita o pedido com firmeza.',
      'Se houver qualquer sinal de violência, agressão ou atividade ilegal, ligue 190 (Polícia Militar) imediatamente, antes de qualquer outra ação.',
      'Após 22h, qualquer barulho audível fora do quarto é considerado perturbação. Antes desse horário, avalie se está realmente atrapalhando outros hóspedes.',
    ]],
  ],

  // ---------------------------------------------------------------- página 7
  [
    ['h3', '9.2. Erros operacionais comuns (e como evitar)'],
    ['ul', [
      '**Esquecer de lançar consumo:** lance no Cloudbeds na hora da venda. Nunca deixe para depois — a chance de esquecer é real.',
      '**Liberar quarto sem revisar:** todo quarto deve passar pela revisão da governança antes de receber novo hóspede. Sem revisão, não libera.',
      '**Não registrar ocorrência:** qualquer ocorrência relevante (reclamação, dano, conflito) entra no sistema e na passagem de turno. Se não está registrado, não aconteceu — e quando der problema, ninguém saberá explicar.',
      '**Passar informação errada ao hóspede:** em caso de dúvida, consulte o superior antes de responder. Errar com confiança gera retrabalho e perde a confiança do hóspede.',
    ]],
    ['h2', '10. Saúde, segurança e EPIs'],
    ['h3', '10.1. Equipamentos de proteção individual (EPI)'],
    ['ul', [
      'É obrigatório usar luvas, botas, toucas e demais EPIs fornecidos para sua função, principalmente no manuseio de produtos e na higienização.',
      'É proibido trabalhar de sandália, chinelo ou sem o EPI adequado para a tarefa.',
    ]],
    ['alerta', 'FALTA GRAVE.', 'Recusar o uso de EPI sem motivo é falta grave. Pode resultar em advertência, suspensão e até demissão por justa causa.'],
    ['h3', '10.2. Ambiente livre de tabaco'],
    ['p', 'É proibido fumar dentro do hotel.'],
    ['h3', '10.3. Álcool e drogas'],
    ['p', 'É proibido trabalhar sob efeito de álcool ou drogas ilícitas. Quem for flagrado nessa situação pode ser demitido por justa causa, sem aviso prévio.'],
    ['h2', '11. Atestados médicos e INSS'],
    ['h3', '11.1. Entrega do atestado'],
    ['p', 'Entregue o atestado médico ou odontológico original na data do retorno ao trabalho. Não vale foto, cópia simples ou entrega depois (Cláusula 27ª da CCT).'],
    ['h3', '11.2. Avaliação pelo médico da empresa'],
    ['p', 'A empresa pode pedir que o atestado seja avaliado pelo médico da empresa antes de aceitá-lo.'],
    ['h3', '11.3. Afastamento pelo INSS'],
    ['p', 'Se o afastamento passar do prazo legal:'],
    ['ol', [
      'Marque a perícia no INSS dentro do prazo.',
      'Após a alta do INSS, apresente-se à empresa no primeiro dia útil seguinte para fazer o exame de retorno.',
    ]],
    ['alerta', 'ABANDONO DE EMPREGO.', 'Faltar mais de 30 dias sem justificativa após a alta do INSS é considerado abandono de emprego. A empresa pode rescindir o contrato por justa causa (Art. 482 CLT).'],
  ],

  // ---------------------------------------------------------------- página 8
  [
    ['h2', '12. Confidencialidade e LGPD'],
    ['p', 'Os dados dos hóspedes são protegidos por lei. O colaborador deve seguir estas regras:'],
    ['ul', [
      'Dados dos hóspedes, número de quarto e informações financeiras são confidenciais.',
      'É proibido fotografar telas de sistema ou documentos de terceiros.',
      'É proibido compartilhar qualquer dado de hóspede com pessoas não autorizadas, incluindo familiares e amigos do próprio colaborador.',
      'É proibido comentar fora do trabalho quem está hospedado, em qual quarto e por quanto tempo.',
      'A violação dessas regras pode gerar punição interna e responsabilização pessoal por danos, conforme a Lei Geral de Proteção de Dados (LGPD).',
    ]],
    ['h2', '13. Comportamento fora do expediente'],
    ['p', 'Fora do trabalho, o colaborador é livre. Mas o que ele faz pode afetar a imagem do hotel quando for associado à empresa. Por isso:'],
    ['ul', [
      'Não use o nome do hotel para conseguir descontos, vantagens ou benefícios pessoais fora do trabalho.',
      'Cuidado com publicações em redes sociais que envolvam o hotel ou que possam prejudicar sua imagem.',
      'Não mantenha relacionamento pessoal com hóspedes enquanto eles estão hospedados.',
    ]],
    ['h2', '14. Conflito de interesses e atividades comerciais'],
    ['h3', '14.1. Indicação de serviços externos'],
    ['p', 'É proibido indicar serviços externos a hóspedes (transporte, restaurante, passeio etc.) recebendo benefício pessoal — comissão, gorjeta ou qualquer contrapartida do prestador. Use apenas os parceiros oficiais do hotel.'],
    ['h3', '14.2. Comércio dentro do hotel'],
    ['ul', [
      'É proibido vender produtos pessoais (roupa, perfume, cosmético, joia etc.) dentro do hotel.',
      'É proibido vender rifa, sorteio, bolão ou jogo de azar nas dependências.',
      'É proibido fazer propaganda política ou religiosa enquanto estiver de uniforme.',
    ]],
  ],

  // ---------------------------------------------------------------- página 9
  { termo: true },
];
