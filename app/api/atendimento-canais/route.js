// ============================================================================
// ROTA DE SERVIDOR: /api/atendimento-canais   (SÓ ADMIN)
// ============================================================================
// Configuração da Caixa de Entrada (aba "Canais"):
//   GET  → situação dos canais, do Google e da Meta + endereços para copiar
//   POST → ações (campo "acao"):
//     salvar_google      { clientId, clientSecret }
//     salvar_meta        { appId, appSecret }       (gera o token de verificação)
//     novo_token_meta    { }                        (gera outro token de verificação)
//     salvar_whatsapp    { canalId?, nome, phoneNumberId, wabaId, token? }
//     registrar_numero   { canalId, pin }
//     conectar_gmail     { email? }                 → devolve o link do Google
//     testar             { canalId }
//     alterar            { canalId, nome?, ativo?, usarAssinatura? }
//     excluir            { canalId }
// Senhas e tokens ficam criptografados (atendimento_segredos) e nunca voltam
// para a tela.
// ============================================================================

import crypto from 'crypto';
import {
  autenticar, respostaErro, erroBanco, gravarSegredo, lerSegredo, apagarSegredos, assinarEstado, origemDoSite,
} from '../../../lib/atendimento/servidor';
import {
  informacoesNumero, inscreverAppNaConta, registrarNumero, tokenDoCanal, formatarNumero,
} from '../../../lib/atendimento/whatsapp';
import { credenciaisGoogle, urlAutorizacao, tokenDaCaixa, perfilDaCaixa } from '../../../lib/atendimento/gmail';

export const dynamic = 'force-dynamic';

const texto = (v, max = 200) => String(v ?? '').trim().slice(0, max);

export async function GET(request) {
  const auth = await autenticar(request, { soAdmin: true });
  if (auth.resposta) return auth.resposta;
  const { chamador, supabaseAdmin } = auth;
  try {
    const [{ data: config, error: e1 }, { data: canais, error: e2 }, { data: segredos }] = await Promise.all([
      supabaseAdmin.from('atendimento_config').select('*').eq('hotel_id', chamador.hotel_id).maybeSingle(),
      supabaseAdmin.from('atendimento_canais').select('*').eq('hotel_id', chamador.hotel_id).order('tipo').order('nome'),
      supabaseAdmin.from('atendimento_segredos').select('canal_id, chave').eq('hotel_id', chamador.hotel_id),
    ]);
    if (e1 || e2) return respostaErro(erroBanco(e1 || e2, 'Não foi possível carregar'));
    const tem = (chave, canalId = 0) => (segredos || []).some((s) => s.chave === chave && Number(s.canal_id) === Number(canalId));
    const origem = origemDoSite(request);
    return Response.json({
      config: {
        googleClientId: config?.google_client_id || '',
        metaAppId: config?.meta_app_id || '',
        metaVerifyToken: config?.meta_verify_token || '',
        googleSecretSalvo: tem('google_client_secret'),
        metaSecretSalvo: tem('meta_app_secret'),
      },
      enderecos: { webhookMeta: `${origem}/api/meta-webhook`, retornoGoogle: `${origem}/api/gmail-retorno`, origem },
      canais: (canais || []).map((c) => ({
        ...c,
        tokenSalvo: c.tipo === 'WHATSAPP' ? tem('whatsapp_token', c.id) : tem('gmail_refresh', c.id),
      })),
    });
  } catch (e) {
    return respostaErro(erroBanco(e, 'Não foi possível carregar'));
  }
}

export async function POST(request) {
  const auth = await autenticar(request, { soAdmin: true });
  if (auth.resposta) return auth.resposta;
  const { chamador, supabaseAdmin } = auth;
  let corpo;
  try { corpo = await request.json(); } catch (e) { return respostaErro('Pedido inválido.'); }
  const hotelId = chamador.hotel_id;

  const salvarConfig = async (campos) => {
    const { error } = await supabaseAdmin.from('atendimento_config').upsert({
      hotel_id: hotelId, ...campos, atualizado_por_id: chamador.id, atualizado_em: new Date().toISOString(),
    });
    if (error) throw error;
  };
  const carregarCanal = async (canalId) => {
    const { data } = await supabaseAdmin.from('atendimento_canais').select('*').eq('id', canalId).eq('hotel_id', hotelId).maybeSingle();
    if (!data) throw new Error('Canal não encontrado.');
    return data;
  };

  try {
    switch (corpo?.acao) {
      // ------------------------------------------------------------ GOOGLE
      case 'salvar_google': {
        const clientId = texto(corpo.clientId, 300);
        if (!/\.apps\.googleusercontent\.com$/.test(clientId)) {
          return respostaErro('O "ID do cliente" do Google termina com ".apps.googleusercontent.com". Confira o que foi copiado.');
        }
        await salvarConfig({ google_client_id: clientId });
        if (texto(corpo.clientSecret, 300)) await gravarSegredo(supabaseAdmin, hotelId, 'google_client_secret', texto(corpo.clientSecret, 300));
        if (!(await lerSegredo(supabaseAdmin, hotelId, 'google_client_secret'))) {
          return respostaErro('Falta a "Chave secreta do cliente" do Google.');
        }
        return Response.json({ sucesso: true });
      }

      case 'conectar_gmail': {
        const { clientId } = await credenciaisGoogle(supabaseAdmin, hotelId);
        const estado = assinarEstado({ h: hotelId, u: chamador.id });
        const url = urlAutorizacao({
          clientId, redirectUri: `${origemDoSite(request)}/api/gmail-retorno`, estado, email: texto(corpo.email, 200) || undefined,
        });
        return Response.json({ url });
      }

      // ------------------------------------------------------------ META
      case 'salvar_meta': {
        const { data: atual } = await supabaseAdmin.from('atendimento_config').select('meta_verify_token').eq('hotel_id', hotelId).maybeSingle();
        await salvarConfig({
          meta_app_id: texto(corpo.appId, 40) || null,
          meta_verify_token: atual?.meta_verify_token || `chokmah-${crypto.randomBytes(12).toString('hex')}`,
        });
        if (texto(corpo.appSecret, 200)) await gravarSegredo(supabaseAdmin, hotelId, 'meta_app_secret', texto(corpo.appSecret, 200));
        if (!(await lerSegredo(supabaseAdmin, hotelId, 'meta_app_secret'))) {
          return respostaErro('Falta a "Chave secreta do app" (App Secret) da Meta.');
        }
        return Response.json({ sucesso: true });
      }

      case 'novo_token_meta': {
        await salvarConfig({ meta_verify_token: `chokmah-${crypto.randomBytes(12).toString('hex')}` });
        return Response.json({ sucesso: true });
      }

      // ------------------------------------------------------------ WHATSAPP
      case 'salvar_whatsapp': {
        const phoneNumberId = texto(corpo.phoneNumberId, 40).replace(/\D/g, '');
        const wabaId = texto(corpo.wabaId, 40).replace(/\D/g, '');
        const nome = texto(corpo.nome, 80) || 'WhatsApp';
        if (!phoneNumberId || !wabaId) return respostaErro('Informe o "ID do número de telefone" e o "ID da conta do WhatsApp Business".');

        const existente = corpo.canalId ? await carregarCanal(corpo.canalId) : null;
        const token = texto(corpo.token, 1000) || (existente ? await tokenDoCanal(supabaseAdmin, existente) : '');
        if (!token) return respostaErro('Informe o token de acesso (token permanente do usuário do sistema).');

        const info = await informacoesNumero({ token, phoneNumberId });
        let avisoInscricao = null;
        try { await inscreverAppNaConta({ token, wabaId }); }
        catch (e) { avisoInscricao = `O número foi salvo, mas o app não foi inscrito na conta do WhatsApp: ${e.message}`; }

        const registro = {
          hotel_id: hotelId, tipo: 'WHATSAPP', nome, identificador: phoneNumberId,
          endereco_exibicao: info.display_phone_number ? formatarNumero(info.display_phone_number) : null,
          config: {
            ...(existente?.config || {}), wabaId, nomeVerificado: info.verified_name || null,
            qualidade: info.quality_rating || null, situacaoNumero: info.status || null,
          },
          status: avisoInscricao ? 'ERRO' : 'OK', erro: avisoInscricao, atualizado_em: new Date().toISOString(),
        };
        let canal;
        if (existente) {
          if (existente.identificador !== phoneNumberId) {
            return respostaErro('Para trocar o número, exclua este canal e cadastre um novo.');
          }
          const { data, error } = await supabaseAdmin.from('atendimento_canais').update(registro).eq('id', existente.id).select().single();
          if (error) throw error;
          canal = data;
        } else {
          const { data, error } = await supabaseAdmin.from('atendimento_canais')
            .insert({ ...registro, criado_por_id: chamador.id }).select().single();
          if (error) {
            if (/duplicate|unique/i.test(error.message)) return respostaErro('Este número de WhatsApp já está cadastrado no sistema.');
            throw error;
          }
          canal = data;
        }
        if (texto(corpo.token, 1000)) await gravarSegredo(supabaseAdmin, hotelId, 'whatsapp_token', texto(corpo.token, 1000), canal.id);
        return Response.json({ sucesso: true, canal, aviso: avisoInscricao });
      }

      case 'registrar_numero': {
        const canal = await carregarCanal(corpo.canalId);
        const pin = texto(corpo.pin, 6);
        if (!/^\d{6}$/.test(pin)) return respostaErro('O PIN tem 6 números (é a "confirmação em duas etapas" do número).');
        const token = await tokenDoCanal(supabaseAdmin, canal);
        await registrarNumero({ token, phoneNumberId: canal.identificador, pin });
        return Response.json({ sucesso: true });
      }

      // ------------------------------------------------------------ GERAIS
      case 'testar': {
        const canal = await carregarCanal(corpo.canalId);
        let detalhe;
        try {
          if (canal.tipo === 'WHATSAPP') {
            const token = await tokenDoCanal(supabaseAdmin, canal);
            const info = await informacoesNumero({ token, phoneNumberId: canal.identificador });
            detalhe = `Número ${formatarNumero(info.display_phone_number)} · ${info.verified_name || 'sem nome verificado'} · qualidade ${info.quality_rating || '—'}`;
          } else {
            const token = await tokenDaCaixa(supabaseAdmin, canal);
            const perfil = await perfilDaCaixa(token);
            detalhe = `Caixa ${perfil.emailAddress} conectada (${perfil.messagesTotal ?? '?'} mensagens no Gmail).`;
          }
        } catch (e) {
          await supabaseAdmin.from('atendimento_canais').update({ status: 'ERRO', erro: e.message }).eq('id', canal.id);
          return respostaErro(e.message);
        }
        await supabaseAdmin.from('atendimento_canais').update({ status: 'OK', erro: null }).eq('id', canal.id);
        return Response.json({ sucesso: true, detalhe });
      }

      case 'alterar': {
        const canal = await carregarCanal(corpo.canalId);
        const campos = { atualizado_em: new Date().toISOString() };
        if (corpo.nome !== undefined) campos.nome = texto(corpo.nome, 80) || canal.nome;
        if (corpo.ativo !== undefined) campos.ativo = !!corpo.ativo;
        if (corpo.usarAssinatura !== undefined) campos.config = { ...(canal.config || {}), usarAssinatura: !!corpo.usarAssinatura };
        const { error } = await supabaseAdmin.from('atendimento_canais').update(campos).eq('id', canal.id);
        if (error) throw error;
        return Response.json({ sucesso: true });
      }

      case 'excluir': {
        const canal = await carregarCanal(corpo.canalId);
        if (canal.tipo === 'EMAIL') {
          // Desfaz a autorização no Google (melhor esforço)
          const refresh = await lerSegredo(supabaseAdmin, hotelId, 'gmail_refresh', canal.id);
          if (refresh) {
            try { await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refresh)}`, { method: 'POST' }); } catch (e) { /* segue */ }
          }
        }
        await apagarSegredos(supabaseAdmin, hotelId, canal.id);
        const { error } = await supabaseAdmin.from('atendimento_canais').delete().eq('id', canal.id);
        if (error) throw error;
        return Response.json({ sucesso: true });
      }

      default:
        return respostaErro('Ação desconhecida.');
    }
  } catch (e) {
    return respostaErro(erroBanco(e, 'Não foi possível concluir'));
  }
}
