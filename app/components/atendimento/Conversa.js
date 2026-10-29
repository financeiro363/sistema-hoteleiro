'use client';

// ============================================================================
// CAIXA DE ENTRADA — tela da conversa
// ============================================================================
// - Conversa: topo (responsável, situação), mensagens e caixa de escrever
// - ModalModelo: modelos aprovados do WhatsApp (obrigatórios fora das 24 h)
// - PainelLateral: contato (dados, histórico, origem) e reserva da Cloudbeds
// - NovaConversa: começar conversa por WhatsApp (modelo) ou e-mail
// - DetalhesConversa: etapa do funil, etiquetas e valor da cotação
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import {
  chamarApi, subirArquivo, avisarCabecalho, STATUS_CONVERSA, ICONE_CANAL, NOME_CANAL,
  soHora, dataHora, rotuloDia, chaveDia, dataCurta, noites, dinheiro, iniciais, tamanhoArquivo,
  aplicarVariaveis, separarCitacao, partesComLinks, tempoDesde, minutosEsperando, inicioEspera, telefoneBonito,
  nomeDaConversa, visitanteNoSite, paginaCurta, lerPreferencia, gravarPreferencia,
} from './util';
import { ModalCotacao, ListaCotacoes } from './Cotacao';
import { EditorHtml, EscolherModelo, aplicarVariaveisModelo, htmlParaTextoTela } from './ModelosEmail';
import { montarTextoModelo, rotuloVariavel, baseDoLink } from '../../../lib/atendimento/modelosTexto';

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
    if (m.tipo === 'sistema' || m.tipo === 'robo' || m.tipo === 'robo_passou') {
      const quem = m.enviado_pelo_robo ? '🤖 Robô' : nomeAtendente(m.enviado_por_id);
      return <div className="at-linha nota"><div className={`at-sistema ${m.tipo === 'robo_passou' ? 'at-sistema-alerta' : ''}`}>{m.texto} · {quem} · {soHora(m.data_original || m.criado_em)}</div></div>;
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
  const autor = saida
    ? (m.enviado_pelo_robo ? '🤖 Robô' : m.enviado_por_id ? nomeAtendente(m.enviado_por_id) : (m.tipo === 'email' ? 'Enviado pelo Gmail' : 'Hotel'))
    : (nomeContato || m.de || 'Cliente');
  const anexos = Array.isArray(m.anexos) ? m.anexos : [];
  return (
    <div className={`at-linha ${saida ? 'saida' : 'entrada'}`}>
      <div className={`at-bolha ${m.tipo === 'email' ? 'at-bolha-email' : ''} ${m.status_envio === 'FALHOU' ? 'falhou' : ''} ${m.enviado_pelo_robo ? 'at-bolha-robo' : ''}`}>
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
  const [varsBotao, setVarsBotao] = useState([]);
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
    setVarsBotao((m?.botoesLink || []).map(() => ''));
  }

  const previa = escolhido ? montarTextoModelo(escolhido, { cabecalho: varsCab, corpo: varsCorpo, botoes: varsBotao }) : '';

  async function enviar() {
    if (!escolhido) { setErro('Escolha um modelo.'); return; }
    if ([...varsCorpo, ...varsCab, ...varsBotao].some((v) => !String(v).trim())) { setErro('Preencha todas as variáveis.'); return; }
    setEnviando(true);
    setErro('');
    try {
      const r = await chamarApi('/api/atendimento', {
        acao: 'enviar', ...destino,
        modelo: {
          nome: escolhido.nome, idioma: escolhido.idioma, variaveisCorpo: varsCorpo, variaveisCabecalho: varsCab,
          nomesCorpo: escolhido.nomesCorpo, nomesCabecalho: escolhido.nomesCabecalho,
          variaveisBotao: (escolhido.botoesLink || []).map((b, i) => ({ indice: b.indice, texto: varsBotao[i] })), textoFinal: previa,
        },
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
                <label className="rotulo">Título — variável {rotuloVariavel(i, escolhido?.nomesCabecalho)}</label>
                <input className="campo" value={v} onChange={(e) => setVarsCab(varsCab.map((x, j) => (j === i ? e.target.value : x)))} />
              </div>
            ))}
            {varsCorpo.map((v, i) => (
              <div key={`b${i}`}>
                <label className="rotulo">Variável {rotuloVariavel(i, escolhido?.nomesCorpo)}</label>
                <input className="campo" value={v} onChange={(e) => setVarsCorpo(varsCorpo.map((x, j) => (j === i ? e.target.value : x)))} />
              </div>
            ))}
            {(escolhido?.botoesLink || []).map((b, i) => (
              <div key={`l${i}`}>
                <label className="rotulo">Botão “{b.texto}” — final do link ({baseDoLink(b.url)}…)</label>
                <input className="campo" value={varsBotao[i] || ''} onChange={(e) => setVarsBotao(varsBotao.map((x, j) => (j === i ? e.target.value : x)))} />
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
// Juntar mensagens (WhatsApp): desde 1º/10/2026 a Meta cobra cada mensagem
// enviada. Depois do Enter a mensagem espera alguns segundos; o que a pessoa
// escrever nesse tempo vai junto, no mesmo balão. Cada um pode desligar.
const ESPERA_JUNTAR_S = 6;
const CHAVE_JUNTAR = 'at-juntar-mensagens';
function lerJuntar() {
  try { return localStorage.getItem(CHAVE_JUNTAR) !== 'nao'; } catch (e) { return true; }
}

// Chat do site: onde a resposta vai chegar (no site agora, por e-mail ou só se voltar)
function AvisoChatSite({ conversa }) {
  const email = String(conversa.contato_endereco || '').includes('@') ? conversa.contato_endereco : null;
  if (visitanteNoSite(conversa)) return <div className="at-aviso-site">🟢 O visitante está no site agora: a resposta aparece na hora, no chat.</div>;
  return (
    <div className="at-aviso-site">
      O visitante saiu do site{conversa.site_visto_em ? ` há ${tempoDesde(conversa.site_visto_em)}` : ''}.{' '}
      {email
        ? <>Se ele não ler em 10 minutos, a resposta vai por e-mail para <strong>{email}</strong>.</>
        : conversa.contato_id
          ? 'Ele deixou o WhatsApp no cadastro: se precisar, continue por lá.'
          : 'Ele não deixou contato: a resposta só aparece se ele voltar ao site no mesmo aparelho.'}
    </div>
  );
}

// "Meu nome" nas mensagens do WhatsApp ("*Ana:*" na primeira linha): cada
// pessoa liga para si; a escolha fica no cadastro (usuarios.atendimento_assinar)
let assinarLembrado = null;

function Escrever({ conversa, canal, usuario, respostas, modelos, nomeHotel, janelaAberta, onEnviado, onAbrirModelo, onAbrirCotacao }) {
  const [texto, setTexto] = useState('');
  const [htmlModelo, setHtmlModelo] = useState(null); // e-mail com modelo formatado
  const [escolherModelo, setEscolherModelo] = useState(false);
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
  const ehSite = canal?.tipo === 'SITE';
  // Fila de mensagens esperando para sair juntas
  const [juntar, setJuntar] = useState(true);
  const [fila, setFila] = useState(null); // { conversaId, textos: [] }
  const [restante, setRestante] = useState(0);
  const filaRef = useRef(null);
  const prazoRef = useRef(0);
  const relogioRef = useRef(null);
  const conversaRef = useRef(conversa.id);
  conversaRef.current = conversa.id;
  const tokenRef = useRef(null); // para mandar a fila mesmo se a pessoa fechar a aba
  useEffect(() => { setJuntar(lerJuntar()); }, []);

  function pararRelogio() {
    if (relogioRef.current) clearInterval(relogioRef.current);
    relogioRef.current = null;
  }

  async function despacharFila() {
    const f = filaRef.current;
    if (!f) return;
    filaRef.current = null;
    setFila(null);
    pararRelogio();
    const junto = f.textos.join('\n');
    try {
      await chamarApi('/api/atendimento', { acao: 'enviar', conversaId: f.conversaId, texto: junto, nota: false });
    } catch (e) {
      setErro(e.message);
      // Não perde o texto: volta para a caixa (se ainda for a mesma conversa)
      if (f.conversaId === conversaRef.current) setTexto((t) => (t.trim() ? `${junto}\n${t}` : junto));
    }
    onEnviado();
  }

  function colocarNaFila(t) {
    supabase.auth.getSession().then(({ data }) => { tokenRef.current = data?.session?.access_token || null; }).catch(() => {});
    const atual = filaRef.current?.conversaId === conversa.id ? filaRef.current.textos : [];
    filaRef.current = { conversaId: conversa.id, textos: [...atual, t] };
    setFila(filaRef.current);
    prazoRef.current = Date.now() + ESPERA_JUNTAR_S * 1000;
    setRestante(ESPERA_JUNTAR_S);
    pararRelogio();
    relogioRef.current = setInterval(() => {
      const falta = Math.ceil((prazoRef.current - Date.now()) / 1000);
      if (falta <= 0) despacharFila();
      else setRestante(falta);
    }, 250);
  }

  function desfazerFila() {
    const f = filaRef.current;
    if (!f) return;
    filaRef.current = null;
    setFila(null);
    pararRelogio();
    const junto = f.textos.join('\n');
    setTexto((t) => (t.trim() ? `${junto}\n${t}` : junto));
    setTimeout(() => campoRef.current?.focus(), 0);
  }

  // Sem o SQL do prazo e assinatura, o cadastro não tem a coluna: o botão não aparece
  const podeAssinar = canal?.tipo === 'WHATSAPP' && !!usuario && 'atendimento_assinar' in usuario;
  const [assinar, setAssinar] = useState(() => (assinarLembrado ?? !!usuario?.atendimento_assinar));
  async function trocarAssinar() {
    const novo = !assinar;
    setAssinar(novo);
    assinarLembrado = novo;
    try { await chamarApi('/api/atendimento', { acao: 'minha_assinatura', assinar: novo }); }
    catch (e) { setAssinar(!novo); assinarLembrado = !novo; setErro(e.message); }
  }

  function trocarJuntar() {
    const novo = !juntar;
    setJuntar(novo);
    try { localStorage.setItem(CHAVE_JUNTAR, novo ? 'sim' : 'nao'); } catch (e) { /* nada */ }
    if (!novo) despacharFila();
  }

  // Saiu da conversa ou fechou a tela: o que estava esperando sai na hora
  useEffect(() => () => { despacharFila(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // Fechou a aba ou recarregou: manda com "keepalive" (o navegador termina o envio sozinho)
    const aoSair = () => {
      const f = filaRef.current;
      if (!f || !tokenRef.current) return;
      filaRef.current = null;
      try {
        fetch('/api/atendimento', {
          method: 'POST', keepalive: true,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenRef.current}` },
          body: JSON.stringify({ acao: 'enviar', conversaId: f.conversaId, texto: f.textos.join('\n'), nota: false }),
        });
      } catch (e) { /* nada */ }
    };
    window.addEventListener('pagehide', aoSair);
    return () => window.removeEventListener('pagehide', aoSair);
  }, []);

  // Rascunho por conversa (só neste navegador)
  useEffect(() => {
    if (filaRef.current && filaRef.current.conversaId !== conversa.id) despacharFila();
    try { setTexto(sessionStorage.getItem(`at-rascunho-${conversa.id}`) || ''); } catch (e) { setTexto(''); }
    setAnexos([]); setErro(''); setNota(false); setCc(''); setMostrarCc(false); setHtmlModelo(null);
  }, [conversa.id]); // eslint-disable-line react-hooks/exhaustive-deps
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
        const subido = await subirArquivo(arquivo, conversa.hotel_id);
        setAnexos((lista) => [...lista, subido]);
      } catch (e) { setErro(e.message); }
      setSubindo((n) => n - 1);
    }
  }

  function usarModelo(m) {
    setEscolherModelo(false);
    const vars = { nomeCliente: conversa.contato_nome, nomeAtendente: usuario.nome, nomeHotel };
    if (ehEmail) {
      setHtmlModelo(aplicarVariaveisModelo(m.corpo_html, vars, true));
    } else {
      const simples = aplicarVariaveisModelo(htmlParaTextoTela(m.corpo_html), vars, false);
      setTexto((t) => (t.trim() ? `${t}\n${simples}` : simples));
    }
    setTimeout(() => campoRef.current?.focus(), 0);
  }

  async function enviar() {
    if (enviando || subindo) return;
    const usandoModelo = ehEmail && !nota && htmlModelo !== null;
    const conteudo = usandoModelo ? htmlParaTextoTela(htmlModelo) : texto.trim();
    if (!conteudo && !anexos.length) {
      if (filaRef.current) despacharFila(); // Enter com a caixa vazia: manda o que está esperando
      return;
    }
    // WhatsApp com "juntar" ligado: espera alguns segundos para ir junto com a próxima
    if (juntar && canal?.tipo === 'WHATSAPP' && !nota && !anexos.length && !usandoModelo) {
      colocarNaFila(conteudo);
      setTexto('');
      try { sessionStorage.removeItem(`at-rascunho-${conversa.id}`); } catch (e) { /* nada */ }
      setTimeout(() => campoRef.current?.focus(), 0);
      return;
    }
    if (filaRef.current && !nota) await despacharFila(); // mantém a ordem das mensagens
    setEnviando(true);
    setErro('');
    try {
      await chamarApi('/api/atendimento', {
        acao: 'enviar', conversaId: conversa.id, texto: conteudo, nota,
        html: usandoModelo ? htmlModelo : undefined,
        anexos: nota ? [] : anexos, cc: ehEmail && !nota ? cc : undefined,
      });
      if (usandoModelo) setHtmlModelo(null);
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
        <div className="at-sugestoes"><div className="at-vazio">Nenhuma resposta pronta. {usuario?.papel === 'ADMIN' ? 'Crie na aba “Respostas prontas”.' : 'Peça ao administrador para criar na aba “Respostas prontas”.'}</div></div>
      )}

      {canalDesligado && <div className="at-aviso-janela">O canal “{canal.nome}” está desligado. Só é possível escrever notas internas.</div>}
      {ehSite && !nota && !canalDesligado && <AvisoChatSite conversa={conversa} />}
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
        {!nota && !ehSite && (
          <>
            <button type="button" className="at-ferramenta" onClick={() => arquivoRef.current?.click()} disabled={canalDesligado || bloqueadoPelaJanela}>📎 Anexar</button>
            <input ref={arquivoRef} type="file" multiple hidden onChange={escolherArquivos} />
          </>
        )}
        <button type="button" className="at-ferramenta" onClick={() => setListaRespostas(!listaRespostas)}>⚡ Respostas prontas</button>
        {!nota && (
          <button type="button" className="at-ferramenta" onClick={() => setEscolherModelo(true)} disabled={canalDesligado || bloqueadoPelaJanela}
            title={ehEmail ? 'Usar um modelo de e-mail formatado' : 'Usar o texto de um modelo de e-mail'}>📄 Modelo de e-mail</button>
        )}
        {!nota && onAbrirCotacao && (
          <button type="button" className="at-ferramenta at-ferramenta-destaque" onClick={() => { despacharFila(); onAbrirCotacao(); }} disabled={canalDesligado}>💰 Cotação</button>
        )}
        {canal?.tipo === 'WHATSAPP' && !nota && (
          <button type="button" className="at-ferramenta" onClick={() => { despacharFila(); onAbrirModelo(); }} disabled={canalDesligado}>📋 Modelo</button>
        )}
        {canal?.tipo === 'WHATSAPP' && !nota && (
          <button type="button" className={`at-ferramenta ${juntar ? 'ativa' : ''}`} onClick={trocarJuntar}
            title={`Ligado: depois do Enter a mensagem espera ${ESPERA_JUNTAR_S} segundos, e o que você escrever nesse tempo vai no mesmo balão (a Meta cobra cada mensagem).`}>
            ⏳ Juntar mensagens: {juntar ? 'ligado' : 'desligado'}
          </button>
        )}
        {podeAssinar && !nota && (
          <button type="button" className={`at-ferramenta ${assinar ? 'ativa' : ''}`} onClick={trocarAssinar}
            title={`Ligado: a mensagem do WhatsApp sai com o seu nome em negrito na primeira linha (ex.: *${String(usuario?.nome || 'Ana').trim().split(/\s+/)[0]}:*). Vale só para você.`}>
            ✍️ Meu nome: {assinar ? 'ligado' : 'desligado'}
          </button>
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

      {fila && fila.conversaId === conversa.id && (
        <div className="at-fila-juntar" role="status">
          <div className="at-fila-texto">{fila.textos.join('\n')}</div>
          <div className="at-fila-acoes">
            <span>⏳ Sai em {restante} s — o que você escrever agora vai junto, no mesmo balão.</span>
            <button type="button" className="at-btn at-btn-verde" onClick={despacharFila}>Enviar agora</button>
            <button type="button" className="at-btn" onClick={desfazerFila}>Desfazer</button>
          </div>
        </div>
      )}

      {htmlModelo !== null && ehEmail && !nota ? (
        <div className="me-na-conversa">
          <div className="at-canal-topo">
            <span className="at-dica" style={{ margin: 0 }}>📄 E-mail com modelo formatado — ajuste o que precisar antes de enviar.</span>
            <button type="button" className="at-link-pequeno" onClick={() => setHtmlModelo(null)}>Voltar ao texto simples</button>
          </div>
          <EditorHtml valor={htmlModelo} onMudar={setHtmlModelo} altura={180} rotulo="Texto do e-mail" />
          <div className="at-botoes" style={{ marginTop: 6 }}>
            <button type="button" className="at-btn at-btn-verde" onClick={enviar} disabled={enviando || subindo > 0 || canalDesligado}>{enviando ? 'Enviando…' : 'Enviar e-mail'}</button>
          </div>
        </div>
      ) : (
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
      )}
      {escolherModelo && (
        <EscolherModelo modelos={modelos || []} paraWhatsApp={!ehEmail} onEscolher={usarModelo} onFechar={() => setEscolherModelo(false)} />
      )}
      {erro && <div className="aviso-erro" style={{ marginTop: 8, marginBottom: 0 }}>{erro}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Robô (Fase 4): quem está atendendo esta conversa
const MOTIVOS_PAUSA_TELA = {
  ASSUMIU: 'alguém da equipe assumiu',
  PEDIU_HUMANO: 'o cliente pediu para falar com uma pessoa',
  ROBO_NAO_SABE: 'o robô não sabia responder e chamou a equipe',
  LIMITE: 'o robô chegou ao limite de gasto do mês',
  ERRO: 'o robô teve um problema para responder',
};

export function roboPausado(conversa, robo, agora = Date.now()) {
  if (!conversa?.robo_pausado_em) return false;
  const ultimaEquipe = Math.max(new Date(conversa.robo_pausado_em).getTime(), conversa.ultima_saida_em ? new Date(conversa.ultima_saida_em).getTime() : 0);
  return agora - ultimaEquipe < (Number(robo?.horas_retomar) || 12) * 3600000;
}

function FaixaRobo({ conversa, robo, usuario, salvando, onAlterar }) {
  if (!robo?.ligado || !(robo.canais || []).includes(conversa.canal_tipo)) return null;
  const pausado = roboPausado(conversa, robo);
  if (!pausado) {
    return (
      <div className="at-faixa-robo">
        <span>🤖 O robô está atendendo esta conversa{conversa.robo_ultima_resposta_em ? ` (última resposta às ${soHora(conversa.robo_ultima_resposta_em)})` : ''}. Ao responder, você assume.</span>
        <button type="button" className="at-btn" disabled={salvando}
          onClick={() => onAlterar({ robo_pausado_em: new Date().toISOString(), robo_pausa_motivo: 'ASSUMIU', ...(conversa.responsavel_id ? {} : { responsavel_id: usuario.id }) })}>
          ✋ Assumir atendimento
        </button>
      </div>
    );
  }
  return (
    <div className="at-faixa-robo pausado">
      <span>✋ Robô pausado: {MOTIVOS_PAUSA_TELA[conversa.robo_pausa_motivo] || 'a equipe está atendendo'}. Volta ao resolver ou após {Number(robo.horas_retomar) || 12} h sem a equipe escrever.</span>
      <button type="button" className="at-btn" disabled={salvando} onClick={() => onAlterar({ robo_pausado_em: null, robo_pausa_motivo: null })}>↩ Devolver ao robô</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conversa completa
export function Conversa({
  conversa, canal, mensagens, carregando, usuario, atendentes, nomes, respostas, etapas, etiquetas, nomeHotel,
  alertaMinutos, onRecarregar, onVoltar, onAlternarLateral, lateralAberta, rotuloVoltar, modelos, nomeHotelReal, robo,
  ampliada, onAmpliar,
}) {
  const [mostrarModelo, setMostrarModelo] = useState(false);
  const [mostrarCotacao, setMostrarCotacao] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const fimRef = useRef(null);
  const listaRef = useRef(null);
  const ultimoTamanho = useRef({ id: null, n: 0 });

  const nomesAtendentes = useMemo(() => ({ ...(nomes || {}), ...Object.fromEntries((atendentes || []).map((a) => [a.id, a.nome])) }), [atendentes, nomes]);
  const nomeAtendente = (id) => (id ? (nomesAtendentes[id] || `Usuário #${id}`) : 'Sistema');
  const esperando = minutosEsperando(conversa);

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
    if (error) { setErro('Não foi possível salvar: ' + error.message); return false; }
    avisarCabecalho();
    onRecarregar();
    return true;
  }

  const nomeContato = nomeDaConversa(conversa);

  return (
    <>
      <div className="at-conv-topo">
        <button type="button" className={`at-btn at-voltar ${rotuloVoltar ? 'sempre' : ''}`} onClick={onVoltar} aria-label={rotuloVoltar || 'Voltar para a lista'}>{rotuloVoltar ? '✕' : '←'}</button>
        <div className="at-avatar">{iniciais(nomeContato)}<span className="at-avatar-canal">{ICONE_CANAL[conversa.canal_tipo]}</span></div>
        <div className="at-conv-titulo">
          <div className="at-conv-nome">{nomeContato}</div>
          <div className="at-conv-sub">
            {nomeHotel ? <strong>{nomeHotel} · </strong> : null}
            {NOME_CANAL[conversa.canal_tipo]}{canal ? (canal.nome !== NOME_CANAL[conversa.canal_tipo] ? ` · ${canal.nome}` : '') : ' · canal removido'}
            {conversa.contato_endereco && conversa.contato_nome ? ` · ${conversa.contato_endereco}` : ''}
            {conversa.canal_tipo === 'EMAIL' && conversa.assunto ? ` · ${conversa.assunto}` : ''}
          </div>
          {conversa.canal_tipo === 'SITE' && (
            <div className="at-conv-sub">
              {visitanteNoSite(conversa) ? '🟢 Está no site agora' : `Saiu do site${conversa.site_visto_em ? ` há ${tempoDesde(conversa.site_visto_em)}` : ''}`}
              {conversa.visitante?.pagina ? ` · ${paginaCurta(conversa.visitante.pagina)}` : ''}
            </div>
          )}
          {conversa.canal_tipo === 'WHATSAPP' && (
            <div className="at-conv-sub">
              {janelaAberta ? `🟢 Pode responder livremente até ${soHora(fimJanela)}${rotuloDia(fimJanela) !== 'Hoje' ? ` de ${rotuloDia(fimJanela).toLowerCase()}` : ''}` : '⏰ Janela de 24 h fechada — só modelos'}
            </div>
          )}
          {esperando !== null && (
            <div className={`at-conv-sub ${alertaMinutos && esperando >= alertaMinutos ? 'at-espera-alerta' : ''}`}>
              ⏳ Cliente esperando resposta há {tempoDesde(inicioEspera(conversa))}
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
          {!['RESOLVIDA', 'ARQUIVADA'].includes(conversa.status) && (
            <button type="button" className="at-btn at-btn-verde" onClick={() => alterar({ status: 'RESOLVIDA' })} disabled={salvando}>✓ Resolver</button>
          )}
          {conversa.status !== 'ARQUIVADA' && (
            <button type="button" className="at-btn" onClick={() => alterar({ status: 'ARQUIVADA' })} disabled={salvando} title="Tira a conversa das listas (volta sozinha se o cliente escrever de novo)">🗄 Arquivar</button>
          )}
          <button type="button" className="at-btn" onClick={onAlternarLateral} title="Dados do contato e reserva na Cloudbeds">
            👤 {lateralAberta ? 'Fechar contato' : 'Contato e reserva'}
          </button>
          {onAmpliar && (
            <button type="button" className="at-btn at-esconder-celular" onClick={onAmpliar} aria-pressed={!!ampliada}
              title={ampliada ? 'Mostrar a lista de conversas de novo' : 'Esconder a lista para a conversa ocupar a tela toda'}>
              {ampliada ? '⤡ Mostrar lista' : '⤢ Ampliar'}
            </button>
          )}
        </div>
      </div>
      <DetalhesConversa conversa={conversa} etapas={etapas} etiquetas={etiquetas} salvando={salvando} onAlterar={alterar} />
      <FaixaRobo conversa={conversa} robo={robo} usuario={usuario} salvando={salvando} onAlterar={alterar} />
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
        conversa={conversa} canal={canal} usuario={usuario} respostas={respostas} modelos={modelos} nomeHotel={nomeHotelReal}
        janelaAberta={janelaAberta} onEnviado={onRecarregar} onAbrirModelo={() => setMostrarModelo(true)}
        onAbrirCotacao={canal && ['WHATSAPP', 'EMAIL', 'SITE'].includes(canal.tipo) ? () => setMostrarCotacao(true) : null}
      />
      {mostrarCotacao && canal && (
        <ModalCotacao
          conversa={conversa} canal={canal} janelaAberta={janelaAberta}
          onFechar={() => setMostrarCotacao(false)}
          onEnviada={() => { setMostrarCotacao(false); avisarCabecalho(); onRecarregar(); }}
        />
      )}

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

function PainelReserva({ conversa, onMudou }) {
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
// Etiqueta (bolinha com a cor + nome; o texto fica na cor normal)
export function ChipEtiqueta({ etiqueta, onRemover, pequeno }) {
  if (!etiqueta) return null;
  return (
    <span className={`at-etq ${pequeno ? 'pequeno' : ''}`} title={etiqueta.automatica ? 'Etiqueta automática' : undefined}>
      <i style={{ background: etiqueta.cor || '#8A938E' }} aria-hidden="true" />
      {etiqueta.nome}
      {onRemover && <button type="button" onClick={onRemover} aria-label={`Tirar a etiqueta ${etiqueta.nome}`}>✕</button>}
    </span>
  );
}

function textoValor(v) {
  if (v === null || v === undefined || v === '') return '';
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function lerValor(texto) {
  let t = String(texto || '').replace(/R\$|\s/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
}

// ---------------------------------------------------------------------------
// Etapa do funil, etiquetas e valor da cotação (faixa abaixo do topo)
export function DetalhesConversa({ conversa, etapas, etiquetas, salvando, onAlterar }) {
  const [valor, setValor] = useState(textoValor(conversa.valor_cotacao));
  const [aberto, setAberto] = useState(false);
  const [erroValor, setErroValor] = useState('');
  useEffect(() => { setValor(textoValor(conversa.valor_cotacao)); setErroValor(''); }, [conversa.id, conversa.valor_cotacao]);
  // Fechada, a faixa vira uma linha só (sobra mais espaço para ler). Lembra a escolha.
  useEffect(() => { setAberto(lerPreferencia('at-detalhes-aberto', false) === true); }, []);
  const alternar = () => { const novo = !aberto; setAberto(novo); gravarPreferencia('at-detalhes-aberto', novo); };

  const lista = etiquetas || [];
  const mapa = Object.fromEntries(lista.map((e) => [e.id, e]));
  const ids = conversa.etiquetas || [];
  const atuais = ids.map((id) => mapa[id]).filter(Boolean);
  const disponiveis = lista.filter((e) => !ids.includes(e.id));
  const etapasHotel = (etapas || []).filter((e) => e.ativa || e.id === conversa.etapa_id);
  const etapaAtual = (etapas || []).find((e) => e.id === conversa.etapa_id);

  async function salvarValor() {
    const n = lerValor(valor);
    if (Number.isNaN(n)) { setErroValor('Valor inválido'); return; }
    setErroValor('');
    if ((n ?? null) === (conversa.valor_cotacao === null || conversa.valor_cotacao === undefined ? null : Number(conversa.valor_cotacao))) {
      setValor(textoValor(n));
      return;
    }
    if (await onAlterar({ valor_cotacao: n })) setValor(textoValor(n));
  }

  return (
    <div className={`at-detalhes ${aberto ? 'aberto' : ''}`}>
      <button type="button" className="at-detalhes-alternar" onClick={alternar} aria-expanded={aberto} title={aberto ? 'Recolher' : 'Mudar etapa, etiquetas ou valor da cotação'}>
        <span>{etapaAtual ? <><i className="at-bolinha" style={{ background: etapaAtual.cor || '#8A938E' }} />{etapaAtual.nome}</> : 'Sem etapa'}</span>
        {!aberto && atuais.slice(0, 4).map((e) => <ChipEtiqueta key={e.id} etiqueta={e} pequeno />)}
        {!aberto && atuais.length > 4 ? <span className="at-chip">+{atuais.length - 4}</span> : null}
        {conversa.valor_cotacao ? <span>· {dinheiro(conversa.valor_cotacao)}</span> : null}
        <span className="at-detalhes-dica">{aberto ? '▴ recolher' : '▾ etapa, etiquetas e cotação'}</span>
      </button>
      <div className="at-detalhes-corpo">
        <label className="at-detalhe">
          <span>Etapa</span>
          <select className="at-select" value={conversa.etapa_id || ''} disabled={salvando}
            onChange={(e) => onAlterar({ etapa_id: e.target.value ? Number(e.target.value) : null })}>
            {!conversa.etapa_id && <option value="">—</option>}
            {etapasHotel.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
        </label>
        <div className="at-detalhe at-detalhe-etq">
          <span>Etiquetas</span>
          {atuais.map((e) => (
            <ChipEtiqueta key={e.id} etiqueta={e} onRemover={salvando ? undefined : () => onAlterar({ etiquetas: ids.filter((x) => x !== e.id) })} />
          ))}
          {disponiveis.length > 0 && (
            <select className="at-select at-select-mini" value="" disabled={salvando} aria-label="Adicionar etiqueta"
              onChange={(e) => { if (e.target.value) onAlterar({ etiquetas: [...ids, Number(e.target.value)] }); }}>
              <option value="">+ etiqueta</option>
              {disponiveis.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
            </select>
          )}
        </div>
        <label className="at-detalhe">
          <span>Cotação R$</span>
          <input className="at-input-valor" inputMode="decimal" value={valor} placeholder="0,00" disabled={salvando}
            onChange={(e) => setValor(e.target.value)} onBlur={salvarValor}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
          {erroValor && <small className="at-ruim">{erroValor}</small>}
        </label>
        {conversa.origem && (
          <span className="at-detalhe" title={conversa.origem.texto || ''}>
            <span className="at-chip at-chip-ad">📣 {conversa.origem.tipo === 'PUBLICACAO' ? 'Veio de publicação' : 'Veio de anúncio'}</span>
            {conversa.origem.titulo && <span className="at-dica" style={{ margin: 0 }}>{conversa.origem.titulo}</span>}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chat do site: de onde a pessoa escreveu (a cidade é aproximada, pelo IP)
const NOME_PAIS = { BR: 'Brasil', PT: 'Portugal', AR: 'Argentina', US: 'Estados Unidos', UY: 'Uruguai', PY: 'Paraguai', CL: 'Chile' };
function DadosVisitante({ v }) {
  const local = [v.cidade, v.estado, v.pais ? (NOME_PAIS[v.pais] || v.pais) : null].filter(Boolean).join(', ');
  const utm = v.utm ? [v.utm.source, v.utm.medium, v.utm.campaign].filter(Boolean).join(' · ') : '';
  const veio = utm || (v.referencia ? paginaCurta(v.referencia) : '');
  return (
    <div className="at-lateral-bloco">
      <p className="at-lateral-titulo">🌐 Visitante do site</p>
      {v.pagina && (
        <div className="at-dado"><span>Página</span><span><a className="at-link-pequeno" href={v.pagina} target="_blank" rel="noopener noreferrer">{paginaCurta(v.pagina)} ↗</a></span></div>
      )}
      {veio && <div className="at-dado"><span>Veio de</span><span>{veio}</span></div>}
      {local && <div className="at-dado"><span>Local (aproximado)</span><span>{local}</span></div>}
      {v.idioma && <div className="at-dado"><span>Idioma do navegador</span><span>{v.idioma}</span></div>}
      {v.aparelho && <div className="at-dado"><span>Aparelho</span><span>{v.aparelho}</span></div>}
      {v.fuso && v.fuso !== 'America/Fortaleza' && v.fuso !== 'America/Recife' && <div className="at-dado"><span>Fuso horário</span><span>{v.fuso}</span></div>}
    </div>
  );
}

// Contato: dados (editáveis), histórico com o hotel e origem
function PainelContato({ conversa, onAbrirConversa }) {
  const [contato, setContato] = useState(null);
  const [historico, setHistorico] = useState([]);
  const [asksuite, setAsksuite] = useState([]);
  const [verAsksuite, setVerAsksuite] = useState(false);
  const [editando, setEditando] = useState(null);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    let ativo = true;
    setContato(null); setHistorico([]); setAsksuite([]); setVerAsksuite(false); setEditando(null); setErro('');
    if (!conversa.contato_id) return undefined;
    Promise.all([
      supabase.from('atendimento_contatos').select('*').eq('id', conversa.contato_id).maybeSingle(),
      supabase.from('atendimento_conversas').select('id, canal_tipo, assunto, status, criado_em, ultima_mensagem_em, ultima_mensagem_resumo')
        .eq('contato_id', conversa.contato_id).order('ultima_mensagem_em', { ascending: false, nullsFirst: false }).limit(30),
      supabase.from('atendimento_historico_externo').select('*').eq('contato_id', conversa.contato_id)
        .order('criado_origem', { ascending: false, nullsFirst: false }).limit(50),
    ]).then(([c, h, a]) => {
      if (!ativo) return;
      setContato(c.data || null);
      setHistorico(h.data || []);
      setAsksuite(a.error ? [] : (a.data || []));
    });
    return () => { ativo = false; };
  }, [conversa.id, conversa.contato_id, versao]);

  async function salvar() {
    const nome = String(editando.nome || '').trim();
    const telefone = String(editando.telefone || '').replace(/\D/g, '');
    const email = String(editando.email || '').trim().toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setErro('E-mail inválido.'); return; }
    setSalvando(true);
    setErro('');
    const { error } = await supabase.from('atendimento_contatos').update({
      nome: nome || null,
      telefone: telefone ? (telefone.length === 10 || telefone.length === 11 ? `55${telefone}` : telefone) : null,
      email: email || null,
      idioma: String(editando.idioma || '').trim() || null,
      observacoes: String(editando.observacoes || '').trim() || null,
      atualizado_em: new Date().toISOString(),
    }).eq('id', contato.id);
    setSalvando(false);
    if (error) { setErro('Não foi possível salvar: ' + error.message); return; }
    setEditando(null);
    setVersao((v) => v + 1);
  }

  const outras = historico.filter((h) => h.id !== conversa.id);
  return (
    <>
      <div className="at-lateral-bloco">
        <div className="at-canal-topo">
          <p className="at-lateral-titulo" style={{ margin: 0 }}>Contato{contato?.ja_reservou ? <span className="at-chip at-chip-estrela" style={{ marginLeft: 6 }}>⭐ Já reservou</span> : null}</p>
          {contato && !editando && <button type="button" className="at-link-pequeno" onClick={() => setEditando({ ...contato })}>Editar</button>}
        </div>
        {erro && <div className="aviso-erro" style={{ fontSize: 13 }}>{erro}</div>}
        {editando ? (
          <div className="at-form-contato">
            <label className="rotulo" htmlFor="pc-nome">Nome</label>
            <input id="pc-nome" className="campo at-campo-pequeno" value={editando.nome || ''} onChange={(e) => setEditando({ ...editando, nome: e.target.value })} />
            <label className="rotulo" htmlFor="pc-tel">Telefone / WhatsApp</label>
            <input id="pc-tel" className="campo at-campo-pequeno" inputMode="tel" value={editando.telefone || ''} onChange={(e) => setEditando({ ...editando, telefone: e.target.value })} />
            <label className="rotulo" htmlFor="pc-email">E-mail</label>
            <input id="pc-email" className="campo at-campo-pequeno" inputMode="email" value={editando.email || ''} onChange={(e) => setEditando({ ...editando, email: e.target.value })} />
            <label className="rotulo" htmlFor="pc-idioma">Idioma</label>
            <input id="pc-idioma" className="campo at-campo-pequeno" value={editando.idioma || ''} placeholder="Português" onChange={(e) => setEditando({ ...editando, idioma: e.target.value })} />
            <label className="rotulo" htmlFor="pc-obs">Observações</label>
            <textarea id="pc-obs" className="campo at-campo-pequeno" rows={3} value={editando.observacoes || ''} onChange={(e) => setEditando({ ...editando, observacoes: e.target.value })} />
            <div className="at-botoes" style={{ marginTop: 8 }}>
              <button type="button" className="at-btn at-btn-verde" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
              <button type="button" className="at-btn" onClick={() => setEditando(null)}>Cancelar</button>
            </div>
          </div>
        ) : (
          <>
            <div className="at-dado"><span>Nome</span><span>{contato?.nome || conversa.contato_nome || '—'}</span></div>
            <div className="at-dado"><span>Telefone</span><span>{contato?.telefone ? telefoneBonito(contato.telefone) : (conversa.canal_tipo === 'WHATSAPP' ? conversa.contato_endereco : '—')}</span></div>
            <div className="at-dado"><span>E-mail</span><span>{contato?.email || (conversa.canal_tipo === 'EMAIL' ? conversa.contato_endereco : '—')}</span></div>
            {contato?.idioma && <div className="at-dado"><span>Idioma</span><span>{contato.idioma}</span></div>}
            <div className="at-dado"><span>Cliente desde</span><span>{dataHora(contato?.criado_em || conversa.criado_em)}</span></div>
            {contato?.etiquetas_importadas && <div className="at-dado"><span>Etiquetas (Asksuite)</span><span>{contato.etiquetas_importadas}</span></div>}
            {contato?.observacoes && <div className="at-obs">{contato.observacoes}</div>}
          </>
        )}
      </div>

      {conversa.origem && (
        <div className="at-lateral-bloco">
          <p className="at-lateral-titulo">📣 Origem: {conversa.origem.tipo === 'PUBLICACAO' ? 'publicação' : 'anúncio'} da Meta</p>
          {conversa.origem.titulo && <div style={{ fontWeight: 700, fontSize: 13.5 }}>{conversa.origem.titulo}</div>}
          {conversa.origem.texto && <div className="at-dica" style={{ whiteSpace: 'pre-wrap' }}>{conversa.origem.texto}</div>}
          {conversa.origem.url && <a className="at-link-pequeno" href={conversa.origem.url} target="_blank" rel="noopener noreferrer">Ver o anúncio ↗</a>}
        </div>
      )}

      {conversa.canal_tipo === 'SITE' && conversa.visitante && <DadosVisitante v={conversa.visitante} />}

      {asksuite.length > 0 && (
        <div className="at-lateral-bloco">
          <div className="at-canal-topo">
            <p className="at-lateral-titulo" style={{ margin: 0 }}>No Asksuite ({asksuite.length})</p>
            {asksuite.length > 3 && <button type="button" className="at-link-pequeno" onClick={() => setVerAsksuite(!verAsksuite)}>{verAsksuite ? 'Ver menos' : 'Ver todas'}</button>}
          </div>
          <p className="at-dica" style={{ marginTop: 2 }}>
            {asksuite.filter((x) => x.pediu_cotacao).length} cotação(ões) · {asksuite.filter((x) => x.clicou_reservar).length} clique(s) em Reservar · {asksuite.filter((x) => x.reservou).length} reserva(s)
          </p>
          {(verAsksuite ? asksuite : asksuite.slice(0, 3)).map((h) => (
            <div key={h.id} className="ct-item">
              <div className="at-canal-topo">
                <strong>{h.criado_origem ? dataHora(h.criado_origem) : '—'}</strong>
                <span className="at-chip">{h.fonte || h.plataforma || 'Asksuite'}</span>
              </div>
              <small>
                {h.reservou ? `🎉 Reservou${h.reserva_valor ? ` ${dinheiro(h.reserva_valor)}` : ''}${h.reserva_codigo ? ` (${h.reserva_codigo})` : ''}`
                  : h.clicou_reservar ? '🖱️ Clicou em Reservar agora' : h.pediu_cotacao ? '💰 Pediu cotação' : 'Conversa'}
                {h.chegada ? ` · ${dataCurta(h.chegada)} a ${dataCurta(h.partida)}` : ''}
                {h.adultos ? ` · ${h.adultos} adulto(s)` : ''}
              </small>
              {h.agente && <small>Atendente: {h.agente}</small>}
              {h.etiquetas?.length > 0 && <small>{h.etiquetas.filter((e) => !/^tag - /i.test(e)).join(' · ')}</small>}
              {h.link && <a className="at-link-pequeno" href={h.link} target="_blank" rel="noopener noreferrer">Abrir no Asksuite ↗</a>}
            </div>
          ))}
        </div>
      )}

      <div className="at-lateral-bloco">
        <p className="at-lateral-titulo">Histórico ({historico.length || 1} conversa{(historico.length || 1) > 1 ? 's' : ''})</p>
        {outras.length === 0 ? <p className="at-dica" style={{ margin: 0 }}>Esta é a única conversa com este contato.</p> : outras.map((h) => (
          <button key={h.id} type="button" className="at-historico" onClick={() => onAbrirConversa && onAbrirConversa(h.id)}>
            <span>{ICONE_CANAL[h.canal_tipo]} {h.assunto || NOME_CANAL[h.canal_tipo]} <small>· {STATUS_CONVERSA[h.status] || h.status}</small></span>
            <small>{dataHora(h.ultima_mensagem_em || h.criado_em)} — {h.ultima_mensagem_resumo || '—'}</small>
          </button>
        ))}
      </div>
    </>
  );
}

export function PainelLateral({ conversa, onMudou, onAbrirConversa }) {
  return (
    <>
      <PainelContato conversa={conversa} onAbrirConversa={onAbrirConversa} />
      <ListaCotacoes conversa={conversa} />
      <PainelReserva conversa={conversa} onMudou={onMudou} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Começar conversa nova
export function NovaConversa({ canais, onFechar, onCriada, inicial, nomesHoteis, nomesHoteisTodos, modelos, usuario }) {
  const ativos = (canais || []).filter((c) => c.ativo && (c.tipo === 'WHATSAPP' || c.tipo === 'EMAIL'));
  const preferido = inicial?.tipo ? ativos.find((c) => c.tipo === inicial.tipo && (!inicial.hotelId || c.hotel_id === inicial.hotelId)) : null;
  const [canalId, setCanalId] = useState((preferido || ativos[0])?.id || '');
  const [para, setPara] = useState(inicial?.para || '');
  const [nome, setNome] = useState(inicial?.nome || '');
  const [assunto, setAssunto] = useState('');
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [modelo, setModelo] = useState(false);
  const [htmlModelo, setHtmlModelo] = useState(null);
  const [escolherModelo, setEscolherModelo] = useState(false);
  const canal = ativos.find((c) => String(c.id) === String(canalId));
  const modelosDoHotel = (modelos || []).filter((m) => m.hotel_id === canal?.hotel_id);

  function usarModelo(m) {
    setEscolherModelo(false);
    const vars = { nomeCliente: nome, nomeAtendente: usuario?.nome, nomeHotel: nomesHoteisTodos?.[canal?.hotel_id] || '' };
    setHtmlModelo(aplicarVariaveisModelo(m.corpo_html, vars, true));
    if (m.assunto && !assunto.trim()) setAssunto(aplicarVariaveisModelo(m.assunto, vars, false));
  }

  async function enviarEmail() {
    setEnviando(true);
    setErro('');
    try {
      const corpoTexto = htmlModelo !== null ? htmlParaTextoTela(htmlModelo) : texto;
      const r = await chamarApi('/api/atendimento', {
        acao: 'enviar', canalId: canal.id, para, nome, assunto, texto: corpoTexto, html: htmlModelo !== null ? htmlModelo : undefined,
      });
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
          {ativos.map((c) => <option key={c.id} value={c.id}>{ICONE_CANAL[c.tipo]} {nomesHoteis?.[c.hotel_id] ? `${nomesHoteis[c.hotel_id]} · ` : ''}{c.nome}{c.endereco_exibicao && c.endereco_exibicao !== c.nome ? ` (${c.endereco_exibicao})` : ''}</option>)}
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
            <div className="at-canal-topo" style={{ marginTop: 10 }}>
              <label className="rotulo" htmlFor="nc-texto" style={{ margin: 0 }}>Mensagem</label>
              {htmlModelo !== null
                ? <button type="button" className="at-link-pequeno" onClick={() => setHtmlModelo(null)}>Voltar ao texto simples</button>
                : <button type="button" className="at-link-pequeno" onClick={() => setEscolherModelo(true)}>📄 Usar modelo de e-mail</button>}
            </div>
            {htmlModelo !== null
              ? <EditorHtml valor={htmlModelo} onMudar={setHtmlModelo} altura={200} rotulo="Texto do e-mail" />
              : <textarea id="nc-texto" className="campo" rows={7} value={texto} onChange={(e) => setTexto(e.target.value)} />}
            <p className="at-dica">A assinatura da caixa de e-mail entra automaticamente no final.</p>
            {escolherModelo && <EscolherModelo modelos={modelosDoHotel} onEscolher={usarModelo} onFechar={() => setEscolherModelo(false)} />}
          </>
        ) : (
          <p className="at-dica">No WhatsApp, a empresa só pode começar a conversa com um <strong>modelo aprovado</strong> pela Meta. Depois que o cliente responder, vocês conversam livremente por 24 horas.</p>
        )}
        {erro && <div className="aviso-erro" style={{ marginTop: 10 }}>{erro}</div>}
        <div className="at-botoes">
          {canal?.tipo === 'EMAIL'
            ? <button type="button" className="at-btn at-btn-verde" onClick={enviarEmail} disabled={enviando || !para.trim() || !assunto.trim() || (htmlModelo === null ? !texto.trim() : !htmlParaTextoTela(htmlModelo))}>{enviando ? 'Enviando…' : 'Enviar e-mail'}</button>
            : <button type="button" className="at-btn at-btn-verde" onClick={() => { if (para.replace(/\D/g, '').length < 10) { setErro('Informe o número com DDD.'); return; } setErro(''); setModelo(true); }}>Escolher modelo →</button>}
          <button type="button" className="at-btn" onClick={onFechar}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
