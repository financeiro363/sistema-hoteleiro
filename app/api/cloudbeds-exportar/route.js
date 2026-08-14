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

// A Cloudbeds exige o país como sigla de 2 letras (ISO 3166-1 alpha-2),
// não o nome por extenso — por isso convertemos aqui. Cobre os nomes
// mais comuns que aparecem na ficha; se não reconhecer, cai em "BR"
// (a grande maioria dos hóspedes é do Brasil).
const PAIS_PARA_SIGLA = {
  'brasil': 'BR', 'brazil': 'BR',
  'estados unidos': 'US', 'eua': 'US', 'usa': 'US', 'united states': 'US',
  'portugal': 'PT', 'argentina': 'AR', 'chile': 'CL', 'uruguai': 'UY', 'uruguay': 'UY',
  'paraguai': 'PY', 'paraguay': 'PY', 'bolivia': 'BO', 'bolívia': 'BO',
  'colombia': 'CO', 'colômbia': 'CO', 'peru': 'PE', 'equador': 'EC', 'ecuador': 'EC',
  'venezuela': 'VE', 'mexico': 'MX', 'méxico': 'MX', 'canada': 'CA', 'canadá': 'CA',
  'espanha': 'ES', 'spain': 'ES', 'franca': 'FR', 'frança': 'FR', 'france': 'FR',
  'italia': 'IT', 'itália': 'IT', 'italy': 'IT', 'alemanha': 'DE', 'germany': 'DE',
  'reino unido': 'GB', 'inglaterra': 'GB', 'united kingdom': 'GB',
  'japao': 'JP', 'japão': 'JP', 'japan': 'JP', 'china': 'CN',
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
    // através de uma consulta separada (getGuestList, filtrando pela
    // reserva), para atualizar ele diretamente.
    const reservaMiolo = dadosReserva?.data || dadosReserva || {};

    let guestIdReal = null;
    try {
      const respostaListaHospedes = await fetch(
        `${CLOUDBEDS_BASE_URL}/getGuestList?reservationID=${encodeURIComponent(reservationId)}`,
        { method: 'GET', headers: cabecalhosCloudbeds }
      );
      const dadosListaHospedes = await respostaListaHospedes.json().catch(() => null);
      const listaHospedes = dadosListaHospedes?.data || [];
      const primeiroHospede = Array.isArray(listaHospedes) ? listaHospedes[0] : null;
      guestIdReal = primeiroHospede?.guestID || primeiroHospede?.guestId || primeiroHospede?.id || null;
    } catch (e) { /* segue sem o ID — usa o plano B (putReservation) */ }

    // ============================================================
    // MAPEAMENTO DE CAMPOS — ficha FNRH → campos esperados pela Cloudbeds
    // (ajuste aqui se algum nome de campo precisar mudar)
    // ============================================================
    const partesNome = ficha.nome_completo.trim().split(/\s+/);
    const primeiroNome = partesNome[0] || '';
    const sobrenome = partesNome.slice(1).join(' ') || primeiroNome;

    // ---- Passo 2: atualiza o cadastro do hóspede de verdade ----
    if (guestIdReal) {
      const corpoGuest = new URLSearchParams({
        guestID: guestIdReal,
        guestFirstName: primeiroNome,
        guestLastName: sobrenome,
        guestEmail: ficha.email || '',
        guestPhone: ficha.telefone || '',
        guestAddress: [ficha.endereco, ficha.numero_endereco].filter(Boolean).join(', '),
        guestCity: ficha.cidade || '',
        guestState: ficha.estado || '',
        guestCountry: paraSiglaPais(ficha.pais),
        guestZip: ficha.cep || '',
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
    } else {
      // Plano B: não achamos um guestID através da busca — tenta pela
      // própria reserva mesmo (pode não refletir no cadastro do hóspede,
      // mas ao menos não deixa a exportação travada).
      const corpoReserva = new URLSearchParams({
        reservationID: reservationId,
        status: reservaMiolo.status || 'confirmed',
        guestFirstName: primeiroNome,
        guestLastName: sobrenome,
        guestEmail: ficha.email || '',
        guestPhone: ficha.telefone || '',
        guestAddress: [ficha.endereco, ficha.numero_endereco].filter(Boolean).join(', '),
        guestCity: ficha.cidade || '',
        guestState: ficha.estado || '',
        guestCountry: paraSiglaPais(ficha.pais),
        guestZip: ficha.cep || '',
      });
      const respostaReservaAtualizada = await fetch(`${CLOUDBEDS_BASE_URL}/putReservation`, {
        method: 'PUT',
        headers: { ...cabecalhosCloudbeds, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: corpoReserva.toString(),
      });
      const dadosReservaAtualizada = await respostaReservaAtualizada.json().catch(() => null);
      if (!respostaReservaAtualizada.ok || dadosReservaAtualizada?.success === false) {
        const mensagemCloudbeds = dadosReservaAtualizada?.message || 'não foi possível atualizar a reserva';
        return Response.json({
          erro: `A Cloudbeds recusou o envio dos dados (putReservation, sem guestID encontrado): ${mensagemCloudbeds} (chaves disponíveis na resposta original: ${Object.keys(reservaMiolo).join(', ')})`,
        }, { status: 400 });
      }
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