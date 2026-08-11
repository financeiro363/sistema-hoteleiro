// ============================================================================
// ROTA DE SERVIDOR: /api/criar-hotel
// ============================================================================
// Só quem tem o "chapéu" de super_admin pode chamar esta rota. Ela cadastra
// um hotel novo E convida a primeira pessoa administradora dele por e-mail
// (mesmo mecanismo de /api/criar-usuario, mas para um hotel que ainda nem
// existe — por isso é uma rota separada).
// ============================================================================

import { createClient } from '@supabase/supabase-js';

export async function POST(request) {
  try {
    const corpo = await request.json();
    const nomeFantasia = (corpo?.nomeFantasia || '').trim();
    const razaoSocial = (corpo?.razaoSocial || '').trim();
    const documento = (corpo?.documento || '').trim();
    const cidade = (corpo?.cidade || '').trim();
    const endereco = (corpo?.endereco || '').trim();
    const nomeAdmin = (corpo?.nomeAdmin || '').trim();
    const emailAdmin = (corpo?.emailAdmin || '').trim();

    if (!nomeFantasia || !nomeAdmin || !emailAdmin) {
      return Response.json({ erro: 'Preencha ao menos o nome do hotel, o nome e o e-mail do administrador.' }, { status: 400 });
    }

    const tokenAcesso = (request.headers.get('authorization') || '').replace('Bearer ', '');
    if (!tokenAcesso) {
      return Response.json({ erro: 'Não autorizado — faça login novamente.' }, { status: 401 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const chaveAnonima = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const chaveMestra = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !chaveAnonima || !chaveMestra) {
      return Response.json({
        erro: 'O servidor não está configurado corretamente — falta a variável SUPABASE_SERVICE_ROLE_KEY no Netlify.',
      }, { status: 500 });
    }

    const supabaseComoChamador = createClient(supabaseUrl, chaveAnonima, {
      global: { headers: { Authorization: `Bearer ${tokenAcesso}` } },
    });

    const { data: dadosAuth, error: erroAuth } = await supabaseComoChamador.auth.getUser(tokenAcesso);
    if (erroAuth || !dadosAuth?.user) {
      return Response.json({ erro: 'Sessão inválida ou expirada. Saia e entre de novo.' }, { status: 401 });
    }

    const { data: chamador, error: erroChamador } = await supabaseComoChamador
      .from('usuarios')
      .select('super_admin')
      .eq('auth_id', dadosAuth.user.id)
      .single();

    if (erroChamador || !chamador || chamador.super_admin !== true) {
      return Response.json({ erro: 'Só administradores gerais podem cadastrar novos hotéis.' }, { status: 403 });
    }

    // A partir daqui, chave mestra — só no servidor
    const supabaseAdmin = createClient(supabaseUrl, chaveMestra);

    const { data: hotelCriado, error: erroHotel } = await supabaseAdmin
      .from('hoteis')
      .insert({
        nome_fantasia: nomeFantasia,
        razao_social: razaoSocial || null,
        documento: documento || null,
        cidade: cidade || null,
        endereco: endereco || null,
      })
      .select()
      .single();

    if (erroHotel) {
      return Response.json({ erro: 'Não foi possível cadastrar o hotel: ' + erroHotel.message }, { status: 400 });
    }

    const protocolo = request.headers.get('x-forwarded-proto') || 'https';
    const host = request.headers.get('host');
    const enderecoDoSite = `${protocolo}://${host}`;

    const { data: convite, error: erroConvite } = await supabaseAdmin.auth.admin.inviteUserByEmail(emailAdmin, {
      redirectTo: `${enderecoDoSite}/redefinir-senha`,
    });

    if (erroConvite) {
      const mensagem = /already registered|already exists/i.test(erroConvite.message)
        ? 'O hotel foi criado, mas já existe uma conta com este e-mail para o administrador.'
        : 'O hotel foi criado, mas não foi possível convidar o administrador: ' + erroConvite.message;
      return Response.json({ erro: mensagem, hotelCriadoId: hotelCriado.id }, { status: 400 });
    }

    const { error: erroInsertUsuario } = await supabaseAdmin.from('usuarios').insert({
      nome: nomeAdmin,
      email: emailAdmin,
      papel: 'ADMIN',
      hotel_id: hotelCriado.id,
      auth_id: convite.user.id,
      ativo: true,
    });

    if (erroInsertUsuario) {
      return Response.json({
        erro: 'O hotel e o convite foram criados, mas houve um problema ao salvar o cadastro do administrador: ' + erroInsertUsuario.message,
      }, { status: 500 });
    }

    return Response.json({ sucesso: true, hotel: hotelCriado });
  } catch (erro) {
    return Response.json({ erro: 'Erro inesperado no servidor: ' + erro.message }, { status: 500 });
  }
}
