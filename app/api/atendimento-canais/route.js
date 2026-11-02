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
//     salvar_site        { canalId?, titulo, saudacao, cor, dominios, pedirContato }  (chat do site)
//     meta_paginas       { token }                  → Páginas do Facebook e o Instagram ligado a cada uma
//     conectar_meta      { token, pageId, tipo }    (tipo FACEBOOK ou INSTAGRAM)
//     meta_webhooks      { }                        → assina os webhooks "page" e "instagram" no app
//     salvar_telegram    { canalId?, nome, token }  (robô do Telegram: confere e liga o webhook)
//     conferir_saida     { }                        → "Pronto para desligar o Asksuite?"
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
import { PADRAO_CHAT, listaDominios } from '../../../lib/atendimento/chatSite';
import {
  listarPaginas, inscreverPagina, assinarWebhooksDoApp, informacoesCanal,
} from '../../../lib/atendimento/metaMensagens';
import {
  tokenParece, dadosDoRobo, novaSenhaWebhook, ligarWebhook, desligarWebhook, situacaoWebhook, tokenDoTelegram,
} from '../../../lib/atendimento/telegram';
import { conferirSaidaAsksuite } from '../../../lib/atendimento/prontoDesligar';

const CHAVE_TOKEN = { WHATSAPP: 'whatsapp_token', EMAIL: 'gmail_refresh', INSTAGRAM: 'meta_page_token', FACEBOOK: 'meta_page_token', TELEGRAM: 'telegram_token' };

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
      enderecos: {
        webhookMeta: `${origem}/api/meta-webhook`, retornoGoogle: `${origem}/api/gmail-retorno`, origem,
        // Chat do site: o código que vai no site e a página de teste
        codigoChat: `<script src="${origem}/chat-site.js" data-hotel="${chamador.hotel_id}" defer></script>`,
        testeChat: `${origem}/chat-site/teste?hotel=${chamador.hotel_id}`,
      },
      canais: (canais || []).map((c) => ({
        ...c,
        tokenSalvo: CHAVE_TOKEN[c.tipo] ? tem(CHAVE_TOKEN[c.tipo], c.id) : false,
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

      // ------------------------------------------------------------ CHAT DO SITE
      case 'salvar_site': {
        const dominios = listaDominios(corpo.dominios);
        const cor = /^#[0-9a-fA-F]{6}$/.test(texto(corpo.cor, 7)) ? texto(corpo.cor, 7) : PADRAO_CHAT.cor;
        const config = {
          titulo: texto(corpo.titulo, 60) || null,
          saudacao: texto(corpo.saudacao, 300) || PADRAO_CHAT.saudacao,
          cor, dominios, pedirContato: corpo.pedirContato !== false,
        };
        const existente = corpo.canalId ? await carregarCanal(corpo.canalId) : null;
        if (existente && existente.tipo !== 'SITE') return respostaErro('Canal não encontrado.');
        const registro = {
          nome: texto(corpo.nome, 80) || 'Chat do site', endereco_exibicao: dominios[0] || null,
          config: { ...(existente?.config || {}), ...config }, atualizado_em: new Date().toISOString(),
        };
        let canal;
        if (existente) {
          const { data, error } = await supabaseAdmin.from('atendimento_canais').update(registro).eq('id', existente.id).select().single();
          if (error) throw error;
          canal = data;
        } else {
          const { data, error } = await supabaseAdmin.from('atendimento_canais').insert({
            ...registro, hotel_id: hotelId, tipo: 'SITE', identificador: `site-${hotelId}`, status: 'OK', criado_por_id: chamador.id,
          }).select().single();
          if (error) {
            if (/duplicate|unique/i.test(error.message)) return respostaErro('Este hotel já tem o chat do site. Use “Editar”.');
            if (/tipo_check|check constraint/i.test(error.message)) return respostaErro('Falta rodar no Supabase o SQL da Fase 1B (sql/caixa_de_entrada_fase1b.sql).');
            throw error;
          }
          canal = data;
        }
        return Response.json({
          sucesso: true, canal,
          aviso: dominios.length ? null : 'Salvo. Falta informar o endereço do site: sem ele, o chat só funciona na página de teste.',
        });
      }

      // ------------------------------------------------------------ INSTAGRAM E FACEBOOK
      case 'meta_paginas': {
        const token = texto(corpo.token, 1000);
        if (!token) return respostaErro('Cole o token de acesso (do usuário do sistema da Meta).');
        const paginas = await listarPaginas(token);
        const { data: jaLigados } = await supabaseAdmin.from('atendimento_canais').select('id, tipo, identificador')
          .eq('hotel_id', hotelId).in('tipo', ['FACEBOOK', 'INSTAGRAM']);
        const ligado = (tipo, id) => (jaLigados || []).find((c) => c.tipo === tipo && c.identificador === String(id))?.id || null;
        // A chave de cada Página não volta para a tela
        return Response.json({
          paginas: paginas.map((p) => ({
            id: p.id, nome: p.nome, temChave: !!p.token, canalFacebook: ligado('FACEBOOK', p.id),
            instagram: p.instagram ? { ...p.instagram, canal: ligado('INSTAGRAM', p.instagram.id) } : null,
          })),
        });
      }

      case 'conectar_meta': {
        const tipo = corpo.tipo === 'INSTAGRAM' ? 'INSTAGRAM' : 'FACEBOOK';
        const token = texto(corpo.token, 1000);
        const pageId = texto(corpo.pageId, 40).replace(/\D/g, '');
        if (!token || !pageId) return respostaErro('Cole o token e escolha a Página.');
        const pagina = (await listarPaginas(token)).find((p) => p.id === pageId);
        if (!pagina) return respostaErro('Este token não dá acesso a essa Página.');
        if (!pagina.token) return respostaErro('A Meta não entregou a chave desta Página. Confira se o usuário do sistema tem a Página como ativo, com permissão total.');
        if (tipo === 'INSTAGRAM' && !pagina.instagram) return respostaErro('Esta Página não tem conta do Instagram ligada. Ligue o Instagram profissional à Página (Configurações da Página → Contas vinculadas).');
        let avisoInscricao = null;
        try { await inscreverPagina(pagina.token, pagina.id); }
        catch (e) { avisoInscricao = `Conectado, mas a Página não foi ligada ao app: ${e.message}`; }
        const identificador = tipo === 'INSTAGRAM' ? pagina.instagram.id : pagina.id;
        const registro = {
          hotel_id: hotelId, tipo, identificador,
          nome: texto(corpo.nome, 80) || (tipo === 'INSTAGRAM' ? `Instagram${pagina.instagram.usuario ? ` @${pagina.instagram.usuario}` : ''}` : `Facebook · ${pagina.nome}`),
          endereco_exibicao: tipo === 'INSTAGRAM' ? (pagina.instagram.usuario ? `@${pagina.instagram.usuario}` : pagina.instagram.nome) : pagina.nome,
          config: { pageId: pagina.id, pagina: pagina.nome, ...(tipo === 'INSTAGRAM' ? { usuario: pagina.instagram.usuario || null } : {}) },
          status: avisoInscricao ? 'ERRO' : 'OK', erro: avisoInscricao, ativo: true, atualizado_em: new Date().toISOString(),
        };
        const { data: existente } = await supabaseAdmin.from('atendimento_canais').select('*')
          .eq('tipo', tipo).eq('identificador', identificador).maybeSingle();
        if (existente && Number(existente.hotel_id) !== Number(hotelId)) return respostaErro('Esta conta já está conectada em outro hotel do sistema.');
        let canal;
        if (existente) {
          const { data, error } = await supabaseAdmin.from('atendimento_canais').update({ ...registro, config: { ...(existente.config || {}), ...registro.config } }).eq('id', existente.id).select().single();
          if (error) throw error;
          canal = data;
        } else {
          const { data, error } = await supabaseAdmin.from('atendimento_canais').insert({ ...registro, criado_por_id: chamador.id }).select().single();
          if (error) throw error;
          canal = data;
        }
        await gravarSegredo(supabaseAdmin, hotelId, 'meta_page_token', pagina.token, canal.id);
        return Response.json({ sucesso: true, canal, aviso: avisoInscricao });
      }

      case 'meta_webhooks': {
        const { data: config } = await supabaseAdmin.from('atendimento_config').select('meta_app_id, meta_verify_token').eq('hotel_id', hotelId).maybeSingle();
        const appSecret = await lerSegredo(supabaseAdmin, hotelId, 'meta_app_secret');
        if (!config?.meta_app_id || !appSecret || !config?.meta_verify_token) {
          return respostaErro('Para assinar sozinho, salve antes o app da Meta com o ID do app e a chave secreta (seção WhatsApp → 1. App da Meta).');
        }
        await assinarWebhooksDoApp({ appId: config.meta_app_id, appSecret, url: `${origemDoSite(request)}/api/meta-webhook`, tokenVerificacao: config.meta_verify_token });
        return Response.json({ sucesso: true });
      }

      // ------------------------------------------------------------ TELEGRAM
      case 'salvar_telegram': {
        const existente = corpo.canalId ? await carregarCanal(corpo.canalId) : null;
        if (existente && existente.tipo !== 'TELEGRAM') return respostaErro('Canal não encontrado.');
        const tokenNovo = texto(corpo.token, 120);
        if (tokenNovo && !tokenParece(tokenNovo)) return respostaErro('Esse não parece um token do Telegram. Ele tem o formato 1234567890:AAH… e vem do @BotFather.');
        const token = tokenNovo || (existente ? await tokenDoTelegram(supabaseAdmin, existente) : '');
        if (!token) return respostaErro('Cole o token que o @BotFather entregou.');
        const bot = await dadosDoRobo(token);
        const identificador = String(bot.id);
        const { data: outro } = await supabaseAdmin.from('atendimento_canais').select('id, hotel_id').eq('tipo', 'TELEGRAM').eq('identificador', identificador).maybeSingle();
        if (outro && (!existente || outro.id !== existente.id)) return respostaErro('Este robô do Telegram já está conectado no sistema.');
        const registro = {
          nome: texto(corpo.nome, 80) || `Telegram @${bot.username}`, identificador, endereco_exibicao: `@${bot.username}`,
          config: { ...(existente?.config || {}), usuario: bot.username, link: `https://t.me/${bot.username}`, nomeRobo: bot.first_name || null },
          atualizado_em: new Date().toISOString(),
        };
        let canal;
        if (existente) {
          const { data, error } = await supabaseAdmin.from('atendimento_canais').update(registro).eq('id', existente.id).select().single();
          if (error) throw error;
          canal = data;
        } else {
          const { data, error } = await supabaseAdmin.from('atendimento_canais')
            .insert({ ...registro, hotel_id: hotelId, tipo: 'TELEGRAM', status: 'OK', criado_por_id: chamador.id }).select().single();
          if (error) {
            if (/tipo_check|check constraint/i.test(error.message)) return respostaErro('Falta rodar no Supabase o SQL dos canais novos (sql/canais_instagram_facebook_telegram.sql).');
            throw error;
          }
          canal = data;
        }
        if (tokenNovo) await gravarSegredo(supabaseAdmin, hotelId, 'telegram_token', tokenNovo, canal.id);
        const senha = novaSenhaWebhook();
        await gravarSegredo(supabaseAdmin, hotelId, 'telegram_senha_webhook', senha, canal.id);
        let aviso = null;
        try { await ligarWebhook(token, `${origemDoSite(request)}/api/telegram-webhook?canal=${canal.id}`, senha); }
        catch (e) { aviso = `O robô foi salvo, mas o Telegram não aceitou o endereço do sistema: ${e.message}`; }
        await supabaseAdmin.from('atendimento_canais').update({ status: aviso ? 'ERRO' : 'OK', erro: aviso }).eq('id', canal.id);
        return Response.json({ sucesso: true, canal, aviso });
      }

      // ------------------------------------------------------------ DESLIGAR O ASKSUITE
      case 'conferir_saida': {
        return Response.json(await conferirSaidaAsksuite(supabaseAdmin, hotelId));
      }

      // ------------------------------------------------------------ GERAIS
      case 'testar': {
        const canal = await carregarCanal(corpo.canalId);
        let detalhe;
        try {
          if (canal.tipo === 'SITE') {
            const n = (canal.config?.dominios || []).length;
            if (!n) throw new Error('Falta informar o endereço do site em “Editar”. Sem ele, o chat só funciona na página de teste.');
            detalhe = `Chat ${canal.ativo ? 'ligado' : 'desligado'} · liberado para ${canal.config.dominios.join(', ')}. Para ver como fica, use “Testar o chat”.`;
          } else if (canal.tipo === 'INSTAGRAM' || canal.tipo === 'FACEBOOK') {
            const info = await informacoesCanal(supabaseAdmin, canal);
            detalhe = canal.tipo === 'INSTAGRAM'
              ? `Instagram ${info.username ? `@${info.username}` : info.name || ''} conectado (Página ${canal.config?.pagina || ''}).`
              : `Página ${info.name || canal.endereco_exibicao} conectada ao Messenger.`;
          } else if (canal.tipo === 'TELEGRAM') {
            const token = await tokenDoTelegram(supabaseAdmin, canal);
            const info = await situacaoWebhook(token);
            if (!info.url) throw new Error('O robô está sem o endereço do sistema. Use “Editar” e “Salvar” para ligar de novo.');
            if (info.last_error_message && info.last_error_date && Date.now() / 1000 - info.last_error_date < 3600) {
              throw new Error(`O Telegram teve problema para entregar mensagens: ${info.last_error_message}`);
            }
            detalhe = `Robô ${canal.endereco_exibicao} ligado. Mensagens esperando entrega: ${info.pending_update_count || 0}.`;
          } else if (canal.tipo === 'WHATSAPP') {
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
        if (canal.tipo === 'TELEGRAM') {
          try { await desligarWebhook(await tokenDoTelegram(supabaseAdmin, canal)); } catch (e) { /* segue */ }
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
