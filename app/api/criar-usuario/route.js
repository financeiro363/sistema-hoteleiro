// ============================================================================
// ROTA DE SERVIDOR: /api/criar-usuario
// ============================================================================
// Esta é uma rota que roda no SERVIDOR (nunca no navegador da pessoa) — é o
// único lugar seguro para usar a "chave mestra" (service role) do Supabase,
// que consegue criar logins de verdade. Se essa chave fosse usada direto no
// navegador, qualquer pessoa poderia copiá-la e ter acesso total ao banco.
//
// Fluxo:
//  1. Confirma que quem está chamando é um ADMIN autenticado (usando o
//     token normal da pessoa, sem privilégio nenhum a mais).
//  2. Usa a chave mestra (só disponível aqui) para convidar a pessoa por
//     e-mail — o Supabase cria o login E manda um e-mail com um link para
//     a pessoa escolher a própria senha (reaproveita a tela
//     "Redefinir Senha" que já existe).
//  3. Salva o cadastro correspondente na tabela "usuarios".
// ============================================================================

import { createClient } from '@supabase/supabase-js';

export async function POST(request) {
  try {
    const corpo = await request.json();
    const nome = (corpo?.nome || '').trim();
    const email = (corpo?.email || '').trim();
    const papel = corpo?.papel || '';

    if (!nome || !email || !papel) {
      return Response.json({ erro: 'Preencha nome, e-mail e papel.' }, { status: 400 });
    }
    if (!['ADMIN', 'COLABORADOR', 'CONTADOR', 'MANUTENCAO', 'CAMAREIRA'].includes(papel)) {
      return Response.json({ erro: 'Papel inválido.' }, { status: 400 });
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
        erro: 'O servidor não está configurado corretamente — falta a variável SUPABASE_SERVICE_ROLE_KEY no Netlify. Veja o LEIA-ME.',
      }, { status: 500 });
    }

    // Cliente "comum" (sem privilégio extra), só para confirmar quem está chamando
    const supabaseComoChamador = createClient(supabaseUrl, chaveAnonima, {
      global: { headers: { Authorization: `Bearer ${tokenAcesso}` } },
    });

    const { data: dadosAuth, error: erroAuth } = await supabaseComoChamador.auth.getUser(tokenAcesso);
    if (erroAuth || !dadosAuth?.user) {
      return Response.json({ erro: 'Sessão inválida ou expirada. Saia e entre de novo.' }, { status: 401 });
    }

    const { data: chamador, error: erroChamador } = await supabaseComoChamador
      .from('usuarios')
      .select('papel, hotel_id')
      .eq('auth_id', dadosAuth.user.id)
      .single();

    if (erroChamador || !chamador || chamador.papel !== 'ADMIN') {
      return Response.json({ erro: 'Só administradores podem cadastrar novos usuários.' }, { status: 403 });
    }

    // A partir daqui, usamos a chave mestra — só neste servidor, nunca no navegador
    const supabaseAdmin = createClient(supabaseUrl, chaveMestra);

    const protocolo = request.headers.get('x-forwarded-proto') || 'https';
    const host = request.headers.get('host');
    const enderecoDoSite = `${protocolo}://${host}`;

    const { data: convite, error: erroConvite } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${enderecoDoSite}/redefinir-senha`,
    });

    if (erroConvite) {
      const mensagem = /already registered|already exists/i.test(erroConvite.message)
        ? 'Já existe uma conta com este e-mail.'
        : 'Não foi possível criar o login: ' + erroConvite.message;
      return Response.json({ erro: mensagem }, { status: 400 });
    }

    const { error: erroInsert } = await supabaseAdmin.from('usuarios').insert({
      nome,
      email,
      papel,
      hotel_id: chamador.hotel_id,
      auth_id: convite.user.id,
      ativo: true,
    });

    if (erroInsert) {
      return Response.json({
        erro: 'O login foi criado, mas houve um problema ao salvar o cadastro: ' + erroInsert.message,
      }, { status: 500 });
    }

    // Registra também o vínculo com este hotel — é o que permite, no
    // futuro, vincular essa mesma pessoa a outro hotel sem perder o acesso
    // a este aqui (ver /api/vincular-hotel-existente).
    await supabaseAdmin.from('vinculos_usuario_hotel')
      .upsert({ auth_id: convite.user.id, hotel_id: chamador.hotel_id, papel, ativo: true }, { onConflict: 'auth_id,hotel_id' });

    return Response.json({ sucesso: true });
  } catch (erro) {
    return Response.json({ erro: 'Erro inesperado no servidor: ' + erro.message }, { status: 500 });
  }
}
