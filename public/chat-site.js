/*
 * Chat do site do hotel — Chokmah System (Caixa de Entrada, Fase 1B)
 *
 * Como instalar no site (antes de </body>):
 *   <script src="https://chokmahsystem.netlify.app/chat-site.js" data-hotel="4" defer></script>
 *
 * O site também pode abrir o chat por um botão próprio:
 *   window.ChatHotel.abrir()   (window.ChatHotel.disponivel diz se o chat carregou)
 * e ouvir o evento "chat-hotel" (detail.tipo: "pronto", "aberto", "mensagem", "contato").
 *
 * O chat só funciona nos endereços cadastrados em Caixa de Entrada → Canais → Chat do site.
 * Nada é guardado em cookie: o passe da conversa fica no armazenamento do navegador.
 */
(function () {
  'use strict';
  if (window.ChatHotel && window.ChatHotel.carregado) return;

  var script = document.currentScript || (function () {
    var s = document.querySelectorAll('script[src*="chat-site.js"]');
    return s[s.length - 1];
  })();
  if (!script) return;
  var HOTEL = String(script.getAttribute('data-hotel') || '').replace(/\D/g, '');
  if (!HOTEL) return;
  var BASE = new URL(script.src, location.href).origin;
  var API = BASE + '/api/chat-site';
  var CHAVE = 'chat-hotel:' + HOTEL;

  var api = { carregado: true, disponivel: false, abrir: function () { pendenteAbrir = true; }, fechar: function () {} };
  window.ChatHotel = api;
  var pendenteAbrir = false;

  // ---------------------------------------------------------------- memória do navegador
  function ler() { try { return JSON.parse(localStorage.getItem(CHAVE)) || {}; } catch (e) { return {}; } }
  function gravar(dados) { try { localStorage.setItem(CHAVE, JSON.stringify(dados)); } catch (e) { /* aba anônima */ } }
  var memoria = ler();
  function guardar(campos) { for (var k in campos) memoria[k] = campos[k]; gravar(memoria); }

  function avisar(tipo, extra) {
    try { window.dispatchEvent(new CustomEvent('chat-hotel', { detail: Object.assign({ tipo: tipo }, extra || {}) })); } catch (e) { /* navegador antigo */ }
  }

  // ---------------------------------------------------------------- conversa com o sistema
  function pedir(corpo, tempo) {
    corpo.hotel = HOTEL;
    var controle = window.AbortController ? new AbortController() : null;
    var relogio = controle ? setTimeout(function () { controle.abort(); }, tempo || 15000) : null;
    return fetch(API, {
      method: 'POST', body: JSON.stringify(corpo), credentials: 'omit', mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, signal: controle ? controle.signal : undefined,
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (relogio) clearTimeout(relogio);
        if (!r.ok) { var e = new Error(j.erro || 'Não foi possível falar com o hotel agora.'); e.status = r.status; e.dados = j; throw e; }
        return j;
      });
    }, function (e) {
      if (relogio) clearTimeout(relogio);
      throw new Error('Sem conexão. Confira a internet e tente de novo.');
    });
  }

  function idNovo() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function visitante() {
    var p = new URLSearchParams(location.search);
    var utm = {};
    ['source', 'medium', 'campaign', 'term', 'content'].forEach(function (k) { var v = p.get('utm_' + k); if (v) utm[k] = v; });
    var fuso = '';
    try { fuso = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { /* nada */ }
    var ref = null;
    try { if (document.referrer) { var u = new URL(document.referrer); ref = u.origin + u.pathname; } } catch (e) { ref = null; }
    return {
      pagina: location.origin + location.pathname, titulo: document.title, referencia: ref,
      utm: utm, idioma: navigator.language || '', fuso: fuso,
    };
  }

  // ---------------------------------------------------------------- texto das mensagens
  function escapar(t) {
    return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  var URL_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g;
  function formatar(texto) {
    return String(texto || '').split('\n').map(function (linha) {
      var botao = /^(.{1,40}?):\s*(https?:\/\/\S+)\s*$/.exec(linha);
      if (botao) {
        return '<a class="botao-link" href="' + escapar(botao[2]) + '" target="_blank" rel="noopener">' + escapar(botao[1]) + ' ↗</a>';
      }
      var seguro = escapar(linha)
        .replace(/\*([^*\n]{1,200})\*/g, '<strong>$1</strong>')
        .replace(URL_RE, function (u) { return '<a href="' + u + '" target="_blank" rel="noopener">' + u + '</a>'; });
      return seguro;
    }).join('<br>');
  }
  function hora(iso) {
    var d = iso ? new Date(iso) : new Date();
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  // ---------------------------------------------------------------- aparência
  var CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box}',
    '[hidden]{display:none !important}',
    '.raiz{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.4;color:#1d1d24;-webkit-font-smoothing:antialiased}',
    '.lancador{position:fixed;right:20px;bottom:20px;width:60px;height:60px;border-radius:50%;border:0;cursor:pointer;background:var(--cor);color:#fff;',
    ' box-shadow:0 6px 20px rgba(20,10,50,.28);display:flex;align-items:center;justify-content:center;z-index:2147483000;transition:transform .09s ease-out}',
    '.lancador:active{transform:scale(.94)}',
    '.lancador:focus-visible,.fechar:focus-visible,.enviar:focus-visible,.link:focus-visible,.botao:focus-visible{outline:3px solid #85b5dd;outline-offset:3px}',
    '.lancador svg{width:28px;height:28px}',
    '.selo{position:absolute;top:-2px;right:-2px;min-width:22px;height:22px;padding:0 6px;border-radius:11px;background:#d93025;color:#fff;font-size:12.5px;font-weight:700;',
    ' display:flex;align-items:center;justify-content:center;border:2px solid #fff}',
    '.janela{position:fixed;right:20px;bottom:92px;width:380px;max-width:calc(100vw - 32px);height:600px;max-height:calc(100vh - 120px);background:#fff;border-radius:16px;',
    ' box-shadow:0 12px 40px rgba(20,10,50,.28);display:flex;flex-direction:column;overflow:hidden;z-index:2147483001;',
    ' transform-origin:bottom right;animation:abre .26s cubic-bezier(.2,.8,.2,1)}',
    '@keyframes abre{from{opacity:0;transform:translateY(12px) scale(.98)}to{opacity:1;transform:none}}',
    '.topo{background:var(--cor);color:#fff;padding:14px 12px 14px 18px;display:flex;align-items:center;gap:10px;flex:none}',
    '.topo-texto{flex:1;min-width:0}',
    '.titulo{font-weight:700;font-size:16.5px;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.situacao{font-size:13px;opacity:.88;margin-top:2px;display:flex;align-items:center;gap:6px}',
    '.ponto{width:8px;height:8px;border-radius:50%;background:#7ee08a;flex:none}',
    '.ponto.fora{background:#ffc53d}',
    '.fechar{width:44px;height:44px;border-radius:10px;border:0;background:transparent;color:#fff;cursor:pointer;font-size:26px;line-height:1;flex:none}',
    '.fechar:active{transform:scale(.94)}',
    '.lista{flex:1;overflow-y:auto;padding:16px 14px 8px;background:#f6f6fa;overscroll-behavior:contain;display:flex;flex-direction:column;gap:8px}',
    '.msg{max-width:84%;padding:9px 12px;border-radius:14px;word-wrap:break-word;overflow-wrap:anywhere}',
    '.msg.hotel{align-self:flex-start;background:#fff;border:1px solid #e6e5ee;border-bottom-left-radius:5px}',
    '.msg.cliente{align-self:flex-end;background:var(--cor);color:#fff;border-bottom-right-radius:5px}',
    '.msg.cliente a{color:#fff}',
    '.autor{font-size:12px;font-weight:700;color:#49408f;margin-bottom:2px}',
    '.quando{font-size:11px;opacity:.65;margin-top:3px;text-align:right}',
    '.msg.falhou{opacity:.75;border:1px dashed #d93025}',
    '.repetir{display:block;margin-top:4px;font-size:12.5px;color:#fff;text-decoration:underline;background:none;border:0;padding:0;cursor:pointer;font:inherit}',
    '.msg a{color:#2a1160;font-weight:600}',
    '.botao-link{display:inline-block;margin:4px 0;padding:8px 14px;border-radius:10px;background:var(--cor);color:#fff !important;text-decoration:none;font-weight:700;font-size:14px}',
    '.digitando{align-self:flex-start;background:#fff;border:1px solid #e6e5ee;border-radius:14px;padding:10px 14px;display:flex;gap:4px}',
    '.digitando i{width:7px;height:7px;border-radius:50%;background:#9a96b8;animation:pula 1.2s infinite ease-in-out}',
    '.digitando i:nth-child(2){animation-delay:.15s}.digitando i:nth-child(3){animation-delay:.3s}',
    '@keyframes pula{0%,60%,100%{transform:translateY(0);opacity:.5}30%{transform:translateY(-4px);opacity:1}}',
    '.aviso{align-self:center;font-size:12.5px;color:#5b5873;text-align:center;padding:2px 8px;max-width:90%}',
    '.cartao{align-self:stretch;background:#fff;border:1px solid #d9d6ea;border-radius:14px;padding:12px}',
    '.cartao p{margin:0 0 8px;font-size:14px}',
    '.cartao label{display:block;font-size:12.5px;font-weight:600;color:#3b3852;margin:6px 0 3px}',
    '.cartao input{width:100%;height:44px;border:1px solid #cfcbe3;border-radius:10px;padding:0 10px;font:inherit;font-size:16px;color:#1d1d24;background:#fff}',
    '.cartao input:focus{outline:2px solid var(--cor);outline-offset:0;border-color:transparent}',
    '.cartao .acoes{display:flex;gap:10px;align-items:center;margin-top:10px;flex-wrap:wrap}',
    '.botao{height:44px;padding:0 16px;border-radius:10px;border:0;background:var(--cor);color:#fff;font:inherit;font-weight:700;cursor:pointer}',
    '.botao:active,.enviar:active{transform:scale(.96)}',
    '.botao[disabled]{opacity:.6;cursor:default}',
    '.link{background:none;border:0;color:#49408f;font:inherit;font-size:14px;cursor:pointer;text-decoration:underline;padding:8px 4px;min-height:44px}',
    '.erro{color:#b3261e;font-size:13px;margin-top:6px}',
    '.rodape{border-top:1px solid #e6e5ee;padding:10px;display:flex;gap:8px;align-items:flex-end;background:#fff;flex:none}',
    '.rodape textarea{flex:1;resize:none;border:1px solid #cfcbe3;border-radius:12px;padding:11px 12px;font:inherit;font-size:16px;line-height:1.35;max-height:120px;min-height:44px;color:#1d1d24;background:#fff}',
    '.rodape textarea:focus{outline:2px solid var(--cor);outline-offset:0;border-color:transparent}',
    '.enviar{width:44px;height:44px;border-radius:12px;border:0;background:var(--cor);color:#fff;cursor:pointer;flex:none;display:flex;align-items:center;justify-content:center}',
    '.enviar[disabled]{opacity:.45;cursor:default}',
    '.enviar svg{width:22px;height:22px}',
    '.oculto{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
    '@media (max-width:560px){.janela{right:0;bottom:0;width:100vw;max-width:100vw;height:100%;max-height:100%;border-radius:0;animation:sobe .26s cubic-bezier(.2,.8,.2,1)}',
    ' .lancador{right:16px;bottom:16px}}',
    '@keyframes sobe{from{transform:translateY(24px);opacity:0}to{transform:none;opacity:1}}',
    '@media (prefers-reduced-motion:reduce){.janela{animation:none}.digitando i{animation:none}.lancador,.botao,.enviar{transition:none}}',
  ].join('\n');

  var ICONE_CHAT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>';
  var ICONE_ENVIAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>';

  // ---------------------------------------------------------------- estado
  var cfg = null;
  var hospedeiro, sombra, raiz, lancador, selo, janela, lista, campo, botaoEnviar, digitandoEl, vivo;
  var mensagens = [];            // { id, de, autor, texto, em, local, falhou, idCliente }
  var ultimoId = Number(memoria.ultimoId) || 0;
  var vistoAte = Number(memoria.vistoAte) || 0;
  var aberta = false;
  var esperandoRobo = false;
  var digitando = false;
  var comEquipe = false; // a equipe assumiu a conversa (o robô não responde)
  var temContato = !!memoria.temContato;
  var relogio = null;
  var ultimaAtividade = Number(memoria.atividade) || 0;
  var enviando = false;
  var fila = [];
  var historicoCarregado = false;
  var cartaoEl = null;           // o cartão de contato é um só (não perde o que a pessoa digitou)
  var obrigadoEl = null;

  function criar() {
    hospedeiro = document.createElement('div');
    hospedeiro.id = 'chat-hotel';
    document.body.appendChild(hospedeiro);
    sombra = hospedeiro.attachShadow ? hospedeiro.attachShadow({ mode: 'open' }) : hospedeiro;
    var estilo = document.createElement('style');
    estilo.textContent = CSS;
    sombra.appendChild(estilo);
    raiz = document.createElement('div');
    raiz.className = 'raiz';
    raiz.style.setProperty('--cor', cfg.cor || '#2a1160');
    sombra.appendChild(raiz);

    lancador = document.createElement('button');
    lancador.type = 'button';
    lancador.className = 'lancador';
    lancador.setAttribute('aria-label', 'Abrir o chat com o ' + (cfg.titulo || 'hotel'));
    lancador.setAttribute('aria-expanded', 'false');
    lancador.innerHTML = ICONE_CHAT;
    selo = document.createElement('span');
    selo.className = 'selo';
    selo.hidden = true;
    lancador.appendChild(selo);
    lancador.addEventListener('click', function () { if (aberta) fechar(); else abrir(); });
    raiz.appendChild(lancador);

    vivo = document.createElement('div');
    vivo.className = 'oculto';
    vivo.setAttribute('aria-live', 'polite');
    raiz.appendChild(vivo);
  }

  function textoSituacao() {
    if (cfg.robo && !comEquipe) return { fora: false, texto: (cfg.assistente ? cfg.assistente + ', assistente virtual' : 'Assistente virtual') + ' · responde na hora' };
    if (comEquipe && cfg.equipe && cfg.equipe.aberta) return { fora: false, texto: 'Agora quem responde é a equipe · em poucos minutos' };
    if (cfg.equipe && cfg.equipe.aberta) return { fora: false, texto: 'A equipe responde em poucos minutos' };
    return { fora: true, texto: cfg.equipe && cfg.equipe.volta ? 'Fora do horário · a equipe volta ' + cfg.equipe.volta : 'Fora do horário · responderemos assim que possível' };
  }

  // A equipe assumiu (ou devolveu ao robô): troca a linha de situação do topo
  function mudarEquipe(valor) {
    valor = !!valor;
    if (valor === comEquipe) return;
    comEquipe = valor;
    if (!janela) return;
    var sit = textoSituacao();
    var ponto = janela.querySelector('.ponto');
    if (ponto) ponto.className = 'ponto' + (sit.fora ? ' fora' : '');
    var el = janela.querySelector('.sit');
    if (el) el.textContent = sit.texto;
  }

  function montarJanela() {
    janela = document.createElement('div');
    janela.className = 'janela';
    janela.setAttribute('role', 'dialog');
    janela.setAttribute('aria-label', 'Chat com o ' + (cfg.titulo || 'hotel'));
    var sit = textoSituacao();
    janela.innerHTML =
      '<div class="topo"><div class="topo-texto"><div class="titulo"></div>' +
      '<div class="situacao"><span class="ponto' + (sit.fora ? ' fora' : '') + '"></span><span class="sit"></span></div></div>' +
      '<button type="button" class="fechar" aria-label="Fechar o chat">×</button></div>' +
      '<div class="lista" role="log" aria-live="polite" aria-relevant="additions"></div>' +
      '<form class="rodape"><label class="oculto" for="chat-hotel-campo">Sua mensagem</label>' +
      '<textarea id="chat-hotel-campo" rows="1" maxlength="2000" placeholder="Escreva sua mensagem" enterkeyhint="send"></textarea>' +
      '<button type="submit" class="enviar" aria-label="Enviar">' + ICONE_ENVIAR + '</button></form>';
    janela.querySelector('.titulo').textContent = cfg.titulo || 'Hotel';
    janela.querySelector('.sit').textContent = sit.texto;
    lista = janela.querySelector('.lista');
    campo = janela.querySelector('textarea');
    botaoEnviar = janela.querySelector('.enviar');
    janela.querySelector('.fechar').addEventListener('click', fechar);
    janela.querySelector('form').addEventListener('submit', function (e) { e.preventDefault(); enviarDoCampo(); });
    campo.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); enviarDoCampo(); }
    });
    campo.addEventListener('input', ajustarCampo);
    janela.addEventListener('keydown', function (e) { if (e.key === 'Escape') fechar(); });
    raiz.appendChild(janela);
    desenhar();
  }

  function ajustarCampo() {
    campo.style.height = 'auto';
    campo.style.height = Math.min(campo.scrollHeight, 120) + 'px';
    botaoEnviar.disabled = !campo.value.trim();
  }

  // ---------------------------------------------------------------- desenho da conversa
  function bolha(m) {
    var div = document.createElement('div');
    var deCliente = m.de === 'cliente';
    div.className = 'msg ' + (deCliente ? 'cliente' : 'hotel') + (m.falhou ? ' falhou' : '');
    var autor = '';
    if (!deCliente) {
      var nome = m.de === 'robo' ? (cfg.assistente || 'Assistente virtual') : (m.autor ? m.autor + ' · ' + (cfg.titulo || 'Hotel') : (cfg.titulo || 'Hotel'));
      autor = '<div class="autor">' + escapar(nome) + '</div>';
    }
    var rodape = m.falhou ? 'Não enviada' : (m.local ? 'Enviando…' : hora(m.em));
    div.innerHTML = autor + '<div>' + formatar(m.texto) + '</div><div class="quando">' + escapar(rodape) + '</div>';
    if (m.falhou) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'repetir';
      b.textContent = 'Tentar de novo';
      b.addEventListener('click', function () { m.falhou = false; m.local = true; desenhar(); fila.push(m); processarFila(); });
      div.appendChild(b);
    }
    return div;
  }

  function desenhar() {
    if (!lista) return;
    var embaixo = lista.scrollHeight - lista.scrollTop - lista.clientHeight < 80;
    var ativo = sombra.activeElement || null; // quem está digitando no cartão de contato não perde o lugar
    lista.innerHTML = '';
    var boasVindas = { de: 'hotel', texto: cfg.saudacao, em: null };
    var saud = bolha(boasVindas);
    saud.querySelector('.quando').remove();
    lista.appendChild(saud);
    var pediu = false;
    var extra = precisaContato() ? (cartaoEl || (cartaoEl = cartaoContato())) : obrigadoEl;
    mensagens.forEach(function (m, i) {
      lista.appendChild(bolha(m));
      // Cartão de contato logo depois da primeira resposta à primeira mensagem do visitante
      if (!pediu && extra && m.de === 'cliente' && !m.local) {
        var proxima = mensagens[i + 1];
        if (!proxima || proxima.de !== 'cliente') { lista.appendChild(extra); pediu = true; }
      }
    });
    if (!pediu && extra && mensagens.some(function (m) { return m.de === 'cliente' && !m.local; })) lista.appendChild(extra);
    if (digitando || esperandoRobo) {
      digitandoEl = document.createElement('div');
      digitandoEl.className = 'digitando';
      digitandoEl.setAttribute('aria-label', 'Escrevendo');
      digitandoEl.innerHTML = '<i></i><i></i><i></i>';
      lista.appendChild(digitandoEl);
    }
    if (!mensagens.length) {
      var aviso = document.createElement('div');
      aviso.className = 'aviso';
      aviso.textContent = textoSituacao().fora ? 'Pode escrever: a sua mensagem fica guardada e respondemos assim que a equipe voltar.' : '';
      if (aviso.textContent) lista.appendChild(aviso);
    }
    if (embaixo || !historicoCarregado) lista.scrollTop = lista.scrollHeight;
    if (ativo && ativo !== document.body && lista.contains(ativo)) { try { ativo.focus({ preventScroll: true }); } catch (e) { /* nada */ } }
  }

  function precisaContato() {
    return cfg.pedirContato && !temContato && !memoria.contatoDispensado;
  }

  function cartaoContato() {
    var c = document.createElement('div');
    c.className = 'cartao';
    c.innerHTML =
      '<p><strong>Para a equipe te responder mesmo se você sair do site:</strong></p>' +
      '<label for="ch-nome">Seu nome</label><input id="ch-nome" autocomplete="name" maxlength="80">' +
      '<label for="ch-tel">WhatsApp (com DDD)</label><input id="ch-tel" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" placeholder="83 98888-7777">' +
      '<label for="ch-email">ou e-mail</label><input id="ch-email" type="email" inputmode="email" autocomplete="email" maxlength="120">' +
      '<div class="erro" hidden></div>' +
      '<div class="acoes"><button type="button" class="botao">Enviar contato</button><button type="button" class="link">Agora não</button></div>';
    var erro = c.querySelector('.erro');
    var botao = c.querySelector('.botao');
    botao.addEventListener('click', function () {
      var nome = c.querySelector('#ch-nome').value.trim();
      var tel = c.querySelector('#ch-tel').value.trim();
      var email = c.querySelector('#ch-email').value.trim();
      if (!tel && !email) { erro.textContent = 'Deixe o WhatsApp ou o e-mail.'; erro.hidden = false; return; }
      botao.disabled = true;
      botao.textContent = 'Enviando…';
      pedir({ acao: 'contato', passe: memoria.passe, nome: nome, telefone: tel, email: email }).then(function () {
        temContato = true;
        guardar({ temContato: true });
        avisar('contato');
        obrigadoEl = document.createElement('div');
        obrigadoEl.className = 'aviso';
        obrigadoEl.textContent = 'Obrigado! Se você sair, respondemos por aqui ou pelo contato que deixou.';
        c.replaceWith(obrigadoEl);
        cartaoEl = null;
      }, function (e) {
        botao.disabled = false;
        botao.textContent = 'Enviar contato';
        erro.textContent = e.message;
        erro.hidden = false;
      });
    });
    c.querySelector('.link').addEventListener('click', function () { guardar({ contatoDispensado: true }); c.remove(); cartaoEl = null; });
    return c;
  }

  // ---------------------------------------------------------------- mensagens recebidas
  function receber(lista2, substituirLocais) {
    var novas = 0;
    (lista2 || []).forEach(function (m) {
      if (mensagens.some(function (x) { return x.id === m.id; })) return;
      if (substituirLocais && m.de === 'cliente') {
        var i = mensagens.findIndex(function (x) { return x.local && x.texto.trim() === String(m.texto).trim(); });
        if (i >= 0) { mensagens.splice(i, 1); }
      }
      mensagens.push(m);
      if (m.de !== 'cliente') { novas += 1; vivo.textContent = (m.de === 'robo' ? (cfg.assistente || 'Assistente') : (m.autor || cfg.titulo)) + ': ' + m.texto.slice(0, 200); }
      if (m.id > ultimoId) ultimoId = m.id;
    });
    mensagens.sort(function (a, b) {
      if (a.local && !b.local) return 1;
      if (b.local && !a.local) return -1;
      return (a.id || 0) - (b.id || 0);
    });
    if (novas) { ultimaAtividade = Date.now(); avisar('mensagem'); }
    guardar({ ultimoId: ultimoId, atividade: ultimaAtividade });
    return novas;
  }

  function atualizarSelo() {
    var naoLidas = aberta ? 0 : mensagens.filter(function (m) { return m.de !== 'cliente' && m.id > vistoAte; }).length;
    selo.hidden = !naoLidas;
    selo.textContent = naoLidas > 9 ? '9+' : String(naoLidas);
    lancador.setAttribute('aria-label', (naoLidas ? naoLidas + ' mensagem(ns) nova(s). ' : '') + 'Abrir o chat com o ' + (cfg.titulo || 'hotel'));
    if (aberta) { vistoAte = ultimoId; guardar({ vistoAte: vistoAte }); }
  }

  function buscarNovas() {
    if (!memoria.passe) return Promise.resolve();
    var depois = historicoCarregado ? ultimoId : 0;
    return pedir({ acao: 'novas', passe: memoria.passe, depois: depois, aberta: aberta && !document.hidden }).then(function (r) {
      if (r.encerrada) { esquecerConversa(); return; }
      var primeira = !historicoCarregado;
      historicoCarregado = true;
      var antes = mensagens.length;
      receber(r.mensagens, false);
      var mudou = primeira || mensagens.length !== antes || digitando !== !!r.digitando || (r.temContato && !temContato);
      digitando = !!r.digitando;
      mudarEquipe(r.equipe);
      if (r.temContato) { temContato = true; guardar({ temContato: true }); }
      if (mudou) desenhar();
      atualizarSelo();
    }, function () { /* tenta na próxima rodada */ });
  }

  function esquecerConversa() {
    mensagens = [];
    ultimoId = 0; vistoAte = 0; temContato = false; cartaoEl = null; obrigadoEl = null;
    memoria = {};
    gravar(memoria);
    desenhar();
    atualizarSelo();
  }

  // Ritmo das buscas: rápido logo depois de uma mensagem, mais lento depois;
  // com o chat fechado, só para mostrar o número de mensagens novas.
  function agendar() {
    clearTimeout(relogio);
    if (!memoria.passe) return;
    var parado = Date.now() - ultimaAtividade;
    var espera;
    if (document.hidden) espera = 60000;
    else if (aberta) espera = parado < 90000 ? 3000 : parado < 600000 ? 8000 : 20000;
    else espera = parado < 1800000 ? 20000 : 0;
    if (!espera) return;
    relogio = setTimeout(function () { buscarNovas().then(agendar); }, espera);
  }

  // ---------------------------------------------------------------- envio
  function enviarDoCampo() {
    var texto = campo.value.trim();
    if (!texto) return;
    campo.value = '';
    ajustarCampo();
    var m = { id: null, idCliente: idNovo(), de: 'cliente', texto: texto, em: new Date().toISOString(), local: true };
    mensagens.push(m);
    ultimaAtividade = Date.now();
    desenhar();
    lista.scrollTop = lista.scrollHeight;
    fila.push(m);
    processarFila();
    avisar('mensagem', { de: 'cliente' });
  }

  function processarFila() {
    if (enviando || !fila.length) return;
    enviando = true;
    var m = fila.shift();
    esperandoRobo = !!cfg.robo && !comEquipe;
    desenhar();
    pedir({ acao: 'enviar', passe: memoria.passe || null, id: m.idCliente, texto: m.texto, depois: historicoCarregado ? ultimoId : 0, visitante: visitante() }, 25000)
      .then(function (r) {
        if (r.passe) { guardar({ passe: r.passe, temContato: false, contatoDispensado: false }); historicoCarregado = true; }
        var i = mensagens.indexOf(m);
        if (i >= 0) mensagens.splice(i, 1);
        receber(r.mensagens, true);
        digitando = !!r.digitando;
        mudarEquipe(r.equipe);
        if (r.temContato) { temContato = true; guardar({ temContato: true }); }
      }, function (e) {
        m.falhou = true; m.local = false;
        mostrarErro(e.status === 429 || e.status === 409 ? e.message : 'Não foi possível enviar. ' + e.message);
      })
      .then(function () {
        enviando = false;
        esperandoRobo = false;
        desenhar();
        atualizarSelo();
        agendar();
        if (fila.length) processarFila();
      });
  }

  function mostrarErro(texto) {
    var a = document.createElement('div');
    a.className = 'aviso';
    a.style.color = '#b3261e';
    a.textContent = texto;
    lista.appendChild(a);
    lista.scrollTop = lista.scrollHeight;
  }

  // ---------------------------------------------------------------- abrir e fechar
  var foco = null;
  function abrir() {
    if (!cfg) { pendenteAbrir = true; return; }
    if (aberta) { if (campo) campo.focus(); return; }
    aberta = true;
    foco = document.activeElement;
    if (!janela) montarJanela(); else janela.hidden = false;
    lancador.setAttribute('aria-expanded', 'true');
    if (window.matchMedia && window.matchMedia('(max-width:560px)').matches) {
      lancador.hidden = true;
      document.documentElement.style.overflow = 'hidden';
    }
    desenhar();
    atualizarSelo();
    lista.scrollTop = lista.scrollHeight;
    setTimeout(function () { campo.focus({ preventScroll: true }); }, 60);
    buscarNovas().then(agendar);
    avisar('aberto');
  }

  function fechar() {
    if (!aberta) return;
    aberta = false;
    janela.hidden = true;
    lancador.hidden = false;
    lancador.setAttribute('aria-expanded', 'false');
    document.documentElement.style.overflow = '';
    atualizarSelo();
    agendar();
    if (foco && foco.focus) { try { foco.focus({ preventScroll: true }); } catch (e) { /* nada */ } } else lancador.focus();
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && memoria.passe) buscarNovas().then(agendar);
  });

  // ---------------------------------------------------------------- início
  function iniciar() {
    var guardada = null;
    try { guardada = JSON.parse(sessionStorage.getItem(CHAVE + ':config')); } catch (e) { guardada = null; }
    var carregar = guardada && Date.now() - guardada.quando < 600000
      ? Promise.resolve(guardada.cfg)
      : pedir({ acao: 'config' }, 10000).then(function (c) {
        try { sessionStorage.setItem(CHAVE + ':config', JSON.stringify({ quando: Date.now(), cfg: c })); } catch (e) { /* nada */ }
        return c;
      });
    carregar.then(function (c) {
      if (!c || !c.ativo) return;
      cfg = c;
      criar();
      api.disponivel = true;
      api.abrir = abrir;
      api.fechar = fechar;
      avisar('pronto');
      var p = new URLSearchParams(location.search);
      if (pendenteAbrir || p.get('chat') === 'abrir' || location.hash === '#chat') { abrir(); return; }
      // Conversa em andamento: busca o que chegou (para o número de novas)
      if (memoria.passe) buscarNovas().then(agendar);
    }, function () { /* site não liberado ou sem conexão: o site segue sem o chat */ });
  }

  if (document.body) iniciar(); else document.addEventListener('DOMContentLoaded', iniciar);
})();
