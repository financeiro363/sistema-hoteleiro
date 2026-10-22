'use client';

// ============================================================================
// CAIXA DE ENTRADA — funções e estilos compartilhados pelas telas
// ============================================================================

import { supabase } from '../../../lib/supabaseClient';

export const FUSO = 'America/Fortaleza';

export async function chamarApi(caminho, corpo, metodo = 'POST') {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  let resposta;
  try {
    resposta = await fetch(caminho, {
      method: metodo,
      headers: { ...(corpo ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${token}` },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
  } catch (e) {
    throw new Error('Falha de conexão com o servidor. Confira a internet e tente de novo.');
  }
  const json = await resposta.json().catch(() => ({}));
  if (!resposta.ok || json.erro) {
    const erro = new Error(json.erro || `Erro ${resposta.status}`);
    erro.dados = json;
    throw erro;
  }
  return json;
}

// Envia um arquivo direto para a pasta privada (sem passar pelo servidor)
export async function subirArquivo(arquivo) {
  const prep = await chamarApi('/api/atendimento', {
    acao: 'upload', nome: arquivo.name, mime: arquivo.type, tamanho: arquivo.size,
  });
  const { error } = await supabase.storage.from(prep.pasta)
    .uploadToSignedUrl(prep.caminho, prep.token, arquivo, { contentType: arquivo.type || 'application/octet-stream' });
  if (error) throw new Error(`Não foi possível enviar "${arquivo.name}": ${error.message}`);
  return { caminho: prep.caminho, nome: arquivo.name, mime: arquivo.type || 'application/octet-stream', tamanho: arquivo.size };
}

// Avisa o cabeçalho (número no menu) que algo mudou
export function avisarCabecalho() {
  try { window.dispatchEvent(new Event('atendimento-atualizado')); } catch (e) { /* nada */ }
}

// ---- Rótulos ---------------------------------------------------------------
export const STATUS_CONVERSA = {
  ABERTA: 'Aberta',
  PENDENTE: 'Aguardando cliente',
  RESOLVIDA: 'Resolvida',
};

export const ICONE_CANAL = { WHATSAPP: '🟢', EMAIL: '✉️', INSTAGRAM: '📸', FACEBOOK: '💬' };
export const NOME_CANAL = { WHATSAPP: 'WhatsApp', EMAIL: 'E-mail', INSTAGRAM: 'Instagram', FACEBOOK: 'Facebook' };

// ---- Datas -----------------------------------------------------------------
function diaFortaleza(data) {
  return new Date(data).toLocaleDateString('en-CA', { timeZone: FUSO });
}

export function horaCurta(iso) {
  if (!iso) return '';
  const hoje = diaFortaleza(new Date());
  const ontem = diaFortaleza(Date.now() - 86400000);
  const dia = diaFortaleza(iso);
  if (dia === hoje) return new Date(iso).toLocaleTimeString('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' });
  if (dia === ontem) return 'Ontem';
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit' });
}

export function soHora(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' });
}

export function dataHora(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function rotuloDia(iso) {
  const hoje = diaFortaleza(new Date());
  const ontem = diaFortaleza(Date.now() - 86400000);
  const dia = diaFortaleza(iso);
  if (dia === hoje) return 'Hoje';
  if (dia === ontem) return 'Ontem';
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: FUSO, weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function chaveDia(iso) { return diaFortaleza(iso); }

export function dataCurta(iso) {
  if (!iso) return '—';
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

export function noites(checkin, checkout) {
  if (!checkin || !checkout) return null;
  const n = Math.round((Date.parse(`${checkout.slice(0, 10)}T00:00:00Z`) - Date.parse(`${checkin.slice(0, 10)}T00:00:00Z`)) / 86400000);
  return n > 0 ? n : null;
}

export function dinheiro(valor) {
  if (valor === null || valor === undefined || Number.isNaN(Number(valor))) return '—';
  return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// ---- Textos ----------------------------------------------------------------
export function iniciais(nome) {
  const partes = String(nome || '?').replace(/[^\p{L}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '?';
  return (partes[0][0] + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase();
}

export function primeiroNome(nome) {
  return String(nome || '').trim().split(/\s+/)[0] || '';
}

export function tamanhoArquivo(bytes) {
  const b = Number(bytes) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

// Troca {nome} e {atendente} numa resposta pronta
export function aplicarVariaveis(texto, { nomeCliente, nomeAtendente }) {
  return String(texto || '')
    .replace(/\{nome\}/gi, primeiroNome(nomeCliente) || '')
    .replace(/\{atendente\}/gi, primeiroNome(nomeAtendente) || '');
}

// Separa o texto novo da parte citada ("Em ... escreveu:") de um e-mail
export function separarCitacao(texto) {
  const linhas = String(texto || '').split('\n');
  const marcadores = [
    /^\s*(Em|On)\s.+(escreveu|wrote)\s*:\s*$/i,
    /^\s*-{2,}\s*(Mensagem original|Original Message|Forwarded message|Mensagem encaminhada)\s*-{2,}/i,
    /^\s*(De|From)\s*:\s.+/i,
    /^\s*_{10,}\s*$/,
  ];
  let corte = -1;
  for (let i = 1; i < linhas.length; i += 1) {
    if (marcadores.some((r) => r.test(linhas[i]))) { corte = i; break; }
    // bloco final só com linhas começando por ">"
    if (linhas[i].startsWith('>') && linhas.slice(i).every((l) => l.startsWith('>') || !l.trim())) { corte = i; break; }
  }
  if (corte < 0) return { principal: texto, citado: '' };
  return { principal: linhas.slice(0, corte).join('\n').trimEnd(), citado: linhas.slice(corte).join('\n') };
}

// Transforma links do texto em <a> (React escapa o resto)
const REGEX_LINK = /(https?:\/\/[^\s<>"]+)/g;
export function partesComLinks(texto) {
  return String(texto || '').split(REGEX_LINK).map((parte, i) => (i % 2 === 1 ? { link: parte } : { texto: parte }));
}

// ---- Estilos da Caixa de Entrada -------------------------------------------
export const ESTILOS_ATENDIMENTO = `
  .at-conteudo { max-width: 1480px !important; }
  .at-abas { display: flex; gap: 6px; flex-wrap: wrap; margin: 4px 0 14px; }
  .at-aba { border: 1px solid var(--borda); background: var(--branco); color: var(--tinta); border-radius: 999px; padding: 8px 14px; font-weight: 600; font-size: 14px; cursor: pointer; font-family: inherit; }
  .at-aba.ativa { background: var(--marca); border-color: var(--marca); color: #fff; }
  .at-aba-badge { display: inline-block; min-width: 18px; padding: 0 5px; margin-left: 6px; border-radius: 999px; background: #C62828; color: #fff; font-size: 11px; line-height: 18px; text-align: center; }

  /* Painel em colunas */
  .at-painel { display: grid; grid-template-columns: 1fr; border: 1px solid var(--borda); border-radius: 14px; background: var(--branco); overflow: hidden; height: calc(100vh - 285px); min-height: 520px; }
  .at-col { min-width: 0; min-height: 0; display: flex; flex-direction: column; }
  .at-col-lista { border-right: 1px solid var(--borda); }
  .at-col-lateral { border-left: 1px solid var(--borda); background: #FAFBF9; overflow-y: auto; }
  .at-esconder-celular { display: none; }

  /* Lista */
  .at-lista-topo { padding: 10px; border-bottom: 1px solid var(--borda); display: flex; flex-direction: column; gap: 8px; }
  .at-filtros { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; }
  .at-filtro { white-space: nowrap; border: 1px solid var(--borda); background: #fff; border-radius: 999px; padding: 5px 10px; font-size: 12.5px; cursor: pointer; font-family: inherit; color: var(--tinta); }
  .at-filtro.ativo { background: var(--marca-clara); border-color: var(--marca); color: var(--marca); font-weight: 700; }
  .at-campo-pequeno { padding: 8px 10px !important; font-size: 14px !important; }
  .at-lista { flex: 1; overflow-y: auto; }
  .at-item { display: flex; gap: 10px; padding: 11px 12px; border-bottom: 1px solid #EEF0EC; cursor: pointer; background: none; border-left: 3px solid transparent; width: 100%; text-align: left; font-family: inherit; color: inherit; }
  .at-item:hover { background: #F7F8F5; }
  .at-item.ativo { background: var(--marca-clara); border-left-color: var(--marca); }
  .at-avatar { flex-shrink: 0; width: 40px; height: 40px; border-radius: 50%; background: #DCE7E2; color: var(--marca-escura); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; position: relative; }
  .at-avatar-canal { position: absolute; right: -4px; bottom: -4px; font-size: 13px; background: #fff; border-radius: 50%; width: 19px; height: 19px; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 0 1px var(--borda); }
  .at-item-meio { flex: 1; min-width: 0; }
  .at-item-linha { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
  .at-item-nome { font-weight: 700; font-size: 14.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .at-item-hora { font-size: 12px; color: var(--texto-suave); flex-shrink: 0; }
  .at-item-hora.nova { color: var(--marca); font-weight: 700; }
  .at-item-resumo { font-size: 13px; color: var(--texto-suave); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .at-item-resumo strong { color: var(--tinta); font-weight: 600; }
  .at-item-rodape { display: flex; gap: 6px; align-items: center; margin-top: 3px; flex-wrap: wrap; }
  .at-badge { display: inline-block; min-width: 20px; padding: 0 6px; border-radius: 999px; background: var(--marca); color: #fff; font-size: 11.5px; font-weight: 700; line-height: 20px; text-align: center; }
  .at-chip { display: inline-block; font-size: 11px; padding: 1px 7px; border-radius: 999px; background: #F0F1EE; color: var(--texto-suave); font-weight: 600; }
  .at-chip-pendente { background: #FFF4D6; color: #7A5600; }
  .at-chip-resolvida { background: #DDF2E4; color: #1E6B3C; }
  .at-chip-resp { background: #E8EEF8; color: #1D4E89; }
  .at-vazio { padding: 28px 16px; text-align: center; color: var(--texto-suave); font-size: 14px; }

  /* Conversa */
  .at-conv-topo { padding: 10px 14px; border-bottom: 1px solid var(--borda); display: flex; gap: 10px; align-items: center; flex-wrap: wrap; background: #fff; }
  .at-conv-titulo { flex: 1; min-width: 160px; }
  .at-conv-nome { font-weight: 700; font-size: 16px; }
  .at-conv-sub { font-size: 12.5px; color: var(--texto-suave); }
  .at-conv-acoes { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  .at-btn { border: 1px solid var(--borda); background: #fff; border-radius: 9px; padding: 7px 11px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; color: var(--tinta); }
  .at-btn:hover { background: #F4F5F2; }
  .at-btn:disabled { opacity: .55; cursor: default; }
  .at-btn-verde { background: var(--marca); border-color: var(--marca); color: #fff; }
  .at-btn-verde:hover { background: var(--marca-escura); }
  .at-btn-perigo { color: var(--erro-texto); }
  .at-select { border: 1px solid var(--borda); border-radius: 9px; padding: 7px 8px; font-size: 13px; font-family: inherit; background: #fff; max-width: 180px; }
  .at-voltar { display: inline-flex; }
  .at-mensagens { flex: 1; overflow-y: auto; padding: 14px 14px 6px; background: #F3F4F0; }
  .at-dia { text-align: center; margin: 10px 0; }
  .at-dia span { font-size: 11.5px; background: #E3E6E0; color: #4A5550; padding: 3px 10px; border-radius: 999px; text-transform: capitalize; }
  .at-linha { display: flex; margin: 4px 0; }
  .at-linha.saida { justify-content: flex-end; }
  .at-linha.nota { justify-content: center; }
  .at-bolha { max-width: min(78%, 640px); border-radius: 12px; padding: 8px 11px 6px; font-size: 14.5px; line-height: 1.45; box-shadow: 0 1px 1px rgba(0,0,0,.06); background: #fff; word-wrap: break-word; overflow-wrap: anywhere; }
  .at-linha.saida .at-bolha { background: #DCEFE7; }
  .at-bolha.falhou { background: #FDECEC !important; }
  .at-bolha-email { max-width: min(92%, 780px); }
  .at-bolha-autor { font-size: 12px; font-weight: 700; color: var(--marca); margin-bottom: 2px; }
  .at-bolha-texto { white-space: pre-wrap; }
  .at-bolha-texto a { color: #1D4E89; }
  .at-bolha-rodape { display: flex; justify-content: flex-end; gap: 6px; font-size: 11px; color: #6A7570; margin-top: 3px; }
  .at-check-visto { color: #1E88E5; font-weight: 700; }
  .at-erro-envio { font-size: 12px; color: var(--erro-texto); margin-top: 4px; }
  .at-nota { background: #FFF6D8; border: 1px dashed #D9B44A; border-radius: 10px; padding: 7px 12px; font-size: 13.5px; max-width: 80%; white-space: pre-wrap; }
  .at-nota-autor { font-size: 11.5px; color: #7A5600; font-weight: 700; }
  .at-sistema { font-size: 12px; color: var(--texto-suave); background: #ECEEEA; border-radius: 8px; padding: 4px 10px; }
  .at-email-cab { font-size: 12px; color: #4A5550; border-bottom: 1px solid rgba(0,0,0,.07); padding-bottom: 5px; margin-bottom: 6px; }
  .at-email-cab div { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .at-citado { white-space: pre-wrap; color: #6A7570; border-left: 3px solid #C9CFC8; padding-left: 8px; margin-top: 6px; font-size: 13px; }
  .at-link-pequeno { background: none; border: none; padding: 0; color: #1D4E89; cursor: pointer; font-size: 12.5px; font-family: inherit; text-decoration: underline; }
  .at-iframe-email { width: 100%; height: 420px; border: 1px solid var(--borda); border-radius: 8px; background: #fff; margin-top: 6px; }
  .at-anexos { display: flex; flex-direction: column; gap: 6px; margin: 4px 0; }
  .at-anexo-img { max-width: 100%; max-height: 300px; border-radius: 8px; cursor: zoom-in; display: block; }
  .at-anexo-arquivo { display: inline-flex; align-items: center; gap: 8px; background: rgba(0,0,0,.04); border: 1px solid rgba(0,0,0,.06); border-radius: 9px; padding: 7px 10px; font-size: 13px; cursor: pointer; font-family: inherit; color: inherit; text-align: left; max-width: 100%; }
  .at-anexo-arquivo span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .at-anexo-audio { width: 260px; max-width: 100%; }
  .at-anexo-video { max-width: 100%; max-height: 300px; border-radius: 8px; }

  /* Escrever */
  .at-escrever { border-top: 1px solid var(--borda); padding: 8px 10px 10px; background: #fff; position: relative; }
  .at-escrever.nota { background: #FFFBEA; }
  .at-aviso-janela { font-size: 13px; background: #FFF4D6; color: #7A5600; border-radius: 9px; padding: 8px 10px; margin-bottom: 8px; display: flex; gap: 8px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
  .at-escrever-linha { display: flex; gap: 8px; align-items: flex-end; }
  .at-textarea { flex: 1; resize: none; min-height: 44px; max-height: 200px; padding: 10px 12px; border: 1px solid var(--borda); border-radius: 12px; font-size: 15px; font-family: inherit; line-height: 1.4; }
  .at-textarea:focus { outline: 2px solid var(--marca-clara); border-color: var(--marca); }
  .at-escrever-ferramentas { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 6px; align-items: center; }
  .at-ferramenta { border: none; background: #F0F2EE; border-radius: 8px; padding: 6px 9px; font-size: 13px; cursor: pointer; font-family: inherit; color: var(--tinta); }
  .at-ferramenta.ativa { background: #FFE9A8; color: #6B4E00; font-weight: 700; }
  .at-btn-enviar { flex-shrink: 0; height: 44px; padding: 0 16px; border-radius: 12px; }
  .at-anexos-escolhidos { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 6px; }
  .at-anexo-chip { font-size: 12.5px; background: #EEF3F0; border-radius: 999px; padding: 4px 6px 4px 10px; display: inline-flex; gap: 6px; align-items: center; }
  .at-anexo-chip button { border: none; background: none; cursor: pointer; font-size: 13px; color: var(--texto-suave); }
  .at-sugestoes { position: absolute; left: 10px; right: 10px; bottom: calc(100% + 4px); background: #fff; border: 1px solid var(--borda); border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,.12); max-height: 260px; overflow-y: auto; z-index: 5; }
  .at-sugestao { display: block; width: 100%; text-align: left; border: none; background: none; padding: 9px 12px; cursor: pointer; font-family: inherit; border-bottom: 1px solid #F0F1EE; }
  .at-sugestao:hover, .at-sugestao.ativa { background: var(--marca-clara); }
  .at-sugestao strong { font-size: 13px; color: var(--marca); }
  .at-sugestao div { font-size: 12.5px; color: var(--texto-suave); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .at-cc { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; font-size: 13px; }
  .at-cc input { flex: 1; }

  /* Lateral (reserva) */
  .at-lateral-bloco { padding: 12px 14px; border-bottom: 1px solid var(--borda); }
  .at-lateral-titulo { font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--latao-texto); margin: 0 0 8px; }
  .at-dado { display: flex; justify-content: space-between; gap: 10px; font-size: 13px; padding: 3px 0; }
  .at-dado span:first-child { color: var(--texto-suave); }
  .at-dado span:last-child { text-align: right; font-weight: 600; overflow-wrap: anywhere; }
  .at-reserva { border: 1px solid var(--borda); border-radius: 12px; background: #fff; padding: 10px 12px; margin-bottom: 8px; }
  .at-reserva-topo { display: flex; justify-content: space-between; gap: 8px; align-items: center; margin-bottom: 4px; }
  .at-reserva-nome { font-weight: 700; font-size: 14px; }
  .at-reserva-acoes { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }

  /* Modais (z-index 80: acima do menu) */
  .at-overlay { position: fixed; inset: 0; z-index: 80; background: rgba(20, 30, 27, .55); display: flex; align-items: flex-end; justify-content: center; }
  .at-modal { background: #fff; width: 100%; max-height: 92vh; overflow-y: auto; border-radius: 18px 18px 0 0; padding: 18px 16px 22px; }
  .at-modal-topo { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 6px; }
  .at-modal h2 { margin: 0; font-size: 19px; }
  .at-previa-modelo { white-space: pre-wrap; background: #DCEFE7; border-radius: 12px; padding: 10px 12px; font-size: 14px; margin-top: 10px; }
  .at-botoes { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
  .at-lateral-modal .at-modal { padding: 0; }

  /* Canais / Respostas */
  .at-cartao { background: #fff; border: 1px solid var(--borda); border-radius: 14px; padding: 16px; margin-bottom: 16px; }
  .at-cartao h2 { margin: 0 0 4px; font-size: 18px; }
  .at-grade { display: grid; grid-template-columns: 1fr; gap: 0 14px; }
  .at-copiar { display: flex; gap: 6px; align-items: center; }
  .at-copiar code { flex: 1; min-width: 0; overflow-x: auto; white-space: nowrap; background: #F3F4F0; border: 1px solid var(--borda); border-radius: 8px; padding: 8px 10px; font-size: 13px; }
  .at-canal { border: 1px solid var(--borda); border-radius: 12px; padding: 12px; margin-top: 10px; }
  .at-canal-topo { display: flex; justify-content: space-between; gap: 10px; align-items: center; flex-wrap: wrap; }
  .at-ok { color: var(--sucesso-texto); font-weight: 700; }
  .at-ruim { color: var(--erro-texto); font-weight: 700; }
  .at-dica { font-size: 12.5px; color: var(--texto-suave); margin-top: 4px; }
  .at-passos { margin: 6px 0 0; padding-left: 20px; font-size: 13.5px; color: #3E4944; }
  .at-passos li { margin: 3px 0; }

  @media (min-width: 900px) {
    .at-painel { grid-template-columns: 340px 1fr; }
    .at-esconder-celular { display: flex; }
    .at-col-lateral.at-esconder-celular { display: block; }
    .at-voltar { display: none; }
    .at-so-celular { display: none !important; }
    .at-grade { grid-template-columns: 1fr 1fr; }
    .at-overlay { align-items: center; padding: 24px; }
    .at-modal { max-width: 620px; border-radius: 18px; padding: 22px; }
  }
  @media (min-width: 1200px) {
    .at-painel.com-lateral { grid-template-columns: 340px 1fr 310px; }
  }
  @media (max-width: 899px) {
    .at-painel { height: calc(100vh - 190px); }
    .at-celular-escondido { display: none !important; }
    /* Conversa aberta no celular: usa a tela toda (esconde título e abas) */
    .at-com-conversa { padding-top: 8px !important; padding-bottom: 8px !important; }
    .at-com-conversa .at-cabecalho-pagina { display: none; }
    .at-com-conversa .at-painel { height: calc(100vh - 84px); height: calc(100dvh - 84px); min-height: 0; border-radius: 10px; }
    .at-conv-topo { padding: 8px 10px; }
    .at-conv-acoes .at-select { max-width: 46%; }
  }
`;
