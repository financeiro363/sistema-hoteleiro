'use client';

// ============================================================================
// CAIXA DE ENTRADA — tela da conversa
// ============================================================================
// - Conversa: topo (responsável, situação), mensagens e caixa de escrever
// - ModalModelo: modelos aprovados do WhatsApp (obrigatórios fora das 24 h)
// - PainelReserva: reserva da Cloudbeds ao lado da conversa
// - NovaConversa: começar conversa por WhatsApp (modelo) ou e-mail
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import {
  chamarApi, subirArquivo, avisarCabecalho, STATUS_CONVERSA, ICONE_CANAL, NOME_CANAL,
  soHora, dataHora, rotuloDia, chaveDia, dataCurta, noites, dinheiro, iniciais, tamanhoArquivo,
  aplicarVariaveis, separarCitacao, partesComLinks,
} from './util';

const JANELA_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Texto com links clicáveis e a formatação do WhatsApp (*negrito*, _itálico_, ~riscado~)
const REGEX_FORMATO = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g;
function comFormatacao(texto, chave) {
  return String(texto || '').split(REGEX_FORMATO).map((parte, i) => {
    if (i % 2 === 0) return <span key={`${chave}-${i}`}>{parte}</span>;
    const miolo = parte.slice(1, -1);
    if (parte[0] === '*') return <strong key={`${chave}-${i}`}>{miolo}</strong>;
    if (parte[0] === '_') return <em key={`${chave}-${i}`}>{miolo}</em>;
    return <s key={`${chave}-${i}`}>{miolo}</s>;
  });
}
function TextoComLinks({ texto }) {
  return partesComLinks(texto).map((p, i) => (p.link
    ? <a key={i} href={p.link} target="_blank" rel="noopener noreferrer">{p.link}</a>
    : <span key={i}>{comFormatacao(p.texto, i)}</span>));
}

// ---------------------------------------------------------------------------
// Anexo (foto, áudio, vídeo, documento). Os links vêm do servidor e valem
// 10 minutos; ficam guardados aqui para não pedir de novo a cada tela.
const linksGuardados = new Map();

async function linkDoAnexo(mensagemId, indice, baixar = false) {
  const chave = `${mensagemId}:${indice}:${baixar ? 'b' : 'v'}`;
  const guardado = linksGuardados.get(chave);
  if (guardado && guardado.expira > Date.now()) return guardado.url;
  const r = await chamarApi('/api/atendimento', { acao: 'anexo', mensagemId, indice, baixar });
  linksGuardados.set(chave, { url: r.url, expira: Date.now() + 9 * 60 * 1000 });
  return r.url;
}

function Anexo({ mensagem, anexo, indice, carregarSozinho }) {
  const mime = String(anexo.mime || '');
  const midia = /^(image|audio|video)\//.test(mime);
  const [url, setUrl] = useState(null);
  const [erro, setErro] = useState(anexo.erro && !anexo.mediaId && !anexo.gmail ? anexo.erro : '');
  const [abrindo, setAbrindo] = useState(false);

  useEffect(() => {
    let ativo = true;
    if (midia && carregarSozinho && !erro) {
      linkDoAnexo(mensagem.id, indice).then((u) => { if (ativo) setUrl(u); }).catch((e) => { if (ativo) setErro(e.message); });
    }
    return () => { ativo = false; };
  }, [mensagem.id, indice, midia, carregarSozinho, erro]);

  async function abrir(baixar) {
    // Abre a aba já no clique (o iPhone bloqueia abas abertas depois de esperar)
    const janela = window.open('', '_blank');
    setAbrindo(true);
    try {
      const link = await linkDoAnexo(mensagem.id, indice, baixar);
      if (janela) { janela.opener = null; janela.location.href = link; } else window.location.href = link;
    } catch (e) {
      if (janela) janela.close();
      setErro(e.message);
    }
    setAbrindo(false);
  }

  if (erro) return <div className="at-erro-envio">⚠️ {anexo.nome || 'Arquivo'}: {erro}</div>;
  if (url && mime.startsWith('image/')) {
    return <img className="at-anexo-img" src={url} alt={anexo.nome || 'imagem'} onClick={() => window.open(url, '_blank', 'noopener')} />;
  }
  if (url && mime.startsWith('audio/')) return <audio className="at-anexo-audio" controls preload="metadata" src={url} />;
  if (url && mime.startsWith('video/')) return <video className="at-anexo-video" controls preload="metadata" src={url} />;
  const icone = mime.startsWith('image/') ? '🖼️' : mime.startsWith('audio/') ? '🎤' : mime.startsWith('video/') ? '🎬' : mime.includes('pdf') ? '📕' : '📄';
  return (
    <button type="button" className="at-anexo-arquivo" onClick={() => abrir(!midia)} disabled={abrindo} title="Abrir / baixar">
      {icone} <span>{anexo.nome || 'arquivo'}</span>
      {anexo.tamanho ? <small>({tamanhoArquivo(anexo.tamanho)})</small> : null}
      {abrindo && <small>…</small>}
    </button>
  );
}

// ---------------------------------------------------------------------------
function StatusEnvio({ m }) {
  if (m.direcao !== 'SAIDA') return null;
  const s = m.status_envio;
  if (s === 'ENVIANDO') return <span title="Enviando">🕓</span>;
  if (s === 'ENVIADA') return <span title="Enviada">✓</span>;
  if (s === 'ENTREGUE') return <span title="Entregue">✓✓</span>;
  if (s === 'VISTA') return <span className="at-check-visto" title="Vista pelo cliente">✓✓</span>;
  if (s === 'FALHOU') return <span title="Não enviada">⚠️</span>;
  return null;
}

function MensagemEmail({ m }) {
  const [mostrarCitado, setMostrarCitado] = useState(false);
  const [formatado, setFormatado] = useState(false);
  const { principal, citado } = useMemo(() => separarCitacao(m.texto || ''), [m.texto]);
  return (
    <>
      <div className="at-email-cab">
        <div><strong>De:</strong> {m.de || '—'}</div>
        {m.para && <div><strong>Para:</strong> {m.para}</div>}
        {m.cc && <div><strong>Cc:</strong> {m.cc}</div>}
        {m.assunto && <div><strong>Assunto:</strong> {m.assunto}</div>}
      </div>
      {formatado && m.html ? (
        <iframe
          className="at-iframe-email"
          title="E-mail formatado"
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          srcDoc={`<base target="_blank"><meta charset="utf-8">${m.html}`}
        />
      ) : (
        <>
          <div className="at-bolha-texto"><TextoComLinks texto={principal || (citado ? '' : '(e-mail sem texto)')} /></div>
          {citado && (
            mostrarCitado
              ? <div className="at-citado">{citado}</div>
              : <button type="button" className="at-link-pequeno" onClick={() => setMostrarCitado(true)}>··· mostrar mensagem anterior</button>
          )}
        </>
      )}
      {m.html && (
        <div><button type="button" className="at-link-pequeno" onClick={() => setFormatado(!formatado)}>
          {formatado ? 'Ver só o texto' : 'Ver e-mail formatado'}
        </button></div>
      )}
    </>
  );
}

function Mensagem({ m, nomeAtendente, nomeContato }) {
  if (m.direcao === 'NOTA') {
    if (m.tipo === 'sistema') {
      return <div className="at-linha nota"><div className="at-sistema">{m.texto} · {nomeAtendente(m.enviado_por_id)} · {soHora(m.data_original || m.criado_em)}</div></div>;
    }
    return (
      <div className="at-linha nota">
        <div className="at-nota">
          <div className="at-nota-autor">📝 Nota interna · {nomeAtendente(m.enviado_por_id)} · {soHora(m.data_original || m.criado_em)}</div>
          <TextoComLinks texto={m.texto} />
        </div>
      </div>
    );
  }
  const saida = m.direcao === 'SAIDA';
  const autor = saida ? (m.enviado_por_id ? nomeAtendente(m.enviado_por_id) : (m.tipo === 'email' ? 'Enviado pelo Gmail' : 'Hotel')) : (nomeContato || m.de || 'Cliente');
  const anexos = Array.isArray(m.anexos) ? m.anexos : [];
  return (
    <div className={`at-linha ${saida ? 'saida' : 'entrada'}`}>
      <div className={`at-bolha ${m.tipo === 'email' ? 'at-bolha-email' : ''} ${m.status_envio === 'FALHOU' ? 'falhou' : ''}`}>
        <div className="at-bolha-autor">{autor}{m.tipo === 'modelo' ? ' · modelo' : ''}</div>
        {m.tipo === 'email' ? <MensagemEmail m={m} /> : null}
        {anexos.length > 0 && (
          <div className="at-anexos">
            {anexos.map((a, i) => <Anexo key={i} mensagem={m} anexo={a} indice={i} carregarSozinho={m.tipo !== 'email'} />)}
          </div>
        )}
        {m.tipo !== 'email' && m.texto && <div className="at-bolha-texto"><TextoComLinks texto={m.texto} /></div>}
        {m.status_envio === 'FALHOU' && <div className="at-erro-envio">Não enviada: {m.erro || 'erro desconhecido'}</div>}
        <div className="at-bolha-rodape">
          <span title={dataHora(m.data_original || m.criado_em)}>{soHora(m.data_original || m.criado_em)}</span>
          <StatusEnvio m={m} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modelos aprovados do WhatsApp
export function ModalModelo({ canal, destino, nomeContato, onFechar, onEnviado }) {
  const [modelos, setModelos] = useState(null);
  const [erro, setErro] = useState('');
  const [escolhido, setEscolhido] = useState(null);
  const [varsCorpo, setVarsCorpo] = useState([]);
  const [varsCab, setVarsCab] = useState([]);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    let ativo = true;
    chamarApi('/api/atendimento', { acao: 'modelos', canalId: canal.id })
      .then((r) => { if (ativo) setModelos(r.modelos || []); })
      .catch((e) => { if (ativo) { setErro(e.message); setModelos([]); } });
    return () => { ativo = false; };
  }, [canal.id]);

  function escolher(chave) {
    const m = (modelos || []).find((x) => `${x.nome}|${x.idioma}` === chave) || null;
    setEscolhido(m);
    const primeiro = String(nomeContato || '').trim().split(/\s+/)[0] || '';
    setVarsCorpo(Array.from({ length: m?.variaveisCorpo || 0 }, (_, i) => (i === 0 ? primeiro : '')));
    setVarsCab(Array.from({ length: m?.variaveisCabecalho || 0 }, () => ''));
  }

  const trocar = (texto, valores) => String(texto || '').replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => valores[Number(n) - 1] || `{{${n}}}`);
  const previa = escolhido
    ? [escolhido.cabecalho ? `*${trocar(escolhido.cabecalho, varsCab)}*` : null, trocar(escolhido.corpo, varsCorpo), escolhido.rodape ? `_${escolhido.rodape}_` : null]
      .filter(Boolean).join('\n')
    : '';

  async function enviar() {
    if (!escolhido) { setErro('Escolha um modelo.'); return; }
    if ([...varsCorpo, ...varsCab].some((v) => !String(v).trim())) { setErro('Preencha todas as variáveis.'); return; }
    setEnviando(true);
    setErro('');
    try {
      const r = await chamarApi('/api/atendimento', {
        acao: 'enviar', ...destino,
        modelo: { nome: escolhido.nome, idioma: escolhido.idioma, variaveisCorpo: varsCorpo, variaveisCabecalho: varsCab, textoFinal: previa },
      });
      onEnviado(r);
    } catch (e) {
      setErro(e.message);
      setEnviando(false);
    }
  }

  return (
    <div className="at-overlay" role="dialog" aria-modal="true" aria-label="Enviar modelo">
      <div className="at-modal">
        <div className="at-modal-topo">
          <h2>Enviar modelo do WhatsApp</h2>
          <button type="button" className="at-btn" onClick={onFechar} aria-label="Fechar">✕</button>
        </div>
        <p className="texto-suave" style={{ fontSize: 13, marginTop: 0 }}>
          Modelos são mensagens aprovadas pela Meta. São obrigatórios para começar uma conversa ou responder depois de 24 horas.
          A Meta cobra por modelo enviado.
        </p>
        {modelos === null ? <p className="texto-suave">Buscando modelos aprovados…</p> : (
          <>
            <label className="rotulo" htmlFor="at-modelo">Modelo</label>
            <select id="at-modelo" className="campo" value={escolhido ? `${escolhido.nome}|${escolhido.idioma}` : ''} onChange={(e) => escolher(e.target.value)}>
              <option value="">— escolha —</option>
              {modelos.map((m) => <option key={`${m.nome}|${m.idioma}`} value={`${m.nome}|${m.idioma}`}>{m.nome} ({m.idioma}) · {m.categoria === 'MARKETING' ? 'marketing' : m.categoria === 'UTILITY' ? 'utilidade' : String(m.categoria || '').toLowerCase()}</option>)}
            </select>
            {modelos.length === 0 && !erro && <p className="at-dica">Nenhum modelo aprovado. Crie modelos no Gerenciador do WhatsApp (business.facebook.com → WhatsApp Manager → Modelos de mensagem).</p>}
            {escolhido?.cabecalhoMidia && <p className="at-erro-envio">Este modelo tem {escolhido.cabecalhoMidia === 'IMAGE' ? 'imagem' : 'arquivo'} no topo — ainda não dá para enviar este tipo por aqui.</p>}
            {varsCab.map((v, i) => (
              <div key={`c${i}`}>
                <label className="rotulo">Título — variável {`{{${i + 1}}}`}</label>
                <input className="campo" value={v} onChange={(e) => setVarsCab(varsCab.map((x, j) => (j === i ? e.target.value : x)))} />
              </div>
            ))}
            {varsCorpo.map((v, i) => (
              <div key={`b${i}`}>
                <label className="rotulo">Variável {`{{${i + 1}}}`}</label>
                <input className="campo" value={v} onChange={(e) => setVarsCorpo(varsCorpo.map((x, j) => (j === i ? e.target.value : x)))} />
              </div>
            ))}
            {escolhido && <div className="at-previa-modelo">{previa}{escolhido.botoes?.length ? `\n\n[${escolhido.botoes.join('] [')}]` : ''}</div>}
          </>
        )}
        {erro && <div className="aviso-erro" style={{ marginTop: 10 }}>{erro}</div>}
        <div className="at-botoes">
          <button type="button" className="at-btn at-btn-verde" onClick={enviar} disabled={enviando || !escolhido || !!escolhido?.cabecalhoMidia}>
            {enviando ? 'Enviando…' : 'Enviar modelo'}
          </button>
          <button type="button" className="at-btn" onClick={onFechar}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Caixa de escrever
function Escrever({ conversa, canal, usuario, respostas, janelaAberta, onEnviado, onAbrirModelo }) {
  const [texto, setTexto] = useState('');
  const [nota, setNota] = useState(false);
  const [anexos, setAnexos] = useState([]);
  const [subindo, setSubindo] = useState(0);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const [mostrarCc, setMostrarCc] = useState(false);
  const [cc, setCc] = useState('');
  const [indiceSugestao, setIndiceSugestao] = useState(0);
  const [listaRespostas, setListaRespostas] = useState(false);
  const campoRef = useRef(null);
  const arquivoRef = useRef(null);
  const ehEmail = canal?.tipo === 'EMAIL';

  // Rascunho por conversa (só neste navegador)
  useEffect(() => {
    try { setTexto(sessionStorage.getItem(`at-rascunho-${conversa.id}`) || ''); } catch (e) { setTexto(''); }
    setAnexos([]); setErro(''); setNota(false); setCc(''); setMostrarCc(false);
  }, [conversa.id]);
  useEffect(() => {
    try { sessionStorage.setItem(`at-rascunho-${conversa.id}`, texto); } catch (e) { /* nada */ }
  }, [texto, conversa.id]);

  // Altura automática
  useEffect(() => {
    const el = campoRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [texto]);

  const busca = /^\/(\S*)$/.exec(texto);
  const sugestoes = useMemo(() => {
    if (!busca && !listaRespostas) return [];
    const termo = (busca?.[1] || '').toLowerCase();
    return (respostas || []).filter((r) => !termo || r.atalho.toLowerCase().startsWith(termo) || String(r.titulo || '').toLowerCase().includes(termo)).slice(0, 8);
  }, [busca, listaRespostas, respostas]);

  function usarResposta(r) {
    const preenchido = aplicarVariaveis(r.texto, { nomeCliente: conversa.contato_nome, nomeAtendente: usuario.nome });
    setTexto(busca ? preenchido : (texto ? `${texto}\n${preenchido}` : preenchido));
    setListaRespostas(false);
    setIndiceSugestao(0);
    setTimeout(() => campoRef.current?.focus(), 0);
  }

  async function escolherArquivos(evento) {
    const arquivos = [...(evento.target.files || [])];
    evento.target.value = '';
    for (const arquivo of arquivos) {
      setSubindo((n) => n + 1);
      try {
        const subido = await subirArquivo(arquivo);
        setAnexos((lista) => [...lista, subido]);
      } catch (e) { setErro(e.message); }
      setSubindo((n) => n - 1);
    }
  }

  async function enviar() {
    if (enviando || subindo) return;
    const conteudo = texto.trim();
    if (!conteudo && !anexos.length) return;
    setEnviando(true);
    setErro('');
    try {
      await chamarApi('/api/atendimento', {
        acao: 'enviar', conversaId: conversa.id, texto: conteudo, nota,
        anexos: nota ? [] : anexos, cc: ehEmail && !nota ? cc : undefined,
      });
      setTexto(''); setAnexos([]); setCc(''); setMostrarCc(false);
      if (nota) setNota(false); // depois de salvar a nota, volta a escrever para o cliente
      try { sessionStorage.removeItem(`at-rascunho-${conversa.id}`); } catch (e) { /* nada */ }
    } catch (e) {
      setErro(e.message);
    }
    setEnviando(false);
    onEnviado();
    setTimeout(() => campoRef.current?.focus(), 0);
  }

  function aoTeclar(e) {
    if (sugestoes.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setIndiceSugestao((i) => (i + 1) % sugestoes.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setIndiceSugestao((i) => (i - 1 + sugestoes.length) % sugestoes.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); usarResposta(sugestoes[Math.min(indiceSugestao, sugestoes.length - 1)]); return; }
      if (e.key === 'Escape') { setListaRespostas(false); setTexto(busca ? '' : texto); return; }
    }
    // WhatsApp: Enter envia (Shift+Enter quebra linha). E-mail: Ctrl+Enter envia.
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || (!ehEmail && !e.shiftKey))) {
      e.preventDefault();
      enviar();
    }
  }

  const bloqueadoPelaJanela = canal?.tipo === 'WHATSAPP' && !janelaAberta && !nota;
  const canalDesligado = canal && !canal.ativo;

  return (
    <div className={`at-escrever ${nota ? 'nota' : ''}`}>
      {sugestoes.length > 0 && (
        <div className="at-sugestoes">
          {sugestoes.map((r, i) => (
            <button key={r.id} type="button" className={`at-sugestao ${i === indiceSugestao ? 'ativa' : ''}`} onMouseDown={(e) => { e.preventDefault(); usarResposta(r); }}>
              <strong>/{r.atalho}</strong> {r.titulo ? `— ${r.titulo}` : ''}
              <div>{r.texto}</div>
            </button>
          ))}
        </div>
      )}
      {listaRespostas && !sugestoes.length && (
        <div className="at-sugestoes"><div className="at-vazio">Nenhuma resposta pronta. Crie na aba “Respostas prontas”.</div></div>
      )}

      {canalDesligado && <div className="at-aviso-janela">O canal “{canal.nome}” está desligado. Só é possível escrever notas internas.</div>}
      {bloqueadoPelaJanela && !canalDesligado && (
        <div className="at-aviso-janela">
          <span>⏰ Passaram 24 horas desde a última mensagem do cliente. Pela regra do WhatsApp, agora só dá para enviar um <strong>modelo aprovado</strong>.</span>
          <button type="button" className="at-btn" onClick={onAbrirModelo}>Enviar modelo</button>
        </div>
      )}

      <div className="at-escrever-ferramentas">
        <button type="button" className={`at-ferramenta ${nota ? 'ativa' : ''}`} onClick={() => setNota(!nota)} title="A nota fica só para a equipe; o cliente não vê">
          📝 {nota ? 'Escrevendo nota interna' : 'Nota interna'}
        </button>
        {!nota && (
          <>
            <button type="button" className="at-ferramenta" onClick={() => arquivoRef.current?.click()} disabled={canalDesligado || bloqueadoPelaJanela}>📎 Anexar</button>
            <input ref={arquivoRef} type="file" multiple hidden onChange={escolherArquivos} />
          </>
        )}
        <button type="button" className="at-ferramenta" onClick={() => setListaRespostas(!listaRespostas)}>⚡ Respostas prontas</button>
        {canal?.tipo === 'WHATSAPP' && !nota && (
          <button type="button" className="at-ferramenta" onClick={onAbrirModelo} disabled={canalDesligado}>📋 Modelo</button>
        )}
        {ehEmail && !nota && (
          <button type="button" className="at-ferramenta" onClick={() => setMostrarCc(!mostrarCc)}>Cc</button>
        )}
      </div>

      {mostrarCc && ehEmail && !nota && (
        <div className="at-cc">
          <span>Cc:</span>
          <input className="campo at-campo-pequeno" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="outro@email.com, mais@email.com" />
        </div>
      )}

      {(anexos.length > 0 || subindo > 0) && !nota && (
        <div className="at-anexos-escolhidos">
          {anexos.map((a, i) => (
            <span key={a.caminho} className="at-anexo-chip">
              📎 {a.nome} ({tamanhoArquivo(a.tamanho)})
              <button type="button" onClick={() => setAnexos(anexos.filter((_, j) => j !== i))} aria-label="Remover anexo">✕</button>
            </span>
          ))}
          {subindo > 0 && <span className="at-anexo-chip">Enviando {subindo} arquivo(s)…</span>}
        </div>
      )}

      <div className="at-escrever-linha">
        <textarea
          ref={campoRef}
          className="at-textarea"
          rows={1}
          value={texto}
          disabled={(canalDesligado || bloqueadoPelaJanela) && !nota}
          onChange={(e) => { setTexto(e.target.value); setIndiceSugestao(0); }}
          onKeyDown={aoTeclar}
          placeholder={nota ? 'Nota para a equipe (o cliente não vê)…'
            : ehEmail ? 'Escreva a resposta do e-mail… (Ctrl+Enter envia; digite / para respostas prontas)'
              : 'Escreva a mensagem… (Enter envia; digite / para respostas prontas)'}
        />
        <button type="button" className="at-btn at-btn-verde at-btn-enviar" onClick={enviar}
          disabled={enviando || subindo > 0 || (!texto.trim() && !anexos.length) || ((canalDesligado || bloqueadoPelaJanela) && !nota)}>
          {enviando ? '…' : nota ? 'Salvar nota' : 'Enviar'}
        </button>
      </div>
      {erro && <div className="aviso-erro" style={{ marginTop: 8, marginBottom: 0 }}>{erro}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conversa completa
export function Conversa({
  conversa, canal, mensagens, carregando, usuario, atendentes, respostas,
  onRecarregar, onVoltar, onAlternarLateral, lateralAberta,
}) {
  const [mostrarModelo, setMostrarModelo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const fimRef = useRef(null);
  const listaRef = useRef(null);
  const ultimoTamanho = useRef({ id: null, n: 0 });

  const nomesAtendentes = useMemo(() => Object.fromEntries((atendentes || []).map((a) => [a.id, a.nome])), [atendentes]);
  const nomeAtendente = (id) => (id ? (nomesAtendentes[id] || `Usuário #${id}`) : 'Sistema');

  // Rola para o fim ao abrir a conversa e quando chega mensagem nova
  useEffect(() => {
    const el = listaRef.current;
    if (!el) return;
    const mesmaConversa = ultimoTamanho.current.id === conversa.id;
    const pertoDoFim = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (!mesmaConversa || pertoDoFim || mensagens.length > ultimoTamanho.current.n) {
      if (!mesmaConversa || pertoDoFim) fimRef.current?.scrollIntoView({ block: 'end' });
    }
    ultimoTamanho.current = { id: conversa.id, n: mensagens.length };
  }, [mensagens, conversa.id]);

  const ultimaEntrada = conversa.ultima_entrada_em ? new Date(conversa.ultima_entrada_em).getTime() : 0;
  const janelaAberta = Date.now() - ultimaEntrada < JANELA_MS;
  const fimJanela = ultimaEntrada ? new Date(ultimaEntrada + JANELA_MS) : null;

  async function alterar(campos) {
    setSalvando(true);
    setErro('');
    const { error } = await supabase.from('atendimento_conversas').update({ ...campos, atualizado_em: new Date().toISOString() }).eq('id', conversa.id);
    setSalvando(false);
    if (error) { setErro('Não foi possível salvar: ' + error.message); return; }
    avisarCabecalho();
    onRecarregar();
  }

  const nomeContato = conversa.contato_nome || conversa.contato_endereco || 'Cliente';

  return (
    <>
      <div className="at-conv-topo">
        <button type="button" className="at-btn at-voltar" onClick={onVoltar} aria-label="Voltar para a lista">←</button>
        <div className="at-avatar">{iniciais(nomeContato)}<span className="at-avatar-canal">{ICONE_CANAL[conversa.canal_tipo]}</span></div>
        <div className="at-conv-titulo">
          <div className="at-conv-nome">{nomeContato}</div>
          <div className="at-conv-sub">
            {NOME_CANAL[conversa.canal_tipo]}{canal ? ` · ${canal.nome}` : ' · canal removido'}
            {conversa.contato_endereco && conversa.contato_nome ? ` · ${conversa.contato_endereco}` : ''}
            {conversa.canal_tipo === 'EMAIL' && conversa.assunto ? ` · ${conversa.assunto}` : ''}
          </div>
          {conversa.canal_tipo === 'WHATSAPP' && (
            <div className="at-conv-sub">
              {janelaAberta ? `🟢 Pode responder livremente até ${soHora(fimJanela)}${rotuloDia(fimJanela) !== 'Hoje' ? ` de ${rotuloDia(fimJanela).toLowerCase()}` : ''}` : '⏰ Janela de 24 h fechada — só modelos'}
            </div>
          )}
        </div>
        <div className="at-conv-acoes">
          <select className="at-select" value={conversa.responsavel_id || ''} disabled={salvando}
            onChange={(e) => alterar({ responsavel_id: e.target.value ? Number(e.target.value) : null })} aria-label="Responsável">
            <option value="">Sem responsável</option>
            {(atendentes || []).map((a) => <option key={a.id} value={a.id}>{a.id === usuario.id ? `${a.nome} (eu)` : a.nome}</option>)}
          </select>
          <select className="at-select" value={conversa.status} disabled={salvando}
            onChange={(e) => alterar({ status: e.target.value })} aria-label="Situação">
            {Object.entries(STATUS_CONVERSA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          {conversa.status !== 'RESOLVIDA' && (
            <button type="button" className="at-btn at-btn-verde" onClick={() => alterar({ status: 'RESOLVIDA' })} disabled={salvando}>✓ Resolver</button>
          )}
          <button type="button" className="at-btn" onClick={onAlternarLateral} title="Reserva na Cloudbeds">
            🏨 {lateralAberta ? 'Fechar reserva' : 'Reserva'}
          </button>
        </div>
      </div>
      {erro && <div className="aviso-erro" style={{ margin: 8 }}>{erro}</div>}

      <div className="at-mensagens" ref={listaRef}>
        {carregando && !mensagens.length ? <div className="at-vazio">Carregando mensagens…</div> : null}
        {mensagens.map((m, i) => {
          const quando = m.data_original || m.criado_em;
          const anterior = mensagens[i - 1];
          const novoDia = !anterior || chaveDia(anterior.data_original || anterior.criado_em) !== chaveDia(quando);
          return (
            <div key={m.id}>
              {novoDia && <div className="at-dia"><span>{rotuloDia(quando)}</span></div>}
              <Mensagem m={m} nomeAtendente={nomeAtendente} nomeContato={conversa.contato_nome} />
            </div>
          );
        })}
        <div ref={fimRef} />
      </div>

      <Escrever
        conversa={conversa} canal={canal} usuario={usuario} respostas={respostas}
        janelaAberta={janelaAberta} onEnviado={onRecarregar} onAbrirModelo={() => setMostrarModelo(true)}
      />

      {mostrarModelo && canal && (
        <ModalModelo
          canal={canal} destino={{ conversaId: conversa.id }} nomeContato={conversa.contato_nome}
          onFechar={() => setMostrarModelo(false)}
          onEnviado={() => { setMostrarModelo(false); onRecarregar(); }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Reserva da Cloudbeds
function CartaoReserva({ r, ligada, onLigar, onDesligar, ocupado }) {
  const n = noites(r.checkin, r.checkout);
  return (
    <div className="at-reserva">
      <div className="at-reserva-topo">
        <span className="at-reserva-nome">{r.nome}</span>
        <span className={`at-chip ${r.status === 'checked_in' ? 'at-chip-resolvida' : r.status === 'canceled' ? 'at-chip-pendente' : ''}`}>{r.statusTexto}</span>
      </div>
      {r.erro ? <div className="at-erro-envio">{r.erro}</div> : (
        <>
          <div className="at-dado"><span>Reserva</span><span>{r.reservationId}</span></div>
          <div className="at-dado"><span>Entrada → Saída</span><span>{dataCurta(r.checkin)} → {dataCurta(r.checkout)}{n ? ` (${n} noite${n > 1 ? 's' : ''})` : ''}</span></div>
          {r.quartos?.length > 0 && <div className="at-dado"><span>Quarto</span><span>{r.quartos.join(', ')}</span></div>}
          {r.adultos ? <div className="at-dado"><span>Hóspedes</span><span>{r.adultos} adulto(s){r.criancas ? ` + ${r.criancas} criança(s)` : ''}</span></div> : null}
          {r.total !== null && <div className="at-dado"><span>Total</span><span>{dinheiro(r.total)}</span></div>}
          {r.saldo !== null && <div className="at-dado"><span>Falta pagar</span><span style={{ color: r.saldo > 0 ? 'var(--erro-texto)' : 'var(--sucesso-texto)' }}>{dinheiro(r.saldo)}</span></div>}
          {r.origem && <div className="at-dado"><span>Origem</span><span>{r.origem}</span></div>}
          {(r.telefone || r.email) && <div className="at-dado"><span>Contato</span><span>{[r.telefone, r.email].filter(Boolean).join(' · ')}</span></div>}
        </>
      )}
      <div className="at-reserva-acoes">
        {r.link && <a className="at-btn" href={r.link} target="_blank" rel="noopener noreferrer">Abrir na Cloudbeds ↗</a>}
        {ligada
          ? <button type="button" className="at-btn at-btn-perigo" onClick={onDesligar} disabled={ocupado}>Desligar</button>
          : <button type="button" className="at-btn at-btn-verde" onClick={onLigar} disabled={ocupado}>Ligar à conversa</button>}
      </div>
    </div>
  );
}

export function PainelReserva({ conversa, onMudou }) {
  const [carregando, setCarregando] = useState(false);
  const [vinculada, setVinculada] = useState(null);
  const [reservas, setReservas] = useState(null);
  const [busca, setBusca] = useState('');
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);

  async function buscar(textoBusca) {
    setCarregando(true);
    setErro('');
    try {
      const r = await chamarApi('/api/atendimento', { acao: 'cloudbeds_buscar', conversaId: conversa.id, busca: textoBusca || undefined });
      if (!textoBusca) setVinculada(r.vinculada);
      setReservas(r.reservas || []);
    } catch (e) { setErro(e.message); }
    setCarregando(false);
  }

  useEffect(() => {
    setVinculada(null); setReservas(null); setBusca(''); setErro('');
    if (conversa.cloudbeds_reservation_id) buscar();
  }, [conversa.id, conversa.cloudbeds_reservation_id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function vincular(reservationId) {
    setOcupado(true);
    setErro('');
    try {
      await chamarApi('/api/atendimento', { acao: 'cloudbeds_vincular', conversaId: conversa.id, reservationId });
      onMudou();
    } catch (e) { setErro(e.message); }
    setOcupado(false);
  }

  return (
    <>
      <div className="at-lateral-bloco">
        <p className="at-lateral-titulo">Contato</p>
        <div className="at-dado"><span>Nome</span><span>{conversa.contato_nome || '—'}</span></div>
        <div className="at-dado"><span>{conversa.canal_tipo === 'EMAIL' ? 'E-mail' : 'Telefone'}</span><span>{conversa.contato_endereco || '—'}</span></div>
        <div className="at-dado"><span>Primeiro contato</span><span>{dataHora(conversa.criado_em)}</span></div>
      </div>
      <div className="at-lateral-bloco">
        <p className="at-lateral-titulo">Reserva na Cloudbeds</p>
        {erro && <div className="aviso-erro" style={{ fontSize: 13 }}>{erro}</div>}
        {vinculada && (
          <CartaoReserva r={vinculada} ligada ocupado={ocupado} onDesligar={() => vincular(null)} />
        )}
        {!vinculada && reservas === null && !carregando && (
          <button type="button" className="at-btn at-btn-verde" onClick={() => buscar()} style={{ width: '100%' }}>
            🔎 Procurar reservas deste cliente
          </button>
        )}
        {carregando && <p className="texto-suave" style={{ fontSize: 13 }}>Consultando a Cloudbeds…</p>}
        {reservas && !carregando && (
          <>
            {reservas.length === 0 && !vinculada
              ? <p className="texto-suave" style={{ fontSize: 13 }}>Nenhuma reserva atual ou futura encontrada{busca ? ` para “${busca}”` : ' com o telefone/e-mail deste contato'}.</p>
              : reservas.filter((r) => r.reservationId !== vinculada?.reservationId).map((r) => (
                <CartaoReserva key={r.reservationId} r={r} ocupado={ocupado} onLigar={() => vincular(r.reservationId)} />
              ))}
          </>
        )}
        <form onSubmit={(e) => { e.preventDefault(); if (busca.trim()) buscar(busca.trim()); }} style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <input className="campo at-campo-pequeno" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome, e-mail ou nº da reserva" />
          <button type="submit" className="at-btn" disabled={carregando || !busca.trim()}>Buscar</button>
        </form>
        <p className="at-dica">Procura reservas com saída de 3 dias atrás até 1 ano à frente.</p>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Começar conversa nova
export function NovaConversa({ canais, onFechar, onCriada }) {
  const ativos = (canais || []).filter((c) => c.ativo && (c.tipo === 'WHATSAPP' || c.tipo === 'EMAIL'));
  const [canalId, setCanalId] = useState(ativos[0]?.id || '');
  const [para, setPara] = useState('');
  const [nome, setNome] = useState('');
  const [assunto, setAssunto] = useState('');
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [modelo, setModelo] = useState(false);
  const canal = ativos.find((c) => String(c.id) === String(canalId));

  async function enviarEmail() {
    setEnviando(true);
    setErro('');
    try {
      const r = await chamarApi('/api/atendimento', { acao: 'enviar', canalId: canal.id, para, nome, assunto, texto });
      onCriada(r.conversaId);
    } catch (e) { setErro(e.message); setEnviando(false); }
  }

  if (!ativos.length) {
    return (
      <div className="at-overlay" role="dialog" aria-modal="true">
        <div className="at-modal">
          <div className="at-modal-topo"><h2>Nova conversa</h2><button type="button" className="at-btn" onClick={onFechar}>✕</button></div>
          <p>Nenhum canal ligado ainda. O administrador conecta WhatsApp e e-mail na aba “Canais”.</p>
        </div>
      </div>
    );
  }

  if (modelo && canal?.tipo === 'WHATSAPP') {
    return (
      <ModalModelo
        canal={canal} destino={{ canalId: canal.id, para, nome }} nomeContato={nome}
        onFechar={() => setModelo(false)} onEnviado={(r) => onCriada(r.conversaId)}
      />
    );
  }

  return (
    <div className="at-overlay" role="dialog" aria-modal="true" aria-label="Nova conversa">
      <div className="at-modal">
        <div className="at-modal-topo"><h2>Nova conversa</h2><button type="button" className="at-btn" onClick={onFechar} aria-label="Fechar">✕</button></div>
        <label className="rotulo" htmlFor="nc-canal">Enviar por</label>
        <select id="nc-canal" className="campo" value={canalId} onChange={(e) => setCanalId(e.target.value)}>
          {ativos.map((c) => <option key={c.id} value={c.id}>{ICONE_CANAL[c.tipo]} {c.nome}{c.endereco_exibicao && c.endereco_exibicao !== c.nome ? ` (${c.endereco_exibicao})` : ''}</option>)}
        </select>
        <label className="rotulo" htmlFor="nc-para">{canal?.tipo === 'EMAIL' ? 'E-mail do cliente' : 'WhatsApp do cliente (com DDD)'}</label>
        <input id="nc-para" className="campo" value={para} onChange={(e) => setPara(e.target.value)}
          placeholder={canal?.tipo === 'EMAIL' ? 'cliente@email.com' : '(83) 98888-7777'} inputMode={canal?.tipo === 'EMAIL' ? 'email' : 'tel'} />
        <label className="rotulo" htmlFor="nc-nome">Nome do cliente (opcional)</label>
        <input id="nc-nome" className="campo" value={nome} onChange={(e) => setNome(e.target.value)} />
        {canal?.tipo === 'EMAIL' ? (
          <>
            <label className="rotulo" htmlFor="nc-assunto">Assunto</label>
            <input id="nc-assunto" className="campo" value={assunto} onChange={(e) => setAssunto(e.target.value)} />
            <label className="rotulo" htmlFor="nc-texto">Mensagem</label>
            <textarea id="nc-texto" className="campo" rows={7} value={texto} onChange={(e) => setTexto(e.target.value)} />
            <p className="at-dica">A assinatura da caixa de e-mail entra automaticamente no final.</p>
          </>
        ) : (
          <p className="at-dica">No WhatsApp, a empresa só pode começar a conversa com um <strong>modelo aprovado</strong> pela Meta. Depois que o cliente responder, vocês conversam livremente por 24 horas.</p>
        )}
        {erro && <div className="aviso-erro" style={{ marginTop: 10 }}>{erro}</div>}
        <div className="at-botoes">
          {canal?.tipo === 'EMAIL'
            ? <button type="button" className="at-btn at-btn-verde" onClick={enviarEmail} disabled={enviando || !para.trim() || !assunto.trim() || !texto.trim()}>{enviando ? 'Enviando…' : 'Enviar e-mail'}</button>
            : <button type="button" className="at-btn at-btn-verde" onClick={() => { if (para.replace(/\D/g, '').length < 10) { setErro('Informe o número com DDD.'); return; } setErro(''); setModelo(true); }}>Escolher modelo →</button>}
          <button type="button" className="at-btn" onClick={onFechar}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
