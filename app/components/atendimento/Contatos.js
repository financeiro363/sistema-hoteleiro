'use client';

// ============================================================================
// CAIXA DE ENTRADA — aba Contatos
// ============================================================================
// Um cadastro por cliente (ligado sozinho pelo telefone do WhatsApp ou pelo
// e-mail). Aqui dá para procurar, editar, ver o histórico de conversas,
// começar conversa, juntar dois contatos da mesma pessoa, importar a planilha
// exportada do Asksuite (CSV) e exportar tudo para planilha.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import {
  chamarApi, dataHora, lerCsv, baixarCsv, ICONE_CANAL, NOME_CANAL, STATUS_CONVERSA, iniciais,
} from './util';

const POR_PAGINA = 100;
const limparBusca = (t) => String(t || '').replace(/[,()%*\\]/g, ' ').trim();

function telefoneBonito(t) {
  const d = String(t || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
    const resto = d.slice(4);
    return `+55 (${d.slice(2, 4)}) ${resto.slice(0, resto.length - 4)}-${resto.slice(-4)}`;
  }
  return `+${d}`;
}

function aplicarFiltros(q, { hotel, busca, mostrar }) {
  let r = q;
  if (hotel) r = r.eq('hotel_id', Number(hotel));
  if (mostrar === 'importados') r = r.eq('origem', 'IMPORTADO');
  if (mostrar === 'conversaram') r = r.neq('origem', 'IMPORTADO');
  const termo = limparBusca(busca);
  if (termo) {
    const t = `%${termo}%`;
    const digitos = termo.replace(/\D/g, '');
    r = r.or(`nome.ilike.${t},email.ilike.${t}${digitos.length >= 4 ? `,telefone.ilike.%${digitos}%` : ''},observacoes.ilike.${t}`);
  }
  return r;
}

// ---------------------------------------------------------------------------
export function Contatos({ hoteis, multiHotel, onAbrirConversa, onNovaConversa }) {
  const [lista, setLista] = useState([]);
  const [total, setTotal] = useState(0);
  const [qtdConversas, setQtdConversas] = useState({});
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [busca, setBusca] = useState('');
  const [hotel, setHotel] = useState('');
  const [mostrar, setMostrar] = useState('');
  const [ordem, setOrdem] = useState('atualizado');
  const [aberto, setAberto] = useState(null);
  const [importar, setImportar] = useState(false);
  const [exportando, setExportando] = useState(false);
  const nomesHoteis = Object.fromEntries((hoteis || []).map((h) => [h.id, h.nome]));
  const pedido = useRef(0);

  const ordenar = useCallback((q) => (ordem === 'nome'
    ? q.order('nome', { ascending: true, nullsFirst: false }).order('id')
    : q.order(ordem === 'criado' ? 'criado_em' : 'atualizado_em', { ascending: false }).order('id', { ascending: false })), [ordem]);

  const carregar = useCallback(async (mais = false) => {
    const meu = ++pedido.current;
    setCarregando(true);
    const de = mais ? lista.length : 0;
    const { data, error, count } = await ordenar(aplicarFiltros(
      supabase.from('atendimento_contatos').select('*', { count: 'exact' }), { hotel, busca, mostrar },
    )).range(de, de + POR_PAGINA - 1);
    if (meu !== pedido.current) return;
    if (error) {
      setErro(/atendimento_contatos|schema cache|does not exist/i.test(error.message)
        ? 'Falta rodar no Supabase o SQL da Fase 2 da Caixa de Entrada.' : 'Não foi possível carregar os contatos: ' + error.message);
      setCarregando(false);
      return;
    }
    setErro('');
    const novos = mais ? [...lista, ...(data || [])] : (data || []);
    setLista(novos);
    setTotal(count || 0);
    const ids = (data || []).map((c) => c.id);
    if (ids.length) {
      const { data: convs } = await supabase.from('atendimento_conversas').select('contato_id').in('contato_id', ids).limit(5000);
      const contagem = {};
      (convs || []).forEach((c) => { contagem[c.contato_id] = (contagem[c.contato_id] || 0) + 1; });
      setQtdConversas((antes) => ({ ...(mais ? antes : {}), ...Object.fromEntries(ids.map((id) => [id, contagem[id] || 0])) }));
    }
    setCarregando(false);
  }, [hotel, busca, mostrar, ordenar, lista]);

  // Recarrega ao mudar filtros (com uma pequena espera na busca)
  useEffect(() => {
    const id = setTimeout(() => carregar(false), busca ? 350 : 0);
    return () => clearTimeout(id);
  }, [hotel, busca, mostrar, ordem]); // eslint-disable-line react-hooks/exhaustive-deps

  async function exportar() {
    setExportando(true);
    setErro('');
    try {
      const todos = [];
      for (let de = 0; ; de += 1000) {
        const { data, error } = await ordenar(aplicarFiltros(supabase.from('atendimento_contatos').select('*'), { hotel, busca, mostrar })).range(de, de + 999);
        if (error) throw error;
        todos.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
      const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Fortaleza' });
      baixarCsv(`contatos-${hoje}.csv`,
        ['Nome', 'Telefone', 'E-mail', 'Idioma', 'Etiquetas', 'Hotel', 'Origem', 'Criado em', 'Atualizado em', 'Observações'],
        todos.map((c) => [c.nome || '', c.telefone ? `+${c.telefone}` : '', c.email || '', c.idioma || '', c.etiquetas_importadas || '',
          nomesHoteis[c.hotel_id] || c.hotel_id, c.origem || '', dataHora(c.criado_em), dataHora(c.atualizado_em), c.observacoes || '']));
    } catch (e) { setErro('Não foi possível exportar: ' + e.message); }
    setExportando(false);
  }

  return (
    <section className="at-cartao">
      <div className="at-canal-topo">
        <div>
          <h2>👥 Contatos</h2>
          <p className="at-dica" style={{ margin: 0 }}>{total.toLocaleString('pt-BR')} contato{total === 1 ? '' : 's'}{hotel || busca || mostrar ? ' com esses filtros' : ''}. Novos clientes entram sozinhos quando escrevem pelo WhatsApp ou e-mail.</p>
        </div>
        <div className="at-botoes" style={{ marginTop: 0 }}>
          <button type="button" className="at-btn" onClick={() => setAberto({ novo: true, hotel_id: Number(hotel) || hoteis[0]?.id })}>+ Novo contato</button>
          <button type="button" className="at-btn" onClick={() => setImportar(true)}>⬆ Importar planilha</button>
          <button type="button" className="at-btn" onClick={exportar} disabled={exportando || !total}>{exportando ? 'Exportando…' : '⬇ Exportar planilha'}</button>
        </div>
      </div>

      <div className="at-filtros-mais" style={{ marginTop: 10 }}>
        <input className="campo at-campo-pequeno" style={{ flex: '1 1 220px' }} type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="🔎 Nome, telefone, e-mail ou observação" />
        {multiHotel && (
          <label><span>Hotel</span>
            <select className="at-select" value={hotel} onChange={(e) => setHotel(e.target.value)}>
              <option value="">Todos</option>
              {hoteis.map((h) => <option key={h.id} value={h.id}>{h.nome}</option>)}
            </select>
          </label>
        )}
        <label><span>Mostrar</span>
          <select className="at-select" value={mostrar} onChange={(e) => setMostrar(e.target.value)}>
            <option value="">Todos</option>
            <option value="conversaram">Que já conversaram</option>
            <option value="importados">Importados de planilha</option>
          </select>
        </label>
        <label><span>Ordem</span>
          <select className="at-select" value={ordem} onChange={(e) => setOrdem(e.target.value)}>
            <option value="atualizado">Última atualização</option>
            <option value="criado">Mais novos</option>
            <option value="nome">Nome (A–Z)</option>
          </select>
        </label>
      </div>

      {erro && <div className="aviso-erro">{erro}</div>}

      <div className="at-tabela-rolagem">
        <table className="at-tabela">
          <thead>
            <tr>
              <th>Nome</th><th>Telefone</th><th>E-mail</th><th>Idioma</th><th>Etiquetas</th>
              {multiHotel && <th>Hotel</th>}
              <th className="num">Conversas</th><th>Criado em</th><th>Atualizado em</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((c) => (
              <tr key={c.id} onClick={() => setAberto(c)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setAberto(c); }}>
                <td data-rotulo="Nome"><span className="at-avatar at-avatar-mini">{iniciais(c.nome || c.email || c.telefone)}</span> <strong>{c.nome || '—'}</strong></td>
                <td data-rotulo="Telefone">{telefoneBonito(c.telefone) || '—'}</td>
                <td data-rotulo="E-mail">{c.email || '—'}</td>
                <td data-rotulo="Idioma">{c.idioma || '—'}</td>
                <td data-rotulo="Etiquetas" className="at-td-etq">{c.etiquetas_importadas || '—'}</td>
                {multiHotel && <td data-rotulo="Hotel">{nomesHoteis[c.hotel_id] || '—'}</td>}
                <td data-rotulo="Conversas" className="num">{qtdConversas[c.id] ?? '…'}</td>
                <td data-rotulo="Criado em">{dataHora(c.criado_em)}</td>
                <td data-rotulo="Atualizado em">{dataHora(c.atualizado_em)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!carregando && !lista.length && !erro && <div className="at-vazio">Nenhum contato encontrado.</div>}
        {carregando && <div className="at-vazio">Carregando…</div>}
      </div>
      {!carregando && lista.length < total && (
        <div style={{ textAlign: 'center', marginTop: 10 }}>
          <button type="button" className="at-btn" onClick={() => carregar(true)}>Carregar mais ({(total - lista.length).toLocaleString('pt-BR')} restantes)</button>
        </div>
      )}

      {aberto && (
        <FichaContato
          contato={aberto}
          hoteis={hoteis}
          multiHotel={multiHotel}
          onFechar={() => setAberto(null)}
          onMudou={() => { setAberto(null); carregar(false); }}
          onAbrirConversa={(id) => { setAberto(null); onAbrirConversa(id); }}
          onNovaConversa={(inicial) => { setAberto(null); onNovaConversa(inicial); }}
        />
      )}
      {importar && <ImportarContatos hoteis={hoteis} multiHotel={multiHotel} onFechar={() => setImportar(false)} onImportado={() => carregar(false)} />}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Ficha: editar, histórico, conversar, juntar, excluir
function FichaContato({ contato, hoteis, multiHotel, onFechar, onMudou, onAbrirConversa, onNovaConversa }) {
  const novo = !!contato.novo;
  const [form, setForm] = useState({
    hotel_id: contato.hotel_id, nome: contato.nome || '', telefone: contato.telefone ? telefoneBonito(contato.telefone) : '',
    email: contato.email || '', idioma: contato.idioma || '', observacoes: contato.observacoes || '',
  });
  const [historico, setHistorico] = useState(null);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [juntar, setJuntar] = useState(false);
  const [buscaJuntar, setBuscaJuntar] = useState('');
  const [candidatos, setCandidatos] = useState([]);

  useEffect(() => {
    if (novo) { setHistorico([]); return; }
    supabase.from('atendimento_conversas').select('id, canal_tipo, assunto, status, criado_em, ultima_mensagem_em, ultima_mensagem_resumo')
      .eq('contato_id', contato.id).order('ultima_mensagem_em', { ascending: false, nullsFirst: false }).limit(50)
      .then(({ data }) => setHistorico(data || []));
  }, [contato.id, novo]);

  useEffect(() => {
    if (!juntar) return undefined;
    const termo = limparBusca(buscaJuntar);
    const id = setTimeout(async () => {
      let q = supabase.from('atendimento_contatos').select('id, nome, telefone, email, criado_em').eq('hotel_id', contato.hotel_id).neq('id', contato.id);
      if (termo) {
        const digitos = termo.replace(/\D/g, '');
        q = q.or(`nome.ilike.%${termo}%,email.ilike.%${termo}%${digitos.length >= 4 ? `,telefone.ilike.%${digitos}%` : ''}`);
      }
      const { data } = await q.order('atualizado_em', { ascending: false }).limit(8);
      setCandidatos(data || []);
    }, 300);
    return () => clearTimeout(id);
  }, [juntar, buscaJuntar, contato.id, contato.hotel_id]);

  function dadosDoForm() {
    const tel = String(form.telefone || '').replace(/\D/g, '').replace(/^0+/, '');
    const email = String(form.email || '').trim().toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('E-mail inválido.');
    if (!tel && !email && !String(form.nome).trim()) throw new Error('Preencha pelo menos o nome, o telefone ou o e-mail.');
    return {
      nome: String(form.nome || '').trim() || null,
      telefone: tel ? ((tel.length === 10 || tel.length === 11) && !String(form.telefone).trim().startsWith('+') ? `55${tel}` : tel) : null,
      email: email || null,
      idioma: String(form.idioma || '').trim() || null,
      observacoes: String(form.observacoes || '').trim() || null,
      atualizado_em: new Date().toISOString(),
    };
  }

  async function salvar() {
    setErro('');
    let dados;
    try { dados = dadosDoForm(); } catch (e) { setErro(e.message); return; }
    setSalvando(true);
    const { error } = novo
      ? await supabase.from('atendimento_contatos').insert({ ...dados, hotel_id: Number(form.hotel_id), origem: 'MANUAL' })
      : await supabase.from('atendimento_contatos').update(dados).eq('id', contato.id);
    setSalvando(false);
    if (error) { setErro('Não foi possível salvar: ' + error.message); return; }
    onMudou();
  }

  async function juntarCom(outro) {
    const nomeOutro = outro.nome || outro.email || telefoneBonito(outro.telefone);
    if (!window.confirm(`Juntar “${nomeOutro}” neste contato?\n\nAs conversas dele passam para cá e os dados que faltam aqui são copiados. O outro cadastro deixa de existir.`)) return;
    setSalvando(true);
    setErro('');
    const { error } = await supabase.rpc('atendimento_juntar_contatos', { p_manter: contato.id, p_remover: outro.id });
    setSalvando(false);
    if (error) { setErro('Não foi possível juntar: ' + error.message); return; }
    onMudou();
  }

  async function excluir() {
    if (!window.confirm('Excluir este contato? (Só é possível porque ele não tem conversas.)')) return;
    setSalvando(true);
    const { error } = await supabase.from('atendimento_contatos').delete().eq('id', contato.id);
    setSalvando(false);
    if (error) { setErro('Não foi possível excluir: ' + error.message); return; }
    onMudou();
  }

  const tel = String(contato.telefone || '').replace(/\D/g, '');
  return (
    <div className="at-overlay" role="dialog" aria-modal="true" aria-label={novo ? 'Novo contato' : 'Contato'}>
      <div className="at-modal at-modal-largo">
        <div className="at-modal-topo">
          <h2>{novo ? 'Novo contato' : (contato.nome || contato.email || telefoneBonito(contato.telefone) || 'Contato')}</h2>
          <button type="button" className="at-btn" onClick={onFechar} aria-label="Fechar">✕</button>
        </div>
        {!novo && <p className="at-dica" style={{ marginTop: 0 }}>Cliente desde {dataHora(contato.criado_em)}{multiHotel ? ` · ${hoteis.find((h) => h.id === contato.hotel_id)?.nome || ''}` : ''}{contato.origem === 'IMPORTADO' ? ' · importado de planilha' : ''}</p>}

        {!novo && (
          <div className="at-botoes" style={{ marginTop: 0, marginBottom: 8 }}>
            {tel && <button type="button" className="at-btn" onClick={() => onNovaConversa({ tipo: 'WHATSAPP', para: tel, nome: contato.nome || '', hotelId: contato.hotel_id })}>🟢 Conversar no WhatsApp</button>}
            {contato.email && <button type="button" className="at-btn" onClick={() => onNovaConversa({ tipo: 'EMAIL', para: contato.email, nome: contato.nome || '', hotelId: contato.hotel_id })}>✉️ Enviar e-mail</button>}
            <button type="button" className="at-btn" onClick={() => setJuntar(!juntar)}>🔗 Juntar com outro contato</button>
          </div>
        )}

        {juntar && (
          <div className="at-canal" style={{ background: '#FAFBF9', marginTop: 0 }}>
            <p className="at-dica" style={{ marginTop: 0 }}>Use quando a mesma pessoa aparece duas vezes (ex.: uma pelo WhatsApp e outra pelo e-mail). Procure o outro cadastro:</p>
            <input className="campo at-campo-pequeno" value={buscaJuntar} onChange={(e) => setBuscaJuntar(e.target.value)} placeholder="Nome, telefone ou e-mail" />
            {candidatos.map((o) => (
              <div key={o.id} className="at-dado" style={{ alignItems: 'center' }}>
                <span>{o.nome || '—'} · {telefoneBonito(o.telefone) || o.email || '—'}</span>
                <button type="button" className="at-btn" onClick={() => juntarCom(o)} disabled={salvando}>Juntar aqui</button>
              </div>
            ))}
            {!candidatos.length && <p className="at-dica">Nenhum outro contato encontrado.</p>}
          </div>
        )}

        {novo && multiHotel && (
          <>
            <label className="rotulo" htmlFor="fc-hotel">Hotel</label>
            <select id="fc-hotel" className="campo" value={form.hotel_id} onChange={(e) => setForm({ ...form, hotel_id: Number(e.target.value) })}>
              {hoteis.map((h) => <option key={h.id} value={h.id}>{h.nome}</option>)}
            </select>
          </>
        )}
        <div className="at-grade">
          <div><label className="rotulo" htmlFor="fc-nome">Nome</label><input id="fc-nome" className="campo" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></div>
          <div><label className="rotulo" htmlFor="fc-idioma">Idioma</label><input id="fc-idioma" className="campo" value={form.idioma} placeholder="Português" onChange={(e) => setForm({ ...form, idioma: e.target.value })} /></div>
          <div><label className="rotulo" htmlFor="fc-tel">Telefone / WhatsApp</label><input id="fc-tel" className="campo" inputMode="tel" value={form.telefone} placeholder="(83) 98888-7777" onChange={(e) => setForm({ ...form, telefone: e.target.value })} /></div>
          <div><label className="rotulo" htmlFor="fc-email">E-mail</label><input id="fc-email" className="campo" inputMode="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
        </div>
        <label className="rotulo" htmlFor="fc-obs">Observações</label>
        <textarea id="fc-obs" className="campo" rows={3} value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} placeholder="Ex.: prefere quarto em andar alto; empresa X" />
        {contato.etiquetas_importadas && <p className="at-dica">Etiquetas que vieram do Asksuite: {contato.etiquetas_importadas}</p>}

        {erro && <div className="aviso-erro" style={{ marginTop: 10 }}>{erro}</div>}
        <div className="at-botoes">
          <button type="button" className="at-btn at-btn-verde" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
          <button type="button" className="at-btn" onClick={onFechar}>Cancelar</button>
          {!novo && historico && historico.length === 0 && <button type="button" className="at-btn at-btn-perigo" onClick={excluir} disabled={salvando}>Excluir</button>}
        </div>

        {!novo && (
          <>
            <p className="at-lateral-titulo" style={{ marginTop: 18 }}>Histórico de conversas</p>
            {historico === null ? <p className="at-dica">Carregando…</p> : historico.length === 0 ? <p className="at-dica">Ainda não conversou com o hotel por aqui.</p> : historico.map((h) => (
              <button key={h.id} type="button" className="at-historico" onClick={() => onAbrirConversa(h.id)}>
                <span>{ICONE_CANAL[h.canal_tipo]} {h.assunto || NOME_CANAL[h.canal_tipo]} <small>· {STATUS_CONVERSA[h.status] || h.status}</small></span>
                <small>{dataHora(h.ultima_mensagem_em || h.criado_em)} — {h.ultima_mensagem_resumo || '—'}</small>
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Importar planilha (CSV) — por exemplo, a exportada do Asksuite
const CAMPOS = [
  ['nome', 'Nome', /^(nome|name|contato|cliente|full ?name)/i],
  ['telefone', 'Telefone / WhatsApp', /(telefone|phone|celular|whats|fone|mobile|n[uú]mero)/i],
  ['email', 'E-mail', /e-?mail/i],
  ['idioma', 'Idioma', /(idioma|language|l[ií]ngua|lang)/i],
  ['etiquetas', 'Etiquetas', /(etiqueta|tag|label|marcador)/i],
  ['criado_em', 'Data de criação', /(cria|created|cadastr|primeir)/i],
  ['atualizado_em', 'Última atualização', /(atualiz|updated|[uú]ltim|modific)/i],
  ['observacoes', 'Observações', /(obs|nota|note|coment)/i],
];

function ImportarContatos({ hoteis, multiHotel, onFechar, onImportado }) {
  const [hotelId, setHotelId] = useState(hoteis[0]?.id || '');
  const [linhas, setLinhas] = useState(null);
  const [colunas, setColunas] = useState([]);
  const [mapa, setMapa] = useState({});
  const [erro, setErro] = useState('');
  const [progresso, setProgresso] = useState(null);
  const [resultado, setResultado] = useState(null);

  async function escolher(e) {
    const arquivo = e.target.files?.[0];
    e.target.value = '';
    setErro(''); setResultado(null);
    if (!arquivo) return;
    if (/\.xlsx?$/i.test(arquivo.name)) {
      setErro('Este arquivo é do Excel. Abra no Excel e use “Salvar como” → “CSV UTF-8 (separado por vírgulas)”. Depois escolha o arquivo .csv aqui.');
      return;
    }
    const texto = await arquivo.text();
    const tabela = lerCsv(texto);
    if (tabela.length < 2) { setErro('Não encontrei contatos nesse arquivo. Confira se a primeira linha tem os títulos das colunas.'); return; }
    const cab = tabela[0].map((c) => String(c).trim());
    const novoMapa = {};
    CAMPOS.forEach(([chave, , regra]) => {
      const i = cab.findIndex((c, idx) => regra.test(c) && !Object.values(novoMapa).includes(idx) && !(chave === 'nome' && /hotel/i.test(c)));
      if (i >= 0) novoMapa[chave] = i;
    });
    setColunas(cab);
    setMapa(novoMapa);
    setLinhas(tabela.slice(1));
  }

  async function importar() {
    if (mapa.telefone === undefined && mapa.email === undefined) { setErro('Escolha qual coluna tem o telefone ou o e-mail.'); return; }
    setErro('');
    const registros = linhas.map((l) => Object.fromEntries(CAMPOS.map(([chave]) => [chave, mapa[chave] !== undefined ? (l[mapa[chave]] ?? '') : ''])));
    const soma = { novos: 0, atualizados: 0, ignorados: 0 };
    try {
      for (let i = 0; i < registros.length; i += 500) {
        setProgresso({ feito: i, total: registros.length });
        const r = await chamarApi('/api/atendimento', { acao: 'importar_contatos', hotelId: Number(hotelId), linhas: registros.slice(i, i + 500) });
        soma.novos += r.novos; soma.atualizados += r.atualizados; soma.ignorados += r.ignorados;
      }
      setResultado(soma);
      onImportado();
    } catch (e) { setErro(e.message); }
    setProgresso(null);
  }

  const exemplo = linhas?.slice(0, 3) || [];
  return (
    <div className="at-overlay" role="dialog" aria-modal="true" aria-label="Importar contatos">
      <div className="at-modal at-modal-largo">
        <div className="at-modal-topo">
          <h2>Importar contatos</h2>
          <button type="button" className="at-btn" onClick={onFechar} aria-label="Fechar">✕</button>
        </div>
        <ol className="at-passos">
          <li>No Asksuite, vá em <strong>Contatos → Exportar</strong> (ou use qualquer planilha com nome, telefone e e-mail).</li>
          <li>Se o arquivo for Excel (.xlsx), salve como <strong>CSV</strong>.</li>
          <li>Escolha o arquivo abaixo, confira as colunas e clique em Importar.</li>
        </ol>
        <p className="at-dica">Contatos que já existem (mesmo telefone ou e-mail) não são duplicados: só completamos o que faltar.</p>

        {multiHotel && (
          <>
            <label className="rotulo" htmlFor="ic-hotel">Importar para o hotel</label>
            <select id="ic-hotel" className="campo" value={hotelId} onChange={(e) => setHotelId(e.target.value)}>
              {hoteis.map((h) => <option key={h.id} value={h.id}>{h.nome}</option>)}
            </select>
          </>
        )}
        <label className="rotulo" htmlFor="ic-arquivo">Arquivo CSV</label>
        <input id="ic-arquivo" className="campo" type="file" accept=".csv,text/csv,.txt,.xlsx,.xls" onChange={escolher} />

        {linhas && !resultado && (
          <>
            <p style={{ fontWeight: 700, marginBottom: 4 }}>{linhas.length.toLocaleString('pt-BR')} linha(s) encontrada(s). Confira as colunas:</p>
            <div className="at-grade">
              {CAMPOS.map(([chave, rotulo]) => (
                <label key={chave} className="at-detalhe" style={{ justifyContent: 'space-between' }}>
                  <span>{rotulo}</span>
                  <select className="at-select" value={mapa[chave] ?? ''} onChange={(e) => setMapa({ ...mapa, [chave]: e.target.value === '' ? undefined : Number(e.target.value) })}>
                    <option value="">— não importar —</option>
                    {colunas.map((c, i) => <option key={i} value={i}>{c || `Coluna ${i + 1}`}</option>)}
                  </select>
                </label>
              ))}
            </div>
            {exemplo.length > 0 && (
              <div className="at-tabela-rolagem" style={{ marginTop: 8 }}>
                <table className="at-tabela at-tabela-previa">
                  <thead><tr>{CAMPOS.filter(([c]) => mapa[c] !== undefined).map(([c, r]) => <th key={c}>{r}</th>)}</tr></thead>
                  <tbody>{exemplo.map((l, i) => <tr key={i}>{CAMPOS.filter(([c]) => mapa[c] !== undefined).map(([c]) => <td key={c}>{l[mapa[c]]}</td>)}</tr>)}</tbody>
                </table>
              </div>
            )}
          </>
        )}

        {progresso && <p className="at-dica">Importando… {progresso.feito.toLocaleString('pt-BR')} de {progresso.total.toLocaleString('pt-BR')}</p>}
        {resultado && (
          <div className="aviso-erro" style={{ background: '#DDF2E4', color: '#1E6B3C', marginTop: 10 }}>
            Pronto! {resultado.novos} contato(s) novo(s), {resultado.atualizados} completado(s){resultado.ignorados ? ` e ${resultado.ignorados} linha(s) sem telefone nem e-mail ignorada(s)` : ''}.
          </div>
        )}
        {erro && <div className="aviso-erro" style={{ marginTop: 10 }}>{erro}</div>}
        <div className="at-botoes">
          {!resultado && <button type="button" className="at-btn at-btn-verde" onClick={importar} disabled={!linhas || !!progresso}>Importar</button>}
          <button type="button" className="at-btn" onClick={onFechar}>{resultado ? 'Fechar' : 'Cancelar'}</button>
        </div>
      </div>
    </div>
  );
}
