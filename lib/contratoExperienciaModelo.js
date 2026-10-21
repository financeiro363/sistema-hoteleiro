// ============================================================================
// MODELO DO CONTRATO DE EXPERIÊNCIA (texto oficial do hotel)
// ============================================================================
// Texto copiado do arquivo "CONTRATO INDIVIDUAL DE TRABALHO A TÍTULO DE
// EXPERIÊNCIA" (PDF enviado pelo Eduardo em 20/10/2026), separado em blocos
// para a impressão ficar organizada.
//
// Cada {{CAMPO}} é trocado pelo que foi digitado na tela Contratos de Trabalho.
// Campo vazio sai como uma linha em branco, para preencher à mão.
//
// Tipos de bloco:
//   titulo_doc   → título do contrato
//   texto        → parágrafo comum
//   titulo       → TÍTULO I, II, ... (faixa)
//   clausula     → h = "Cláusula Xª – Nome." (negrito) + x = texto
//   par          → h = "§ 1º" ou "Parágrafo único." (negrito) + x = texto
//   item         → h = "1." + x = texto (lista da cláusula 40)
//   atribuicoes  → descrição das atribuições digitada na tela
//   email_contracheque → e-mail para contracheque
//   rubrica39    → linha de rubrica da cláusula 39
//   assinaturas  → local/data + linhas de assinatura (tipo prorrogacao/final)
//
// Para mudar o texto do contrato no futuro, a correção é só neste arquivo.
// ============================================================================

export const CONTRATO_EXPERIENCIA_BLOCOS = [
 {
  "t": "titulo_doc",
  "x": "CONTRATO INDIVIDUAL DE TRABALHO A TÍTULO DE EXPERIÊNCIA"
 },
 {
  "t": "texto",
  "x": "EMPREGADOR(A): {{EMPREGADOR_RAZAO_SOCIAL}} ({{EMPREGADOR_NOME_FANTASIA}}), pessoa jurídica de direito privado, inscrita no CNPJ sob nº {{EMPREGADOR_CNPJ}}, estabelecida na {{EMPREGADOR_LOGRADOURO}}, nº {{EMPREGADOR_NUMERO}}, Bairro {{EMPREGADOR_BAIRRO}}, CEP {{EMPREGADOR_CEP}}, {{EMPREGADOR_CIDADE}}/{{EMPREGADOR_UF}}, neste ato representada por seu representante legal {{EMPREGADOR_REPRESENTANTE_LEGAL}}, doravante denominada EMPREGADOR(A), HOTEL ou, quando se tratar das cláusulas de confidencialidade, REVELADOR(A)."
 },
 {
  "t": "texto",
  "x": "EMPREGADO(A): {{EMPREGADO_NOME}}, {{EMPREGADO_NACIONALIDADE}}, {{EMPREGADO_ESTADO_CIVIL}}, portador(a) da Carteira de Trabalho Digital nº {{EMPREGADO_CTPS_NUMERO}} série {{EMPREGADO_CTPS_SERIE}}, inscrito(a) no CPF sob nº {{EMPREGADO_CPF}}, RG nº {{EMPREGADO_RG}}, PIS/NIS nº {{EMPREGADO_PIS}}, residente e domiciliado(a) à {{EMPREGADO_ENDERECO}}, Bairro {{EMPREGADO_BAIRRO}}, CEP {{EMPREGADO_CEP}}, cidade de {{EMPREGADO_CIDADE}}/{{EMPREGADO_UF}}, e-mail {{EMPREGADO_EMAIL}}, telefone {{EMPREGADO_TELEFONE}}, doravante denominado(a) EMPREGADO(A) ou, quando se tratar das cláusulas de confidencialidade, RECEPTOR(A)."
 },
 {
  "t": "texto",
  "x": "Pelo presente instrumento, as partes acima qualificadas ajustam e convencionam contrato individual de trabalho em caráter de experiência, nos termos do art. 443, § 2º, alínea \"c\", e do art. 445, parágrafo único, da Consolidação das Leis do Trabalho (CLT), que se regerá pelas cláusulas abaixo, pela Convenção Coletiva de Trabalho 2026/2028 registrada no Ministério do Trabalho e Emprego sob nº PB000223/2026 (vigência de 01/05/2026 a 30/04/2028) e pelas que a sucederem (\"CCT\"), e pelas demais disposições legais aplicáveis."
 },
 {
  "t": "titulo",
  "x": "TÍTULO I — Função, atribuições e regulamento interno"
 },
 {
  "t": "clausula",
  "x": "Fica o(a) EMPREGADO(A) admitido(a) ao quadro de funcionários do EMPREGADOR(A), na função de {{FUNCAO}}, CBO nº {{CBO}}, lotado(a) no setor {{SETOR}}, com remuneração de R$ {{SALARIO_VALOR}} ({{SALARIO_EXTENSO}}) por mês, nunca inferior ao piso salarial da categoria fixado na CCT (R$ 1.665,00 a partir de 01/05/2026), encarregando-se de todas as atividades que lhe forem atribuídas por intermédio de ordens verbais ou escritas, ou independentemente destas, segundo a necessidade do EMPREGADOR(A), respeitada sua condição pessoal e capacidade laboral, nos termos do art. 456, parágrafo único, da CLT.",
  "h": "Cláusula 1ª – Admissão, função e salário."
 },
 {
  "t": "par",
  "x": "Descrição da função. São atribuições do(a) EMPREGADO(A) na função de {{FUNCAO}}:",
  "h": "§ 1º"
 },
 {
  "t": "atribuicoes"
 },
 {
  "t": "par",
  "x": "O(A) EMPREGADO(A) declara ter ciência de que suas atribuições englobam não apenas as atividades principais da função, mas também o desempenho de quaisquer tarefas correlatas, acessórias ou complementares que sejam compatíveis com sua condição pessoal e horário de trabalho, conforme a dinâmica e a necessidade da {{EMPREGADOR_RAZAO_SOCIAL}}. O salário mensal ajustado remunera a totalidade dessas atividades.",
  "h": "§ 2º"
 },
 {
  "t": "par",
  "x": "O EMPREGADOR(A) poderá estabelecer, revisar e alterar, a qualquer tempo, plano de cargos, salários e funções compatível com a condição pessoal do(a) EMPREGADO(A), inclusive com critérios de promoção apenas por merecimento (CCT, cláusula 4ª).",
  "h": "§ 3º"
 },
 {
  "t": "par",
  "x": "O exercício de tarefas correlatas ou compatíveis com a condição pessoal do(a) EMPREGADO(A), dentro da mesma jornada, não configura acúmulo nem desvio de função e não gera direito a acréscimo salarial (art. 456, parágrafo único, da CLT), ressalvada a hipótese de substituição prevista no § 3º da Cláusula 3ª.",
  "h": "§ 4º"
 },
 {
  "t": "clausula",
  "x": "Obriga-se o(a) EMPREGADO(A), além de executar com dedicação e lealdade as suas atividades, a cumprir o Regulamento Interno do EMPREGADOR(A), as instruções de sua administração e as ordens de seus chefes e superiores hierárquicos relativas às peculiaridades dos serviços que lhe forem confiados.",
  "h": "Cláusula 2ª – Deveres gerais e regulamento interno."
 },
 {
  "t": "par",
  "x": "No ato da assinatura deste contrato, o(a) EMPREGADO(A) recebe o Regulamento Interno do EMPREGADOR(A), cujas cláusulas integram o presente instrumento, e a violação de qualquer delas implicará medidas disciplinares proporcionais e gradativas, passíveis de culminar na rescisão do contrato por justa causa, observado o Título XI.",
  "h": "§ 1º"
 },
 {
  "t": "par",
  "x": "O Regulamento Interno do HOTEL é o seu Manual de Procedimentos Internos (Cláusula 47ª), que integra este contrato.",
  "h": "§ 2º"
 },
 {
  "t": "clausula",
  "x": "A circunstância de ser a função especificada não importa a intransferibilidade do(a) EMPREGADO(A) para outro serviço no qual demonstre melhor capacidade de adaptação, desde que compatível com sua condição pessoal e sem redução salarial.",
  "h": "Cláusula 3ª – Mudança de serviço."
 },
 {
  "t": "par",
  "x": "O(A) EMPREGADO(A) poderá ser designado(a) para exercer, em experiência, por até 90 (noventa) dias, cargo hierarquicamente superior, podendo ser revertido(a) ao cargo de origem sem que isso implique promoção (CCT, cláusula 15ª, § 2º).",
  "h": "§ 1º"
 },
 {
  "t": "par",
  "x": "Não se considera alteração unilateral a reversão ao cargo efetivo anteriormente ocupado, deixando o exercício de função de confiança, hipótese em que a gratificação correspondente não será mantida nem incorporada, independentemente do tempo de exercício (art. 468, §§ 1º e 2º, da CLT; CCT, cláusula 15ª).",
  "h": "§ 2º"
 },
 {
  "t": "par",
  "x": "Ao(À) EMPREGADO(A) designado(a) para substituir, por período não inferior a 30 (trinta) dias ininterruptos, a integralidade das funções de outro empregado de salário superior, sem divisão de responsabilidades, será assegurado igual salário ao do substituído durante a substituição, excluídas as vantagens pessoais (CCT, cláusula 5ª).",
  "h": "§ 3º"
 },
 {
  "t": "clausula",
  "x": "O(A) EMPREGADO(A) acatará ordem emanada pelo EMPREGADOR(A) para prestação de serviços em qualquer outro estabelecimento ou localidade, além daquele da celebração do contrato, em caráter transitório ou definitivo, nos termos do art. 469 da CLT.",
  "h": "Cláusula 4ª – Local de trabalho e transferência."
 },
 {
  "t": "par",
  "x": "Não se considera transferência a que não acarretar necessariamente a mudança de domicílio do(a) EMPREGADO(A), hipótese em que não haverá modificação salarial.",
  "h": "§ 1º"
 },
 {
  "t": "par",
  "x": "Havendo mudança de domicílio, a transferência observará a real necessidade do serviço (art. 469, § 1º, da CLT), o pagamento do adicional de 25% (vinte e cinco por cento) enquanto durar a transferência provisória (art. 469, § 3º) e o custeio das despesas de mudança pelo EMPREGADOR(A) (art. 470 da CLT).",
  "h": "§ 2º"
 },
 {
  "t": "titulo",
  "x": "TÍTULO II — Prazo de experiência, prorrogação e rescisão"
 },
 {
  "t": "clausula",
  "x": "O presente contrato terá vigência de {{EXPERIENCIA_DIAS}} ({{EXPERIENCIA_DIAS_EXTENSO}}) dias, com início em {{EXPERIENCIA_INICIO}} e término em {{EXPERIENCIA_TERMINO}}, sendo celebrado para que as partes verifiquem, reciprocamente, a conveniência ou não de prorrogação ou de se vincularem em caráter definitivo a um contrato de trabalho por tempo indeterminado, na forma da lei.",
  "h": "Cláusula 5ª – Prazo."
 },
 {
  "t": "par",
  "x": "O contrato poderá ser prorrogado uma única vez, por mútuo acordo, desde que a soma dos dois períodos não ultrapasse 90 (noventa) dias (arts. 445, parágrafo único, e 451 da CLT), mediante o Termo de Prorrogação do § 3º desta cláusula.",
  "h": "§ 1º"
 },
 {
  "t": "par",
  "x": "As partes ajustam, desde já, que, não havendo manifestação em contrário de qualquer delas até o término do primeiro período e continuando o(a) EMPREGADO(A) a prestar serviços, o contrato ficará automaticamente prorrogado por mais {{PRORROGACAO_DIAS}} dias, até {{PRORROGACAO_TERMINO}}, respeitado o limite total de 90 (noventa) dias.",
  "h": "§ 2º"
 },
 {
  "t": "par",
  "x": "Termo de Prorrogação. Por mútuo acordo entre as partes, prorroga-se até {{PRORROGACAO_TERMINO}} o presente Contrato de Experiência, que detinha vigência determinada até {{EXPERIENCIA_TERMINO}}, respeitado o limite total de 90 (noventa) dias (arts. 445, parágrafo único, e 451 da CLT), permanecendo inalteradas as demais cláusulas.",
  "h": "§ 3º"
 },
 {
  "t": "assinaturas",
  "tipo": "prorrogacao",
  "x": "{{EMPREGADOR_CIDADE}}/{{EMPREGADOR_UF}}, {{PRORROGACAO_DATA_ASSINATURA}}."
 },
 {
  "t": "clausula",
  "x": "Findo o período experimental, considerada eventual prorrogação, e continuada a prestação de serviços do(a) EMPREGADO(A) ao EMPREGADOR(A), o contrato passará a vigorar por tempo indeterminado, ficando ratificadas todas as cláusulas aqui estabelecidas.",
  "h": "Cláusula 6ª – Conversão em prazo indeterminado."
 },
 {
  "t": "clausula",
  "x": "Opera-se a rescisão do presente contrato pelo decurso do prazo acima ou por vontade das partes, nos termos da lei.",
  "h": "Cláusula 7ª – Extinção."
 },
 {
  "t": "par",
  "x": "Na rescisão antecipada sem justa causa por iniciativa do EMPREGADOR(A), este pagará ao(à) EMPREGADO(A), a título de indenização, metade da remuneração a que teria direito até o termo do contrato (art. 479 da CLT).",
  "h": "§ 1º"
 },
 {
  "t": "par",
  "x": "Na rescisão antecipada sem justa causa por iniciativa do(a) EMPREGADO(A), este(a) ficará obrigado(a) a indenizar o EMPREGADOR(A) pelos prejuízos que desse fato lhe resultarem, limitada a indenização ao valor a que teria direito o(a) EMPREGADO(A) em idênticas condições, autorizada a compensação com as verbas rescisórias (art. 480, §§ 1º e 2º, da CLT), respeitado o limite do art. 477, § 5º, da CLT.",
  "h": "§ 2º"
 },
 {
  "t": "par",
  "x": "Ficam ressalvadas as garantias provisórias de emprego previstas em lei e na jurisprudência consolidada, inclusive as decorrentes de gestação e de acidente do trabalho.",
  "h": "§ 3º"
 },
 {
  "t": "par",
  "x": "Os benefícios previstos na CCT, de natureza econômica ou social, não se estendem ao período de projeção do aviso prévio indenizado (CCT, cláusula 38ª).",
  "h": "§ 4º"
 },
 {
  "t": "titulo",
  "x": "TÍTULO III — Jornada, intervalos, banco de horas e controle de ponto"
 },
 {
  "t": "clausula",
  "x": "O horário de trabalho do(a) EMPREGADO(A) será anotado em ficha ou registro de ponto, permanecendo sempre íntegra sua obrigação de cumprir o horário que lhe for determinado, observado o limite legal. A jornada contratada é de 7h20 diárias em seis dias por semana (CCT, cláusula 19ª), respeitado o limite constitucional semanal vigente.",
  "h": "Cláusula 8ª – Horário de trabalho."
 },
 {
  "t": "par",
  "x": "A duração normal do trabalho poderá ser acrescida de horas suplementares, nos termos da lei, conforme determinação do EMPREGADOR(A), em número não excedente de 2 (duas) por dia (art. 59 da CLT).",
  "h": "§ 1º"
 },
 {
  "t": "par",
  "x": "Aceita o(a) EMPREGADO(A), expressamente, a condição de prestar serviços em qualquer dos turnos de trabalho, inclusive noturno, desde que sem simultaneidade, asseguradas as garantias legais, como o adicional noturno e a hora noturna reduzida (art. 73 da CLT).",
  "h": "§ 2º"
 },
 {
  "t": "par",
  "x": "Sobrevindo emenda constitucional ou lei que altere o limite máximo da jornada semanal ou o número de repousos semanais, a jornada aqui contratada será ajustada automaticamente, na forma e no prazo de transição fixados pela nova norma, sem necessidade de novo termo aditivo.",
  "h": "§ 3º"
 },
 {
  "t": "clausula",
  "x": "Por mútuo acordo, fica estabelecido que o excesso de horas em um dia poderá ser compensado pela correspondente diminuição em outro dia, de modo que a compensação ocorra no período máximo de 6 (seis) meses e não seja ultrapassado o limite de 10 (dez) horas diárias (art. 59, §§ 2º e 5º, da CLT). Também é lícita a compensação no mesmo mês (art. 59, § 6º, da CLT).",
  "h": "Cláusula 9ª – Compensação e banco de horas."
 },
 {
  "t": "par",
  "x": "Independentemente de acordo individual, as horas trabalhadas em excesso à jornada contratada, ou a diminuição das horas trabalhadas quando autorizada pelo EMPREGADOR(A), poderão ser computadas no Banco de Horas semestral previsto na CCT (cláusula 20ª).",
  "h": "§ 1º"
 },
 {
  "t": "par",
  "x": "Na rescisão do contrato sem compensação integral, o(a) EMPREGADO(A) receberá as horas extras não compensadas, calculadas sobre a remuneração da data da rescisão. As horas extras em feriados não compensadas no prazo serão pagas com adicional de 100% (cem por cento). O pagamento de horas extras não descaracteriza o banco de horas.",
  "h": "§ 2º"
 },
 {
  "t": "par",
  "x": "O não atendimento das exigências legais para a compensação não implica a repetição do pagamento das horas excedentes à jornada diária se não ultrapassada a duração máxima semanal, sendo devido apenas o respectivo adicional (art. 59-B da CLT; CCT, cláusula 21ª).",
  "h": "§ 3º"
 },
 {
  "t": "clausula",
  "x": "Para jornadas superiores a 6 (seis) horas, será concedido intervalo intrajornada de no mínimo 1 (uma) hora. Por este acordo individual escrito, autorizado pelo art. 71, caput, da CLT e pela cláusula 23ª da CCT, o(a) EMPREGADO(A) concorda expressamente que o intervalo poderá ser superior a 2 (duas) horas, até o limite de 4 (quatro) horas diárias, inclusive em regime de turno partido, conforme escala definida pelo EMPREGADOR(A).",
  "h": "Cláusula 10ª – Intervalo para repouso e alimentação de até 4 (quatro) horas."
 },
 {
  "t": "par",
  "x": "Para jornadas superiores a 4 (quatro) e de até 6 (seis) horas, o intervalo será de 15 (quinze) minutos (art. 71, § 1º, da CLT).",
  "h": "§ 1º"
 },
 {
  "t": "par",
  "x": "Será sempre respeitado o intervalo mínimo de 11 (onze) horas consecutivas entre duas jornadas (art. 66 da CLT).",
  "h": "§ 2º"
 },
 {
  "t": "par",
  "x": "A não concessão ou a concessão parcial do intervalo mínimo implica o pagamento, de natureza indenizatória, apenas do período suprimido, com acréscimo de 50% (cinquenta por cento) sobre a hora normal (art. 71, § 4º, da CLT).",
  "h": "§ 3º"
 },
 {
  "t": "par",
  "x": "Durante o intervalo o(a) EMPREGADO(A) está livre para dele dispor, inclusive para sair do estabelecimento.",
  "h": "§ 4º"
 },
 {
  "t": "clausula",
  "x": "Não é considerado tempo à disposição do EMPREGADOR(A), nem será computado como período extraordinário, o tempo em que o(a) EMPREGADO(A), por escolha própria, buscar proteção pessoal em caso de insegurança nas vias públicas ou más condições climáticas (como chuva), bem como adentrar ou permanecer nas dependências do HOTEL para exercer atividades particulares, entre outras: práticas religiosas, descanso, lazer, estudo, alimentação, atividades de relacionamento social, higiene pessoal e troca de roupa ou uniforme, quando não houver obrigatoriedade de realizar a troca na empresa (art. 4º, § 2º, da CLT; CCT, cláusula 19ª, I).",
  "h": "Cláusula 11ª – Tempo que não é hora extra (tempo à disposição)."
 },
 {
  "t": "par",
  "x": "O tempo despendido da residência até a efetiva ocupação do posto de trabalho e no retorno, por qualquer meio, inclusive transporte fornecido pelo EMPREGADOR(A), não será computado na jornada (art. 58, § 2º, da CLT; CCT, cláusula 19ª, II).",
  "h": "§ 1º"
 },
 {
  "t": "par",
  "x": "Nenhum empregado é obrigado a atender ligações ou a responder mensagens relacionadas ao trabalho (WhatsApp, e-mail, telefone ou qualquer outro meio) fora da sua jornada de trabalho, inclusive nas folgas, férias e afastamentos (Manual de Procedimentos Internos, item 2.4). As mensagens recebidas fora do horário poderão ser lidas e respondidas no início da jornada seguinte, e a falta de resposta fora do horário não gera nenhuma penalidade. O uso de aplicativos de mensagens fora do horário de trabalho, para comunicação interna ou com hóspedes, visa apenas à coordenação de rotinas ou ao repasse de informações que não exigem resposta imediata. O fato de portar aparelho celular ou receber mensagens fora da jornada não caracteriza regime de prontidão, sobreaviso ou tempo à disposição (Súmula 428, I, do TST). Qualquer trabalho fora do horário só será realizado mediante convocação expressa do superior e com registro no ponto.",
  "h": "§ 2º"
 },
 {
  "t": "clausula",
  "x": "Fica autorizado o trabalho aos domingos e feriados (CCT, cláusula 39ª). O EMPREGADOR(A) poderá adotar o sistema da “quinta folga” mensal para compensação antecipada dos feriados, concedendo, além de uma folga semanal, um domingo por mês não trabalhado; não concedida a folga, o feriado trabalhado será pago em dobro ou compensado no próprio mês. Não adotada a “quinta folga”, o repouso semanal coincidirá com o domingo pelo menos uma vez por mês (CCT, cláusula 24ª).",
  "h": "Cláusula 12ª – Domingos, feriados e repouso."
 },
 {
  "t": "par",
  "x": "O(A) EMPREGADO(A) inscrito(a) no ENEM poderá usufruir o repouso semanal no(s) dia(s) de prova, desde que comunique o EMPREGADOR(A) com antecedência mínima de 30 (trinta) dias, com o comprovante de inscrição (CCT, cláusula 40ª).",
  "h": "Parágrafo único."
 },
 {
  "t": "clausula",
  "x": "O EMPREGADOR(A) poderá adotar, por setor, registro de ponto manual, mecânico, eletrônico ou sistema alternativo de controle de jornada (art. 74 da CLT; Portaria MTP nº 671/2021; CCT, cláusula 36ª). O(A) EMPREGADO(A) obriga-se a registrar pessoalmente, todos os dias, os horários reais de entrada, saída e intervalos.",
  "h": "Cláusula 13ª – Controle de ponto."
 },
 {
  "t": "par",
  "x": "Na folha de ponto não são permitidas rasuras, o uso de corretivo de qualquer espécie, apagar ou sobrepor os horários anotados, nem o preenchimento com caneta de cor preta, devendo ser usada a cor indicada pelo setor de pessoal. Esta atitude é passível de punição.",
  "h": "§ 1º"
 },
 {
  "t": "par",
  "x": "Havendo qualquer erro na folha de ponto, o(a) EMPREGADO(A) deverá comunicar imediatamente o setor competente, devendo ter a maior atenção ao anotar os horários para evitar erros.",
  "h": "§ 2º"
 },
 {
  "t": "par",
  "x": "É proibido anotar horários invariáveis (“britânicos”) que não correspondam à realidade, bem como registrar o ponto de outro empregado ou permitir que outro registre o seu. A fraude no registro de ponto constitui ato de improbidade (art. 482, “a”, da CLT).",
  "h": "§ 3º"
 },
 {
  "t": "par",
  "x": "A realização de horas extras depende de autorização prévia do superior imediato. A prorrogação sem autorização constitui falta disciplinar, sem prejuízo da remuneração das horas efetivamente trabalhadas e registradas.",
  "h": "§ 4º"
 },
 {
  "t": "par",
  "x": "O(A) EMPREGADO(A) deverá conferir e assinar mensalmente o espelho ou a folha de ponto, apontando por escrito eventuais divergências no ato da conferência.",
  "h": "§ 5º"
 },
 {
  "t": "par",
  "x": "Pontualidade. A tolerância máxima de atraso para entrar no trabalho é de 10 (dez) minutos. Atrasos repetidos serão tratados como falta de comprometimento e podem ensejar medidas disciplinares. Para fins de pagamento ou desconto, não serão consideradas as variações de horário no registro de ponto de até 5 (cinco) minutos por marcação, observado o limite de 10 (dez) minutos diários; ultrapassado esse limite, será considerada a totalidade do tempo (art. 58, § 1º, da CLT).",
  "h": "§ 6º"
 },
 {
  "t": "par",
  "x": "As faltas e os atrasos injustificados serão descontados do salário e acarretam a perda da remuneração do repouso semanal da respectiva semana (art. 6º da Lei nº 605/1949), além dos reflexos legais nas férias (art. 130 da CLT).",
  "h": "§ 7º"
 },
 {
  "t": "titulo",
  "x": "TÍTULO IV — Remuneração, benefícios, gorjetas e descontos"
 },
 {
  "t": "clausula",
  "x": "O salário será pago até o 5º (quinto) dia útil do mês subsequente ao vencido (art. 459, § 1º, da CLT).",
  "h": "Cláusula 14ª – Pagamento e contracheque por e-mail."
 },
 {
  "t": "par",
  "x": "Autorização para envio de contracheque por e-mail. O(A) EMPREGADO(A) autoriza expressamente o envio do seu contracheque para o endereço de e-mail indicado abaixo, fornecido à empresa para este fim, e declara que o informou corretamente, que está ciente de que o envio por este meio é uma opção segura e eficiente para o recebimento das suas informações salariais e que se compromete a acusar o recebimento desses e-mails.",
  "h": "§ 1º"
 },
 {
  "t": "par",
  "x": "É facultado ao(à) EMPREGADO(A) solicitar o recebimento do contracheque impresso no momento em que julgar necessário, sem prejuízo do recebimento eletrônico. Qualquer alteração do e-mail deverá ser comunicada por escrito ao setor de pessoal.",
  "h": "§ 2º"
 },
 {
  "t": "texto",
  "x": "E-mail do(a) EMPREGADO(A) para recebimento do contracheque:"
 },
 {
  "t": "email_contracheque"
 },
 {
  "t": "clausula",
  "x": "O(A) EMPREGADO(A) autoriza o EMPREGADOR(A) a realizar, em seu salário, os descontos legais e convencionais e, ainda, quando oferecida a devida contraprestação, a efetuar descontos em folha referentes a: seguro de vida individual ou em grupo; transporte (vale-transporte, até 6% do salário-base, Lei nº 7.418/1985); plano médico/odontológico; alimentação; planos de previdência privada; empréstimos consignados nos termos da Lei nº 10.820/2003; dentre outros que poderão ser objeto de autorização específica (Súmula 342 do TST).",
  "h": "Cláusula 15ª – Descontos autorizados."
 },
 {
  "t": "par",
  "x": "Danos. Além dos descontos compulsórios, reserva-se o EMPREGADOR(A) o direito de descontar do(a) EMPREGADO(A) as importâncias correspondentes aos danos por ele(a) causados, por dolo, imprudência, negligência ou imperícia, nos termos do art. 462, § 1º, da CLT, sendo os descontos efetuados em folha de pagamento ou nas verbas rescisórias, com o que o(a) EMPREGADO(A) expressamente concorda. Na rescisão, a compensação não poderá exceder o equivalente a um mês de remuneração (art. 477, § 5º, da CLT), podendo o saldo ser cobrado pelas vias próprias.",
  "h": "§ 1º"
 },
 {
  "t": "par",
  "x": "Estão incluídos no parágrafo anterior, entre outros: o extravio ou dano culposo de uniforme, EPI, equipamentos, chaves e cartões; diferenças de caixa; e prejuízos a hóspedes que o HOTEL seja obrigado a indenizar por ato do(a) EMPREGADO(A), ressalvado o desgaste natural pelo uso.",
  "h": "§ 2º"
 },
 {
  "t": "par",
  "x": "Quebra de caixa. Ao(À) EMPREGADO(A) que exerça função de caixa, tesoureiro ou assemelhado, se o EMPREGADOR(A) adotar a política de descontar as faltas de caixa, será paga gratificação mensal de 10% (dez por cento) do salário-base, que não integra a remuneração (CCT, cláusula 8ª).",
  "h": "§ 3º"
 },
 {
  "t": "par",
  "x": "Poderão ainda ser descontados: os adiantamentos salariais (art. 462, caput, da CLT); os valores pagos a maior por erro, mediante comunicação prévia ao(à) EMPREGADO(A); e os produtos vendidos pelo HOTEL e consumidos pelo(a) EMPREGADO(A) (Cláusula 31ª, § 1º).",
  "h": "§ 4º"
 },
 {
  "t": "clausula",
  "x": "O EMPREGADOR(A) fornecerá auxílio-alimentação ou refeição no valor mínimo de R$ 17,00 (dezessete reais) por dia efetivamente trabalhado, por cartão eletrônico ou ticket, ou, alternativamente, refeição completa no próprio estabelecimento, hipótese em que fica desobrigado do vale. Não é permitido substituir a refeição por lanches. O benefício, em qualquer modalidade, tem natureza indenizatória e não integra a remuneração para nenhum efeito (art. 457, § 2º, da CLT; CCT, cláusulas 7ª e 10ª).",
  "h": "Cláusula 16ª – Vale-alimentação ou refeição no local."
 },
 {
  "t": "clausula",
  "x": "O EMPREGADOR(A) custeará integralmente, inclusive durante o contrato de experiência, benefício odontológico com mensalidade per capita de R$ 18,00 (dezoito reais), contratado junto a operadora credenciada pelo Sindicato Laboral, sem natureza salarial (CCT, cláusula 33ª). O(A) EMPREGADO(A) declara ciência do benefício.",
  "h": "Cláusula 17ª – Benefício odontológico obrigatório."
 },
 {
  "t": "par",
  "x": "O(A) EMPREGADO(A) poderá incluir dependentes, assumindo integralmente a mensalidade de R$ 18,00 (dezoito reais) por dependente, descontada em folha mediante autorização prévia e por escrito (Anexo II).",
  "h": "Parágrafo único."
 },
 {
  "t": "clausula",
  "x": "Serão observados, quando cabíveis: (a) auxílio-funeral de 1 (um) piso salarial, pago ao cônjuge ou herdeiros, se o HOTEL não mantiver seguro de vida em grupo (CCT, cláusula 12ª); (b) auxílio-creche de R$ 140,00 por filho de até 6 anos, se o HOTEL tiver mais de 30 empregadas com mais de 16 anos (CCT, cláusula 13ª); (c) vale-combustível em substituição ao vale-transporte, mediante opção do(a) EMPREGADO(A), de natureza indenizatória (CCT, cláusula 11ª). Todos os benefícios têm natureza não salarial e não se incorporam ao contrato (CCT, cláusula 7ª).",
  "h": "Cláusula 18ª – Outros benefícios convencionais."
 },
 {
  "t": "clausula",
  "x": "O(A) EMPREGADO(A) declara ciência de que:",
  "h": "Cláusula 19ª – Contribuições sindicais."
 },
 {
  "t": "par",
  "x": "Taxa negocial. O EMPREGADOR(A) descontará mensalmente, inclusive sobre o 13º salário, 1,5% (um e meio por cento) do salário a título de contribuição de taxa negocial, devida ao SINDHOTEL/PB (CNPJ 24.098.634/0001-97), conforme cláusula 29ª da CCT e o entendimento do Supremo Tribunal Federal (Tema 935).",
  "h": "§ 1º"
 },
 {
  "t": "par",
  "x": "Direito de oposição. Fica assegurado ao(à) EMPREGADO(A) o direito de se opor ao desconto, mediante comunicação expressa e presencial ao Sindicato, na Rua Olavo Bilac, s/n, 1º andar, Tambiá, João Pessoa/PB, CEP 58020-570, no prazo de até 10 (dez) dias úteis contados da publicação da homologação da CCT (CCT, cláusula 29ª, § 6º). Exercida a oposição, o(a) EMPREGADO(A) entregará cópia do protocolo ao setor de pessoal para que o desconto seja suspenso.",
  "h": "§ 2º"
 },
 {
  "t": "par",
  "x": "Mensalidade sindical. Somente se o(a) EMPREGADO(A) for associado(a) ao Sindicato será descontada a mensalidade de 2% (dois por cento) do salário-base (art. 545 da CLT; CCT, cláusula 28ª). A contribuição sindical anual dos arts. 578 e 579 da CLT depende de autorização prévia e expressa.",
  "h": "§ 3º"
 },
 {
  "t": "clausula",
  "x": "O HOTEL adota a política estrita de NÃO cobrar taxa de serviço (10%) na nota e NÃO AUTORIZA, em nenhuma hipótese, o recebimento de gorjeta espontânea (caixinha) por parte de sua equipe.",
  "h": "Cláusula 20ª – Ausência de Gorjetas e Taxa de Serviço."
 },
 {
  "t": "par",
  "x": "É terminantemente proibido ao(à) EMPREGADO(A) solicitar, insinuar, aceitar ou receber qualquer quantia em dinheiro, PIX ou bens de hóspedes a título de gorjeta ou gratificação pessoal.",
  "h": "§ 1º"
 },
 {
  "t": "par",
  "x": "O descumprimento desta proibição será considerado insubordinação e quebra de fidúcia, sujeitando o(a) EMPREGADO(A) à demissão por justa causa (art. 482, 'h' e 'a', da CLT), não gerando a verba recebida indevidamente qualquer reflexo salarial, trabalhista ou previdenciário (CCT, cláusula 9ª, II, parágrafo único).",
  "h": "§ 2º"
 },
 {
  "t": "titulo",
  "x": "TÍTULO V — Uniforme, apresentação pessoal, segurança e saúde, álcool, drogas e tabaco"
 },
 {
  "t": "clausula",
  "x": "O(A) EMPREGADO(A) compromete-se a utilizar o fardamento fornecido gratuitamente pelo EMPREGADOR(A), em quantidade suficiente para a troca diária, anuindo com a utilização de logomarcas ou símbolos do HOTEL e de seus parceiros, sem que isso configure propaganda, uso inapropriado do seu direito de imagem ou gere qualquer desconforto (art. 20 do Código Civil; art. 456-A da CLT; CCT, cláusula 26ª).",
  "h": "Cláusula 21ª – Uniforme."
 },
 {
  "t": "par",
  "x": "A higienização do uniforme é de responsabilidade do(a) EMPREGADO(A), salvo quando exigir procedimentos ou produtos diferentes dos usados para roupas de uso comum (art. 456-A, parágrafo único, da CLT).",
  "h": "§ 1º"
 },
 {
  "t": "par",
  "x": "O(A) EMPREGADO(A) fica obrigado(a) a devolver ao EMPREGADOR(A), ao término do contrato ou quando solicitado, o uniforme completo, crachá e outras peças de vestimenta, inclusive luvas, calçados especiais e óculos de segurança, de acordo com a especificidade de cada atividade. Em caso de extravio por culpa do(a) EMPREGADO(A), salvo desgaste natural, ele(a) arcará com o custo do novo fardamento (CCT, cláusula 26ª, §§ 2º e 3º).",
  "h": "§ 2º"
 },
 {
  "t": "par",
  "x": "O uniforme deve ser usado completo e limpo durante toda a jornada. O uso de calçado fechado é obrigatório, por motivo de segurança, sendo proibido trabalhar de sandália ou chinelo. O uso do uniforme fora do HOTEL observa a Cláusula 57ª.",
  "h": "§ 3º"
 },
 {
  "t": "par",
  "x": "O HOTEL não exige que a troca de uniforme seja feita no estabelecimento: o(a) EMPREGADO(A) é livre para vir uniformizado(a) de casa ou para trocar-se no local. Optando por trocar-se no HOTEL, o tempo de troca, por escolha própria, não integra a jornada nem gera hora extra (art. 4º, § 2º, VIII, da CLT; CCT, cláusula 19ª). Se o HOTEL vier a exigir a troca no local para determinada função, o ponto será registrado antes da troca, na entrada, e depois da troca, na saída.",
  "h": "§ 4º"
 },
 {
  "t": "clausula",
  "x": "O(A) EMPREGADO(A) deve se apresentar ao trabalho de forma impecável: uniforme completo, limpo e em bom estado; crachá visível; higiene corporal e bucal adequadas; cabelos limpos e arrumados; unhas limpas e aparadas; uso discreto de adornos, maquiagem e perfume.",
  "h": "Cláusula 22ª – Apresentação pessoal e asseio."
 },
 {
  "t": "par",
  "x": "Nos setores de alimentos e bebidas, cozinha e café da manhã, serão observadas as normas sanitárias (RDC ANVISA nº 216/2004): cabelos presos e protegidos por touca, barba feita ou protegida, unhas curtas e sem esmalte, sem adornos.",
  "h": "§ 1º"
 },
 {
  "t": "par",
  "x": "As regras de apresentação são aplicadas igualmente a todos, sem qualquer discriminação por raça, cor, textura de cabelo, sexo, identidade de gênero, religião ou idade, sendo permitidos símbolos religiosos compatíveis com a segurança e a higiene da função.",
  "h": "§ 2º"
 },
 {
  "t": "par",
  "x": "O descumprimento reiterado das regras de apresentação pessoal sujeita o(a) EMPREGADO(A) às medidas disciplinares do Título XI.",
  "h": "§ 3º"
 },
 {
  "t": "clausula",
  "x": "O(A) EMPREGADO(A) fica ciente das normas de segurança que regulam suas atividades e se compromete a usar os EPIs fornecidos, sob pena de ser punido(a) por falta grave, nos termos da legislação vigente e das normas de Segurança e Medicina do Trabalho. Constitui ato faltoso a recusa injustificada ao uso dos EPIs e à observância das instruções de segurança (art. 158, parágrafo único, da CLT).",
  "h": "Cláusula 23ª – Equipamentos de proteção individual (EPI)."
 },
 {
  "t": "par",
  "x": "Cabe ao(à) EMPREGADO(A), quanto ao EPI (NR-06, item 6.6.1): (a) usá-lo apenas para a finalidade a que se destina; (b) responsabilizar-se pela limpeza, guarda e conservação; (c) comunicar ao HOTEL o extravio, dano ou qualquer alteração que o torne impróprio para uso; (d) cumprir as determinações do HOTEL sobre o uso adequado; (e) reembolsar o HOTEL em caso de dano ou extravio decorrente de dolo ou culpa (art. 462, § 1º, da CLT); e (f) devolvê-lo ao término do contrato ou quando o HOTEL assim julgar conveniente. A entrega será registrada na Ficha de Controle do Anexo I.",
  "h": "§ 1º"
 },
 {
  "t": "par",
  "x": "É obrigatório usar luvas, botas, toucas e demais EPIs fornecidos para a função, principalmente no manuseio de produtos e na higienização, sendo proibido trabalhar de sandália, chinelo ou sem o EPI adequado para a tarefa. Recusar o uso de EPI sem motivo é falta grave, que pode resultar em advertência, suspensão e até dispensa por justa causa.",
  "h": "§ 2º"
 },
 {
  "t": "clausula",
  "x": "O(A) EMPREGADO(A) obriga-se a comparecer aos exames médicos ocupacionais (admissional, periódico, de retorno ao trabalho, de mudança de risco e demissional – NR-07), a participar dos treinamentos de segurança, inclusive sobre riscos psicossociais e prevenção ao assédio (NR-01), e a comunicar imediatamente qualquer acidente ou condição insegura ao superior.",
  "h": "Cláusula 24ª – Saúde e segurança."
 },
 {
  "t": "par",
  "x": "O HOTEL fornecerá ordens de serviço com as precauções a tomar para evitar acidentes e doenças ocupacionais e as informações sobre os riscos da função, e o(a) EMPREGADO(A) obriga-se a cumpri-las (arts. 157, II, e 158, I, da CLT; NR-01).",
  "h": "§ 1º"
 },
 {
  "t": "par",
  "x": "Quando designado(a), o(a) EMPREGADO(A) deverá integrar a brigada de incêndio e participar dos treinamentos e simulados de abandono do estabelecimento.",
  "h": "§ 2º"
 },
 {
  "t": "clausula",
  "x": "É terminantemente proibido ao(à)",
  "h": "Cláusula 25ª – Álcool, drogas e tabaco."
 },
 {
  "t": "texto",
  "x": "EMPREGADO(A): (a) apresentar-se ou permanecer em serviço sob efeito de bebida alcoólica ou de substância psicoativa ilícita; (b) consumir, portar, guardar, oferecer ou comercializar tais substâncias nas dependências do HOTEL, inclusive bebidas destinadas a hóspedes."
 },
 {
  "t": "par",
  "x": "A embriaguez em serviço constitui falta grave passível de dispensa por justa causa, inclusive em ocorrência única, quando comprovada (art. 482, “f”, da CLT). O porte ou comércio de drogas ilícitas configura também mau procedimento (art. 482, “b”) e será comunicado à autoridade policial.",
  "h": "§ 1º"
 },
 {
  "t": "par",
  "x": "O(A) EMPREGADO(A) concorda em se submeter a teste de etilômetro (bafômetro) ou exame toxicológico: (i) havendo indícios objetivos de que esteja sob efeito de álcool ou drogas; (ii) após acidente ou incidente de trabalho; e (iii) em programa aleatório e impessoal, para funções que envolvam a condução de veículos (inclusive manobra de veículos de hóspedes), operação de máquinas ou risco à segurança de terceiros. Os testes serão realizados de forma reservada, por profissional habilitado, e o resultado será tratado como dado pessoal sensível e sigiloso.",
  "h": "§ 2º"
 },
 {
  "t": "par",
  "x": "Constatado o estado de embriaguez ou intoxicação, ou havendo recusa injustificada ao teste diante de indícios objetivos, o(a) EMPREGADO(A) será imediatamente afastado(a) do posto de trabalho para preservar sua segurança e a de terceiros, podendo o período ser considerado falta injustificada, sem prejuízo das medidas disciplinares cabíveis.",
  "h": "§ 3º"
 },
 {
  "t": "par",
  "x": "Havendo indícios de dependência química, que é reconhecida como doença, o HOTEL poderá encaminhar o(a) EMPREGADO(A) para avaliação médica e tratamento, inclusive junto ao INSS.",
  "h": "§ 4º"
 },
 {
  "t": "par",
  "x": "Ambiente livre de tabaco. É proibido fumar dentro do HOTEL, inclusive cigarros eletrônicos (vapes), narguilés ou qualquer outro produto fumígeno, derivado ou não do tabaco (art. 2º da Lei nº 9.294/1996).",
  "h": "§ 5º"
 },
 {
  "t": "titulo",
  "x": "TÍTULO VI — Normas de conduta"
 },
 {
  "t": "clausula",
  "x": "Por medida de segurança, é terminantemente vedada a utilização de aparelho celular particular (voz e dados) durante a jornada de trabalho, salvo em hipóteses de extrema necessidade, que devem ser informadas imediatamente ao supervisor imediato. Tal mandamento visa ao silêncio para maior conforto dos clientes, à harmonia do ambiente e à desenvoltura das atividades prestadas pelos colaboradores.",
  "h": "Cláusula 26ª – Uso de celular."
 },
 {
  "t": "par",
  "x": "O uso é livre nos intervalos, nas áreas destinadas aos empregados, devendo o aparelho permanecer guardado no armário ou local indicado durante o trabalho. A proibição não se aplica ao aparelho corporativo nem ao uso expressamente autorizado pela chefia para a função.",
  "h": "§ 1º"
 },
 {
  "t": "par",
  "x": "O descumprimento será razão de advertências e suspensões e, em caso de reincidência, considerar-se-á justo motivo para rescisão do contrato de trabalho, em conformidade com o art. 482 da CLT.",
  "h": "§ 2º"
 },
 {
  "t": "par",
  "x": "A proibição vale principalmente nas áreas de contato com o hóspede. Em caso de emergência familiar, o(a) EMPREGADO(A) deve avisar a gerência.",
  "h": "§ 3º"
 },
 {
  "t": "clausula",
  "x": "É proibido ao(à) EMPREGADO(A), sem autorização prévia e escrita da administração: (a) filmar, fotografar, gravar áudio ou transmitir ao vivo os bastidores do HOTEL (cozinha, governança, rouparia, lavanderia, recepção interna, escritórios, sistemas, documentos, quartos e áreas restritas), hóspedes, visitantes ou colegas, inclusive para TikTok, Instagram, Facebook, Kwai, YouTube, WhatsApp ou qualquer rede; (b) publicar conteúdo em que apareça uniformizado(a) ou que identifique o HOTEL de forma depreciativa; (c) publicar ou compartilhar comentários difamatórios, injuriosos, caluniosos ou ofensivos sobre o HOTEL, seus sócios, gestores, colegas, hóspedes ou fornecedores; (d) divulgar qualquer informação confidencial ou dado de hóspede; (e) falar em nome do HOTEL com imprensa ou em redes sociais.",
  "h": "Cláusula 27ª – Redes sociais e reputação."
 },
 {
  "t": "par",
  "x": "Esta cláusula não restringe a liberdade de expressão lícita, nem o direito de apresentar reclamações ao Sindicato, ao Ministério do Trabalho, ao Ministério Público, à Justiça ou ao canal de denúncias do HOTEL.",
  "h": "§ 1º"
 },
 {
  "t": "par",
  "x": "A violação poderá caracterizar justa causa (art. 482, “b”, “g”, “j” e “k”, da CLT), obrigará a remoção imediata do conteúdo e sujeitará o(a) EMPREGADO(A) à reparação civil (arts. 186, 187 e 927 do Código Civil) e às sanções penais por crimes contra a honra (arts. 138 a 140 do Código Penal).",
  "h": "§ 2º"
 },
 {
  "t": "clausula",
  "x": "O HOTEL adota tolerância zero com assédio moral, assédio sexual, importunação sexual, violência e discriminação de qualquer natureza, praticados por ou contra empregados, hóspedes, prestadores de serviço ou visitantes (Lei nº 14.457/2022; NR-01).",
  "h": "Cláusula 28ª – Prevenção ao assédio e à discriminação."
 },
 {
  "t": "par",
  "x": "São proibidos, entre outros: humilhações, ofensas, apelidos pejorativos, isolamento, ameaças e cobranças abusivas e repetidas (assédio moral); constranger alguém com o intuito de obter vantagem ou favorecimento sexual, valendo-se de superioridade hierárquica (art. 216-A do Código Penal); praticar ato libidinoso sem consentimento (art. 215-A do Código Penal); comentários, gestos, toques ou mensagens de cunho sexual indesejados; e qualquer distinção, exclusão ou ofensa por raça, cor, etnia, sexo, orientação sexual, identidade de gênero, religião, origem, idade, deficiência, estado civil, gravidez ou condição social (Lei nº 9.029/1995; Lei nº 7.716/1989; Lei nº 14.532/2023).",
  "h": "§ 1º"
 },
 {
  "t": "par",
  "x": "Quem sofrer ou presenciar tais condutas deve relatá-las ao superior, à gerência ou ao canal de denúncias do HOTEL ({{CANAL_DENUNCIAS}}), sendo garantidos sigilo, possibilidade de anonimato e proteção contra retaliação. Toda denúncia será apurada.",
  "h": "§ 2º"
 },
 {
  "t": "par",
  "x": "O(A) EMPREGADO(A) deve participar dos treinamentos periódicos sobre o tema. A prática comprovada das condutas acima constitui falta grave (art. 482, “b” e “j”, da CLT), sem prejuízo da responsabilidade civil e penal; a denúncia sabidamente falsa, feita de má-fé, também constitui falta disciplinar.",
  "h": "§ 3º"
 },
 {
  "t": "par",
  "x": "Em especial, é proibido fazer fofocas, dar apelidos pejorativos e comentar sobre religião ou vida pessoal de colegas, bem como qualquer forma de assédio sexual, como cantadas, comentários sobre o corpo, toques com ou sem consentimento e mensagens de cunho sexual. Qualquer forma de discriminação pode gerar dispensa por justa causa. A denúncia será apurada em sigilo.",
  "h": "§ 4º"
 },
 {
  "t": "clausula",
  "x": "É proibido hospedar criança ou adolescente desacompanhado dos pais ou responsável sem autorização expressa destes ou da autoridade judiciária (art. 82 do ECA). O(A) EMPREGADO(A) deve seguir o procedimento do HOTEL de conferência de documentos e comunicar imediatamente à gerência qualquer suspeita de exploração sexual ou maus-tratos de criança ou adolescente (art. 244-A do ECA), cabendo também a denúncia ao Disque 100. A omissão ou a facilitação constitui falta gravíssima, sem prejuízo da responsabilidade penal.",
  "h": "Cláusula 29ª – Proteção de crianças e adolescentes."
 },
 {
  "t": "clausula",
  "x": "É vedado ao(à) EMPREGADO(A) valer-se de sua condição no HOTEL para obter benefícios ou vantagens de distribuidores, concessionários, clientes ou fornecedores. Em especial, é proibido:",
  "h": "Cláusula 30ª – Compliance e antissuborno."
 },
 {
  "t": "par",
  "x": "Solicitar, receber ou aceitar, direta ou indiretamente, dinheiro, comissões, descontos pessoais, presentes, viagens, hospedagens ou qualquer vantagem indevida de fornecedores, prestadores de serviço, candidatos a fornecedor ou concorrentes. Brindes institucionais de valor simbólico (até R$ 50,00) somente podem ser aceitos com comunicação à gerência.",
  "h": "§ 1º"
 },
 {
  "t": "par",
  "x": "Oferecer, prometer ou pagar qualquer vantagem a agente público (fiscais da vigilância sanitária, prefeitura, bombeiros, polícia e outros), em nome ou no interesse do HOTEL (art. 333 do Código Penal; Lei nº 12.846/2013).",
  "h": "§ 2º"
 },
 {
  "t": "par",
  "x": "Indicar a hóspedes táxis, passeios, restaurantes ou outros serviços de terceiros em troca de comissão, ou exercer negociação habitual por conta própria ou alheia, sem autorização do HOTEL (art. 482, “c”, da CLT).",
  "h": "§ 3º"
 },
 {
  "t": "par",
  "x": "Qualquer oferta indevida recebida e qualquer situação de conflito de interesses (por exemplo, parente proprietário de fornecedor) devem ser comunicadas por escrito à gerência. A violação constitui ato de improbidade (art. 482, “a”, da CLT), obriga à restituição do valor recebido e pode configurar crime (art. 195, IX e X, da Lei nº 9.279/1996).",
  "h": "§ 4º"
 },
 {
  "t": "clausula",
  "x": "Objetos esquecidos ou perdidos por hóspedes devem ser entregues imediatamente ao setor responsável, com registro. A apropriação de coisa achada é crime (art. 169, parágrafo único, II, do Código Penal) e ato de improbidade (art. 482, “a”, da CLT). É ainda proibido, sem autorização: consumir alimentos, bebidas, itens de frigobar, amenities ou insumos do HOTEL; retirar qualquer bem do estabelecimento; entrar em unidades habitacionais sem motivo funcional; utilizar quartos, piscina ou outras instalações destinadas a hóspedes; receber visitas no local de trabalho; e reter chaves ou cartões-mestre fora do controle do setor.",
  "h": "Cláusula 31ª – Patrimônio, achados e perdidos."
 },
 {
  "t": "par",
  "x": "Tudo o que é vendido no HOTEL e for consumido pelo(a) EMPREGADO(A) deve ser pago. É proibido consumir itens do frigobar dos quartos, amenidades destinadas aos hóspedes ou sobras de eventos sem autorização da gerência.",
  "h": "§ 1º"
 },
 {
  "t": "par",
  "x": "Os empregados não podem usar piscina, academia, sala de jogos ou outras áreas destinadas exclusivamente aos hóspedes. Só colaboradores autorizados podem circular nas áreas internas e operacionais, sendo proibida a permanência de familiares e amigos do(a) EMPREGADO(A) nessas áreas, em qualquer horário.",
  "h": "§ 2º"
 },
 {
  "t": "par",
  "x": "Qualquer dano ou avaria nas dependências do HOTEL, inclusive os causados por hóspedes, deve ser comunicado imediatamente à gerência e registrado conforme o procedimento.",
  "h": "§ 3º"
 },
 {
  "t": "par",
  "x": "A chave mestra é de responsabilidade pessoal de quem a recebe e nunca deve ser emprestada a outra pessoa nem deixada em local desprotegido (balcão, armário aberto, mesa).",
  "h": "§ 4º"
 },
 {
  "t": "par",
  "x": "Os procedimentos de achados e perdidos estão detalhados na Cláusula 54ª.",
  "h": "§ 5º"
 },
 {
  "t": "clausula",
  "x": "Para prevenção de furtos de insumos do HOTEL e de pertences de hóspedes, o(a) EMPREGADO(A) autoriza a revista visual de bolsas, mochilas, sacolas e demais pertences, na entrada e na saída do estabelecimento ou em outros momentos, na forma da cláusula 17ª da CCT e da jurisprudência do TST, observadas as seguintes regras:",
  "h": "Cláusula 32ª – Revista visual de pertences."
 },
 {
  "t": "par",
  "x": "A revista será apenas visual, sem nenhum contato físico, realizada de forma impessoal e geral (ou por sorteio), sem discriminação de origem, raça, sexo, cor, idade ou hierarquia, preferencialmente por pessoa do mesmo sexo, podendo utilizar detector de metais e câmera, e podendo os bens do(a) EMPREGADO(A) ser identificados e etiquetados.",
  "h": "§ 1º"
 },
 {
  "t": "par",
  "x": "É proibida a revista íntima, assim entendida a apalpação do corpo ou a exposição de trajes ou partes íntimas (art. 373-A, VI, da CLT; Lei nº 13.271/2016). A revista não será feita perante hóspedes ou terceiros estranhos ao quadro do HOTEL, e os armários individuais somente serão abertos na presença do(a) EMPREGADO(A).",
  "h": "§ 2º"
 },
 {
  "t": "par",
  "x": "A recusa injustificada à revista será registrada e poderá caracterizar ato de indisciplina (art. 482, “h”, da CLT).",
  "h": "§ 3º"
 },
 {
  "t": "par",
  "x": "A revista nunca envolverá toque no corpo do(a) EMPREGADO(A) nem em pertences íntimos, e a revista de bolsas e armários será feita sempre com o(a) EMPREGADO(A) presente.",
  "h": "§ 4º"
 },
 {
  "t": "titulo",
  "x": "TÍTULO VII — Privacidade do hóspede, confidencialidade e propriedade intelectual"
 },
 {
  "t": "clausula",
  "x": "É absolutamente proibido ao(à) EMPREGADO(A) revelar, confirmar ou negar a qualquer pessoa – inclusive familiares, cônjuges, acompanhantes, colegas de outros setores, imprensa ou visitantes – se determinada pessoa está ou esteve hospedada no HOTEL, o número do seu quarto, datas de entrada e saída, acompanhantes, consumo, hábitos, documentos ou dados de pagamento.",
  "h": "Cláusula 33ª – Privacidade do hóspede."
 },
 {
  "t": "par",
  "x": "O(A) EMPREGADO(A) deve: nunca anunciar o número do quarto em voz alta; transferir ligações e anunciar visitantes somente com o consentimento do hóspede; entregar chave ou cartão apenas após conferência de identidade; e encaminhar à gerência qualquer pedido de informação feito por autoridades.",
  "h": "§ 1º"
 },
 {
  "t": "par",
  "x": "A violação fere a intimidade do hóspede (art. 5º, X, da Constituição; art. 21 do Código Civil; LGPD), caracteriza falta grave (art. 482, “b” e “g”, da CLT) e pode configurar crime (art. 154 do Código Penal). Se o HOTEL for condenado a indenizar o hóspede, poderá exercer direito de regresso contra o(a) EMPREGADO(A) culpado(a) (art. 934 do Código Civil), observado o art. 462, § 1º, da CLT.",
  "h": "§ 2º"
 },
 {
  "t": "par",
  "x": "Nunca se confirma a presença de um hóspede a terceiros sem autorização dele. Se alguém procurar um hóspede, o(a) EMPREGADO(A) deve: (I) pedir para a pessoa aguardar; (II) ligar para o quarto e perguntar se o hóspede deseja ser anunciado; (III) só passar a chamada ou anunciar a visita se o hóspede confirmar.",
  "h": "§ 3º"
 },
 {
  "t": "par",
  "x": "Com hóspedes VIP e celebridades, é proibido: pedir foto ou autógrafo; comentar, interna ou externamente, que a celebridade está hospedada; abordar o hóspede em momentos de lazer; e postar nas redes sociais qualquer coisa que possa identificar o hóspede.",
  "h": "§ 4º"
 },
 {
  "t": "clausula",
  "x": "As partes celebram o presente pacto de confidencialidade como condição para a transmissão de informações confidenciais, nos seguintes termos:",
  "h": "Cláusula 34ª – Confidencialidade."
 },
 {
  "t": "par",
  "x": "Definições. Tem-se por REVELADOR(A) a parte que compartilha informações internas confidenciais (o HOTEL) e por RECEPTOR(A) aquela que as recebe (o EMPREGADO). O REVELADOR é titular de informações técnicas, financeiras, operacionais e comerciais de caráter sigiloso, segredos, dados pessoais e outras informações exclusivas relacionadas a seus clientes, fornecedores, atividades, tecnologias e negócios, sendo o caráter confidencial dessas informações de valor substancial e inestimável. A expressão “confidenciais” significa quaisquer informações, textos, correspondências e dados, comerciais, industriais ou de projetos técnicos, relativos aos negócios existentes ou em desenvolvimento, revelados oral ou visualmente, independentemente do meio em que forem transmitidos.",
  "h": "§ 1º"
 },
 {
  "t": "par",
  "x": "Abrangência. São consideradas sigilosas TODAS as informações a que o(a) EMPREGADO(A) tiver acesso por força do contrato de trabalho, incluindo, mas não se limitando, às informações administrativas do HOTEL e aos dados pessoais de outros colaboradores, clientes, hóspedes e fornecedores. Não são sigilosas as informações que, comprovadamente, sejam de domínio público no momento da revelação ou após ela, exceto se isso ocorrer por ato ou omissão do(a) EMPREGADO(A).",
  "h": "§ 2º"
 },
 {
  "t": "par",
  "x": "Obrigações. O(A) EMPREGADO(A) compromete-se a manter sigilo e a não utilizar, divulgar, revelar, reproduzir ou dar conhecimento a terceiros das informações confidenciais; a não efetuar gravações ou cópias da documentação a que tiver acesso, salvo autorização expressa em documento assinado pelo representante legal do HOTEL; e a não repassar as informações, respondendo por todas as pessoas, físicas ou jurídicas, que a elas tiverem acesso por seu intermédio ou auxílio.",
  "h": "§ 3º"
 },
 {
  "t": "par",
  "x": "Revelação autorizada. As informações confidenciais somente poderão ser disponibilizadas a terceiros com autorização prévia e escrita do HOTEL ou por determinação judicial, hipótese em que o(a) EMPREGADO(A) deverá informar o HOTEL de imediato, por escrito.",
  "h": "§ 4º"
 },
 {
  "t": "par",
  "x": "Segredos do negócio. O(A) EMPREGADO(A) obriga-se a não divulgar ou explorar, sem autorização expressa, segredo de fábrica (qualquer meio, método, forma ou processo de organização ou produção) ou segredo de negócio (know-how relacionado à comercialização) que lhe tenha sido confiado ou de que tenha tido conhecimento em razão de sua atividade, assumindo o compromisso de manter segredo absoluto e de não transmitir, direta ou indiretamente, a quem quer que seja, quaisquer informações ou conhecimentos técnicos, administrativos ou comerciais relativos às atividades do HOTEL, inclusive os ligados à organização interna, clientela, serviços, pesquisas, aperfeiçoamentos, invenções, contabilidade, salários, vendas, sistemas de trabalho e tudo o mais que constitua elemento de caráter confidencial, sob pena de responder integralmente pelas perdas e danos correspondentes a cada violação, sem prejuízo das sanções civis, penais e trabalhistas cabíveis (art. 482, “c” e “g”, da CLT; art. 154 do Código Penal; art. 195 da Lei nº 9.279/1996).",
  "h": "§ 5º"
 },
 {
  "t": "par",
  "x": "Documentos. Todos os memorandos, anotações, impressos, desenhos, plantas, projetos, cópias e demais documentos contendo informações dos negócios do HOTEL, incluindo listas e dados cadastrais de clientes, entregues ao(à) EMPREGADO(A) ou por ele(a) preparados em razão do emprego, são de propriedade exclusiva do HOTEL e devem ser devolvidos sempre que solicitado ou na extinção do contrato.",
  "h": "§ 6º"
 },
 {
  "t": "par",
  "x": "Prazo. A obrigação de confidencialidade vigora durante todo o contrato e por mais 5 (cinco) anos após o seu término, podendo o(a) EMPREGADO(A) ser responsabilizado(a) por descumprimento ocorrido nesse período. Quanto aos dados pessoais de hóspedes e colaboradores e aos segredos de negócio, o sigilo perdura enquanto a informação mantiver sua proteção legal.",
  "h": "§ 7º"
 },
 {
  "t": "clausula",
  "x": "Serão de propriedade exclusiva do HOTEL quaisquer bens de propriedade intelectual, aperfeiçoamentos ou obras técnicas ou literárias relacionadas à natureza de sua atividade realizadas pelo(a) EMPREGADO(A), quando decorrentes de sua contribuição pessoal e também de recursos, dados, meios, materiais, instalações ou equipamentos do HOTEL. Os direitos autorais e de invenção, bem como os aperfeiçoamentos resultantes de atividades exercidas total ou parcialmente pelo(a) EMPREGADO(A) na vigência do contrato, pertencerão exclusivamente ao HOTEL, constituindo esta cláusula a disposição contratual expressa a que se referem os arts. 88 e 91 da Lei nº 9.279/1996, e ficando os direitos patrimoniais de autor cedidos ao HOTEL de forma total e definitiva (art. 49 da Lei nº 9.610/1998; art. 4º da Lei nº 9.609/1998), sendo a remuneração limitada ao salário ajustado.",
  "h": "Cláusula 35ª – Propriedade intelectual."
 },
 {
  "t": "titulo",
  "x": "TÍTULO VIII — Proteção de dados (LGPD), monitoramento, imagem e voz, equipamentos e internet"
 },
 {
  "t": "clausula",
  "x": "As partes realizarão atividades de tratamento de informações relacionadas a pessoas naturais identificadas ou identificáveis (“Dados Pessoais”) e declaram que, no desempenho de suas obrigações contratuais, cumprirão toda a legislação aplicável, incluindo, mas não se limitando à Lei nº 13.709/2018 (“LGPD”).",
  "h": "Cláusula 36ª – Dados pessoais tratados pelo(a) EMPREGADO(A)."
 },
 {
  "t": "par",
  "x": "Entende-se por “dados pessoais” toda e qualquer informação sobre ou vinculada a uma pessoa física, como nome, CPF, RG, endereço, sexo, e-mail, telefone etc.; e por “tratamento de dados pessoais” toda operação realizada com eles, como coleta, produção, recepção, classificação, utilização, acesso, reprodução, transmissão, distribuição, processamento, arquivamento, armazenamento, eliminação, avaliação ou controle da informação, modificação, comunicação e transferência.",
  "h": "§ 1º"
 },
 {
  "t": "par",
  "x": "O(A) EMPREGADO(A) somente poderá tratar os dados pessoais a que tenha acesso em razão de suas atribuições, com o objetivo exclusivo de alcançar as finalidades diretamente relacionadas à execução do contrato, sendo proibido o tratamento para quaisquer outras finalidades.",
  "h": "§ 2º"
 },
 {
  "t": "par",
  "x": "É proibido qualquer tratamento de dados pessoais pelo(a) EMPREGADO(A) que extrapole as finalidades do contrato de trabalho, sendo passível de responsabilidade exclusiva do(a) EMPREGADO(A), que fica obrigado(a) a indenizar o HOTEL por todo e qualquer dano ou prejuízo eventualmente causado ao HOTEL e a terceiros em razão de tratamento não autorizado.",
  "h": "§ 3º"
 },
 {
  "t": "par",
  "x": "Se o(a) EMPREGADO(A) necessitar de dados pessoais tratados no âmbito deste contrato para cumprir obrigações legais ou regulatórias ou para exercer seus direitos em processos judiciais, administrativos ou arbitrais, deverá informar essa necessidade ao HOTEL, por escrito e de forma detalhada, com razoável antecedência.",
  "h": "§ 4º"
 },
 {
  "t": "par",
  "x": "O HOTEL poderá autorizar compartilhamentos de dados pessoais com terceiros quando necessários ao cumprimento do contrato pelo(a) EMPREGADO(A), autorizações estas que deverão ser feitas por escrito, não se admitindo presunção.",
  "h": "§ 5º"
 },
 {
  "t": "par",
  "x": "É vedado fotografar documentos de hóspedes com celular particular, enviar dados de hóspedes por aplicativos pessoais ou deixar documentos e telas com dados expostos. Qualquer incidente de segurança (perda, vazamento ou acesso indevido) deve ser comunicado imediatamente à gerência.",
  "h": "§ 6º"
 },
 {
  "t": "par",
  "x": "Dados dos hóspedes, número de quarto e informações financeiras são confidenciais. É proibido fotografar telas de sistema ou documentos de terceiros; compartilhar qualquer dado de hóspede com pessoas não autorizadas, incluindo familiares e amigos do próprio colaborador; e comentar fora do trabalho quem está hospedado, em qual quarto e por quanto tempo. A violação dessas regras pode gerar punição interna e responsabilização pessoal por danos, conforme a LGPD.",
  "h": "§ 7º"
 },
 {
  "t": "par",
  "x": "É proibido anotar, copiar ou guardar números de cartões de pagamento, códigos de segurança ou senhas de hóspedes.",
  "h": "§ 8º"
 },
 {
  "t": "clausula",
  "x": "O HOTEL tratará os dados pessoais do(a) EMPREGADO(A), inclusive dados sensíveis de saúde, para: execução do contrato; cumprimento de obrigações legais (eSocial, FGTS, INSS, Receita Federal, saúde e segurança do trabalho); concessão de benefícios (compartilhamento com operadoras de vale-alimentação, plano odontológico, vale-transporte e seguro); repasses ao sindicato previstos na CCT; segurança de pessoas e do patrimônio; e exercício regular de direitos em processos judiciais, administrativos e arbitrais (arts. 7º, II, V, VI e IX, e 11, II, “a” e “d”, da LGPD). Os dados serão guardados pelos prazos legais e prescricionais aplicáveis. O(A) EMPREGADO(A) pode exercer os direitos do art. 18 da LGPD pelo contato {{EMAIL_ENCARREGADO_LGPD}}.",
  "h": "Cláusula 37ª – Dados pessoais do(a) EMPREGADO(A)."
 },
 {
  "t": "clausula",
  "x": "O(A) EMPREGADO(A) está ciente e concorda que é facultado ao HOTEL, tendo em vista a necessidade de preservar a segurança de hóspedes, empregados e do patrimônio, a adoção de sistema de monitoramento por câmeras e outros meios eletrônicos, e autoriza, de forma gratuita, nos termos do art. 20 do Código Civil, livre de qualquer coação e sem ferir a moral ou os bons costumes, o uso de sua imagem e voz, por prazo indeterminado e quantas vezes forem necessárias, nas finalidades desta cláusula, sem que haja nada a reclamar a título de direitos conexos ou da personalidade.",
  "h": "Cláusula 38ª – Monitoramento e uso de imagem e voz em procedimentos internos e processos."
 },
 {
  "t": "par",
  "x": "As imagens e áudios serão originários do monitoramento do ambiente comum de trabalho, abrangendo toda a área e o espaço físico laboral, sinalizados por avisos, excetuados os banheiros, vestiários e qualquer local destinado ao uso pessoal dos empregados. Poderão também ser gravadas as ligações feitas por telefones e rádios corporativos.",
  "h": "§ 1º"
 },
 {
  "t": "par",
  "x": "O HOTEL poderá utilizar, armazenar e apresentar as imagens, áudios, registros de sistemas e de ponto do(a) EMPREGADO(A), independentemente de novo consentimento, para: (a) segurança de pessoas e do patrimônio; (b) apuração de faltas e instrução de procedimentos disciplinares; (c) prova em processos trabalhistas, cíveis, criminais, administrativos e arbitrais, inquéritos policiais e perícias; (d) atendimento a requisições de autoridades; e (e) treinamentos internos e materiais de segurança e procedimentos de uso interno. Essas finalidades se baseiam no legítimo interesse, no exercício regular de direitos e na proteção da vida e da incolumidade física (arts. 7º, VI, VII e IX, e 11, II, “d” e “e”, da LGPD) e permanecem válidas após o fim do contrato, pelo prazo prescricional e enquanto houver processo pendente.",
  "h": "§ 2º"
 },
 {
  "t": "clausula",
  "x": "Ao assinar este contrato, o(a) EMPREGADO(A) autoriza e consente expressamente, de forma livre, informada, inequívoca e gratuita, nos termos do art. 20 do Código Civil e dos arts. 7º, I, e 8º da LGPD, o uso de sua imagem, voz e nome pela {{EMPREGADOR_RAZAO_SOCIAL}}, em caráter promocional, comercial ou institucional, incluindo redes sociais, vídeos de treinamento e materiais de segurança, durante a vigência do contrato de trabalho e por até 5 (cinco) anos após a rescisão, em todo o território nacional e no exterior, sem que tal uso gere direito a qualquer remuneração adicional.",
  "h": "Cláusula 39ª – Uso de imagem, voz e nome para fins promocionais e institucionais (cláusula destacada – art. 8º, § 1º, da LGPD)."
 },
 {
  "t": "par",
  "x": "A autorização abrange o uso e a reprodução em todo e qualquer material, sejam fotos, documentos ou outros meios de comunicação, em campanhas promocionais e institucionais, destacando-se as modalidades: (I) outdoor; (II) busdoor; folhetos em geral (encartes, mala direta, catálogo etc.); (III) folder de apresentação; (IV) anúncios em revistas e jornais em geral; (V) home page; (VI) cartazes; (VII) back-light; (VIII) mídia eletrônica (painéis, vídeos, televisão, cinema, programas de rádio, entre outros); (IX) mídia virtual (internet, site, Facebook, e-mail, celular, WhatsApp, Instagram e similares), no formato de foto, vídeo ou áudio; e divulgação em geral.",
  "h": "§ 1º"
 },
 {
  "t": "par",
  "x": "O uso respeitará a honra, a dignidade e a boa fama do(a) EMPREGADO(A), sendo vedada qualquer utilização vexatória ou que o(a) exponha ao ridículo.",
  "h": "§ 2º"
 },
 {
  "t": "par",
  "x": "Nos termos do art. 8º, § 5º, da LGPD, o consentimento poderá ser revogado mediante manifestação expressa e escrita, com efeitos apenas para usos futuros, ficando ratificados os usos realizados e mantidos os materiais já produzidos e divulgados até a revogação.",
  "h": "§ 3º"
 },
 {
  "t": "par",
  "x": "Esta cláusula não se confunde com a Cláusula 38ª, cujos usos (segurança, procedimentos disciplinares e processos) independem de consentimento.",
  "h": "§ 4º"
 },
 {
  "t": "rubrica39",
  "x": "Ciência e concordância específica com a Cláusula 39ª — rubrica do(a) EMPREGADO(A):"
 },
 {
  "t": "clausula",
  "x": "O(A) EMPREGADO(A) declara ciência e concordância com as seguintes regras:",
  "h": "Cláusula 40ª – Equipamentos e internet corporativa."
 },
 {
  "t": "item",
  "x": "A internet e os equipamentos eletrônicos (computadores, tablets, notebooks, celulares, smartphones, rádios, sistemas e e-mails corporativos) colocados à sua disposição destinam-se exclusivamente a propósitos relacionados às atribuições e atividades diárias, no interesse do HOTEL, sendo proibido usá-los para jogar, acessar redes sociais pessoais, pesquisar preço de produto pessoal ou qualquer atividade que não seja do cargo.",
  "h": "1."
 },
 {
  "t": "item",
  "x": "É vedado o uso dos meios disponibilizados para enviar, encaminhar ou disseminar, em qualquer escala, conteúdo difamatório, ofensivo, racista, obsceno ou pornográfico.",
  "h": "2."
 },
 {
  "t": "item",
  "x": "É vedado o uso dos meios disponibilizados, físicos ou digitais, para promover ou executar atividades não autorizadas, com intuito de obter vantagem pessoal, alheias ao interesse do HOTEL, bem como instalar programas não autorizados ou pirateados.",
  "h": "3."
 },
 {
  "t": "item",
  "x": "É responsabilidade de todos cuidar da integridade, confidencialidade e disponibilidade das informações contidas e propagadas no ambiente de trabalho, requerendo auxílio ou comunicando, sempre que necessário, o setor competente.",
  "h": "4."
 },
 {
  "t": "item",
  "x": "O(A) EMPREGADO(A) tem conhecimento de que o ambiente de trabalho, inclusive equipamentos, rede, sistemas, e-mail corporativo e internet, é monitorado, não havendo expectativa de privacidade nessas ferramentas, e aceita que o HOTEL utilize os controles, relatórios e imagens licitamente, para segurança da empresa e dos funcionários, autorizando desde já sua utilização.",
  "h": "5."
 },
 {
  "t": "item",
  "x": "Em caso de extinção ou suspensão do vínculo, as informações produzidas ou armazenadas nos meios corporativos estarão à disposição plena do HOTEL e poderão ser utilizadas sem prévio aviso.",
  "h": "6."
 },
 {
  "t": "item",
  "x": "O(A) EMPREGADO(A) garante evitar quaisquer ações de mau uso do ambiente laboral que possam trazer prejuízo ou má reputação ao HOTEL.",
  "h": "7."
 },
 {
  "t": "item",
  "x": "Todos os códigos, logins e senhas fornecidos pelo HOTEL são pessoais, intransferíveis e estritamente confidenciais, devendo o(a) EMPREGADO(A) tomar todas as cautelas para a sua guarda, sendo proibido compartilhá-los.",
  "h": "8."
 },
 {
  "t": "item",
  "x": "Os equipamentos devem ser devolvidos em bom estado ao fim do contrato ou quando solicitado.",
  "h": "9."
 },
 {
  "t": "par",
  "x": "O(A) EMPREGADO(A) compromete-se a respeitar e cumprir plena e integralmente estas regras, sob pena de aplicação das medidas disciplinares cabíveis, inclusive dispensa por justa causa, nos termos do art. 482 da CLT (Título XI).",
  "h": "Parágrafo único."
 },
 {
  "t": "titulo",
  "x": "TÍTULO IX — Atestados, afastamento pelo INSS e insalubridade"
 },
 {
  "t": "clausula",
  "x": "Para justificar ausência por motivo de saúde, o(a) EMPREGADO(A) deverá apresentar atestado médico ou odontológico. Sempre que possível, deverá avisar o superior no próprio dia da ausência. Ficando impossibilitado(a) de comparecer, deverá fazer o atestado chegar ao HOTEL por terceiro ou por meio eletrônico e, em todo caso, entregar a via original no dia do retorno, sob pena de as faltas não serem justificadas (CCT, cláusula 27ª).",
  "h": "Cláusula 41ª – Atestados médicos e odontológicos."
 },
 {
  "t": "par",
  "x": "O(A) EMPREGADO(A) poderá ser avaliado(a) pelo médico do HOTEL, a quem cabe homologar ou não o atestado, em decisão fundamentada, devendo comparecer quando solicitado, ainda que durante a vigência do atestado. Se não puder se locomover, o médico do HOTEL poderá examiná-lo(a) na residência ou onde se encontrar. A recusa em ser avaliado(a) autoriza a não homologação do atestado.",
  "h": "§ 1º"
 },
 {
  "t": "par",
  "x": "Declarações de comparecimento a consultas justificam apenas as horas nelas indicadas. Ficam ressalvadas as faltas legais do art. 473 da CLT.",
  "h": "§ 2º"
 },
 {
  "t": "par",
  "x": "A apresentação de atestado falso ou adulterado constitui ato de improbidade (art. 482, “a”, da CLT) e crime (arts. 297, 298, 302 e 304 do Código Penal).",
  "h": "§ 3º"
 },
 {
  "t": "par",
  "x": "Foto, cópia simples ou entrega posterior não substituem o atestado original: a foto ou o envio eletrônico servem apenas como aviso, devendo o original ser entregue na data do retorno ao trabalho (CCT, cláusula 27ª). O HOTEL pode pedir que o atestado seja avaliado pelo médico da empresa antes de aceitá-lo.",
  "h": "§ 4º"
 },
 {
  "t": "clausula",
  "x": "Nos afastamentos superiores a 15 (quinze) dias, o HOTEL fará o encaminhamento previdenciário e dará ciência ao(à) EMPREGADO(A) desta cláusula.",
  "h": "Cláusula 42ª – Afastamento e retorno do INSS."
 },
 {
  "t": "par",
  "x": "É obrigatório ao(à) EMPREGADO(A) que receber alta previdenciária apresentar-se ao HOTEL no dia útil imediatamente seguinte à alta, recebendo protocolo de apresentação, sob pena de ter o período de inércia considerado falta injustificada, podendo ser caracterizado o abandono de emprego (CCT, cláusula 18ª; art. 482, “i”, da CLT). Presume-se o abandono se o(a) EMPREGADO(A) não retornar nem justificar a ausência no prazo de 30 (trinta) dias após a cessação do benefício (Súmula 32 do TST).",
  "h": "§ 1º"
 },
 {
  "t": "par",
  "x": "Se recorrer da alta, o(a) EMPREGADO(A) deverá comunicar o HOTEL também no dia útil imediatamente seguinte à alta, mediante contrarrecibo, sob as mesmas penas. Se optar por não trabalhar durante o recurso ou ação contra o INSS, deverá declarar essa condição por escrito, eximindo o HOTEL do pagamento de salários e demais consectários no período (CCT, cláusula 18ª, §§ 1º e 2º).",
  "h": "§ 2º"
 },
 {
  "t": "par",
  "x": "Antes de reassumir, o(a) EMPREGADO(A) afastado(a) por 30 (trinta) dias ou mais fará exame de retorno ao trabalho (NR-07). Se o médico do HOTEL o(a) considerar inapto(a) após a alta, o HOTEL adotará as providências cabíveis, como readaptação em função compatível ou novo encaminhamento ao INSS.",
  "h": "§ 3º"
 },
 {
  "t": "par",
  "x": "Se o afastamento passar do prazo legal, o(a) EMPREGADO(A) deve marcar a perícia no INSS dentro do prazo e, após a alta, apresentar-se ao HOTEL no primeiro dia útil seguinte para fazer o exame de retorno. Faltar mais de 30 (trinta) dias sem justificativa após a alta do INSS caracteriza abandono de emprego, autorizando a rescisão por justa causa (art. 482, “i”, da CLT).",
  "h": "§ 4º"
 },
 {
  "t": "clausula",
  "x": "Nos termos do art. 611-A, XII, da CLT e da cláusula 32ª da CCT, apenas a atividade, em tempo permanente, de limpeza e higienização de banheiros nas dependências do HOTEL é considerada insalubre, em grau médio. O(A) EMPREGADO(A) declara ciência de que:",
  "h": "Cláusula 43ª – Insalubridade."
 },
 {
  "t": "par",
  "x": "Considera-se: (a) eventual – a atividade exercida em período inferior a 1/4 do tempo de trabalho diário; (b) intermitente – entre 1/4 e 3/4; (c) permanente – superior a 3/4 do tempo de trabalho diário. Apenas a permanente gera o adicional.",
  "h": "§ 1º"
 },
 {
  "t": "par",
  "x": "Não é considerado tempo de limpeza e higienização de banheiros o tempo gasto na limpeza e arrumação de quartos, corredores ou áreas comuns do estabelecimento, que não geram insalubridade.",
  "h": "§ 2º"
 },
 {
  "t": "par",
  "x": "O(A) EMPREGADO(A) obriga-se a usar os EPIs que neutralizam ou eliminam o agente insalubre (art. 191 da CLT).",
  "h": "§ 3º"
 },
 {
  "t": "titulo",
  "x": "TÍTULO X — Férias"
 },
 {
  "t": "clausula",
  "x": "Por mútuo acordo, com observância do art. 134, § 1º, da CLT e da cláusula 25ª da CCT, o(a) EMPREGADO(A) concorda prévia e expressamente que as férias adquiridas poderão ser usufruídas em até três períodos, a critério do HOTEL e na forma da lei, sendo que um deles não poderá ser inferior a 14 (quatorze) dias corridos e os demais não poderão ser inferiores a 5 (cinco) dias corridos cada um, vedado o início nos dois dias que antecedem feriado ou repouso semanal (art. 134, § 3º, da CLT).",
  "h": "Cláusula 44ª – Fracionamento."
 },
 {
  "t": "titulo",
  "x": "TÍTULO XI — Regime disciplinar"
 },
 {
  "t": "clausula",
  "x": "O descumprimento deste contrato, do Regulamento Interno ou das normas do HOTEL sujeita o(a) EMPREGADO(A), conforme a gravidade, a advertência verbal, advertência escrita, suspensão de até 30 (trinta) dias (art. 474 da CLT) e dispensa por justa causa. Faltas graves podem ensejar a justa causa diretamente, sem graduação prévia.",
  "h": "Cláusula 45ª – Medidas disciplinares."
 },
 {
  "t": "par",
  "x": "O(A) EMPREGADO(A) declara ciência de que constituem justa causa para rescisão do contrato pelo empregador (art. 482 da CLT): (a) ato de improbidade; (b) incontinência de conduta ou mau procedimento; (c) negociação habitual por conta própria ou alheia sem permissão do empregador, e quando constituir ato de concorrência à empresa ou for prejudicial ao serviço; (d) condenação criminal, passada em julgado, caso não tenha havido suspensão da execução da pena; (e) desídia no desempenho das funções; (f) embriaguez habitual ou em serviço; (g) violação de segredo da empresa; (h) ato de indisciplina ou de insubordinação; (i) abandono de emprego; (j) ato lesivo da honra ou da boa fama praticado no serviço contra qualquer pessoa, ou ofensas físicas, nas mesmas condições, salvo em legítima defesa, própria ou de outrem; (k) ato lesivo da honra ou da boa fama ou ofensas físicas praticadas contra o empregador e superiores hierárquicos, salvo em legítima defesa, própria ou de outrem; (l) prática constante de jogos de azar; (m) perda da habilitação ou dos requisitos legais para o exercício da profissão, em decorrência de conduta dolosa.",
  "h": "§ 1º"
 },
 {
  "t": "par",
  "x": "As penalidades serão aplicadas com imediatidade após a ciência e a apuração do fato, assegurado ao(à) EMPREGADO(A) apresentar sua versão. A recusa em assinar a comunicação da penalidade não impede sua aplicação, que poderá ser atestada por duas testemunhas.",
  "h": "§ 2º"
 },
 {
  "t": "clausula",
  "x": "Além das sanções trabalhistas, o(a) EMPREGADO(A) responde civilmente pelos danos que causar por dolo ou culpa (arts. 186 e 927 do Código Civil) e criminalmente pelos ilícitos que praticar, podendo o HOTEL exercer direito de regresso pelos valores que for obrigado a pagar a terceiros por ato do(a) EMPREGADO(A) (art. 934 do Código Civil).",
  "h": "Cláusula 46ª – Responsabilidade civil e penal."
 },
 {
  "t": "titulo",
  "x": "TÍTULO XII — Manual de Procedimentos Internos e rotinas operacionais"
 },
 {
  "t": "clausula",
  "x": "Integra este contrato o Manual de Procedimentos Internos do HOTEL (Normas, Condutas e Procedimentos Operacionais – versão {{MANUAL_VERSAO}}, com {{MANUAL_PAGINAS}} páginas), entregue ao(à) EMPREGADO(A) em virtude deste contrato, em cópia impressa ou digital. As regras de comportamento e os procedimentos do dia a dia nele previstos, reproduzidos neste Título e nas demais cláusulas deste contrato, são de leitura e cumprimento obrigatórios para todos os colaboradores, sem exceção. O(A) EMPREGADO(A) declara que recebeu o Manual e se compromete a cumpri-lo integralmente.",
  "h": "Cláusula 47ª – Manual de Procedimentos Internos."
 },
 {
  "t": "par",
  "x": "Uma cópia do termo de ciência assinado fica no arquivo do setor de Recursos Humanos e uma cópia digital é guardada no sistema.",
  "h": "§ 1º"
 },
 {
  "t": "par",
  "x": "Sempre que o Manual for atualizado, o(a) EMPREGADO(A) receberá a nova versão e assinará novo termo de ciência. A versão mais recente substitui as anteriores e é a única válida, não podendo as atualizações reduzir direitos previstos em lei, na CCT ou neste contrato (art. 468 da CLT).",
  "h": "§ 2º"
 },
 {
  "t": "par",
  "x": "Em caso de dúvida sobre qualquer item, o(a) EMPREGADO(A) deve falar com o superior imediato antes de agir.",
  "h": "§ 3º"
 },
 {
  "t": "par",
  "x": "O descumprimento do Manual pode gerar advertência verbal, advertência escrita, suspensão ou dispensa por justa causa, observada a progressividade das medidas ou a gravidade da conduta, na forma da CLT, da CCT e do Título XI.",
  "h": "§ 4º"
 },
 {
  "t": "par",
  "x": "Havendo divergência entre o Manual e este contrato, prevalece o disposto neste contrato.",
  "h": "§ 5º"
 },
 {
  "t": "clausula",
  "x": "É proibido sair do posto de trabalho sem autorização do superior imediato. Se precisar se ausentar, o(a) EMPREGADO(A) deve pedir autorização e garantir que o posto fique coberto.",
  "h": "Cláusula 48ª – Saída do posto e passagem de turno."
 },
 {
  "t": "par",
  "x": "Toda troca de turno exige o repasse de informações ao colega que assume o turno seguinte. O repasse é obrigatório, é feito dentro da jornada, antes do registro de saída, e deve conter: (a) hóspedes que chegaram, que saíram e que estão previstos para chegar ou sair; (b) quartos em situação especial (manutenção, bloqueados, em limpeza, com VIP); (c) reclamações e ocorrências em aberto, com nome do hóspede e quarto, devidamente registradas no sistema Starter; (d) pedidos pendentes (lavanderia, despertar); (e) pagamentos pendentes ou cobranças em discussão; (f) problemas nos sistemas (Cloudbeds, Ask Suite, Starter) ou em equipamentos; (g) avisos da gerência ou da direção que precisam circular; (h) caixa: valor de abertura e de fechamento, com conferência feita pelos dois colaboradores.",
  "h": "§ 1º"
 },
 {
  "t": "par",
  "x": "A passagem de turno deve ser registrada em formato digital no sistema Starter. Quem assume o turno é responsável a partir do momento da troca.",
  "h": "§ 2º"
 },
 {
  "t": "clausula",
  "x": "O(A) EMPREGADO(A) deve manter postura profissional e evitar intimidades com hóspedes. É proibido pedir empréstimos a hóspedes ou induzir gorjetas, e é proibido discutir com hóspedes em qualquer hipótese: se o hóspede estiver agressivo, o(a) EMPREGADO(A) deve chamar a gerência.",
  "h": "Cláusula 49ª – Postura com hóspedes e defesa do colaborador."
 },
 {
  "t": "par",
  "x": "Se um hóspede tratar mal, assediar ou for agressivo com o(a) EMPREGADO(A), este(a) deve se afastar imediatamente e chamar a gerência. O HOTEL não admite que o hóspede desrespeite o funcionário e adotará as providências cabíveis para protegê-lo(a).",
  "h": "Parágrafo único."
 },
 {
  "t": "clausula",
  "x": "Toda reclamação deve ser tratada com seriedade, seguindo este passo a passo: (I) ouvir o hóspede até o fim, sem interromper; (II) demonstrar que entendeu o problema, repetindo-o com suas palavras (“Então, o senhor está dizendo que...”); (III) pedir desculpas pelo transtorno, mesmo que a culpa não seja sua; (IV) se o problema for simples e puder ser resolvido na hora, resolver; (V) se fugir da sua alçada ou envolver dinheiro (desconto, cortesia, devolução), chamar imediatamente a gerência; (VI) registrar a reclamação no sistema Cloudbeds (campo de observações da reserva), com data, hora e o que foi feito, e também no programa Starter, na parte de comunicações internas; (VII) no final do dia, comunicar a reclamação na passagem de turno; (VIII) se a reclamação envolver dano material ou ameaça de processo, comunicar imediatamente a gerência, ainda que fora do horário de expediente da gerência.",
  "h": "Cláusula 50ª – Reclamações de hóspedes."
 },
 {
  "t": "clausula",
  "x": "(a) Atendimento presencial na recepção: imediato; se estiver atendendo outra pessoa, fazer contato visual e dizer “Em um instante estou com o senhor”. (b) Telefone interno (do quarto): atender até o terceiro toque. (c) Telefone externo: atender até o quarto toque. (d) WhatsApp do HOTEL, durante o expediente: responder em até 5 (cinco) minutos; se a resposta exigir mais tempo (consulta, conferência), enviar primeiro uma mensagem informando: “Recebi sua mensagem, vou verificar e retorno em X minutos”.",
  "h": "Cláusula 51ª – Tempo máximo de resposta ao hóspede."
 },
 {
  "t": "clausula",
  "x": "O tratamento entre colegas e com superiores deve ser sempre cordial, sem distinção de hierarquia, raça, sexo, religião, orientação sexual ou qualquer outra característica pessoal.",
  "h": "Cláusula 52ª – Relacionamento entre colegas e comunicação interna."
 },
 {
  "t": "par",
  "x": "O(A) EMPREGADO(A) deve manter linguagem profissional, evitando gírias, palavrões e apelidos, tanto presencialmente quanto em mensagens, redes sociais e grupos de trabalho.",
  "h": "§ 1º"
 },
 {
  "t": "par",
  "x": "Quando um problema chegar até o(a) EMPREGADO(A), é seu dever resolvê-lo, desde que compatível com as suas atribuições, ou encaminhá-lo a quem é responsável pela resolução.",
  "h": "§ 2º"
 },
 {
  "t": "par",
  "x": "Os grupos de WhatsApp do trabalho são exclusivos para assuntos profissionais, sendo proibido enviar correntes, conteúdo religioso, político, humorístico, comercial, pessoal, dentre outros. A participação nesses grupos não obriga a leitura ou a resposta de mensagens fora da jornada (Cláusula 11ª, § 2º).",
  "h": "§ 3º"
 },
 {
  "t": "clausula",
  "x": "No check-in é obrigatório: (I) conferir o documento de identificação com foto do hóspede; (II) preencher a ficha completa no Cloudbeds, sem deixar campos vazios e sem erros de digitação; (III) imprimir a ficha de hospedagem para assinatura do hóspede; (IV) arquivar a ficha assinada conforme orientação, observadas a Lei Geral do Turismo (Lei nº 11.771/2008) e as regras sobre a Ficha Nacional de Registro de Hóspedes, bem como a Cláusula 29ª (crianças e adolescentes).",
  "h": "Cláusula 53ª – Recepção: check-in, encomendas, valores e pagamentos."
 },
 {
  "t": "par",
  "x": "Não é permitida a entrega de encomendas, alimentação ou similares diretamente no apartamento: o hóspede deve vir até a recepção para retirar.",
  "h": "§ 1º"
 },
 {
  "t": "par",
  "x": "É proibido receber em guarda pessoal dinheiro, joias, documentos ou objetos de valor de hóspedes fora do procedimento oficial do HOTEL (cofre e registro).",
  "h": "§ 2º"
 },
 {
  "t": "par",
  "x": "Todo recebimento deve ser feito pelos meios oficiais do HOTEL (caixa com recibo, máquina de cartão ou conta/PIX em nome do HOTEL), sendo proibido receber valores em conta pessoal ou fora do sistema. O consumo deve ser lançado no Cloudbeds no momento da venda.",
  "h": "§ 3º"
 },
 {
  "t": "clausula",
  "x": "Ao encontrar um item esquecido, o(a) EMPREGADO(A) deve: (I) entregá-lo imediatamente à recepção ou à governança – nunca levá-lo para casa nem deixá-lo no local em que foi visto; (II) registrar no programa Starter a data e a hora em que foi encontrado, o local exato (quarto, área comum, restaurante), a descrição do item e o nome de quem encontrou; (III) guardar o item no local físico padronizado, com etiqueta de identificação.",
  "h": "Cláusula 54ª – Achados e perdidos."
 },
 {
  "t": "par",
  "x": "Devolução ao hóspede. (I) Confirmar a identidade da pessoa, pedindo documento e conferindo com o cadastro da reserva; (II) conferir se a descrição dada pela pessoa bate com o registro; (III) registrar a entrega no Starter, com data, hora e quem entregou; (IV) pedir assinatura no documento de entrega; (V) se a devolução for por correio, o hóspede paga o frete e assume o risco do envio.",
  "h": "§ 1º"
 },
 {
  "t": "par",
  "x": "Tempo de armazenamento. Itens de baixo valor (roupas, toalhas, cosméticos, carregadores): 90 dias. Itens de valor médio (óculos, livros, eletrônicos pequenos): 180 dias. Itens de alto valor (joias, dinheiro, documentos, eletrônicos caros): 1 ano. Documentos pessoais (RG, passaporte, CNH): devolver imediatamente, com tentativa ativa de contato pelo telefone do cadastro; sem retorno em 30 dias, comunicar à gerência para definir a destinação. Após o prazo, os itens não reclamados podem ser doados (preferencialmente a instituições parceiras) ou descartados, sempre com registro escrito da destinação no Starter.",
  "h": "§ 2º"
 },
 {
  "t": "par",
  "x": "A apropriação de item achado sujeita o(a) EMPREGADO(A) ao disposto na Cláusula 31ª.",
  "h": "§ 3º"
 },
 {
  "t": "clausula",
  "x": "O hóspede tem direito ao descanso. Quando uma reclamação de barulho chegar à recepção, o(a) EMPREGADO(A) deve: (I) ligar para o quarto que está gerando o barulho e identificar-se com cordialidade: “Aqui é o(a) [nome] da recepção. Recebemos uma reclamação sobre barulho. O senhor pode, por gentileza, diminuir o som?”; (II) registrar no Cloudbeds a hora da ligação, o motivo, o quarto que reclamou e o quarto que recebeu o aviso; (III) se o barulho continuar após 15 minutos, subir ao apartamento, sempre em dupla, nunca sozinho(a), bater na porta, identificar-se e repetir o pedido com firmeza; (IV) havendo qualquer sinal de violência, agressão ou atividade ilegal, ligar imediatamente para o 190 (Polícia Militar), antes de qualquer outra ação.",
  "h": "Cláusula 55ª – Barulho e perturbação."
 },
 {
  "t": "par",
  "x": "Após as 22h, qualquer barulho audível fora do quarto é considerado perturbação. Antes desse horário, deve-se avaliar se está realmente atrapalhando outros hóspedes.",
  "h": "Parágrafo único."
 },
 {
  "t": "clausula",
  "x": "O(A) EMPREGADO(A) deve: (a) lançar o consumo no Cloudbeds na hora da venda, nunca deixando para depois; (b) não liberar quarto para novo hóspede sem a revisão da governança – sem revisão, não libera; (c) registrar no sistema e na passagem de turno qualquer ocorrência relevante (reclamação, dano, conflito) – se não está registrado, não aconteceu; (d) em caso de dúvida, consultar o superior antes de responder ao hóspede, evitando passar informação errada.",
  "h": "Cláusula 56ª – Erros operacionais a evitar."
 },
 {
  "t": "par",
  "x": "A repetição desses erros, após orientação, poderá caracterizar desídia no desempenho das funções (art. 482, “e”, da CLT).",
  "h": "Parágrafo único."
 },
 {
  "t": "clausula",
  "x": "Fora do trabalho o(a) EMPREGADO(A) é livre, mas o que faz pode afetar a imagem do HOTEL quando associado à empresa. Por isso: (a) não pode usar o nome do HOTEL para conseguir descontos, vantagens ou benefícios pessoais; (b) deve ter cuidado com publicações em redes sociais que envolvam o HOTEL ou possam prejudicar sua imagem (Cláusula 27ª); (c) não pode manter relacionamento pessoal com hóspedes enquanto estiverem hospedados; (d) é proibido frequentar bares ou locais de lazer usando o uniforme do HOTEL.",
  "h": "Cláusula 57ª – Comportamento fora do expediente."
 },
 {
  "t": "clausula",
  "x": "É proibido indicar serviços externos a hóspedes (transporte, restaurante, passeio etc.) recebendo benefício pessoal – comissão, gorjeta ou qualquer contrapartida do prestador –, devendo ser usados apenas os parceiros oficiais do HOTEL (Cláusula 30ª).",
  "h": "Cláusula 58ª – Conflito de interesses e comércio interno."
 },
 {
  "t": "par",
  "x": "Dentro do HOTEL é proibido: (a) vender produtos pessoais (roupa, perfume, cosmético, joia etc.); (b) vender rifa, sorteio, bolão ou promover jogo de azar; (c) fazer propaganda política ou religiosa enquanto estiver de uniforme.",
  "h": "Parágrafo único."
 },
 {
  "t": "titulo",
  "x": "TÍTULO XIII — Disposições complementares de proteção"
 },
 {
  "t": "clausula",
  "x": "Caso o(a) EMPREGADO(A) venha a prestar serviços, durante a mesma jornada, à empresa {{EMPRESA_SOCIOS_COMUNS_RAZAO_SOCIAL}}, inscrita no CNPJ sob nº {{EMPRESA_SOCIOS_COMUNS_CNPJ}}, ou a qualquer outra empresa que tenha sócios em comum com o EMPREGADOR(A), isso não caracterizará a coexistência de mais de um contrato de trabalho, permanecendo a {{EMPREGADOR_RAZAO_SOCIAL}} como única empregadora (Súmula 129 do TST), observadas as regras da Cláusula 4ª.",
  "h": "Cláusula 59ª – Serviços a empresas com sócios em comum."
 },
 {
  "t": "clausula",
  "x": "Quando a função envolver a condução de veículos do HOTEL ou de hóspedes, inclusive a manobra de veículos de hóspedes no estacionamento para liberar a saída de outros veículos, o(a) EMPREGADO(A) deve possuir Carteira Nacional de Habilitação válida e compatível, informar imediatamente qualquer suspensão ou cassação e cumprir integralmente o Código de Trânsito Brasileiro (CTB).",
  "h": "Cláusula 60ª – Condução de veículos."
 },
 {
  "t": "par",
  "x": "As infrações de trânsito decorrentes de atos praticados na direção do veículo são de responsabilidade do condutor (art. 257, § 3º, do CTB), obrigando-se o(a) EMPREGADO(A) a assinar a indicação de condutor e autorizando o desconto das multas a que der causa (art. 462, § 1º, da CLT).",
  "h": "§ 1º"
 },
 {
  "t": "par",
  "x": "É proibido utilizar veículos de hóspedes ou do HOTEL para fins não autorizados, permitir que terceiros os conduzam ou retirar objetos de seu interior. Danos causados por dolo ou culpa observarão a Cláusula 15ª, § 1º.",
  "h": "§ 2º"
 },
 {
  "t": "par",
  "x": "Somente o(a) EMPREGADO(A) habilitado(a) e previamente autorizado(a) pela gerência poderá manobrar veículos de hóspedes, sempre dentro do estacionamento e apenas pelo tempo necessário à manobra. Antes de manobrar, deve verificar visualmente se o veículo tem avarias aparentes; deve registrar o recebimento e a devolução da chave e comunicar imediatamente à gerência qualquer avaria, já existente ou ocorrida durante a manobra.",
  "h": "§ 3º"
 },
 {
  "t": "clausula",
  "x": "Após a conversão deste contrato em prazo indeterminado, o(a) EMPREGADO(A) que pedir demissão deverá conceder ao HOTEL aviso prévio de 30 (trinta) dias, por escrito. A falta do aviso dá ao HOTEL o direito de descontar os salários correspondentes ao respectivo prazo (art. 487, § 2º, da CLT). Durante o período de experiência aplica-se a Cláusula 7ª.",
  "h": "Cláusula 61ª – Pedido de demissão e aviso prévio."
 },
 {
  "t": "clausula",
  "x": "O(A) EMPREGADO(A) obriga-se a participar dos treinamentos oferecidos pelo HOTEL, como integração, atendimento ao hóspede, uso dos sistemas, segurança do trabalho, combate a incêndio, LGPD e prevenção ao assédio e à discriminação, assinando a lista de presença. Os treinamentos serão realizados dentro da jornada ou, quando fora dela, computados como tempo de trabalho.",
  "h": "Cláusula 62ª – Treinamentos."
 },
 {
  "t": "clausula",
  "x": "As partes reconhecem a validade da assinatura eletrônica ou digital deste contrato, de seus aditivos, avisos, advertências, recibos, espelhos de ponto e demais documentos da relação de emprego, como meio de comprovação de autoria e integridade admitido pelas partes (art. 10, § 2º, da Medida Provisória nº 2.200-2/2001). São também válidas as comunicações enviadas pelo HOTEL ao e-mail e ao telefone/WhatsApp informados pelo(a) EMPREGADO(A), sem prejuízo do disposto na Cláusula 11ª, § 2º.",
  "h": "Cláusula 63ª – Documentos, assinaturas e comunicações eletrônicas."
 },
 {
  "t": "titulo",
  "x": "TÍTULO XIV — Disposições finais"
 },
 {
  "t": "clausula",
  "x": "Comunicados, políticas e normas internas posteriores, dados a conhecer por assinatura, e-mail, aplicativo corporativo ou mural, integram este contrato, desde que não tragam prejuízo ao(à) EMPREGADO(A) (art. 468 da CLT).",
  "h": "Cláusula 64ª – Comunicados e normas internas."
 },
 {
  "t": "clausula",
  "x": "O(A) EMPREGADO(A) deve manter atualizados endereço, telefone, e-mail, dependentes e dados de transporte, considerando-se válidas as comunicações enviadas aos últimos dados informados. Declara que as informações e documentos apresentados na admissão são verdadeiros.",
  "h": "Cláusula 65ª – Atualização cadastral."
 },
 {
  "t": "clausula",
  "x": "A garantia de emprego de 12 (doze) meses antes da aposentadoria, para quem tiver ao menos 5 (cinco) anos de casa, depende de o(a) EMPREGADO(A) comprovar ao HOTEL o preenchimento dos requisitos até um dia após o recebimento do aviso prévio, sob pena de decadência, podendo o HOTEL dar seguimento à rescisão mediante a indenização prevista na cláusula 16ª da CCT.",
  "h": "Cláusula 66ª – Véspera de aposentadoria."
 },
 {
  "t": "clausula",
  "x": "Aplicam-se a este contrato a CCT vigente e as que a sucederem, inclusive quanto a medidas em caso de pandemia (CCT, cláusula 37ª), bem como a legislação superveniente.",
  "h": "Cláusula 67ª – Norma coletiva e legislação superveniente."
 },
 {
  "t": "clausula",
  "x": "A eventual nulidade ou inaplicabilidade de qualquer cláusula não prejudica as demais, devendo a cláusula afetada ser aplicada até o limite permitido em lei (art. 184 do Código Civil).",
  "h": "Cláusula 68ª – Validade das cláusulas."
 },
 {
  "t": "clausula",
  "x": "O presente contrato e seus anexos formam um todo único e indivisível, para todos os efeitos legais. As condições aqui inscritas vigoram a partir da assinatura.",
  "h": "Cláusula 69ª – Integralidade e vigência."
 },
 {
  "t": "clausula",
  "x": "O(A) EMPREGADO(A) declara que leu integralmente este contrato e seus anexos, que teve oportunidade de esclarecer dúvidas, que recebeu cópia deste instrumento, do Regulamento Interno (Manual de Procedimentos Internos) e que o assina livremente.",
  "h": "Cláusula 70ª – Declarações do(a) EMPREGADO(A)."
 },
 {
  "t": "clausula",
  "x": "Fica eleito o foro da Justiça do Trabalho de {{EMPREGADOR_CIDADE}}/{{EMPREGADOR_UF}} para dirimir quaisquer controvérsias decorrentes deste contrato e de seus anexos, inclusive as relativas à confidencialidade após a extinção do vínculo, ainda que digam respeito a fatos anteriores à sua assinatura (art. 114 da Constituição; art. 651 da CLT).",
  "h": "Cláusula 71ª – Foro."
 },
 {
  "t": "texto",
  "x": "E, por estarem de pleno acordo, as partes assinam o presente contrato em duas vias, de igual teor, rubricando todas as páginas, ficando a primeira em poder do EMPREGADOR(A) e a segunda com o(a) EMPREGADO(A), que dela dará o competente recibo, na presença das testemunhas abaixo."
 },
 {
  "t": "assinaturas",
  "tipo": "final",
  "x": "{{EMPREGADOR_CIDADE}}/{{EMPREGADOR_UF}}, {{DATA_ASSINATURA}}."
 }
];
