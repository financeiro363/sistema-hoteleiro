'use client';

// ============================================================================
// CAIXA DE ENTRADA — aba "📣 WhatsApp" (Fase 6, só ADMIN)
// ============================================================================
// Modelos: ver, criar (com modelos prontos) e excluir os modelos aprovados
// pela Meta. Campanhas: mandar um modelo para um grupo de clientes (contatos
// do sistema ou planilha), com prévia, custo estimado e relatório.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { chamarApi, dataHora, baixarCsv, lerCsv, telefoneBonito } from './util';
import {
  modelosProntos, validarModeloNovo, normalizarNomeModelo, CATEGORIAS_MODELO, IDIOMAS_MODELO, SITUACAO_MODELO,
} from '../../../lib/atendimento/modelosNovos';
import { montarTextoModelo, rotuloVariavel, baseDoLink } from '../../../lib/atendimento/modelosTexto';
import {
  SITUACOES_CAMPANHA, SITUACOES_ENVIO, FONTES_VARIAVEL, FILTROS_CONTATOS, LIMITE_CAMPANHA,
} from '../../../lib/atendimento/campanhasConfig';
import { AUTOMACAO_POR_TIPO } from '../../../lib/atendimento/automacoesConfig';

const inteiro = (v) => Number(v || 0).toLocaleString('pt-BR');
const reais = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const categoriaTexto = (c) => CATEGORIAS_MODELO[c]?.rotulo || (c ? String(c).toLowerCase() : '');
const ENTREGA = { ENVIADA: 'Enviada', ENTREGUE: 'Entregue', VISTA: 'Lida', FALHOU: 'Falhou' };
const RE_TELEFONE = /(telefone|celular|whats|fone|phone|n[uú]mero)/i;
const RE_NOME = /^(nome|name|cliente|h[oó]spede)/i;

function Chip({ estilo, children }) {
  return <span className="at-chip" style={estilo}>{children}</span>;
}

// ===========================================================================
export function WhatsAppAvancado({ hoteis, hotelAtual, canais, onAbrirConversa }) {
  const [hotelId, setHotelId] = useState((hoteis.find((h) => h.id === Number(hotelAtual)) || hoteis[0])?.id);
  const [secao, setSecao] = useState('campanhas');
  const numeros = (canais || []).filter((c) => c.tipo === 'WHATSAPP' && Number(c.hotel_id) === Number(hotelId));
  return (
    <>
      <div className="at-botoes" style={{ marginTop: 0, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        {hoteis.length > 1 && (
          <label className="at-detalhe" style={{ margin: 0 }}>
            <span style={{ color: 'var(--tinta)', fontWeight: 600 }}>Hotel</span>
            <select className="at-select" value={hotelId} onChange={(e) => setHotelId(Number(e.target.value))}>
              {hoteis.map((h) => <option key={h.id} value={h.id}>{h.nome}</option>)}
            </select>
          </label>
        )}
        <div className="at-abas" role="tablist" style={{ margin: 0 }}>
          {[['campanhas', '📣 Campanhas'], ['modelos', '📋 Modelos']].map(([k, r]) => (
            <button key={k} type="button" role="tab" aria-selected={secao === k} className={`at-aba ${secao === k ? 'ativa' : ''}`} onClick={() => setSecao(k)}>{r}</button>
          ))}
        </div>
      </div>
      {numeros.length === 0 && <div className="aviso-erro">Este hotel ainda não tem número de WhatsApp ligado no sistema (aba ⚙️ Canais).</div>}
      {numeros.length > 0 && secao === 'modelos' && <Modelos key={`m${hotelId}`} numeros={numeros} />}
      {numeros.length > 0 && secao === 'campanhas' && <Campanhas key={`c${hotelId}`} hotelId={hotelId} onAbrirConversa={onAbrirConversa} />}
    </>
  );
}

function EscolherNumero({ numeros, valor, onMudar, id }) {
  if (numeros.length <= 1) return null;
  return (
    <label className="at-detalhe" style={{ margin: 0 }} htmlFor={id}>
      <span style={{ color: 'var(--tinta)', fontWeight: 600 }}>Número</span>
      <select id={id} className="at-select" value={valor} onChange={(e) => onMudar(Number(e.target.value))}>
        {numeros.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.endereco_exibicao ? ` · ${c.endereco_exibicao}` : ''}</option>)}
      </select>
    </label>
  );
}

// ===========================================================================
// MODELOS
// ===========================================================================
function Modelos({ numeros }) {
  const [canalId, setCanalId] = useState((numeros.find((c) => c.ativo && c.config?.wabaId) || numeros[0]).id);
  const [lista, setLista] = useState(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [aberto, setAberto] = useState('');
  const [novo, setNovo] = useState(false);
  const [filtro, setFiltro] = useState('');

  const carregar = useCallback(async () => {
    setErro('');
    try { const r = await chamarApi('/api/atendimento', { acao: 'whatsapp_modelos', canalId }); setLista(r.modelos || []); }
    catch (e) { setErro(e.message); setLista([]); }
  }, [canalId]);
  useEffect(() => { setLista(null); carregar(); }, [carregar]);

  async function excluir(m) {
    if (!window.confirm(`Excluir o modelo “${m.nome}” (${IDIOMAS_MODELO[m.idioma] || m.idioma})? Isso não tem volta, e a Meta não deixa usar o mesmo nome por 4 semanas.`)) return;
    setErro(''); setAviso('');
    try { await chamarApi('/api/atendimento', { acao: 'modelo_excluir', canalId, nome: m.nome, id: m.id }); setAviso(`Modelo “${m.nome}” excluído.`); carregar(); }
    catch (e) { setErro(e.message); }
  }

  const visiveis = (lista || []).filter((m) => !filtro || m.situacao === filtro);
  const contagem = (lista || []).reduce((a, m) => ({ ...a, [m.situacao]: (a[m.situacao] || 0) + 1 }), {});
  return (
    <section className="at-cartao">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>📋 Modelos do WhatsApp</h2>
        <div className="at-botoes" style={{ marginTop: 0, alignItems: 'center' }}>
          <EscolherNumero numeros={numeros} valor={canalId} onMudar={setCanalId} id="wm-numero" />
          <button type="button" className="at-btn" onClick={carregar}>🔄 Atualizar</button>
          <button type="button" className="at-btn at-btn-verde" onClick={() => setNovo(true)}>➕ Novo modelo</button>
        </div>
      </div>
      <p className="at-dica">
        Modelo é a mensagem aprovada pela Meta. É o único jeito de mandar mensagem para quem não escreveu nas últimas 24 horas
        (automações, campanhas e reabrir conversa). Depois de criado, a Meta analisa em minutos ou horas.
      </p>
      {novo && (
        <FormModelo
          canalId={canalId} existentes={lista || []} onFechar={() => setNovo(false)}
          onCriado={(r) => { setNovo(false); setAviso(`✅ Modelo “${r.nome}” enviado para a Meta (${SITUACAO_MODELO[r.situacao]?.rotulo || r.situacao}). Clique em Atualizar daqui a pouco para ver se foi aprovado.`); carregar(); }}
        />
      )}
      {aviso && <div className="aviso-erro" style={{ background: '#E5F4EA', color: '#14532D' }}>{aviso}</div>}
      {erro && <div className="aviso-erro">{erro}</div>}
      {lista === null ? <div className="at-vazio">Buscando os modelos na Meta…</div> : (
        <>
          <div className="at-filtros-mais" style={{ margin: '10px 0' }}>
            <label><span>Situação</span>
              <select className="at-select" value={filtro} onChange={(e) => setFiltro(e.target.value)}>
                <option value="">Todos ({inteiro(lista.length)})</option>
                {Object.entries(SITUACAO_MODELO).filter(([k]) => contagem[k]).map(([k, v]) => <option key={k} value={k}>{v.rotulo} ({contagem[k]})</option>)}
              </select>
            </label>
          </div>
          {visiveis.length === 0 ? <div className="at-vazio">Nenhum modelo.</div> : (
            <div className="at-tabela-rolagem">
              <table className="at-tabela at-tabela-previa">
                <thead><tr><th>Nome</th><th>Categoria</th><th>Idioma</th><th>Situação</th><th>Texto</th><th>Em uso</th><th /></tr></thead>
                <tbody>
                  {visiveis.map((m) => {
                    const chave = `${m.nome}|${m.idioma}`;
                    const uso = [...(m.usoAutomacoes || []).map((t) => `🔁 ${AUTOMACAO_POR_TIPO[t]?.titulo || t}`), ...(m.usoCampanhas || []).map((n) => `📣 ${n}`)];
                    return (
                      <tr key={chave}>
                        <td><strong>{m.nome}</strong></td>
                        <td>{categoriaTexto(m.categoria)}</td>
                        <td>{IDIOMAS_MODELO[m.idioma] || m.idioma}</td>
                        <td>
                          <Chip estilo={SITUACAO_MODELO[m.situacao]?.cor}>{SITUACAO_MODELO[m.situacao]?.rotulo || m.situacao}</Chip>
                          {m.motivoRecusa && <div className="at-dica" style={{ margin: '4px 0 0' }}>Motivo: {m.motivoRecusa}</div>}
                        </td>
                        <td style={{ maxWidth: 380 }}>
                          {aberto === chave ? (
                            <div className="at-previa-modelo" style={{ marginTop: 0 }}>
                              {m.cabecalho && <strong>{m.cabecalho}{'\n'}</strong>}{m.corpo}{m.rodape ? `\n${m.rodape}` : ''}
                              {(m.botoesDetalhe || []).length > 0 && `\n\n${m.botoesDetalhe.map((b) => `[${b.texto}${b.url ? ` → ${b.url}` : ''}]`).join(' ')}`}
                            </div>
                          ) : <span>{String(m.corpo || '').slice(0, 90)}{String(m.corpo || '').length > 90 ? '…' : ''}</span>}
                        </td>
                        <td>{uso.length ? uso.map((u) => <div key={u} className="at-dica" style={{ margin: 0 }}>{u}</div>) : '—'}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <button type="button" className="at-link-pequeno" onClick={() => setAberto(aberto === chave ? '' : chave)}>{aberto === chave ? 'Fechar' : 'Ver'}</button>
                          <button type="button" className="at-link-pequeno" style={{ marginLeft: 8, color: '#B42318' }} onClick={() => excluir(m)}>Excluir</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
const VAZIO = { nome: '', categoria: 'MARKETING', idioma: 'pt_BR', cabecalho: '', exemploCabecalho: '', corpo: '', exemplos: [], rodape: '', botoes: [] };
const maiorVariavel = (texto) => Math.max(0, ...[...String(texto || '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((x) => Number(x[1])));

function FormModelo({ canalId, existentes, onCriado, onFechar }) {
  const origem = typeof window !== 'undefined' ? window.location.origin : '';
  const prontos = useMemo(() => modelosProntos(origem), [origem]);
  const [m, setM] = useState(VAZIO);
  const [pronto, setPronto] = useState('');
  const [tentou, setTentou] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const corpoRef = useRef(null);

  const qtd = maiorVariavel(m.corpo);
  const erros = validarModeloNovo(m);
  const nomeFinal = normalizarNomeModelo(m.nome);
  const repetido = existentes.some((x) => x.nome === nomeFinal && x.idioma === m.idioma);
  const temVarCab = /\{\{\s*1\s*\}\}/.test(m.cabecalho);
  const previa = montarTextoModelo({ cabecalho: m.cabecalho, corpo: m.corpo, rodape: m.rodape }, { corpo: m.exemplos, cabecalho: [m.exemploCabecalho] });
  const usarEm = prontos.find((p) => p.chave === pronto)?.usarEm;

  function usarPronto(chave) {
    setPronto(chave);
    const p = prontos.find((x) => x.chave === chave);
    if (!p) { setM(VAZIO); return; }
    setM({ ...VAZIO, nome: p.chave, categoria: p.categoria, cabecalho: p.cabecalho || '', corpo: p.corpo, exemplos: [...p.exemplos], rodape: p.rodape || '', botoes: p.botoes.map((b) => ({ ...b })) });
  }

  function addVariavel() {
    const n = qtd + 1;
    const el = corpoRef.current;
    const ini = el ? el.selectionStart : m.corpo.length;
    const fim = el ? el.selectionEnd : m.corpo.length;
    const corpo = `${m.corpo.slice(0, ini)}{{${n}}}${m.corpo.slice(fim)}`;
    setM({ ...m, corpo });
    setTimeout(() => { if (el) { el.focus(); el.selectionStart = el.selectionEnd = ini + `{{${n}}}`.length; } }, 0);
  }

  const mudarBotao = (i, campos) => setM({ ...m, botoes: m.botoes.map((b, k) => (k === i ? { ...b, ...campos } : b)) });
  const linkDoSistema = (b) => b.url === `${origem}/r/{{1}}`;

  async function enviar() {
    setTentou(true);
    setErro('');
    if (erros.length || repetido) return;
    setOcupado(true);
    try { const r = await chamarApi('/api/atendimento', { acao: 'modelo_criar', canalId, modelo: { ...m, nome: nomeFinal } }); onCriado(r); }
    catch (e) { setErro(e.message); }
    setOcupado(false);
  }

  return (
    <div className="at-canal" style={{ background: '#FAFBF9', margin: '10px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>Novo modelo</h3>
        <button type="button" className="at-btn" onClick={onFechar}>Fechar</button>
      </div>
      <label className="rotulo" htmlFor="mn-pronto">Começar de um modelo pronto (textos do Asksuite)</label>
      <select id="mn-pronto" className="campo" value={pronto} onChange={(e) => usarPronto(e.target.value)}>
        <option value="">Em branco</option>
        {prontos.map((p) => <option key={p.chave} value={p.chave}>{p.titulo}</option>)}
      </select>
      {usarEm && <p className="at-dica" style={{ margin: '4px 0 0' }}>💡 Para usar em: {usarEm}</p>}

      <div className="at-grade" style={{ marginTop: 10 }}>
        <div>
          <label className="rotulo" htmlFor="mn-nome">Nome (só letras minúsculas, números e _)</label>
          <input id="mn-nome" className="campo" value={m.nome} onChange={(e) => setM({ ...m, nome: e.target.value })} placeholder="ex.: promocao_natal" />
          {m.nome && nomeFinal !== m.nome && <span className="at-dica" style={{ display: 'block', margin: 0 }}>Vai ficar: <code>{nomeFinal}</code></span>}
          {repetido && <span className="at-ruim" style={{ display: 'block', fontSize: 13 }}>Já existe um modelo com esse nome neste idioma.</span>}
        </div>
        <div>
          <label className="rotulo" htmlFor="mn-idioma">Idioma</label>
          <select id="mn-idioma" className="campo" value={m.idioma} onChange={(e) => setM({ ...m, idioma: e.target.value })}>
            {Object.entries(IDIOMAS_MODELO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>
      <span className="rotulo">Categoria</span>
      <div className="at-botoes" style={{ marginTop: 0, flexWrap: 'wrap' }}>
        {Object.entries(CATEGORIAS_MODELO).map(([k, v]) => (
          <label key={k} className="at-reserva" style={{ flex: '1 1 260px', margin: 0, cursor: 'pointer', borderColor: m.categoria === k ? 'var(--verde, #1B6B4F)' : undefined }}>
            <input type="radio" name="mn-categoria" checked={m.categoria === k} onChange={() => setM({ ...m, categoria: k })} /> <strong>{v.rotulo}</strong>
            <div className="at-dica" style={{ margin: '2px 0 0' }}>{v.dica}</div>
          </label>
        ))}
      </div>

      <label className="rotulo" htmlFor="mn-cab">Título (opcional, até 60 letras)</label>
      <input id="mn-cab" className="campo" maxLength={60} value={m.cabecalho} onChange={(e) => setM({ ...m, cabecalho: e.target.value })} />
      {temVarCab && (
        <><label className="rotulo" htmlFor="mn-excab">Exemplo para {'{{1}}'} do título</label>
          <input id="mn-excab" className="campo" value={m.exemploCabecalho} onChange={(e) => setM({ ...m, exemploCabecalho: e.target.value })} /></>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 10 }}>
        <label className="rotulo" htmlFor="mn-corpo">Texto da mensagem ({m.corpo.length}/1.024)</label>
        <button type="button" className="at-btn" onClick={addVariavel}>＋ Variável {`{{${qtd + 1}}}`}</button>
      </div>
      <textarea id="mn-corpo" ref={corpoRef} className="campo" rows={6} value={m.corpo} onChange={(e) => setM({ ...m, corpo: e.target.value })}
        placeholder="Olá, {{1}}! …" />
      <span className="at-dica" style={{ display: 'block', margin: 0 }}>
        Variável é a parte que muda para cada cliente (ex.: o nome). O que vai nela você escolhe depois, na automação ou na campanha. *negrito* e _itálico_ funcionam no WhatsApp.
      </span>
      {qtd > 0 && (
        <div className="at-grade" style={{ marginTop: 6 }}>
          {Array.from({ length: qtd }, (_, i) => (
            <label key={i}><span className="rotulo">Exemplo para {`{{${i + 1}}}`}</span>
              <input className="campo" value={m.exemplos[i] || ''} onChange={(e) => { const ex = [...m.exemplos]; ex[i] = e.target.value; setM({ ...m, exemplos: ex }); }} placeholder={i === 0 ? 'Maria' : ''} />
            </label>
          ))}
        </div>
      )}

      <label className="rotulo" htmlFor="mn-rodape">Rodapé (opcional, até 60 letras)</label>
      <input id="mn-rodape" className="campo" maxLength={60} value={m.rodape} onChange={(e) => setM({ ...m, rodape: e.target.value })} />
      {m.categoria === 'MARKETING' && !m.rodape && (
        <button type="button" className="at-link-pequeno" onClick={() => setM({ ...m, rodape: 'Para não receber mais, responda SAIR' })}>Usar “Para não receber mais, responda SAIR” (recomendado em marketing)</button>
      )}

      <span className="rotulo" style={{ marginTop: 10 }}>Botões (opcional)</span>
      {m.botoes.map((b, i) => (
        <div key={i} className="at-reserva" style={{ marginTop: 6 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <strong>{b.tipo === 'URL' ? '🔗 Link' : '↩️ Resposta rápida'}</strong>
            <input className="campo" style={{ flex: '1 1 180px', margin: 0 }} maxLength={25} value={b.texto} onChange={(e) => mudarBotao(i, { texto: e.target.value })} placeholder="Texto do botão (até 25 letras)" aria-label={`Texto do botão ${i + 1}`} />
            <button type="button" className="at-link-pequeno" onClick={() => setM({ ...m, botoes: m.botoes.filter((_, k) => k !== i) })}>Remover</button>
          </div>
          {b.tipo === 'URL' && (
            <>
              <label className="at-dica" style={{ display: 'flex', gap: 6, alignItems: 'center', margin: '6px 0' }}>
                <input type="checkbox" checked={linkDoSistema(b)} onChange={(e) => mudarBotao(i, e.target.checked ? { url: `${origem}/r/{{1}}`, exemplo: 'AB12CD34-0' } : { url: 'https://', exemplo: '' })} />
                Link “Reservar agora” da cotação (o sistema completa o final do link)
              </label>
              {!linkDoSistema(b) && (
                <div className="at-grade">
                  <label><span className="rotulo">Endereço (https://…; para um final que muda, termine com {'{{1}}'})</span>
                    <input className="campo" value={b.url} onChange={(e) => mudarBotao(i, { url: e.target.value })} /></label>
                  {/\{\{\s*1\s*\}\}$/.test(b.url) && (
                    <label><span className="rotulo">Exemplo do final do link</span>
                      <input className="campo" value={b.exemplo || ''} onChange={(e) => mudarBotao(i, { exemplo: e.target.value })} /></label>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      ))}
      <div className="at-botoes">
        <button type="button" className="at-btn" disabled={m.botoes.length >= 10} onClick={() => setM({ ...m, botoes: [...m.botoes.filter((b) => b.tipo === 'QUICK_REPLY'), { tipo: 'QUICK_REPLY', texto: '' }, ...m.botoes.filter((b) => b.tipo === 'URL')] })}>＋ Resposta rápida</button>
        <button type="button" className="at-btn" disabled={m.botoes.filter((b) => b.tipo === 'URL').length >= 2 || m.botoes.length >= 10} onClick={() => setM({ ...m, botoes: [...m.botoes, { tipo: 'URL', texto: '', url: `${origem}/r/{{1}}`, exemplo: 'AB12CD34-0' }] })}>＋ Link</button>
      </div>

      <span className="rotulo" style={{ marginTop: 10 }}>Como o cliente vai ver (com os exemplos)</span>
      <div className="at-previa-modelo">
        {previa || '…'}
        {m.botoes.length > 0 && `\n\n${m.botoes.map((b) => `[${b.texto || '…'}]`).join(' ')}`}
      </div>

      {(tentou || m.corpo) && erros.length > 0 && (
        <ul className="at-dica" style={{ color: '#B42318', margin: '8px 0 0', paddingLeft: 18 }}>
          {erros.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}
      {erro && <div className="aviso-erro" style={{ marginTop: 8 }}>{erro}</div>}
      <div className="at-botoes">
        <button type="button" className="at-btn at-btn-verde" onClick={enviar} disabled={ocupado || (tentou && (erros.length > 0 || repetido))}>{ocupado ? 'Enviando…' : '📤 Enviar para a Meta aprovar'}</button>
        <button type="button" className="at-btn" onClick={onFechar}>Cancelar</button>
      </div>
    </div>
  );
}

// ===========================================================================
// CAMPANHAS
// ===========================================================================
function Campanhas({ hotelId, onAbrirConversa }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [nova, setNova] = useState(false);
  const [envios, setEnvios] = useState(null);
  const [aviso, setAviso] = useState('');

  const carregar = useCallback(async () => {
    try { const r = await chamarApi('/api/atendimento', { acao: 'campanhas', hotelId }); setDados(r); setErro(''); }
    catch (e) { setErro(e.message); }
  }, [hotelId]);
  useEffect(() => { carregar(); }, [carregar]);
  const andando = (dados?.campanhas || []).some((c) => ['AGENDADA', 'ENVIANDO'].includes(c.situacao));
  useEffect(() => {
    if (!andando) return undefined;
    const id = setInterval(carregar, 30000);
    return () => clearInterval(id);
  }, [andando, carregar]);

  async function mudar(c, mudanca) {
    if (mudanca === 'cancelar' && !window.confirm(`Cancelar a campanha “${c.nome}”? O que ainda não saiu não será enviado.`)) return;
    setErro(''); setAviso('');
    try { await chamarApi('/api/atendimento', { acao: 'campanha_mudar', campanhaId: c.id, mudanca }); await carregar(); }
    catch (e) { setErro(e.message); }
  }

  return (
    <>
      <div className="aviso-erro" style={{ background: '#FFF4D6', color: '#7A5600' }}>
        ⚠️ Pela política do WhatsApp, só mande campanha para quem aceitou receber mensagens do hotel. Mensagem de marketing para quem não pediu
        gera bloqueios e denúncias, e a Meta pode limitar o número. Cada mensagem é cobrada. Quem responder “SAIR” não recebe mais.
      </div>
      {aviso && <div className="aviso-erro" style={{ background: '#E5F4EA', color: '#14532D' }}>{aviso}</div>}
      {erro && <div className="aviso-erro">{erro}</div>}
      {nova && dados && (
        <NovaCampanha
          hotelId={hotelId} canais={dados.canais} precos={dados.precos} onFechar={() => setNova(false)}
          onCriada={(c) => { setNova(false); setAviso(`✅ Campanha “${c.nome}” criada para ${inteiro(c.total)} cliente(s). ${new Date(c.agendada_para).getTime() > Date.now() + 60000 ? `Começa em ${dataHora(c.agendada_para)}.` : 'Começa a sair em até 2 minutos.'}`); carregar(); }}
        />
      )}
      <section className="at-cartao">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>📣 Campanhas</h2>
          <div className="at-botoes" style={{ marginTop: 0 }}>
            <button type="button" className="at-btn" onClick={carregar}>🔄 Atualizar</button>
            {!nova && <button type="button" className="at-btn at-btn-verde" onClick={() => setNova(true)} disabled={!dados}>➕ Nova campanha</button>}
          </div>
        </div>
        {!dados && !erro && <div className="at-vazio">Carregando…</div>}
        {dados && dados.campanhas.length === 0 && <div className="at-vazio">Nenhuma campanha ainda.</div>}
        {dados && dados.campanhas.length > 0 && (
          <div className="at-tabela-rolagem">
            <table className="at-tabela at-tabela-previa">
              <thead>
                <tr><th>Campanha</th><th>Situação</th><th className="num">Público</th><th className="num">Enviadas</th><th className="num">Entregues</th><th className="num">Lidas</th>
                  <th className="num">Responderam</th><th className="num">Falharam</th><th className="num">Saíram</th><th className="num">Reservas</th><th className="num">Custo ≈</th><th /></tr>
              </thead>
              <tbody>
                {dados.campanhas.map((c) => {
                  const r = c.resumo || {};
                  const sit = SITUACOES_CAMPANHA[c.situacao] || {};
                  return (
                    <tr key={c.id}>
                      <td>
                        <strong>{c.nome}</strong>
                        <div className="at-dica" style={{ margin: 0 }}>Modelo {c.modelo_nome} · {c.situacao === 'AGENDADA' ? `começa ${dataHora(c.agendada_para)}` : `criada ${dataHora(c.criado_em)}`}{c.expira_em ? ` · até ${dataHora(c.expira_em)}` : ''}</div>
                        {c.etiqueta && <div className="at-dica" style={{ margin: 0 }}>🏷️ {c.etiqueta}{c.robo_responde ? '' : ' · robô em silêncio'}</div>}
                        {!c.etiqueta && !c.robo_responde && <div className="at-dica" style={{ margin: 0 }}>Robô em silêncio nas respostas</div>}
                        {c.aviso && <div className="at-ruim" style={{ fontSize: 13 }}>⚠️ {c.aviso}</div>}
                      </td>
                      <td><Chip estilo={sit.cor}>{sit.rotulo || c.situacao}</Chip>{Number(r.pendentes) > 0 && <div className="at-dica" style={{ margin: 0 }}>{inteiro(r.pendentes)} na fila</div>}</td>
                      <td className="num">{inteiro(c.total)}</td>
                      <td className="num">{inteiro(r.enviados)}</td>
                      <td className="num">{inteiro(r.entregues)}</td>
                      <td className="num">{inteiro(r.lidos)}</td>
                      <td className="num">{inteiro(r.responderam)}</td>
                      <td className="num">{inteiro(Number(r.falhas || 0) + Number(r.pulados || 0))}</td>
                      <td className="num">{inteiro(r.sairam)}</td>
                      <td className="num">{inteiro(r.reservas)}{Number(r.valor) > 0 ? <div className="at-dica" style={{ margin: 0 }}>{reais(r.valor)}</div> : null}</td>
                      <td className="num">{reais(Number(r.enviados || 0) * Number(c.preco_unitario || 0))}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button type="button" className="at-link-pequeno" onClick={() => setEnvios(c)}>Ver envios</button>
                        {['AGENDADA', 'ENVIANDO'].includes(c.situacao) && <button type="button" className="at-link-pequeno" style={{ marginLeft: 8 }} onClick={() => mudar(c, 'pausar')}>Pausar</button>}
                        {c.situacao === 'PAUSADA' && <button type="button" className="at-link-pequeno" style={{ marginLeft: 8 }} onClick={() => mudar(c, 'retomar')}>Retomar</button>}
                        {['AGENDADA', 'ENVIANDO', 'PAUSADA'].includes(c.situacao) && <button type="button" className="at-link-pequeno" style={{ marginLeft: 8, color: '#B42318' }} onClick={() => mudar(c, 'cancelar')}>Cancelar</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="at-dica">As mensagens saem aos poucos (cerca de 40 a cada 2 minutos). “Responderam” conta respostas em até 72 h; “Reservas”, reservas que entraram na Cloudbeds em até 30 dias.</p>
      </section>
      {envios && <EnviosCampanha campanha={envios} onFechar={() => setEnvios(null)} onAbrirConversa={onAbrirConversa} />}
    </>
  );
}

// ---------------------------------------------------------------------------
function EnviosCampanha({ campanha, onFechar, onAbrirConversa }) {
  const [lista, setLista] = useState(null);
  const [situacao, setSituacao] = useState('');
  const [erro, setErro] = useState('');
  useEffect(() => {
    let ativo = true;
    setLista(null);
    chamarApi('/api/atendimento', { acao: 'campanha_envios', campanhaId: campanha.id, situacao: situacao || undefined })
      .then((r) => { if (ativo) setLista(r.envios || []); })
      .catch((e) => { if (ativo) { setErro(e.message); setLista([]); } });
    return () => { ativo = false; };
  }, [campanha.id, situacao]);
  function exportar() {
    baixarCsv(`campanha-${campanha.id}.csv`, ['Cliente', 'Telefone', 'Situação', 'Entrega', 'Motivo', 'Enviado em', 'Saiu'],
      (lista || []).map((e) => [e.nome || '', `+${e.telefone}`, SITUACOES_ENVIO[e.situacao] || e.situacao, ENTREGA[e.entrega] || '', e.motivo || e.erroEntrega || '', e.enviado_em ? dataHora(e.enviado_em) : '', e.saiu_em ? 'sim' : '']));
  }
  return (
    <div className="at-overlay" role="dialog" aria-modal="true" aria-label="Envios da campanha">
      <div className="at-modal at-modal-largo">
        <div className="at-modal-topo">
          <h2>Envios — {campanha.nome}</h2>
          <button type="button" className="at-btn" onClick={onFechar} aria-label="Fechar">✕</button>
        </div>
        <div className="at-filtros-mais" style={{ margin: '6px 0 10px' }}>
          <label><span>Situação</span>
            <select className="at-select" value={situacao} onChange={(e) => setSituacao(e.target.value)}>
              <option value="">Todas</option>
              {Object.entries(SITUACOES_ENVIO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <button type="button" className="at-btn" onClick={exportar} disabled={!(lista || []).length}>⬇ Exportar</button>
        </div>
        {erro && <div className="aviso-erro">{erro}</div>}
        {lista === null ? <div className="at-vazio">Carregando…</div> : lista.length === 0 ? <div className="at-vazio">Nada aqui.</div> : (
          <div className="at-tabela-rolagem">
            <table className="at-tabela at-tabela-previa">
              <thead><tr><th>Cliente</th><th>Situação</th><th>Detalhe</th><th>Quando</th><th /></tr></thead>
              <tbody>
                {lista.map((e) => (
                  <tr key={e.id}>
                    <td>{e.nome || '—'}<div className="at-dica" style={{ margin: 0 }}>{telefoneBonito(e.telefone)}</div></td>
                    <td>{SITUACOES_ENVIO[e.situacao] || e.situacao}{e.entrega && e.situacao === 'ENVIADO' ? ` · ${ENTREGA[e.entrega] || e.entrega}` : ''}{e.saiu_em ? ' · 🚫 saiu' : ''}</td>
                    <td>{e.motivo || e.erroEntrega || ''}</td>
                    <td>{e.enviado_em ? dataHora(e.enviado_em) : ''}</td>
                    <td>{e.conversa_id && <button type="button" className="at-link-pequeno" onClick={() => { onFechar(); onAbrirConversa(e.conversa_id); }}>Abrir conversa</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {(lista || []).length >= 1000 && <p className="at-dica">Mostrando os primeiros 1.000. Use o filtro de situação.</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function sugestaoVariavel(nome, i) {
  const t = String(nome || '').toLowerCase();
  if (/hotel|empresa/.test(t)) return { fonte: 'hotel', valor: '' };
  if (/nome|viajante|cliente/.test(t) || (!nome && i === 0)) return { fonte: 'primeiro_nome', valor: '' };
  return { fonte: 'fixo', valor: '' };
}

function CampoVariavel({ rotulo, valor, onMudar, colunas, soLink }) {
  const fontes = Object.entries(FONTES_VARIAVEL).filter(([k]) => (soLink ? ['fixo', 'coluna'].includes(k) : true) && (k !== 'coluna' || colunas.length));
  return (
    <div className="at-reserva" style={{ marginTop: 6 }}>
      <span className="rotulo" style={{ marginTop: 0 }}>{rotulo}</span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select className="campo" style={{ flex: '1 1 200px', margin: 0 }} value={valor?.fonte || ''} onChange={(e) => onMudar({ fonte: e.target.value, valor: e.target.value === 'coluna' ? colunas[0] || '' : '' })} aria-label={`Fonte de ${rotulo}`}>
          <option value="">Escolha…</option>
          {fontes.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {valor?.fonte === 'fixo' && <input className="campo" style={{ flex: '2 1 220px', margin: 0 }} value={valor.valor || ''} onChange={(e) => onMudar({ ...valor, valor: e.target.value })} placeholder="Texto" aria-label={`Texto de ${rotulo}`} />}
        {valor?.fonte === 'coluna' && (
          <select className="campo" style={{ flex: '2 1 220px', margin: 0 }} value={valor.valor || ''} onChange={(e) => onMudar({ ...valor, valor: e.target.value })} aria-label={`Coluna de ${rotulo}`}>
            {colunas.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>
    </div>
  );
}

function NovaCampanha({ hotelId, canais, precos, onCriada, onFechar }) {
  const ativos = canais.filter((c) => c.ativo && c.temWaba);
  const [nome, setNome] = useState('');
  const [canalId, setCanalId] = useState(ativos[0]?.id || '');
  const [modelos, setModelos] = useState(null);
  const [chaveModelo, setChaveModelo] = useState('');
  const [variaveis, setVariaveis] = useState([]);
  const [variaveisCab, setVariaveisCab] = useState([]);
  const [botoes, setBotoes] = useState([]);
  const [tipo, setTipo] = useState('CONTATOS');
  const [filtros, setFiltros] = useState({ mostrar: '', periodo: '', idioma: '', etiqueta: '', busca: '' });
  const [planilha, setPlanilha] = useState(null);
  const [etiqueta, setEtiqueta] = useState('');
  const [roboResponde, setRoboResponde] = useState(true);
  const [quando, setQuando] = useState('agora');
  const [agendada, setAgendada] = useState('');
  const [expira, setExpira] = useState('');
  const [previa, setPrevia] = useState(null);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!canalId) { setModelos([]); return undefined; }
    let ativo = true;
    setModelos(null);
    chamarApi('/api/atendimento', { acao: 'modelos', canalId: Number(canalId) })
      .then((r) => { if (ativo) setModelos((r.modelos || []).filter((m) => !m.cabecalhoMidia)); })
      .catch((e) => { if (ativo) { setModelos([]); setErro(e.message); } });
    return () => { ativo = false; };
  }, [canalId]);

  const modelo = (modelos || []).find((m) => `${m.nome}|${m.idioma}` === chaveModelo);
  const colunas = planilha?.cabecalho || [];
  const preco = String(modelo?.categoria).toUpperCase() === 'UTILITY' ? precos.utilidade : precos.marketing;

  // Qualquer mudança: a prévia precisa ser vista de novo
  useEffect(() => { setPrevia(null); }, [nome, canalId, chaveModelo, variaveis, variaveisCab, botoes, tipo, filtros, planilha, etiqueta, roboResponde, quando, agendada, expira]);

  function escolherModelo(chave) {
    setChaveModelo(chave);
    const m = (modelos || []).find((x) => `${x.nome}|${x.idioma}` === chave);
    setVariaveis(m ? Array.from({ length: m.variaveisCorpo }, (_, i) => sugestaoVariavel(m.nomesCorpo?.[i], i)) : []);
    setVariaveisCab(m ? Array.from({ length: m.variaveisCabecalho }, (_, i) => sugestaoVariavel(m.nomesCabecalho?.[i], 1)) : []);
    setBotoes(m ? (m.botoesLink || []).map(() => ({ fonte: 'fixo', valor: '' })) : []);
  }

  async function lerArquivo(arquivo) {
    setErro('');
    if (!arquivo) { setPlanilha(null); return; }
    if (/\.xlsx?$/i.test(arquivo.name)) { setErro('Salve a planilha como CSV (no Excel: Arquivo → Salvar como → CSV) e escolha o arquivo de novo.'); return; }
    if (arquivo.size > 5 * 1024 * 1024) { setErro('A planilha pode ter até 5 MB.'); return; }
    const linhas = lerCsv(await arquivo.text());
    if (linhas.length < 2) { setErro('A planilha precisa de uma linha de títulos e pelo menos um cliente.'); return; }
    const cabecalho = linhas[0].map((c, i) => String(c || '').trim() || `Coluna ${i + 1}`);
    const colTel = cabecalho.findIndex((c) => RE_TELEFONE.test(c));
    const colNome = cabecalho.findIndex((c) => RE_NOME.test(c));
    setPlanilha({ arquivo: arquivo.name, cabecalho, linhas: linhas.slice(1), colTel: colTel >= 0 ? colTel : 0, colNome });
  }

  function exemploPlanilha() {
    baixarCsv('modelo-campanha.csv', ['telefone', 'nome', 'cidade'], [['83988887777', 'Maria Souza', 'Recife'], ['83977776666', 'João Lima', 'Natal']]);
  }

  function entrada() {
    const publico = tipo === 'PLANILHA' && planilha
      ? {
        tipo: 'PLANILHA',
        linhas: planilha.linhas.slice(0, LIMITE_CAMPANHA * 2).map((l) => ({
          telefone: l[planilha.colTel] || '', nome: planilha.colNome >= 0 ? l[planilha.colNome] || '' : '',
          colunas: Object.fromEntries(planilha.cabecalho.map((c, i) => [c, l[i] ?? ''])),
        })),
      }
      : { tipo: 'CONTATOS', filtros };
    return {
      nome, canal_id: Number(canalId), modelo_nome: modelo?.nome, modelo_idioma: modelo?.idioma,
      variaveis, variaveis_cabecalho: variaveisCab, botoes, publico, etiqueta, robo_responde: roboResponde,
      agendada_para: quando === 'agendar' && agendada ? new Date(agendada).toISOString() : null,
      expira_em: expira ? new Date(expira).toISOString() : null,
    };
  }

  async function verPrevia() {
    setErro(''); setOcupado(true);
    if (tipo === 'PLANILHA' && !planilha) { setErro('Escolha a planilha (CSV).'); setOcupado(false); return; }
    if (quando === 'agendar' && !agendada) { setErro('Escolha a data e a hora do envio.'); setOcupado(false); return; }
    try { setPrevia(await chamarApi('/api/atendimento', { acao: 'campanha_previa', hotelId, campanha: entrada() })); }
    catch (e) { setErro(e.message); }
    setOcupado(false);
  }

  async function criar() {
    if (!previa) return;
    if (!window.confirm(`Enviar a campanha “${nome}” para ${inteiro(previa.total)} cliente(s)?\nCusto estimado: ${reais(previa.custo)} (modelo de ${categoriaTexto(previa.categoria).toLowerCase()}).`)) return;
    setErro(''); setOcupado(true);
    try {
      const r = await chamarApi('/api/atendimento', { acao: 'campanha_criar', hotelId, campanha: { ...entrada(), confirmar_total: previa.total } });
      onCriada(r.campanha);
    } catch (e) { setErro(e.message); setPrevia(null); }
    setOcupado(false);
  }

  const ex = previa?.excluidos || {};
  const foraDaLista = Number(ex.sem_numero || 0) + Number(ex.repetidos || 0) + Number(ex.sairam || 0) + Number(ex.acima_do_limite || 0);
  return (
    <section className="at-cartao" style={{ background: '#FAFBF9' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>Nova campanha</h2>
        <button type="button" className="at-btn" onClick={onFechar}>Fechar</button>
      </div>
      {ativos.length === 0 && <div className="aviso-erro">Nenhum número de WhatsApp ligado com o “ID da conta do WhatsApp Business” (aba ⚙️ Canais).</div>}

      <h3 style={{ margin: '12px 0 4px', fontSize: 15 }}>1. Mensagem</h3>
      <div className="at-grade">
        <div>
          <label className="rotulo" htmlFor="nc-nome">Nome da campanha</label>
          <input id="nc-nome" className="campo" maxLength={120} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="ex.: Promoção de Natal" />
        </div>
        {ativos.length > 1 && (
          <div>
            <label className="rotulo" htmlFor="nc-numero">Número que envia</label>
            <select id="nc-numero" className="campo" value={canalId} onChange={(e) => { setCanalId(Number(e.target.value)); setChaveModelo(''); }}>
              {ativos.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.numero ? ` · ${c.numero}` : ''}</option>)}
            </select>
          </div>
        )}
      </div>
      <label className="rotulo" htmlFor="nc-modelo">Modelo aprovado</label>
      <select id="nc-modelo" className="campo" value={chaveModelo} onChange={(e) => escolherModelo(e.target.value)} disabled={!modelos}>
        <option value="">{modelos === null ? 'Lendo os modelos na Meta…' : 'Escolha…'}</option>
        {(modelos || []).map((m) => <option key={`${m.nome}|${m.idioma}`} value={`${m.nome}|${m.idioma}`}>{m.nome} ({m.idioma} · {categoriaTexto(m.categoria).toLowerCase()})</option>)}
      </select>
      <span className="at-dica" style={{ display: 'block', margin: 0 }}>Não achou o modelo? Crie em 📋 Modelos (a Meta aprova em minutos ou horas).</span>
      {modelo && (
        <div className="at-previa-modelo">
          {modelo.cabecalho ? `*${modelo.cabecalho}*\n` : ''}{modelo.corpo}{modelo.rodape ? `\n_${modelo.rodape}_` : ''}{modelo.botoes?.length ? `\n\n[${modelo.botoes.join('] [')}]` : ''}
        </div>
      )}

      <h3 style={{ margin: '14px 0 4px', fontSize: 15 }}>2. Quem recebe</h3>
      <div className="at-botoes" style={{ marginTop: 0, flexWrap: 'wrap' }}>
        <label className="at-reserva" style={{ flex: '1 1 240px', margin: 0, cursor: 'pointer' }}>
          <input type="radio" name="nc-tipo" checked={tipo === 'CONTATOS'} onChange={() => setTipo('CONTATOS')} /> <strong>Contatos do sistema</strong>
          <div className="at-dica" style={{ margin: '2px 0 0' }}>Clientes da aba 👥 Contatos que têm WhatsApp.</div>
        </label>
        <label className="at-reserva" style={{ flex: '1 1 240px', margin: 0, cursor: 'pointer' }}>
          <input type="radio" name="nc-tipo" checked={tipo === 'PLANILHA'} onChange={() => setTipo('PLANILHA')} /> <strong>Planilha (CSV)</strong>
          <div className="at-dica" style={{ margin: '2px 0 0' }}>Uma linha por cliente, com telefone e nome. Outras colunas podem ir nas variáveis.</div>
        </label>
      </div>
      {tipo === 'CONTATOS' && (
        <div className="at-filtros-mais" style={{ marginTop: 8 }}>
          <label><span>Mostrar</span>
            <select className="at-select" value={filtros.mostrar} onChange={(e) => setFiltros({ ...filtros, mostrar: e.target.value })}>
              {Object.entries(FILTROS_CONTATOS.mostrar).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label><span>Com movimento</span>
            <select className="at-select" value={filtros.periodo} onChange={(e) => setFiltros({ ...filtros, periodo: e.target.value })}>
              {Object.entries(FILTROS_CONTATOS.periodo).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label><span>Idioma contém</span><input className="campo at-campo-pequeno" value={filtros.idioma} onChange={(e) => setFiltros({ ...filtros, idioma: e.target.value })} placeholder="ex.: Português" /></label>
          <label><span>Etiqueta (Asksuite) contém</span><input className="campo at-campo-pequeno" value={filtros.etiqueta} onChange={(e) => setFiltros({ ...filtros, etiqueta: e.target.value })} placeholder="ex.: Reservou" /></label>
          <label><span>Nome ou observação</span><input className="campo at-campo-pequeno" value={filtros.busca} onChange={(e) => setFiltros({ ...filtros, busca: e.target.value })} /></label>
        </div>
      )}
      {tipo === 'PLANILHA' && (
        <div className="at-reserva" style={{ marginTop: 8 }}>
          <input type="file" accept=".csv,text/csv" onChange={(e) => lerArquivo(e.target.files?.[0])} aria-label="Planilha de clientes (CSV)" />
          <button type="button" className="at-link-pequeno" style={{ marginLeft: 8 }} onClick={exemploPlanilha}>⬇ Baixar planilha de exemplo</button>
          {planilha && (
            <div className="at-grade" style={{ marginTop: 8 }}>
              <p className="at-dica" style={{ margin: 0 }}>{planilha.arquivo}: {inteiro(planilha.linhas.length)} linha(s).</p>
              <label><span className="rotulo">Coluna do telefone</span>
                <select className="campo" value={planilha.colTel} onChange={(e) => setPlanilha({ ...planilha, colTel: Number(e.target.value) })}>
                  {planilha.cabecalho.map((c, i) => <option key={c} value={i}>{c}</option>)}
                </select></label>
              <label><span className="rotulo">Coluna do nome</span>
                <select className="campo" value={planilha.colNome} onChange={(e) => setPlanilha({ ...planilha, colNome: Number(e.target.value) })}>
                  <option value={-1}>(sem nome)</option>
                  {planilha.cabecalho.map((c, i) => <option key={c} value={i}>{c}</option>)}
                </select></label>
            </div>
          )}
        </div>
      )}

      {modelo && (variaveis.length > 0 || variaveisCab.length > 0 || botoes.length > 0) && (
        <>
          <h3 style={{ margin: '14px 0 4px', fontSize: 15 }}>3. O que vai em cada variável</h3>
          {variaveisCab.map((v, i) => (
            <CampoVariavel key={`c${i}`} rotulo={`Título ${rotuloVariavel(i, modelo.nomesCabecalho)}`} valor={v} colunas={tipo === 'PLANILHA' ? colunas : []}
              onMudar={(x) => setVariaveisCab(variaveisCab.map((y, k) => (k === i ? x : y)))} />
          ))}
          {variaveis.map((v, i) => (
            <CampoVariavel key={`v${i}`} rotulo={`${rotuloVariavel(i, modelo.nomesCorpo)} no texto`} valor={v} colunas={tipo === 'PLANILHA' ? colunas : []}
              onMudar={(x) => setVariaveis(variaveis.map((y, k) => (k === i ? x : y)))} />
          ))}
          {botoes.map((v, i) => (
            <CampoVariavel key={`b${i}`} soLink rotulo={`Final do link do botão “${modelo.botoesLink[i]?.texto}” (${baseDoLink(modelo.botoesLink[i]?.url)}…)`} valor={v}
              colunas={tipo === 'PLANILHA' ? colunas : []} onMudar={(x) => setBotoes(botoes.map((y, k) => (k === i ? x : y)))} />
          ))}
          <span className="at-dica" style={{ display: 'block', margin: '4px 0 0' }}>Cliente sem nome cadastrado recebe “cliente” no lugar do nome.</span>
        </>
      )}

      <h3 style={{ margin: '14px 0 4px', fontSize: 15 }}>{modelo && (variaveis.length || variaveisCab.length || botoes.length) ? '4' : '3'}. Envio</h3>
      <div className="at-grade">
        <div>
          <label className="rotulo" htmlFor="nc-etiqueta">Etiqueta na conversa (opcional)</label>
          <input id="nc-etiqueta" className="campo" maxLength={40} value={etiqueta} onChange={(e) => setEtiqueta(e.target.value)} placeholder="ex.: Campanha Natal" />
        </div>
        <label className="at-reserva" style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '22px 0 0', cursor: 'pointer' }}>
          <input type="checkbox" checked={roboResponde} onChange={(e) => setRoboResponde(e.target.checked)} />
          <span>O robô responde a quem responder a campanha</span>
        </label>
      </div>
      <div className="at-grade">
        <div>
          <span className="rotulo">Quando</span>
          <div className="at-botoes" style={{ marginTop: 0, alignItems: 'center' }}>
            <label><input type="radio" name="nc-quando" checked={quando === 'agora'} onChange={() => setQuando('agora')} /> Agora</label>
            <label><input type="radio" name="nc-quando" checked={quando === 'agendar'} onChange={() => setQuando('agendar')} /> Agendar</label>
            {quando === 'agendar' && <input className="campo" style={{ margin: 0, maxWidth: 230 }} type="datetime-local" value={agendada} onChange={(e) => setAgendada(e.target.value)} aria-label="Data e hora do envio" />}
          </div>
        </div>
        <div>
          <label className="rotulo" htmlFor="nc-expira">Parar de enviar em (opcional)</label>
          <input id="nc-expira" className="campo" type="datetime-local" value={expira} onChange={(e) => setExpira(e.target.value)} />
          <span className="at-dica" style={{ display: 'block', margin: 0 }}>Ex.: promoção que acaba no domingo. O que não saiu até lá é cancelado.</span>
        </div>
      </div>

      {erro && <div className="aviso-erro" style={{ marginTop: 10 }}>{erro}</div>}
      {previa && (
        <div className="at-reserva" style={{ marginTop: 10, background: '#fff' }}>
          <strong>Prévia: {inteiro(previa.total)} cliente(s) vão receber.</strong>
          {foraDaLista > 0 && (
            <div className="at-dica" style={{ margin: '4px 0 0' }}>
              Ficaram de fora: {[ex.sairam && `${inteiro(ex.sairam)} pediram para sair`, ex.sem_numero && `${inteiro(ex.sem_numero)} sem número válido`, ex.repetidos && `${inteiro(ex.repetidos)} repetidos`, ex.acima_do_limite && `${inteiro(ex.acima_do_limite)} acima do limite de ${inteiro(LIMITE_CAMPANHA)}`].filter(Boolean).join(' · ')}.
            </div>
          )}
          <div className="at-dica" style={{ margin: '4px 0 0' }}>Custo estimado: <strong>{reais(previa.custo)}</strong> ({reais(previa.preco)} por mensagem de {categoriaTexto(previa.categoria).toLowerCase()}; confira na fatura da Meta).</div>
          {(previa.exemplos || []).map((x) => (
            <div key={x.telefone} style={{ marginTop: 8 }}>
              <div className="at-dica" style={{ margin: 0 }}>{x.nome || 'Sem nome'} · {telefoneBonito(x.telefone)}</div>
              <div className="at-previa-modelo" style={{ marginTop: 4 }}>{x.texto}</div>
            </div>
          ))}
        </div>
      )}
      <div className="at-botoes">
        <button type="button" className="at-btn" onClick={verPrevia} disabled={ocupado || !modelo || !nome.trim()}>{ocupado && !previa ? 'Calculando…' : '👀 Ver prévia'}</button>
        <button type="button" className="at-btn at-btn-verde" onClick={criar} disabled={ocupado || !previa || !previa.total}>
          📣 {previa ? `Enviar para ${inteiro(previa.total)} cliente(s)` : 'Enviar'}
        </button>
        <span className="at-dica" style={{ margin: 0 }}>{previa ? `≈ ${reais(previa.custo)}` : modelo ? `${reais(preco)} por mensagem` : ''}</span>
      </div>
    </section>
  );
}
