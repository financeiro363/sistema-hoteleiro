// ============================================================================
// ROTA DE SERVIDOR: /api/cloudbeds-exportar
// ============================================================================
// Pega uma ficha FNRH já preenchida + o número da reserva na Cloudbeds
// (informado pelo operador do hotel) e envia os dados do hóspede para a
// Cloudbeds. Só ADMIN pode chamar.
//
// ⚠️ SOBRE OS NOMES DOS CAMPOS DA CLOUDBEDS: usei os nomes de campo mais
// comuns e documentados publicamente pela Cloudbeds para o endpoint
// postGuest (ex.: guestFirstName, guestLastName, guestEmail...). Como a
// documentação completa e detalhada de cada campo só é visível depois de
// login na conta Cloudbeds do hotel, é possível que algum nome precise de
// pequeno ajuste depois do primeiro teste real. Esses nomes estão todos
// juntos, comentados, na seção "MAPEAMENTO DE CAMPOS" abaixo — fácil de
// ajustar se algum campo não for reconhecido pela Cloudbeds na prática.
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import { descriptografar } from '../../../lib/cloudbedsCrypto';

const CLOUDBEDS_BASE_URL = 'https://api.cloudbeds.com/api/v1.2';

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
    if (erroChamador || !chamador || chamador.papel !== 'ADMIN') {
      return Response.json({ erro: 'Só administradores podem exportar para a Cloudbeds.' }, { status: 403 });
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

    // ============================================================
    // MAPEAMENTO DE CAMPOS — ficha FNRH → campos esperados pela Cloudbeds
    // (ajuste aqui se algum nome de campo precisar mudar)
    // ============================================================
    const partesNome = ficha.nome_completo.trim().split(/\s+/);
    const primeiroNome = partesNome[0] || '';
    const sobrenome = partesNome.slice(1).join(' ') || primeiroNome;

    const corpoGuest = new URLSearchParams({
      reservationID: reservationId,
      guestFirstName: primeiroNome,
      guestLastName: sobrenome,
      guestEmail: ficha.email || '',
      guestPhone: ficha.telefone || '',
      guestAddress: [ficha.endereco, ficha.numero_endereco].filter(Boolean).join(', '),
      guestCity: ficha.cidade || '',
      guestState: ficha.estado || '',
      guestCountry: ficha.pais || '',
      guestZip: ficha.cep || '',
      // Campos sem equivalente padrão direto na Cloudbeds (documento,
      // nacionalidade, profissão, motivo da viagem etc.) vão como
      // observação, para não se perder — ajuste para um campo
      // personalizado da Cloudbeds se o hotel tiver um configurado.
      guestNotes: [
        `Documento: ${ficha.tipo_documento || '—'} ${ficha.numero_documento || ''}`,
        ficha.orgao_expedidor ? `Órgão expedidor: ${ficha.orgao_expedidor}` : null,
        ficha.nacionalidade ? `Nacionalidade: ${ficha.nacionalidade}` : null,
        ficha.profissao ? `Profissão: ${ficha.profissao}` : null,
        ficha.motivo_viagem ? `Motivo da viagem: ${ficha.motivo_viagem}` : null,
        ficha.meio_transporte ? `Meio de transporte: ${ficha.meio_transporte}` : null,
      ].filter(Boolean).join(' | '),
    });

    // ---- Passo 2: envia os dados do hóspede ----
    const respostaGuest = await fetch(`${CLOUDBEDS_BASE_URL}/postGuest`, {
      method: 'POST',
      headers: { ...cabecalhosCloudbeds, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: corpoGuest.toString(),
    });
    const dadosGuest = await respostaGuest.json().catch(() => null);

    if (!respostaGuest.ok || dadosGuest?.success === false) {
      const mensagemCloudbeds = dadosGuest?.message || 'não foi possível salvar os dados do hóspede';
      return Response.json({ erro: `A Cloudbeds recusou o envio dos dados: ${mensagemCloudbeds}` }, { status: 400 });
    }

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

    return Response.json({ sucesso: true });
  } catch (erro) {
    return Response.json({ erro: 'Erro inesperado no servidor: ' + erro.message }, { status: 500 });
  }
}
