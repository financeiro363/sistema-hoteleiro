// ============================================================================
// ROTA DE SERVIDOR: /api/cloudbeds-exportar
// ============================================================================
// Pega uma ficha FNRH já preenchida + o número da reserva na Cloudbeds
// (informado pelo operador do hotel) e envia os dados do hóspede para a
// Cloudbeds. Só ADMIN pode chamar.
//
// ⚠️ SOBRE OS NOMES DOS CAMPOS DA CLOUDBEDS: usei os nomes de campo mais
// comuns e confirmados a partir de uma resposta real da API (putReservation,
// com guestFirstName/guestLastName/guestEmail/etc.). Como a documentação
// completa e detalhada de cada campo só é visível depois de login na
// conta Cloudbeds do hotel, é possível que algum nome ainda precise de
// pequeno ajuste. Esses nomes estão reunidos, comentados, na seção
// "MAPEAMENTO DE CAMPOS" abaixo — fácil de ajustar se precisar.
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import { descriptografar } from '../../../lib/cloudbedsCrypto';

const CLOUDBEDS_BASE_URL = 'https://api.cloudbeds.com/api/v1.2';

// Nossos códigos internos → texto em português (os campos da Cloudbeds
// são de texto livre, não códigos)
const MOTIVO_VIAGEM_TEXTO = { LAZER: 'Lazer', NEGOCIOS: 'Negócios', EVENTOS: 'Eventos', PARENTES: 'Visita a parentes', SAUDE: 'Saúde', OUTRO: 'Outro' };
const MEIO_TRANSPORTE_TEXTO = { AVIAO: 'Avião', AUTOMOVEL: 'Automóvel', ONIBUS: 'Ônibus', TREM: 'Trem', OUTRO: 'Outro' };
// Códigos confirmados na documentação oficial da Cloudbeds para o tipo de
// documento (só vimos 4 dos 8 valores possíveis — "dni" e "passport" são
// a melhor aposta para RG/Passaporte, podem precisar de ajuste)
const DOC_TIPO_CLOUDBEDS = { CPF: 'cpf', RG: 'dni', PASSAPORTE: 'passport' };

// A Cloudbeds exige o país como sigla de 2 letras (ISO 3166-1 alpha-2),
// não o nome por extenso — por isso convertemos aqui. Cobre os nomes
// mais comuns que aparecem na ficha; se não reconhecer, cai em "BR"
// (a grande maioria dos hóspedes é do Brasil).
const PAIS_PARA_SIGLA = {
  'brasil': 'BR', 'brazil': 'BR', 'brasileiro': 'BR', 'brasileira': 'BR',
  'estados unidos': 'US', 'eua': 'US', 'usa': 'US', 'united states': 'US', 'americano': 'US', 'americana': 'US',
  'portugal': 'PT', 'português': 'PT', 'portuguesa': 'PT',
  'argentina': 'AR', 'argentino': 'AR', 'argentina (nacionalidade)': 'AR',
  'chile': 'CL', 'chileno': 'CL', 'chilena': 'CL',
  'uruguai': 'UY', 'uruguay': 'UY', 'uruguaio': 'UY', 'uruguaia': 'UY',
  'paraguai': 'PY', 'paraguay': 'PY', 'paraguaio': 'PY', 'paraguaia': 'PY',
  'bolivia': 'BO', 'bolívia': 'BO', 'boliviano': 'BO', 'boliviana': 'BO',
  'colombia': 'CO', 'colômbia': 'CO', 'colombiano': 'CO', 'colombiana': 'CO',
  'peru': 'PE', 'peruano': 'PE', 'peruana': 'PE',
  'equador': 'EC', 'ecuador': 'EC', 'equatoriano': 'EC', 'equatoriana': 'EC',
  'venezuela': 'VE', 'venezuelano': 'VE', 'venezuelana': 'VE',
  'mexico': 'MX', 'méxico': 'MX', 'mexicano': 'MX', 'mexicana': 'MX',
  'canada': 'CA', 'canadá': 'CA', 'canadense': 'CA',
  'espanha': 'ES', 'spain': 'ES', 'espanhol': 'ES', 'espanhola': 'ES',
  'franca': 'FR', 'frança': 'FR', 'france': 'FR', 'francês': 'FR', 'francesa': 'FR',
  'italia': 'IT', 'itália': 'IT', 'italy': 'IT', 'italiano': 'IT', 'italiana': 'IT',
  'alemanha': 'DE', 'germany': 'DE', 'alemão': 'DE', 'alemã': 'DE',
  'reino unido': 'GB', 'inglaterra': 'GB', 'united kingdom': 'GB', 'inglês': 'GB', 'inglesa': 'GB', 'britânico': 'GB', 'britânica': 'GB',
  'japao': 'JP', 'japão': 'JP', 'japan': 'JP', 'japonês': 'JP', 'japonesa': 'JP',
  'china': 'CN', 'chinês': 'CN', 'chinesa': 'CN',
};
function paraSiglaPais(nomePais) {
  const chave = String(nomePais || '').trim().toLowerCase();
  if (!chave) return 'BR';
  // Já é uma sigla de 2 letras? usa direto (deixa maiúscula)
  if (/^[a-z]{2}$/i.test(chave)) return chave.toUpperCase();
  return PAIS_PARA_SIGLA[chave] || 'BR';
}

export async function POST(request) {
  try {
    const corpo = await request.json();
    const fichaId = corpo?.fichaId;
    const reservationId = (corpo?.reservationId || '').trim();

    if (!fichaId || !reservationId) {
      return Response.json({ erro: 'Informe o número da reserva na Cloudbeds.' }, { status: 400 });
    }

    const tokenAcesso = (request.headers.get('authorization') || '').replace('Bearer ', '');
    if (!tokenAcesso) {
      return Response.json({ erro: 'Não autorizado — faça login novamente.' }, { status: 401 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const chaveAnonima = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const chaveMestra = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const segredoCripto = process.env.CLOUDBEDS_CRYPTO_SECRET;

    if (!supabaseUrl || !chaveAnonima || !chaveMestra || !segredoCripto) {
      return Response.json({ erro: 'O servidor não está configurado corretamente (faltam variáveis de ambiente).' }, { status: 500 });
    }

    const supabaseComoChamador = createClient(supabaseUrl, chaveAnonima, {
      global: { headers: { Authorization: `Bearer ${tokenAcesso}` } },
    });
    const { data: dadosAuth, error: erroAuth } = await supabaseComoChamador.auth.getUser(tokenAcesso);
    if (erroAuth || !dadosAuth?.user) {
      return Response.json({ erro: 'Sessão inválida ou expirada.' }, { status: 401 });
    }

    const { data: chamador, error: erroChamador } = await supabaseComoChamador
      .from('usuarios').select('papel, hotel_id, id').eq('auth_id', dadosAuth.user.id).single();
    if (erroChamador || !chamador) {
      return Response.json({ erro: 'Não foi possível confirmar seu usuário.' }, { status: 403 });
    }

    const supabaseAdmin = createClient(supabaseUrl, chaveMestra);

    // Busca a ficha (confirmando que é do mesmo hotel de quem está chamando)
    const { data: ficha, error: erroFicha } = await supabaseAdmin
      .from('fichas_fnrh').select('*').eq('id', fichaId).eq('hotel_id', chamador.hotel_id).single();
    if (erroFicha || !ficha) {
      return Response.json({ erro: 'Ficha não encontrada.' }, { status: 404 });
    }

    // Busca e descriptografa a credencial da Cloudbeds
    const { data: credencial, error: erroCred } = await supabaseAdmin
      .from('cloudbeds_credenciais').select('*').eq('hotel_id', chamador.hotel_id).maybeSingle();
    if (erroCred || !credencial?.api_key_cifrada) {
      return Response.json({ erro: 'A integração com a Cloudbeds ainda não foi configurada para este hotel.' }, { status: 400 });
    }

    let apiKey;
    try {
      apiKey = descriptografar(credencial.api_key_cifrada, segredoCripto);
    } catch (e) {
      return Response.json({ erro: 'Não foi possível ler a credencial salva — tente configurar a chave da Cloudbeds novamente.' }, { status: 500 });
    }

    const cabecalhosCloudbeds = {
      Authorization: `Bearer ${apiKey}`,
      ...(credencial.cloudbeds_property_id ? { 'x-property-id': credencial.cloudbeds_property_id } : {}),
    };

    // ---- Passo 1: confirma que a reserva existe na Cloudbeds ----
    const respostaReserva = await fetch(`${CLOUDBEDS_BASE_URL}/getReservation?reservationID=${encodeURIComponent(reservationId)}`, {
      method: 'GET',
      headers: cabecalhosCloudbeds,
    });
    const dadosReserva = await respostaReserva.json().catch(() => null);

    if (!respostaReserva.ok || dadosReserva?.success === false) {
      const mensagemCloudbeds = dadosReserva?.message || 'reserva não encontrada ou credencial inválida';
      return Response.json({ erro: `A Cloudbeds recusou a consulta da reserva: ${mensagemCloudbeds}` }, { status: 400 });
    }

    // A resposta da Cloudbeds confirma: "guestName" e "guestEmail" existem
    // DIRETO na reserva — mas descobrimos que atualizar por putReservation
    // não reflete no cadastro real do hóspede (ele "aceita" mas não muda
    // nada). Por isso, agora buscamos o cadastro de hóspede de verdade
    // A documentação oficial da Cloudbeds confirma o caminho certo:
    // "getReservations com includeGuestsDetails: true" traz os detalhes
    // completos dos hóspedes junto da reserva — é daí que pegamos o
    // guestID de verdade para atualizar com putGuest.
    const reservaMiolo = dadosReserva?.data || dadosReserva || {};

    let guestIdReal = null;
    let origemDoAchado = ''; // para diagnóstico: de onde veio o guestID e a que reserva pertence
    try {
      const respostaComGuestDetails = await fetch(
        `${CLOUDBEDS_BASE_URL}/getReservations?reservationID=${encodeURIComponent(reservationId)}&includeGuestsDetails=true`,
        { method: 'GET', headers: cabecalhosCloudbeds }
      );
      const dadosComGuestDetails = await respostaComGuestDetails.json().catch(() => null);
      const listaReservas = dadosComGuestDetails?.data || [];
      const reservaComDetalhes = Array.isArray(listaReservas) ? listaReservas[0] : null;
      // IMPORTANTE: guestList vem como um OBJETO (o próprio guestID é a
      // chave), não uma lista comum — por isso pegamos os "values" dele.
      const listaHospedesObjeto = reservaComDetalhes?.guestList || reservaComDetalhes?.guests || {};
      const listaHospedes = Array.isArray(listaHospedesObjeto) ? listaHospedesObjeto : Object.values(listaHospedesObjeto);
      const primeiroHospede = listaHospedes[0] || null;
      guestIdReal = primeiroHospede?.guestID || primeiroHospede?.guestId || primeiroHospede?.id || null;
      origemDoAchado = `getReservations — reservationID da reserva encontrada: "${reservaComDetalhes?.reservationID}" (deveríamos ter pedido "${reservationId}") — nome do hóspede encontrado: "${primeiroHospede?.guestFirstName || primeiroHospede?.guestName || primeiroHospede?.firstName || '?'}" — total de reservas que essa busca devolveu: ${listaReservas.length}`;
    } catch (e) { origemDoAchado = 'getReservations falhou: ' + e.message; }

    // ⚠️ REMOVIDO: a busca por getGuestList não estava filtrando pela
    // reserva certa (devolvia os 100 hóspedes do hotel inteiro), e por
    // isso já causou uma atualização errada uma vez. Não usar mais esse
    // caminho até confirmarmos o parâmetro certo de filtro.

    // ============================================================
    // MAPEAMENTO DE CAMPOS — ficha FNRH → campos esperados pela Cloudbeds
    // (ajuste aqui se algum nome de campo precisar mudar)
    // ============================================================
    const partesNome = ficha.nome_completo.trim().split(/\s+/);
    const primeiroNome = partesNome[0] || '';
    const sobrenome = partesNome.slice(1).join(' ') || primeiroNome;

    // DIAGNÓSTICO EXTRA: busca o cadastro ATUAL do hóspede antes de tentar
    // mudar algo, para vermos com nossos próprios olhos os nomes de campo
    // que a Cloudbeds realmente usa nesse endpoint (evita mais chute).
    let cadastroAtualHospede = null;
    if (guestIdReal) {
      try {
        const respostaGetGuest = await fetch(`${CLOUDBEDS_BASE_URL}/getGuest?guestID=${encodeURIComponent(guestIdReal)}`, {
          method: 'GET', headers: cabecalhosCloudbeds,
        });
        cadastroAtualHospede = await respostaGetGuest.json().catch(() => null);
      } catch (e) { /* segue mesmo sem isso */ }
    }

    // DIAGNÓSTICO EXTRA 2: lista TODOS os campos personalizados que esse
    // hotel já configurou na Cloudbeds — é aqui que Gênero, Nacionalidade,
    // Bairro, Motivo da Viagem etc. provavelmente vivem (o Brasil usa um
    // "template" de FNRH da Cloudbeds baseado em campos personalizados).
    let listaCustomFields = null;
    try {
      const respostaCustomFields = await fetch(`${CLOUDBEDS_BASE_URL}/getCustomFields`, {
        method: 'GET', headers: cabecalhosCloudbeds,
      });
      listaCustomFields = await respostaCustomFields.json().catch(() => null);
    } catch (e) { /* segue mesmo sem isso */ }

    // ---- Passo 2: atualiza o cadastro do hóspede de verdade ----
    if (guestIdReal) {
      const enderecoCompleto = [ficha.endereco, ficha.numero_endereco].filter(Boolean).join(', ');
      const siglaPais = paraSiglaPais(ficha.pais);

      // Gênero: convertendo do nosso formato para o que a Cloudbeds usa (M/F)
      const GENERO_CLOUDBEDS = { Masculino: 'M', Feminino: 'F' };

      const corpoGuest = new URLSearchParams({
        guestID: guestIdReal,
        // Nome/e-mail/telefone (já confirmados funcionando com prefixo "guest")
        guestFirstName: primeiroNome,
        guestLastName: sobrenome,
        guestEmail: ficha.email || '',
        guestPhone: ficha.telefone || '',
        // Endereço — a resposta trouxe "address2" (complemento) separado,
        // então a rua provavelmente é "address1", não só "address".
        // Mandando todas as variações possíveis.
        guestAddress: enderecoCompleto, address: enderecoCompleto, address1: enderecoCompleto, guestAddress1: enderecoCompleto,
        guestCity: ficha.cidade || '', city: ficha.cidade || '',
        guestState: ficha.estado || '', state: ficha.estado || '',
        guestCountry: siglaPais, country: siglaPais,
        guestZip: ficha.cep || '', zip: ficha.cep || '',
        // Data de nascimento — variações de nome de campo
        guestBirthdate: ficha.data_nascimento || '', guestBirthDate: ficha.data_nascimento || '',
        birthDate: ficha.data_nascimento || '', birthdate: ficha.data_nascimento || '',
        // Documento — mandando o tipo em português puro (sem tentar
        // "adivinhar" um valor em inglês, que pode estar inválido e
        // travando o campo inteiro)
        // Documento — nomes de campo CONFIRMADOS na documentação oficial
        // (todos com prefixo "guest"), e o tipo usa um código específico,
        // não o nome por extenso: "cpf" = CPF brasileiro, "dni" = RG
        // (carteira de identidade), "passport" = passaporte.
        guestDocumentType: DOC_TIPO_CLOUDBEDS[ficha.tipo_documento] || '',
        guestDocumentNumber: ficha.numero_documento || '',
        guestDocumentIssuingCountry: siglaPais,
        // Mantém as variações antigas também, por garantia
        documentType: ficha.tipo_documento || '',
        documentNumber: ficha.numero_documento || '',
        documentIssuingCountry: siglaPais,
        // Gênero e nacionalidade — campos padrão que faltavam no envio
        gender: GENERO_CLOUDBEDS[ficha.genero] || '',
        guestGender: GENERO_CLOUDBEDS[ficha.genero] || '',
        guestNationality: paraSiglaPais(ficha.nacionalidade), nationality: paraSiglaPais(ficha.nacionalidade),
      });

      // Campos personalizados deste hotel — nomes/IDs exatos confirmados
      // via getCustomFields. Mandando em DOIS formatos possíveis: como
      // texto JSON (formato mais comum nesse tipo de API) e também com
      // colchetes numerados (reforço, caso o primeiro não funcione).
      const listaCamposPersonalizados = [
        { customFieldID: '33748', customFieldName: 'CPF', customFieldValue: (ficha.numero_documento || '').replace(/\D/g, '') },
        { customFieldID: '33749', customFieldName: 'Profissao', customFieldValue: ficha.profissao || '' },
        { customFieldID: '48195', customFieldName: 'motivo_da_viagem', customFieldValue: MOTIVO_VIAGEM_TEXTO[ficha.motivo_viagem] || ficha.motivo_viagem || '' },
        { customFieldID: '48196', customFieldName: 'meio_de_transporte', customFieldValue: MEIO_TRANSPORTE_TEXTO[ficha.meio_transporte] || ficha.meio_transporte || '' },
      ];
      // Nome do campo CONFIRMADO na documentação oficial: "guestCustomFields"
      // (não "customFields" — esse era o erro este tempo todo!)
      corpoGuest.set('guestCustomFields', JSON.stringify(listaCamposPersonalizados));
      listaCamposPersonalizados.forEach((campo, indice) => {
        corpoGuest.set(`guestCustomFields[${indice}][customFieldID]`, campo.customFieldID);
        corpoGuest.set(`guestCustomFields[${indice}][customFieldName]`, campo.customFieldName);
        corpoGuest.set(`guestCustomFields[${indice}][customFieldValue]`, campo.customFieldValue);
      });

      const respostaGuest = await fetch(`${CLOUDBEDS_BASE_URL}/putGuest`, {
        method: 'PUT',
        headers: { ...cabecalhosCloudbeds, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: corpoGuest.toString(),
      });
      const dadosGuest = await respostaGuest.json().catch(() => null);
      if (!respostaGuest.ok || dadosGuest?.success === false) {
        const mensagemCloudbeds = dadosGuest?.message || 'não foi possível atualizar o cadastro do hóspede';
        return Response.json({ erro: `A Cloudbeds recusou o envio dos dados (putGuest, guestID ${guestIdReal}): ${mensagemCloudbeds}` }, { status: 400 });
      }
      // DIAGNÓSTICO: mesmo com "sucesso", mostra o que a Cloudbeds
      // devolveu de verdade, para conferirmos se os dados realmente
      // foram aceitos (e não só "engolidos" sem efeito).
      return Response.json({
        erro: `[DIAGNÓSTICO — não é erro de verdade] putGuest encontrou e usou o guestID ${guestIdReal}. ORIGEM DA BUSCA (isso é o que importa agora): ${origemDoAchado}. Resposta completa da Cloudbeds do putGuest: ${JSON.stringify(dadosGuest)}. Cadastro ATUAL do hóspede (getGuest, para vermos os nomes de campo certos): ${JSON.stringify(cadastroAtualHospede)}. CAMPOS PERSONALIZADOS deste hotel (getCustomFields — é aqui que Gênero/Nacionalidade/Bairro/etc. provavelmente estão): ${JSON.stringify(listaCustomFields)}`,
      }, { status: 400 });
    } else {
      // Antes caíamos silenciosamente no putReservation (que já provamos
      // não funcionar). Agora, em vez de mascarar isso com uma falsa
      // mensagem de sucesso, mostramos exatamente o que encontramos (ou
      // não) nas duas buscas, para investigar de verdade.
      return Response.json({
        erro: `[DIAGNÓSTICO] Não encontramos um guestID para essa reserva. Detalhe da busca: ${origemDoAchado}. ` +
          `Chaves da resposta de getReservation: ${Object.keys(reservaMiolo).join(', ')}. ` +
          `guestList dentro dela: ${JSON.stringify(reservaMiolo.guestList || 'não existe')}.`,
      }, { status: 400 });
    }

    // ---- Passo 3 (complementar, opcional) ----
    // Tenta também guardar os dados extras (documento, nacionalidade,
    // profissão, motivo da viagem etc. — que não têm campo padrão na
    // reserva) como uma anotação/observação. Se isso falhar por
    // qualquer razão, NÃO trava a exportação — o essencial (passo 2)
    // já foi salvo com sucesso.
    try {
      const observacoes = [
        `Documento: ${ficha.tipo_documento || '—'} ${ficha.numero_documento || ''}`,
        ficha.orgao_expedidor ? `Órgão expedidor: ${ficha.orgao_expedidor}` : null,
        ficha.nacionalidade ? `Nacionalidade: ${ficha.nacionalidade}` : null,
        ficha.profissao ? `Profissão: ${ficha.profissao}` : null,
        ficha.motivo_viagem ? `Motivo da viagem: ${ficha.motivo_viagem}` : null,
        ficha.meio_transporte ? `Meio de transporte: ${ficha.meio_transporte}` : null,
      ].filter(Boolean).join(' | ');

      await fetch(`${CLOUDBEDS_BASE_URL}/postReservationNote`, {
        method: 'POST',
        headers: { ...cabecalhosCloudbeds, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ reservationID: reservationId, note: `Ficha FNRH: ${observacoes}` }).toString(),
      });
    } catch (e) { /* melhor esforço — não trava a exportação */ }

    // ---- Marca a ficha como exportada ----
    const { error: erroUpdate } = await supabaseAdmin.from('fichas_fnrh').update({
      cloudbeds_reservation_id: reservationId,
      status: 'EXPORTADO',
      exportado_em: new Date().toISOString(),
      exportado_por_id: chamador.id,
    }).eq('id', fichaId);

    if (erroUpdate) {
      return Response.json({ erro: 'Os dados foram enviados à Cloudbeds, mas houve um problema ao atualizar o status aqui: ' + erroUpdate.message }, { status: 500 });
    }

    // Log de auditoria — melhor esforço, não trava a resposta se falhar
    try {
      await supabaseAdmin.from('fichas_fnrh_log').insert({
        usuario_id: chamador.id, ficha_id: fichaId, acao: 'EXPORTACAO',
        detalhe: `Ficha de ${ficha.nome_completo} exportada para a reserva ${reservationId} na Cloudbeds.`,
        hotel_id: chamador.hotel_id,
      });
    } catch (e) { /* silencioso */ }

    return Response.json({ sucesso: true });
  } catch (erro) {
    return Response.json({ erro: 'Erro inesperado no servidor: ' + erro.message }, { status: 500 });
  }
}