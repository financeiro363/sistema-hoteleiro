'use client';

// ============================================================================
// CAIXA DE ENTRADA — Modelos de e-mail (Fase 3)
// ============================================================================
// - ModelosEmail: aba com os modelos de cada hotel (Atrações, Cancelamento,
//   Confirmação, Cotação, Formas de pagamento, Outros). O ADMIN cria, edita,
//   duplica e exclui; a equipe vê e usa.
// - EditorHtml: caixa de texto com formatação (negrito, listas, links, cores,
//   imagens). Colar um texto formatado (ex.: do Asksuite) mantém o visual.
// - EscolherModelo: janela para usar um modelo na conversa.
// Variáveis: {nome} (primeiro nome do cliente), {atendente}, {hotel}.
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { dataHora } from './util';

export const CATEGORIAS_MODELO = {
  ATRACOES: '🗺️ Atrações',
  CANCELAMENTO: '❌ Cancelamento',
  CONFIRMACAO: '✅ Confirmação',
  COTACAO: '💰 Cotação',
  PAGAMENTO: '💳 Formas de pagamento',
  OUTRO: '📄 Outros',
};

// ---- HTML seguro (sem scripts nem eventos) -----------------------------------
const PROIBIDAS = 'script,style,iframe,object,embed,form,input,button,textarea,select,meta,link,base,frame,frameset';

export function limparHtmlTela(html) {
  if (typeof DOMParser === 'undefined') return String(html || '');
  const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
  doc.body.querySelectorAll(PROIBIDAS).forEach((el) => el.remove());
  doc.body.querySelectorAll('*').forEach((el) => {
    [...el.attributes].forEach((a) => {
      const nome = a.name.toLowerCase();
      if (nome.startsWith('on')) el.removeAttribute(a.name);
      if ((nome === 'href' || nome === 'src') && /^\s*(javascript|vbscript|data:text)/i.test(a.value)) el.removeAttribute(a.name);
    });
    if (el.tagName === 'A') { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
  });
  return doc.body.innerHTML;
}

export function htmlParaTextoTela(html) {
  if (typeof DOMParser === 'undefined') return String(html || '').replace(/<[^>]+>/g, ' ');
  const doc = new DOMParser().parseFromString(`<body>${String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<(p|div|ul|ol|h[1-6]|table|tr|blockquote)(\s[^>]*)?>/gi, '\n$&')
    .replace(/<\/(p|div|h[1-6]|li|tr|ul|ol|blockquote)>/gi, '$&\n')}</body>`, 'text/html');
  doc.body.querySelectorAll('li').forEach((li) => { li.textContent = `• ${li.textContent}`; });
  doc.body.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href');
    if (href && /^https?:/i.test(href) && !a.textContent.includes(href)) a.textContent = `${a.textContent} (${href})`;
  });
  return (doc.body.textContent || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

const escapar = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function aplicarVariaveisModelo(texto, { nomeCliente, nomeAtendente, nomeHotel }, html = true) {
  const primeiro = (n) => (/\p{L}/u.test(String(n || '')) ? String(n).trim().split(/\s+/)[0] : '');
  const v = (t) => (html ? escapar(t) : t);
  return String(texto || '')
    .replace(/,?\s*\{nome\}/gi, (m) => (primeiro(nomeCliente) ? m.replace(/\{nome\}/i, v(primeiro(nomeCliente))) : ''))
    .replace(/\{atendente\}/gi, v(primeiro(nomeAtendente)))
    .replace(/\{hotel\}/gi, v(nomeHotel || ''));
}

// ---------------------------------------------------------------------------
// Editor com formatação
export function EditorHtml({ valor, onMudar, altura = 260, rotulo = 'Texto' }) {
  const ref = useRef(null);
  const [verCodigo, setVerCodigo] = useState(false);
  const ultimo = useRef(null);

  useEffect(() => {
    if (!ref.current || verCodigo) return;
    if (valor !== ultimo.current && document.activeElement !== ref.current) {
      ref.current.innerHTML = limparHtmlTela(valor || '');
      ultimo.current = valor;
    }
  }, [valor, verCodigo]);

  function mudou() {
    const html = ref.current?.innerHTML || '';
    ultimo.current = html;
    onMudar(html);
  }

  function comando(nome, argumento = null) {
    ref.current?.focus();
    try { document.execCommand(nome, false, argumento); } catch (e) { /* navegador sem suporte */ }
    mudou();
  }

  function link() {
    const url = window.prompt('Endereço do link (começando com https://):', 'https://');
    if (url && /^https?:\/\//i.test(url.trim())) comando('createLink', url.trim());
  }

  function imagem() {
    const url = window.prompt('Endereço da imagem (começando com https://):', 'https://');
    if (url && /^https:\/\//i.test(url.trim())) comando('insertImage', url.trim());
  }

  return (
    <div className="me-editor">
      <div className="me-barra" role="toolbar" aria-label={`Formatação: ${rotulo}`}>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => comando('bold')} title="Negrito"><strong>N</strong></button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => comando('italic')} title="Itálico"><em>I</em></button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => comando('underline')} title="Sublinhado"><u>S</u></button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => comando('formatBlock', 'h3')} title="Título">T</button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => comando('formatBlock', 'p')} title="Parágrafo normal">¶</button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => comando('insertUnorderedList')} title="Lista">•</button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => comando('insertOrderedList')} title="Lista numerada">1.</button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => comando('justifyCenter')} title="Centralizar">≡</button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={link} title="Link">🔗</button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={imagem} title="Imagem (endereço da internet)">🖼️</button>
        <label className="me-cor" title="Cor do texto">
          A<input type="color" defaultValue="#14532D" onChange={(e) => comando('foreColor', e.target.value)} aria-label="Cor do texto" />
        </label>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => comando('removeFormat')} title="Limpar formatação">⌫</button>
        <select value="" onChange={(e) => { if (e.target.value) comando('insertText', e.target.value); }} aria-label="Inserir variável">
          <option value="">+ variável</option>
          <option value="{nome}">Nome do cliente</option>
          <option value="{atendente}">Nome do atendente</option>
          <option value="{hotel}">Nome do hotel</option>
        </select>
        <button type="button" className={verCodigo ? 'ativo' : ''} onClick={() => { if (verCodigo) ultimo.current = null; setVerCodigo(!verCodigo); }} title="Ver ou colar o código HTML">&lt;/&gt;</button>
      </div>
      {verCodigo ? (
        <textarea className="me-codigo" style={{ minHeight: altura }} value={valor || ''} onChange={(e) => onMudar(e.target.value)} aria-label={`${rotulo} (código HTML)`} />
      ) : (
        <div
          ref={ref}
          className="me-area"
          style={{ minHeight: altura }}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={rotulo}
          onInput={mudou}
          onBlur={() => { const limpo = limparHtmlTela(ref.current?.innerHTML || ''); ultimo.current = limpo; onMudar(limpo); }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Prévia segura (sem scripts)
export function PreviaHtml({ html, altura = 320 }) {
  return (
    <iframe
      className="at-iframe-email"
      style={{ height: altura }}
      title="Prévia do e-mail"
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      srcDoc={`<base target="_blank"><meta charset="utf-8"><div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1F2A26">${limparHtmlTela(html)}</div>`}
    />
  );
}

// ---------------------------------------------------------------------------
// Aba "Modelos de e-mail"
export function ModelosEmail({ hoteis, multiHotel, modelos, usuario, onMudou }) {
  const editaveis = hoteis.filter((h) => h.souAdmin);
  const atual = hoteis.find((h) => h.id === Number(usuario?.hotel_id));
  const [hotel, setHotel] = useState((atual || hoteis[0])?.id || '');
  const [form, setForm] = useState(null);
  const [ver, setVer] = useState(null);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const podeEditar = editaveis.some((h) => h.id === Number(hotel));
  const lista = modelos.filter((m) => m.hotel_id === Number(hotel));

  async function salvar() {
    const nome = String(form.nome || '').trim();
    if (!nome) { setErro('Dê um nome ao modelo.'); return; }
    if (!String(form.corpo_html || '').replace(/<[^>]+>/g, '').trim() && !/<img/i.test(form.corpo_html || '')) { setErro('Escreva o texto do modelo.'); return; }
    setSalvando(true);
    setErro('');
    const registro = {
      nome, categoria: form.categoria || 'OUTRO', assunto: String(form.assunto || '').trim() || null,
      corpo_html: limparHtmlTela(form.corpo_html), ativo: form.ativo !== false,
      atualizado_por_id: usuario.id, atualizado_em: new Date().toISOString(),
    };
    const { error } = form.id
      ? await supabase.from('atendimento_modelos_email').update(registro).eq('id', form.id)
      : await supabase.from('atendimento_modelos_email').insert({ ...registro, hotel_id: Number(hotel), criado_por_id: usuario.id });
    setSalvando(false);
    if (error) {
      setErro(/duplicate|unique/i.test(error.message) ? 'Já existe um modelo com esse nome neste hotel.'
        : /atendimento_modelos_email|schema cache/i.test(error.message) ? 'Falta rodar no Supabase o SQL da Fase 3.' : 'Não foi possível salvar: ' + error.message);
      return;
    }
    setForm(null);
    onMudou();
  }

  async function duplicar(m) {
    let nome = `${m.nome} (cópia)`;
    let n = 2;
    while (lista.some((x) => x.nome.toLowerCase() === nome.toLowerCase())) { nome = `${m.nome} (cópia ${n})`; n += 1; }
    const { error } = await supabase.from('atendimento_modelos_email').insert({
      hotel_id: m.hotel_id, nome, categoria: m.categoria, assunto: m.assunto, corpo_html: m.corpo_html, criado_por_id: usuario.id,
    });
    if (error) { setErro('Não foi possível duplicar: ' + error.message); return; }
    onMudou();
  }

  async function excluir(m) {
    if (!window.confirm(`Excluir o modelo “${m.nome}”?`)) return;
    const { error } = await supabase.from('atendimento_modelos_email').delete().eq('id', m.id);
    if (error) { setErro('Não foi possível excluir: ' + error.message); return; }
    onMudou();
  }

  const grupos = Object.keys(CATEGORIAS_MODELO).map((cat) => [cat, lista.filter((m) => m.categoria === cat)]).filter(([, l]) => l.length);

  return (
    <section className="at-cartao">
      <div className="at-canal-topo">
        <div>
          <h2>✉️ Modelos de e-mail</h2>
          <p className="at-dica" style={{ margin: 0 }}>
            Textos prontos e formatados para responder e-mails (e também para mandar no WhatsApp, sem a formatação).
            Use {'{nome}'}, {'{atendente}'} e {'{hotel}'} — trocados sozinhos ao usar.
            {!podeEditar && ' Só o administrador cria e edita os modelos.'}
          </p>
        </div>
        <div className="at-botoes" style={{ marginTop: 0 }}>
          {multiHotel && (
            <select className="at-select" value={hotel} onChange={(e) => { setHotel(Number(e.target.value)); setForm(null); }} aria-label="Hotel">
              {hoteis.map((h) => <option key={h.id} value={h.id}>{h.nome}</option>)}
            </select>
          )}
          {podeEditar && <button type="button" className="at-btn at-btn-verde" onClick={() => { setErro(''); setForm({ nome: '', categoria: 'COTACAO', assunto: '', corpo_html: '', ativo: true }); }}>+ Novo modelo</button>}
        </div>
      </div>
      {erro && <div className="aviso-erro">{erro}</div>}

      {form && (
        <div className="at-canal" style={{ background: '#FAFBF9' }}>
          <div className="at-grade">
            <div>
              <label className="rotulo" htmlFor="me-nome">Nome do modelo</label>
              <input id="me-nome" className="campo" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Ex.: Formas de pagamento" />
            </div>
            <div>
              <label className="rotulo" htmlFor="me-cat">Categoria</label>
              <select id="me-cat" className="campo" value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })}>
                {Object.entries(CATEGORIAS_MODELO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
          <label className="rotulo" htmlFor="me-assunto">Assunto do e-mail (usado ao começar um e-mail novo)</label>
          <input id="me-assunto" className="campo" value={form.assunto || ''} onChange={(e) => setForm({ ...form, assunto: e.target.value })} placeholder="Ex.: Formas de pagamento — {hotel}" />
          <label className="rotulo">Texto</label>
          <EditorHtml valor={form.corpo_html} onMudar={(html) => setForm((f) => ({ ...f, corpo_html: html }))} rotulo="Texto do modelo" />
          <p className="at-dica">Dica: copie o texto do Asksuite (ou de um e-mail) e cole aqui — a formatação vem junto.</p>
          <label className="at-detalhe" style={{ marginTop: 6 }}>
            <input type="checkbox" checked={form.ativo !== false} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} />
            <span style={{ color: 'var(--tinta)' }}>Ativo (aparece para a equipe usar)</span>
          </label>
          <div className="at-botoes">
            <button type="button" className="at-btn at-btn-verde" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar modelo'}</button>
            <button type="button" className="at-btn" onClick={() => setForm(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {!form && lista.length === 0 && (
        <p className="at-vazio">Nenhum modelo neste hotel ainda.{podeEditar ? ' Clique em “+ Novo modelo”.' : ''}</p>
      )}
      {!form && grupos.map(([cat, itens]) => (
        <div key={cat}>
          <p className="at-lateral-titulo" style={{ marginTop: 14 }}>{CATEGORIAS_MODELO[cat]}</p>
          {itens.map((m) => (
            <div key={m.id} className={`at-canal ${m.ativo ? '' : 'me-inativo'}`}>
              <div className="at-canal-topo">
                <div>
                  <strong>{m.nome}</strong>{!m.ativo && <span className="at-chip" style={{ marginLeft: 6 }}>inativo</span>}
                  {m.assunto && <div className="at-dica" style={{ margin: 0 }}>Assunto: {m.assunto}</div>}
                  <div className="at-dica" style={{ margin: 0 }}>Atualizado {dataHora(m.atualizado_em)}</div>
                </div>
                <div className="at-botoes" style={{ marginTop: 0 }}>
                  <button type="button" className="at-btn" onClick={() => setVer(ver === m.id ? null : m.id)}>{ver === m.id ? 'Fechar' : 'Ver'}</button>
                  {podeEditar && (
                    <>
                      <button type="button" className="at-btn" onClick={() => { setErro(''); setForm({ ...m }); }}>Editar</button>
                      <button type="button" className="at-btn" onClick={() => duplicar(m)}>Duplicar</button>
                      <button type="button" className="at-btn at-btn-perigo" onClick={() => excluir(m)}>Excluir</button>
                    </>
                  )}
                </div>
              </div>
              {ver === m.id && <PreviaHtml html={m.corpo_html} />}
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Escolher um modelo na conversa
export function EscolherModelo({ modelos, onEscolher, onFechar, paraWhatsApp }) {
  const [busca, setBusca] = useState('');
  const [ver, setVer] = useState(null);
  const termo = busca.trim().toLowerCase();
  const lista = modelos.filter((m) => m.ativo !== false && (!termo || m.nome.toLowerCase().includes(termo)
    || htmlParaTextoTela(m.corpo_html).toLowerCase().includes(termo)));
  const visto = lista.find((m) => m.id === ver);

  return (
    <div className="at-overlay" role="dialog" aria-modal="true" aria-label="Escolher modelo">
      <div className="at-modal at-modal-largo">
        <div className="at-modal-topo">
          <h2>📄 Modelos de e-mail</h2>
          <button type="button" className="at-btn" onClick={onFechar} aria-label="Fechar">✕</button>
        </div>
        {paraWhatsApp && <p className="at-dica" style={{ marginTop: 0 }}>No WhatsApp o modelo entra como texto simples (sem cores e imagens). Você pode ajustar antes de enviar.</p>}
        <input className="campo at-campo-pequeno" type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="🔎 Procurar modelo" />
        {lista.length === 0 && <p className="at-vazio">Nenhum modelo{termo ? ' com essa busca' : ' neste hotel ainda. O administrador cria na aba “Modelos de e-mail”'}.</p>}
        <div className="me-escolher">
          {lista.map((m) => (
            <button key={m.id} type="button" className={`at-historico ${ver === m.id ? 'me-visto' : ''}`} onClick={() => setVer(m.id)}>
              <span><strong>{m.nome}</strong> <small>· {CATEGORIAS_MODELO[m.categoria] || m.categoria}</small></span>
              <small>{htmlParaTextoTela(m.corpo_html).slice(0, 120)}</small>
            </button>
          ))}
        </div>
        {visto && <PreviaHtml html={visto.corpo_html} altura={260} />}
        <div className="at-botoes">
          <button type="button" className="at-btn at-btn-verde" disabled={!visto} onClick={() => onEscolher(visto)}>Usar este modelo</button>
          <button type="button" className="at-btn" onClick={onFechar}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
